const _ = require('lodash');
const system = require('../../lib/system');
const { SCENARIO_EXECUTION_EVENTS } = require('../constants');
const ThreadGroup = require('./ThreadGroup');
const { createError, CONSTANTS } = require('../../lib/communication');
const { log } = require('../../lib/logging');
const { killAllChildProcesses } = require('../../lib/process-management');
const ExtendedHeap = require('./ExtendedHeap');

const WORKER_MIN_ENDURANCE = 7; // This will be set when a workload is assigned to Engine
const WORKER_MAX_ENDURANCE = 10;
const HEAP_LIMIT_PER_PROCESS = 1024 * 1024 * 1024; // 1 GB

/**
 * This is the strategy for heaping the threads in the active pool.
 * This will be used to heapify threads in the active pool such that the thread with
 * the least assigned scenarios will be at the top of the heap.
 *
 * @param {Object} threadA - Thread object
 * @param {Object} threadB - Thread object
 *
 * @returns {Number} - 1 if threadA is greater than threadB, -1 if threadA is less than threadB, 0 if threadA is equal to threadB
 */
const activeThreadsHeapingStrategy = (threadA, threadB) => {
  return threadA.assigned - threadB.assigned;
};


/**
 * The ExecutionEngine class is responsible for distributing the workload across the worker threads to achieve
 * parallelism. It is also responsible for managing the lifecycle of the worker threads such that the worker threads
 * are not idle for too long and are not overworked and not holding on to too much memory.
 *
 * It creates a pool of worker threads and distributes the workload across them via round-robin scheduling.
 * It is responsible for assigning scenarios to the worker threads and also for stopping the worker threads.
 *
 * There are some internal component that work together to achieve the same. They are:
 * 1. ThreadGroups: which are independent processes acting as containers/holders for the threads, since there is a hard
 *    limit of 4GB on the memory that can be used by a node process. These thread-groups will act like memory containers
 *    for the threads. To allocate more memory to the threads, we will be spinning up thread containers proportionally to
 *    the amount of available memory.
 *
 *    The thread groups will be dumb containers for the threads. They will not be aware of any business logic. They will
 *    act like a proxy between the threads and the parent process. They will be responsible for forwarding the messages
 *    from the threads to the parent process and vice-versa.
 *
 * 2. Workers aka WorkerThreads: These are the actual threads that will be executing the scenarios. They will be spawned
 *    by the thread groups and will be executing the scenarios. They will be sending the runtime events to the thread
 *    groups which will be forwarding them to the parent process.
 *
 * @class ExecutionEngine
 * @singleton
 *
 * @param {Object} options - Options for the ExecutionEngine
 * @param {Function} options.runtimeEventHandler - Event handler for the runtime events
 */
module.exports = class ExecutionEngine {
  // We'll be forking one or more workers to execute scenarios within. Maintaining a map of these workers
  // will allow us to manage their lifecycles and judiciously spin up new workers only when we need them. This is a
  // map of worker names to the actual WorkerThread objects. We will also be enforcing a limit on the number of workers
  // to be started.
  pools = {
    reserve: new Map(),

    // ExtendedHeap is equivalent to Heap class with added ability to make constant time lookups for nodes.
    // This class will heapify the threads based on the number of scenarios assigned to them. Which will
    // be used to distribute the workload across the threads in a least utilization manner.
    // The thread with the least number of assigned scenarios will be at the top of the heap and will be chosen for the
    // next assignment in O(1) time.
    active: new ExtendedHeap(activeThreadsHeapingStrategy),
    draining: new Map(),
  };

  // This will be a map of sequence ids to the thread ids. This will be used to kill the assigned
  // scenario on a thread. Engine will use this to figure out the container and thread for a sequence,
  // to be able to create a signal for killing it. Using this it will determine the correct container and
  // correct thread inside container for targeting the signal.
  sequenceAssignmentMap = new Map();

  // This will be a map of thread group ids to the thread group objects. This will be used to manage the lifecycle of
  // the thread groups. We will be starting and stopping the thread groups based on the workload assigned to them in a
  // round-robin fashion.
  groups = new Map();
  poolSize = 0; // This will be set when startup is called

  // Pointer for holding reference to any pre-constructed instance of this class to enforce a singleton of this class.
  static instance = null;

  constructor (options) {
    if (ExecutionEngine.instance) {
      return ExecutionEngine.instance;
    }

    this.options = options;
    this.groupIdPool = [];
    this.lastAllocatedGroupId = -1;

    // We don't want to start workers until we absolutely need to, to minimize our footprint outside of execution
    // concerns within the app. This class will have a one-time initialization step which will be tracked using the
    // initializing and initialized flags.
    this.initializing = false;
    this.initialized = false;

    // This flag will be used to track if the worker manager is stopping or not. This will be used to prevent any
    // new workers from being started or any new scenarios from being assigned to the workers.
    this.stopped = false;

    // This flag is set to true when an execution is terminated
    this.killing = false;

    // Endurance is the number of scenarios each worker will be allowed to run before it is killed
    // For each run, we pick a minimum and maximum endurance that the workers need to have
    // and for each worker we pick its endurance as a random number between the min and max
    this.minimumWorkerEndurance = WORKER_MIN_ENDURANCE;
    this.maximumWorkerEndurance = WORKER_MAX_ENDURANCE;

    // This should always be the last line in the constructor such that it can be preserved in the singleton.
    ExecutionEngine.instance = this;

    log.info('ExecutionEngine: Created');
  }

  _getNumberOfPossibleGroups = async () => {
    // Decide number of processes to spawn based on free memory of the system as we want to allocate more memory to
    // the threads. We will be spawning threads in round robin across containers.
    // TODO: Check if the getPlatformSpecs() can fail or not. If it can fail, then we need to handle that case.
    const { memory, logicalCores } = await system.getPlatformSpecs();

    let numberOfGroups = Math.floor((memory.available) / HEAP_LIMIT_PER_PROCESS);

    // If the number of groups is less than 1, then we will spawn only 1 process as the container.
    if (numberOfGroups < 1) {
      numberOfGroups = 1;
    }

    // If the number of groups is greater than the number of logical cores, then we will spawn only as many processes
    // as the number of logical cores as if we spawn more processes than the number of logical cores, then there will be
    // number of containers to hold the threads than the number of threads. So some of them remain idle.
    // Since there can be Number(logicalCores) active threads and draining threads at a time, we can use as many as
    // 2 * logicalCores as number of groups.
    if (numberOfGroups > logicalCores * 2) {
      numberOfGroups = logicalCores * 2;
    }

    return { numberOfGroups, numberOfThreads: logicalCores };
  }

  /**
   * Sets up the engine by spawning the thread groups as container processes for threads.
   *
   * @returns {Promise<void>}
   */
  setup = async () => {
    const { numberOfGroups, numberOfThreads } = await this._getNumberOfPossibleGroups();

    log.info(`[Engine] Starting ${numberOfGroups} groups and ${numberOfThreads} threads`);

    // We will be dividing number of threads to start equally among the number of groups.
    const groups = await this.spawnGroups(numberOfGroups);

    log.info('[Engine] Spawned all the groups');

    for (const group of groups) {
      this.groups.set(group.id, group);
    }

    // Total number of threads to spawn will be the number of logical CPUs available on the machine.
    this.poolSize = numberOfThreads;
  }

  /**
   * Adjusts thread group processes if the system has more available memory during initialization phase of engine.
   *
   * @returns {Promise<void>}
   * @private
   */
  _adjustGroupSize = async () => {
    const { numberOfGroups } = await this._getNumberOfPossibleGroups();

    if (this.groups.size >= numberOfGroups) {
      // TODO: Shrink the number of groups if the number of groups is greater than the number of groups that can be
      // spawned.
      return;
    }

    log.info(`[Engine] Spawning ${numberOfGroups - this.groups.size} more groups to adjust for available memory`);

    const groups = await this.spawnGroups(numberOfGroups - this.groups.size);

    for (const group of groups) {
      this.groups.set(group.id, group);
    }
  }

  /**
   * Gets a group ID that is not currently used
   *
   * It gets the worker ID from a pool of IDs that have been used in the past
   * If there are no free IDs, it will add a new ID 1 greater than the highest used one
   */
  getUnusedGroupId = () => {
    if (this.groupIdPool.length > 0) {
      return this.groupIdPool.shift();
    }
    else {
      this.lastAllocatedGroupId += 1;

      return this.lastAllocatedGroupId;
    }
  }

  /**
   * Returns a group from the groups map in a round-robin fashion to evenly spread threads across groups.
   *
   * @returns {*}
   */
  getNextGroup = () => {
    if (typeof this.groupAssignmentPointer?.next !== 'function') {
      // Initial assignment, in case assignmentPointer isn't already implementing an Iterator.
      this.groupAssignmentPointer = this.groups.values();
    }

    let next = this.groupAssignmentPointer.next();

    // Check if we're exhausted the Iterator and refresh it if so.
    if (next.done) {
      this.groupAssignmentPointer = this.groups.values();

      next = this.groupAssignmentPointer.next();
    }

    return next.value;
  }

  /**
   * Creates a new thread group and initializes it.
   *
   * @param {Number} id - ID of the thread group
   *
   * @returns {Promise<{process, threads: Map<any, any>, id, ipcNode: (null|IPCNode|*)}>}
   */
  createThreadGroup = async (id) => {
    const threadGroup = new ThreadGroup(id, this.workerEventCallback, this.onChildProcessExit);

    await threadGroup.init();

    log.info(`[Engine] Started and initialized a thread-group with ID ${id}`);

    return threadGroup;
  }

  /**
   * Spawns all the sub processes configured as thread groups.
   *
   * @returns {Promise<Object[]>}
   */
  spawnGroups = (length) => {
    // Call spawnProcess for each process to spawn
    return Promise.all(Array.from({ length }, () => this.createThreadGroup(this.getUnusedGroupId())));
  };

  /**
   * Adjusts the endurance of the workers based on the expected VU count
   *
   * @param {number} expectedVUCount - expected VU count
   */
  adjustEndurance = (expectedVUCount) => {
    const endurance = Math.ceil(expectedVUCount / this.desiredPoolSize);

    if (endurance < WORKER_MIN_ENDURANCE) {
      this.minimumWorkerEndurance = WORKER_MIN_ENDURANCE;
      this.maximumWorkerEndurance = WORKER_MAX_ENDURANCE;
    }
    else {
      this.minimumWorkerEndurance = endurance;

      // Set the maximum endurance to 10% more than the minimum endurance
      this.maximumWorkerEndurance = Math.ceil(endurance * 1.10);
    }

    log.info(`[Engine] Setting up the endurance to ${this.minimumWorkerEndurance} - ${this.maximumWorkerEndurance}`);
  }

  /**
   * Starts a worker thread inside a thread group.
   */
  startThread = async () => {
    const worker = await this.startWorkerThread();

    this.pools.reserve.set(worker.id, worker);
  }

  /**
   * Kills a worker thread
   *
   * @param {string} id - ID of the worker
   */
  stopThread = (id) => {
    let workerItem, poolName;

    Object.keys(this.pools).forEach((pool) => {
      if (this.pools[pool].has(id)) {
        workerItem = this.pools[pool].get(id);
        poolName = pool;
      }
    });

    if (workerItem) {
      log.info(`Killing worker from ${poolName} pool, ${id}`);
      workerItem.worker.stop();
      this.pools[poolName].delete(id);

      // Clear the sequenceId to workerId mapping for the killed worker
      this.sequenceAssignmentMap.forEach((value, key) => {
        if (value === id) {
          this.sequenceAssignmentMap.delete(key);
        }
      });
    }
    else {
      log.warn(`Execution - ExecutionEngine ~ Attempted to kill worker which doesn't exist, ${id}`);
    }

    this.groupIdPool.push(id);
  }

  /**
   * Returns the number of workers to start from the options.
   * It uses the number of logical cores available on the machine to make optimal use of the resources for parallel execution.
   * By depending on the number of logical cores, we can make sure that we are not spawning more workers than the machine can handle at a time.
   * This will make sure that all the logical cores are consumed and we are optimally using the resources available.
   *
   * @returns {Number|*}
   */
  get desiredPoolSize () {
    return this.poolSize;
  }

  /**
   * Starts all the workers if they are not already started. If they are already started, it does nothing.
   *
   * @returns {Promise<void>}
   */
  init = async () => {
    log.info('Execution - ExecutionEngine.init ~ Initialization has started');

    this.initializing = true;

    // Set stopped to false for accepting new assignments
    this.stopped = false;
    this.killing = false;

    // Check for possibility for accommodating more thread groups. If possible, add more thread groups.
    await this._adjustGroupSize();

    // Divide the started workers into separate pools of active, draining and reserve/ready workers
    // We need to know how we can distribute the generated workers across these pools
    // As a general rule, we can have min and max for each of the pools:
    //   - active pool: min = 1, max = 100% of the total count
    //   - draining pool: min = 0, max = 100% of the total count [Initially it will be 0, as assignments are passed to
    //     active pool it will automatically move workers to draining pool]
    //   - reserve pool: min = 0, max = 100% of the total count
    const [activeThreads, reservedThreads] = await Promise.all([
      this.startThreads(this.desiredPoolSize),
      this.startThreads(this.desiredPoolSize)
    ]);

    // add all the workers to the active pool and reserved pool to begin with
    this.pools.active.addAll(activeThreads);

    for (const worker of reservedThreads) {
      this.pools.reserve.set(worker.id, worker);
    }

    // Threads start by being in the active and reserve pools. Some from the active pool will be moved
    // to the draining pool based on the number of runs they have serviced. Drained workers will be killed.
    // For each killed thread, one is started into the reserve pool. If the active pool does not have "enough"
    // workers, some will be moved from reserve to active. Based on what?
    log.info(`Execution - ExecutionEngine.init ~ Started ${activeThreads.length} + ${reservedThreads.length} workers.`);

    this.initializing = false;
    this.initialized = true;
  }

  /**
   * The workers emit events as they're executing scenarios. This method intercepts those events, executes any
   * necessary operations, and then bubbles those events up to whoever instantiated the ExecutionEngine for additional
   * optional processing.
   */
  workerEventCallback = (rawData) => {
    const data = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;

    // Forward the data to the initiator of engine execution
    this.options?.runtimeEventHandler?.(data);

    // Handle lifecycle events
    this.handleRuntimeEvents(data?.event, data?.executionContext);
  }

  /**
   * Event handler for runtime events from the workers to manage workload among workers
   *
   * @param {Object} executorEvent - The event from the executor worker to listen for runtime events
   * @param {Object} executionContext - The execution context of the worker that emitted the event
   * @param {String} executionContext.executorReferenceId - The ID of the worker that emitted the event
   * @param {String} executionContext.sequenceId - The ID of the sequence that was executed
   *
   * @returns {void}
   */
  handleRuntimeEvents = (executorEvent, { executorReferenceId: workerId, sequenceId }) => {
    let workerItem, poolName;

    Object.keys(this.pools).forEach((pool) => {
      if (this.pools[pool].has(workerId)) {
        workerItem = this.pools[pool].get(workerId);
        poolName = pool;
      }
    });

    log.debug(`Worker ${workerId} is present in `, poolName);

    if (!poolName) {
      log.debug(`Worker ${workerId} is not present in any pool`);
    }

    switch (executorEvent) {
      case SCENARIO_EXECUTION_EVENTS.FINISHED:
      case SCENARIO_EXECUTION_EVENTS.ABORTED:
        // remove sequenceId from the sequenceAssignmentMap
        this.sequenceAssignmentMap.delete(sequenceId);

        // Break statement is not required here as we need to do the same thing for both the events.
        // We will preserve the sequenceId to workerId mapping in case of error event so mapping
        // will be only cleaned when finished or aborted events is issued.
        // eslint-disable-next-line no-fallthrough

      case SCENARIO_EXECUTION_EVENTS.ERROR:
        if (workerItem) {
          workerItem.finished += 1;
          workerItem.assigned -= 1;

          if (this.pools.active.has(workerId)) {
            // If the worker is in the active pool, then we need to heapify the active pool again to make sure that
            // the thread with the least number of assigned scenarios is at the top of the heap.
            this.pools.active.update(workerItem);
          }

          if (workerItem.finished >= workerItem.totalAssignments && this.pools.draining.has(workerId)) {
            this.disposeThread(workerId);
          }
        }
        else {
          log.warn(`Execution - ExecutionEngine ~ Event from worker not in active/draining pool, ${workerId}`);
        }

        break;

      default:
        return;
    }
  }

  /**
   * Move a worker from the active to the draining pool
   *
   * @param  {String} workerId - The ID of the worker which needs to be moved to the draining pool
   */
  drainThread = async (workerId) => {
    const worker = this.pools.active.get(workerId);

    if (worker) {
      this.pools.draining.set(workerId, worker);
      this.pools.active.remove(workerId);
      await this.activateReservedThread();

      log.debug(`[Engine] Moved worker ${workerId} from active to draining`);
    }
    else {
      log.warn(`Execution - ExecutionEngine ~ Trying to drain worker not in active pool, ${workerId}`);
    }
  }

  /**
   * Replenish the active worker pool using a worker from the reserve pool, then start a new worker to replenish the
   * reserve pool. Replenishing the active pool should be an instantaneous operation, but we can take some time to
   * start a new worker into the reserve pool.
   */
  activateReservedThread = async () => {
    if (this.pools.reserve.size === 0) {
      // @TODO: Exit the execution when encountering a fatal error.
      log.error('Execution - ExecutionEngine ~ Fatal error, no reserve workers available');

      createError({
        message: 'Execution - ExecutionEngine ~ Fatal error, no reserve workers available',
        source: 'workerThreadManager.activateReservedThread',
        subsystem: 'ScenarioManager',
        severity: CONSTANTS.SEVERITY.CRITICAL
      });
    }

    const [reserveId, reserveThread] = this.pools.reserve.entries()?.next().value;

    this.pools.active.add(reserveThread);
    this.pools.reserve.delete(reserveId);

    log.debug(`[Engine] Moved worker ${reserveId} from reserve to active`);

    // Start a new worker to replace the one we just removed from the reserve
    await this.startThread();

    log.debug('[Engine] Spawned a replacement thread into the reserve pool');
  }

  /**
   * Destroy a worker and reclaim any resources being consumed by it.
   *
   * @param  {String} workerId - The ID of the worker which needs to be disposed of
   */
  disposeThread = async (workerId) => {
    const worker = this.pools.draining.get(workerId);

    if (worker) {
      this.stopThread(workerId);
      this.pools.draining.delete(workerId);

      log.debug(`[Engine] Disposed a thread with ID ${workerId}`);
    }
    else {
      log.warn(`Execution - ExecutionEngine ~ Trying to dispose worker not in draining pool, ${workerId}`);
    }
  }

  /**
   * Assign a scenario to a worker-thread. It uses least utilization algorithm to assign the scenario to the worker.
   *
   * @TODO: Introduce the idea of partitioning across different bundles when we need to support more than one type of
   * execution at a time.
   *
   * @param  {object} params.executionContext - An opaque object used accompanying this scenario.
   * @param  {object} params.data - Data to be passed to the scenario worker to be used in the execution.
   */
  assignScenario = async (...args) => {
    if (this.stopped) {
      createError({
        message: 'ExecutionEngine ~ Assigning scenario while stopping, ignoring request',
        source: 'workerThreadManager.assignScenario',
        subsystem: 'ScenarioManager',
        severity: CONSTANTS.SEVERITY.CRITICAL
      });
    }

    if (this.initialized !== true) {
      createError({
        message: 'ExecutionEngine ~ Trying to assign scenarios before initializing manager.',
        source: 'workerThreadManager.assignScenario',
        subsystem: 'ScenarioManager',
        severity: CONSTANTS.SEVERITY.CRITICAL
      });
    }

    // Assign this scenario to the worker. the assignment pointer is referencing, then advance the pointer to continue
    // the round-robin assignment.
    let leastAssignedThread = this.pools.active.peek();

    if (!leastAssignedThread) {
      createError({
        message: 'ExecutionEngine ~ No active worker available for scenario assignment',
        source: 'assignScenario',
        subsystem: 'ScenarioManager',
        severity: CONSTANTS.SEVERITY.CRITICAL
      });
    }

    leastAssignedThread.assigned += 1;
    leastAssignedThread.totalAssignments += 1;

    // Replace the least assigned thread in the heap to make sure that the thread with the least number of assigned
    // scenarios is at the top of the heap.
    this.pools.active.update(leastAssignedThread);

    const workerId = leastAssignedThread.id;

    leastAssignedThread.worker.assignRun(args);

    const sequenceId = args[0].executionContext.sequenceId;

    log.debug(`[Engine] Assigned scenario ${sequenceId} to worker ${workerId}`);

    // Store the sequenceId to workerId mapping for killing the scenario, if needed
    this.sequenceAssignmentMap.set(sequenceId, workerId);

    // Each worker is drained once it has reached its configured endurance to provide some protection against leaks
    // within individual workers. Check with >= rather than === to catch any workers which may have fallen
    // through the cracks. Using === here can lead to, at some point in the future, workers never being drained.
    if (leastAssignedThread.totalAssignments >= leastAssignedThread.endurance) {
      await this.drainThread(workerId);
    }
  };

  /**
   * Aborts a scenario execution for a given sequenceId.
   *
   * @param {Object} executionContext - The execution context of the scenario to kill.
   * @param {String} executionContext.sequenceId - The sequenceId of the scenario to kill.
   * @param {String} executionContext.executionId - The executionId of the scenario to kill.
   *
   * @returns {Promise<*>} - Returns a promise which will get resolved when the request is submitted to the worker.
   */
  abortScenario = async (executionContext) => {
    const { sequenceId } = executionContext;

    // Get the workerId to target the signal for killing the scenario
    const workerId = this.sequenceAssignmentMap.get(sequenceId);

    if (!workerId) {
      log.warn(`Execution - ExecutionEngine ~ Trying to abort scenario that is not assigned to any worker, ${sequenceId}`);
      return;
    }

    // The scenario could be in one of the thread of active or draining pool, so get the reference to the worker
    // from any of the pools.
    const workerItem = this.pools.active.get(workerId) || this.pools.draining.get(workerId);

    if (!workerItem) {
      log.warn(`Execution - ExecutionEngine ~ Trying to abort scenario that is not assigned to any worker, ${sequenceId}`);
      return;
    }

    log.info(`Execution - ExecutionEngine ~ Killing scenario of sequenceId [${sequenceId}] from worker [${workerId}]`);

    return workerItem.worker.abortRun(executionContext);
  }

  /**
   * Kills a scenario execution for a given sequenceId.
   *
   * @param {Object} executionContext - The execution context of the scenario to kill.
   * @param {String} executionContext.sequenceId - The sequenceId of the scenario to kill.
   * @param {String} executionContext.executionId - The executionId of the scenario to kill.
   *
   * @returns {Promise<*>} - Returns a promise which will get resolved when the request is submitted to the worker.
   */
  stopScenario = async (executionContext) => {
      const { sequenceId } = executionContext;

      // Get the workerId to target the signal for killing the scenario
      const workerId = this.sequenceAssignmentMap.get(sequenceId);

      if (!workerId) {
        log.warn(`Execution - ExecutionEngine ~ Trying to stop scenario that is not assigned to any worker, ${sequenceId}`);
        return;
      }

      // The scenario could be in one of the thread of active or draining pool, so get the reference to the worker
      // from any of the pools.
      const threadGroupRef = this.pools.active.get(workerId) || this.pools.draining.get(workerId);

      if (!threadGroupRef) {
        log.warn(`Execution - ExecutionEngine ~ Trying to stop scenario that is not assigned to any worker, ${sequenceId}`);
        return;
      }

      return threadGroupRef.worker.stopRun(executionContext);
    }

  /**
   * Starts all the workers configured.
   *
   * @returns {Promise<Object[]>}
   */
  startThreads = (length) => {
    // Call startProcess for each worker to start
    return Promise.all(Array.from({ length }, () => this.startWorkerThread()));
  };

  /**
   * Starts a worker thread and adds it to the active pool. If the worker manager is stopped while the worker is
   * starting, we need to kill the worker. Not doing so might cause the worker to be orphaned and continue running.
   */
  startWorkerThread = async () => {
    const group = this.getNextGroup();

    if (this.stopped) {
      // Assignment is stopped, so we don't want to start any workers. Not doing so might cause the workers
      // to be orphaned and continue running.
      createError({
        message: 'ExecutionEngine ~ Starting worker while worker manager is stopping',
        source: 'workerThreadManager.startWorkerThread',
        subsystem: 'ScenarioManager',
        severity: CONSTANTS.SEVERITY.CRITICAL
      });
    }

    const worker = await group.createThread();

    log.info(`[Engine] Started a worker ${worker.id} in group ${group.id}`);

    if (this.stopped) {
      // If the worker manager is stopped while the worker is starting, we need to kill the worker.
      // Not doing so might cause the worker to be orphaned and continue running.
      await worker.stop();

      createError({
        message: 'ExecutionEngine ~ Started a worker while worker manager is stopping, killing it.',
        source: 'workerThreadManager.startWorkerThread',
        subsystem: 'ScenarioManager',
        severity: CONSTANTS.SEVERITY.CRITICAL
      });
    }

    return {
      id: worker.id,
      worker,
      groupId: worker.group.id,

      // Decide a random endurance for the worker after which it will be drained. Such that the pool has some randomisation
      // while moving to draining pool among all the workers. They should not move all at one.
      endurance: _.random(this.minimumWorkerEndurance, this.maximumWorkerEndurance),

      // Since this is a new worker, it's not assigned to any scenarios yet.
      assigned: 0,
      finished: 0,
      totalAssignments: 0
    };
  }

  /**
   * Kills all the workers.
   * @memberof ExecutionEngine
   * @returns {void}
   */
  stopAll = async () => {
    // Set the stopped flag to true so that no new workers are started or assignments are allowed
    this.stopped = true;

    try {
      // Clear the sequence to worker mapping
      this.sequenceAssignmentMap.clear();

      // Ask all the groups to stop their workers
      // Promise.allSettled is used here to ensure that all the workers are killed even if one of them fails to kill
      const results = await Promise.allSettled(Array.from(this.groups.values()).map((group) => group.stop()));

      // Check if any of the workers failed to kill
      const failed = results.filter((result) => result.status === 'rejected');

      if (failed.length) {
        log.error('ExecutionEngine.killAll ~ Error while killing all workers', failed);

        createError({
          error: failed,
          message: 'ExecutionEngine.killAll ~ Error while killing all workers',
          source: 'stopAll',
          subsystem: 'ScenarioManager',
          severity: CONSTANTS.SEVERITY.ERROR
        });
      }
      else {
        log.info('[Engine] Successfully stopped all the threads in groups');
      }
    } catch (e) {
      log.error('ExecutionEngine.killAll ~ Error while killing all workers', e);
    } finally {
      // Kill all container processes as a workaround for memory retention issues where we are loading any
      // dependency from `asar` archive.
      // https://github.com/electron/electron/issues/36597
      // TODO: Remove this once the issue is fixed or we migrate to a newer version of Electron possibly 22.*.*
      await this.forceKill();
    }
  }

  /**
   * Stops all the workers and clears the pools.
   * @returns {Promise<void>}
   */
  forceKill = async () => {
    // Set the stopped flag to true so that no new subprocesses are spawned or assignments are allowed
    this.stopped = true;
    this.killing = true;

    try {
      await killAllChildProcesses(process.pid);

      log.info('[Engine] Force killed all thread-group processes');
    } catch (e) {
      log.error('Error while force killing child processes', e);
      this.unInit();

      createError({
        message: 'Error while force killing child processes',
        error: e,
        source: 'Engine.forceKill',
        subsystem: 'ScenarioManager',
        severity: CONSTANTS.SEVERITY.CRITICAL
      });
    } finally {
      // Since we have force killed all the thread groups (container) processes, we need to clear the references of the
      // thread groups from the engine so that we don't use a stale reference for starting threads in next run.
      this.groups.clear();

      // Reset the state of the engine
      this.unInit();

      // Reset the killing flag
      this.killing = false;
    }
  }

  /**
   * This is the handler that is passed to the thread-group so that it can be invoked when any of
   * the container processes terminate
   *
   * @param {Object} threadGroup - An instance of ThreadGroup, which has exited
   * @returns
   */
  onChildProcessExit = async (threadGroup) => {
    // If the process has died due to any reason, remove its threads from the pool
    for (const { id } of threadGroup.threads.values()) {
      let workerItem, poolName;

      Object.keys(this.pools).forEach((pool) => {
        if (this.pools[pool].has(id)) {
          workerItem = this.pools[pool].get(id);
          poolName = pool;
        }
      });

      if (workerItem) {
        log.debug('[Engine] Removing worker from pool', { id, poolName });
        this.pools[poolName].delete(id);
      }
    }

    // If the engine is stopped, don't replace the thread group as it will be taken care of init method
    // during the next run
    if (this.stopped) {
      return;
    }

    log.info('Replacing a threadGroup after one was terminated');

    // remove from the thread-group map and return the ID to the pool
    this.groups.delete(threadGroup.id);
    this.groupIdPool.push(threadGroup.id);

    const newThreadGroup = await this.createThreadGroup(this.getUnusedGroupId());

    let thread;

    const threadCount = threadGroup.threads.size;

    // replace each thread of the process that dies with a new thread
    await Promise.all(Array.from({ length: threadCount }, async () => {
      thread = await newThreadGroup.createThread();
      newThreadGroup.threads.set(thread.id, thread);

      // add the threads to the reserve pool
      this.pools.reserve.set(thread.id, thread);
    }));

    this.groups.set(newThreadGroup.id, newThreadGroup);

    log.info(`Spawned a new thread group with ID ${newThreadGroup.id} and its threads`);
  }

  unInit = () => {
    // setting this as not initialized to allow the next run to
    // initialize and set up the workers. Without this, the subsequent runs
    // will not start as there will be no active workers
    this.initializing = false;
    this.initialized = false;

    this.groupIdPool = [];
    this.lastAllocatedGroupId = -1;

    // reset these back to their default values
    this.minimumWorkerEndurance = WORKER_MIN_ENDURANCE;
    this.maximumWorkerEndurance = WORKER_MAX_ENDURANCE;

    // We need to clear stale references to avoid using then for assigning scenarios in the
    // next run and to make sure we don't attempt freeing up resources that don't actually exist.
    this.pools.active.clear();
    this.pools.draining.clear();
    this.pools.reserve.clear();
  }
};
