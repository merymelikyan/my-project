/**
 * The WorkloadManager service is responsible for managing the lifecycle of one or more collection execution threads.
 * This is useful for features like the Collection Runner or Performance Testing where users are able to select one
 * or more requests to execute, and then execute them while still having the ability to use other parts of the app
 * or observe the execution as it's in progress. The actual execution happens outside of the main process.
 *
 * @TODO: What abstraction do we use to wrap around a group of scenarios? Do we even need to introduce the idea of
 * a scenario within this class or do we use something more traditional like "transaction"?
 */
const _ = require('lodash');
const system = require('../lib/system');
const { log } = require('../lib/logging');
const loadProfiles = require('./load-profile');
const Sequence = require('./Sequence');
const {
  WORKLOAD_STATES,
  DATAFILE_DISTRIBUTION_TYPES,
  DATAFILE_RANDOM_DISTRIBUTION
} = require('../ScenarioManager/constants');
const { broadcastOnIPC } = require('../sub-process-functions');
const { deserializeObject } = require('../utils/string');
const ResourceUtilizationQueue = require('./resource-utilization-queue');
const { getUtilizationConfigDelta } = require('./resource-utilization-tuner');
const { createError, CONSTANTS } = require('../lib/communication');
const SequenceTracker = require('./SequenceTracker');
const LoadProfile = require('./load-profile/LoadProfile');

const defaults = {
  // Load profiles are continuous functions but it's not necessary to continually evaluate them since fractional virtual
  // users can't exist. The (load) increment delay is the minimum time we wait for before evaluating the load profile
  // and deciding whether or not to add or remove virtual users. Decreasing this value will follow the load profile more
  // closely at the cost of some additional compute. Extremely small values are probably unnecessary and won't improve
  // the product experience much so this should hover around 1s at the very least.
  incrementDelayMs: 2000,

  // The time to wait between consecutive executions of a scenario by a single sequence/VU. This can be used to tune the
  // density of the generated load profile by controlling the relationship between VUs and request throughput. A smaller
  // sleep time will lead to a higher requests throughput but can add significant compute and network load in doing so.
  // Sleep times ranging from 100ms to 2000ms are probably reasonable, though either of the spectrum becomes
  // increasingly questionable.
  sleepTimeMs: 100,

  // The time before the end of the workload during which additional scenarios (and by extension, sequences) should not
  // be started. We're assuming that a scenario takes some time to complete and starting a scenario too close to the end
  // of the workload will consume system resources without generating any value. This should be a relatively small value
  // since we're really only accounting for small scenarios. This is unlikely to have much of an impact on long-running
  // workloads or long-running scenarios.
  deadZoneMs: 1000,

  // The time we allow for scenarios to gracefully finish after a workload has technically run for the configured
  // duration. Since there is not limit on the execution time of a single scenario, it's entirely possible for one or
  // more scenarios to continue executing well beyond the configured duration of a workload. The grace period allows
  // some flexibility to allow this by also enforces an absolute maximum duration beyond which scenarios and sequences
  // will be forcibly terminated.
  gracePeriodMs: 5000,

  // The time we allow for scenarios to gracefully finish after a scenario has been requested to do so.
  // The grace period allows some flexibility to allow this, but also enforces an absolute maximum duration
  // beyond which scenarios and sequences will be forcibly terminated.
  sequenceGracePeriod: 2000,

  // Number of resource utilization measurements to depend upon to make decisions about the configs.
  // This number is not set in stone, we can change based on requirement in future.
  resourceUtilObservationCount: 5,

  // The maximum time duration between scenarios, where the process sleeps. We have noticed drop in request
  // throughput beyond the 2000ms limit.
  maxSleepTimeMs: 2000,

  // The minimum time duration between scenarios, where the process sleeps.
  minSleepTimeMs: 100
};

/**
 * Parses the options passed to the WorkerManager and returns a parsed object.
 * @param {{serialized: Object, unSerialized: Object}} context - Context for the WorkloadManager
 */
const parseContext = (context) => {
  const parsedContext = { ...context.unSerialized };
  const serializedContext = context.serialized;

  for (const key in serializedContext) {
    parsedContext[key] = deserializeObject(serializedContext[key]);
  }

  return parsedContext;
};

module.exports = class WorkloadManager {
  dataFileConfig = null;

  /**
   * Creates a new instance of the WorkloadManager which can be used for the duration of the execution. Multiple
   * executions can occur in parallel, and each execution goes through a specific lifecycle:
   *   - `start`: A request to start an execution has been received. Acquire/transform data necessary to execute? What
   *     data should this receive when being invoked and what should it fetch on its own?
   *   - `running`: "Event loop" is running.
   *   - `finished`: Any cleanup activities.
   *
   * @TODO Collection/environment parameters may have to be serialized objects instead of IDs. We need to determine that
   * based on how the main/renderer processes are implemented.
   *
   * @TODO: Does the WorkloadManager need to be aware of what's happening within each scenario?
   *
   * @param  {Array} params.sequence - A set of request or Item (as defined by postman-collection) IDs representing
   *                                   the series of requests to be executed.
   * @param  {[String]} params.context.collection - The collection ID. This is an array for now to support multiple
   *                                                collections in the future.
   * @param  {String} params.context.environment - The environment ID.
   * @param  {String} params.options.loadProfile - POJO representation of selected load profile which is the return
   *                                               value of LoadProfile base class `toObject` method
   *                                               (xMax is duration of this execution in minutes, yMax is max VUs)
   */
  constructor ({ sequence, context: rawContext, options }) {
    const context = parseContext(rawContext);

    // Validate the inputs before we do absolutely anything
    // @TODO: Consolidate and expand this validation logic elsewhere and invoke instead of having it inline.
    if (!options.loadProfile || !options.loadProfile.id || !loadProfiles[options.loadProfile.id]) {
      throw new Error(`Valid load profile selection is required, but got ${options.loadProfile.id}.`);
    }

    // A unique ID, to be used *within this session*, to reference this instance of the WorkloadManager.
    // This is being generated in newman-api and being passed down to the WorkloadManager.
    this.workloadId = options.id;

    this.config = Object.assign({}, defaults, {
      ...options,
      loadProfile: options.loadProfile,
      durationMs: options.loadProfile.xMax,
      collection: context.collection,
      requestSelection: context.requestSelection,
      environment: context.environment || null,
      globals: context.globals || null,
      isTransient: options.isTransient,
      runtimeOptions: options.runtimeOptions || {}, // Refer TODO above about merging with default config
    });

    if (context.dataFileConfig) {
      this.setDataFileConfig(context.dataFileConfig);
    }

    // @TODO: Consolidate these under something that can represent the current state of this WorkloadManager instance.
    this.eventLoopTimeout = null;
    this.startTime = null;
    this.executionId = this.workloadId;
    this.executionContext = { executionContextId: this.workloadId };
    this.runOngoing = false;
    this.deadzoneThresholdMs = this.config.durationMs - this.config.deadZoneMs;
    this.gracefulDurationMs = this.config.durationMs + this.config.gracePeriodMs;
    this.sequences = new Set();
    this.sequenceIdMap = new Map();
    this.currentSleepDuration = defaults.sleepTimeMs;
    this.lastCreatedSequenceIndex = null;

    // Using an array and not a set here to maintain the order in which the sequences were stopped
    // and to use the same order when re-using the indexes available
    this.usableSequenceIndexes = [];

    // Print platform specs again such that if the logs are rotated on the machine, last run start event can convey
    // the platform specs.
    system.getPlatformSpecs().then((data) => {
      pm.logger.info('System Information', data);
    });

    this.resourceUtilizationQueue = new ResourceUtilizationQueue(defaults.resourceUtilObservationCount);

    this.trackers = [];
  }

  /**
   * @type {WORKLOAD_STATES} - The current state of the WorkloadManager.
   */
  state = WORKLOAD_STATES.IDLE;

  init = async () => {
    this.state = WORKLOAD_STATES.WARMING_UP;

    // Initialize the process manager, such that all the workers are ready to execute scenarios and pools are
    // maintained along with IPC channels to communicate with the workers.

    try {
      pm.logger.info(`[WorkloadManager][${this.workloadId}]~Init initializing`);

      await system.invoke('scenarioManager', {
        method: 'init',
        args: [this.config.loadProfile.yMax]
      });

      this._setState(WORKLOAD_STATES.READY);

      log.debug(`[WorkloadManager][${this.workloadId}] Workload is ready to start run`);
    }
    catch (error) {
      pm.logger.error(`[WorkloadManager][${this.workloadId}]~Error initializing: `, error);

      // cleanup and enter error state, so that it can be retried
      // TODO: Change this to use system.invoke instead of using globals directly.
      await global.SUBSYSTEM_REGISTER.private.scenarioManager.kill();

      this._setState(WORKLOAD_STATES.ERROR, error);
    }
  }

  _setState = (state, error = null) => {
    if (Object.values(WORKLOAD_STATES).includes(state) && state !== this.state) {
      this.state = state;
      const workloadError = error ? {
        name: error.name,
        message: error.message
      } : null;

      // TODO: Refactor the data payload once we have uniform structure for all the events.
      broadcastOnIPC('workload-state-change', {
        id: this.workloadId,
        state: this.state,
        error: workloadError
      });
    }
  }

  /**
   * Terminates the execution of the WorkloadManager. This will be called within system when the test execution encounters
   * an error which the system will not be able to recover from and test results are degraded because of that error.
   *
   * @returns {Promise<void>}
   */
  terminate = async () => {
    log.info(`WorkloadManager[${this.workloadId}]~Terminating execution`);

    await this.stop(WORKLOAD_STATES.TERMINATED);
  }

  /**
   * Function to get an integer ID to be given to a Sequence object. It tries to fetch
   * an ID from a pool called `usableSequenceIndexes`. If the pool is empty, it returns
   * an incremented value that tracks the highest value of sequence-index used so far.
   *
   * @returns {Integer} - The sequence index to be used as the ID which creating sequences
   */
  getSequenceIndex = () => {
    if (this.usableSequenceIndexes.length > 0) {
      return this.usableSequenceIndexes.shift();
    }

    else {
      return this.lastCreatedSequenceIndex++;
    }
  }

  /**
   * The Workload event loop runs continuously once an execution has started and ensures that:
   *
   *   - the number of sequences executing in parallel adheres to the selected load profile
   *   - the duration of the Workload is respected, taking into account parameters like the gracePeriod and deadZone.
   *
   * It does so by ticking at specific intervals, controlled by the incrementDelay config parameter. The incrementDelay
   * effectively places a limit on the maximum resolution at which the load profile is evaluated.
   *
   *                                                         Duration (as specified by user)
   *                                                         │
   *  ┌──────────────────────────────────────────────┬───────┴──────────┐
   *  │                                              │                  │
   *  Start                                  Deadzone Threshold    Grace Period
   *
   *  │◄─── Start sequences, to fit load profile ───►│◄──── No new ────►│◄─┐
   *                                                       sequences       │
   *                                                                       │
   *                                                                    Forcibly kill
   *                                                                    running sequences
   */
  async workloadEventLoop () {
    const tickTime = new Date();

    // If elapsed time is 0 set it to 1ms.
    // Since the incrementDelay is 2s, if we get the elapsed time as 0 then no sequences will be started
    // in the first tick. This will lead to a delay of 2s in starting the scenarios. This is not desirable
    // and hence we are setting the elapsed time to 1ms.
    const elapsedMs = (tickTime - this.startTime) <= 0 ? 1 : (tickTime - this.startTime);

    // Record the system utilization and store them in queue without blocking the event loop
    system.getUsageStats()
      .then(this.resourceUtilizationQueue.enqueue)
      .catch((err) => log.error(
          `WorkloadManager[${this.workloadId}]~Error while getting system utilization`,
          err.toString(),
          err.stack
        )
      );

    // If resource utilization measurement queue is full, update sleep duration
    if (this.resourceUtilizationQueue.isFull()) {
      this.updateSleepDuration();
    }

    // No new scenarios should be triggered if we're past the dead zone threshold, since we're nearing the end of the
    // Workload duration.
    if (elapsedMs < this.deadzoneThresholdMs) {
      const actualSequenceCount = this.sequences.size;
      const desiredSequenceCount = LoadProfile.evaluate({
        loadProfile: this.config.loadProfile,
        elapsedMs
      });

      let totalTracked = 0;

      for (const tracker of this.trackers) {
        totalTracked += tracker.target;
      }

      // @TODO: Account for load profiles where the load can decrease as well. This implementation only accounts
      // for loads which remain constant or increase over time. In case a profile gets added without resolving this
      // todo, having Math.max here will ensure that the rest of the code doesn't fail catastrophically.
      const sequenceDelta = desiredSequenceCount - actualSequenceCount + totalTracked;

      if (sequenceDelta > 0) {
        for (let member = 1; member <= sequenceDelta; member++) {
          const sequence = new Sequence({
            workloadSequenceIndex: this.getSequenceIndex(),
            sequence: this.config.collection,
            environment: this.config.environment,
            globals: this.config.globals,
            requestSelection: this.config.requestSelection,
            runOptions: this.config.runtimeOptions,
            executionContext: this.executionContext,
            getSleepDuration: () => { return this.getSleepDuration(); }, // We need closure here to maintain the scope.
            sequenceFinishCallback: this.sequenceFinishCallback.bind(this),
            sequenceOptions: {
              sequenceGracePeriod: this.config.sequenceGracePeriod
            }
          });

          this.sequences.add(sequence);
          this.sequenceIdMap.set(sequence.id, sequence);

          await sequence.start();
        }
      }
      else if (sequenceDelta < 0) {
        const tracker = new SequenceTracker(-sequenceDelta, this.config.gracePeriodMs, this.abortSequences.bind(this));

        this.trackers.push(tracker);
      }

      // Set the current VU count in the metric store
      await system.invoke('metricsProcessor', {
        method: 'processSetVUCount',
        args: [{
          executionContext: this.executionContext,
          currentVuCount: desiredSequenceCount,
        }]
      });
    }

    if (elapsedMs < this.gracefulDurationMs) {
      // @TODO: How do we reliably bail out if the event loop encounters a failure condition? Should we set a top-level
      // timeout as well to guard against that?

      // Check if there are any sequences still running scenarios. If there are, let them continue since we're still
      // within the grace period. If there are no sequences running scenarios at all then we can can stop early.
      if (elapsedMs >= this.deadzoneThresholdMs) {
        // all the scenarios have completed
        if (this.sequenceIdMap.size === 0) {
          log.debug(`WorkloadManager[${this.workloadId}]~All scenarios have completed, stopping execution`);
          this.stop(WORKLOAD_STATES.FINISHED);
        }
        else {
          // this is where we need to let the sequences know that they should not start any new scenario executions
          log.debug(`WorkloadManager[${this.workloadId}]~Duration has exceeded deadzone threshold, stopping new scenarios`);

          for (let [sequenceId, sequence] of this.sequenceIdMap) {
            sequence.stopNewScenarios();
          }

          this._setState(WORKLOAD_STATES.FINISHING);
        }
      }

      // As long as we're within the grace period and no condition for stopping has been encountered, we can schedule
      // the next tick of the event loop.
      if (this.runOngoing) {
        this.eventLoopTimeout = setTimeout(this.workloadEventLoop.bind(this), this.config.incrementDelayMs);
      }
    }
    else {
      // At this point we need to kill all the sequences that are still running scenarios
      // TODO: This will kill ALL the sequences started, we need to remove the sequences that have completed from the Map
      // all the scenarios have completed
      // As of now, we are killing all the sequences. In future, we need to kill only the sequences that are belonging
      // to a particular execution context
      log.debug(`WorkloadManager[${this.workloadId}]~Duration has exceeded grace period, stopping execution`);
      this.stop(WORKLOAD_STATES.FINISHED);

      // Since no longer relevant, we will kill the queue
      this.resourceUtilizationQueue.clear();
    }
  }

  sequenceFinishCallback (sequenceId, state) {
    // It is possible that the first tracker exhausted its grace period, force-stopped
    // the remaining Sequences and set its target to 0. So, we'll need to find a tracker
    // whose target is a positive number and keep clearing the ones that are done.
    while (this.trackers.length > 0 && this.trackers[0].target === 0) {
      this.trackers.shift();
    }

    if (state !== 'aborted') {
      if (this.trackers.length > 0) {
        this.trackers[0].countDown();

        if (this.trackers[0].target === 0) {
          this.trackers.shift();
        }
      } else {
        return false;
      }
    }

    // Preserve the index of the sequence that will be removed, to reuse if a new sequence is added later
    this.usableSequenceIndexes.push(this.sequenceIdMap.get(sequenceId).workloadSequenceIndex);

    // Delete the records of the sequence from the set and the map
    this.sequences.delete(this.sequenceIdMap.get(sequenceId));
    this.sequenceIdMap.delete(sequenceId);

    return true;
  }

  /**
   * Aborts the given number of sequences by aborting the runs in whichever point
   * of execution they are in.
   *
   * @param {integer} count - The number of sequences to stop
   */
  async abortSequences (count = 0) {
    if (this.sequences.size > 0) {
      const sequences = Array.from(this.sequences.values()).filter((seq) => !seq.sequenceCompleted).slice(0, count);
      for (let sequence of sequences) {
        await sequence.abortScenario();
      }
    }
  }

  /**
   * This returns the sleep delay based on current config, and resource utilization.
   *
   * @returns {Number}
   */
  getSleepDuration () {
    return this.currentSleepDuration;
  }

  /**
   * This function updates the sleep delay based on current config, and resource utilization.
   */
  updateSleepDuration () {
    const { sleepDuration: sleepDurationDelta } = getUtilizationConfigDelta({
      resourceUtilizationMetrics: this.resourceUtilizationQueue?.values,
      currentConfigs: { sleepDuration: this.currentSleepDuration }
    });

    let resultingSleepDuration = this.currentSleepDuration + sleepDurationDelta;

    // Ensure we update sleep duration to a valid value.
    if (resultingSleepDuration > defaults.maxSleepTimeMs) {
      resultingSleepDuration = defaults.maxSleepTimeMs;
    }
    else if (resultingSleepDuration < defaults.minSleepTimeMs) {
      resultingSleepDuration = defaults.minSleepTimeMs;
    }

    this.currentSleepDuration = resultingSleepDuration;

    // If we have changed the sleep duration value, we will clear the queue
    if (sleepDurationDelta !== 0) {
      this.resourceUtilizationQueue.clear();
    }
  }

  /**
   * Stops the workload run and puts it in the state provided
   *
   * @param {string} finalState: The state that the workload manager needs to be moved to
   */
  async stop (finalState = WORKLOAD_STATES.STOPPED) {
    if (![WORKLOAD_STATES.RUNNING, WORKLOAD_STATES.FINISHING].includes(this.state)) {
      log.debug('[WorkloadManager] Stop attempted when the workload is not running');
      return;
    }

    this.runOngoing = false;
    this.eventLoopTimeout && clearTimeout(this.eventLoopTimeout);

    if (this.sequenceIdMap.size > 0) {
      for (let [_, sequence] of this.sequenceIdMap) {
        sequence.abortScenario();
      }
    }

    if (!this.finishTime) {
      // send an event so that anybody waiting for the end of the workload is notified
      this.finishTime = new Date();
    }

    // @TODO: The WorkloadManager shouldn't be directly aware of scenarios, but it should signal the Sequence instead.
    await system.invoke('scenarioManager', { method: 'stop' });

    log.debug('[WorkloadManager] ScenarioManager was stopped');

    system.releasePowerSaver();

    this._setState(finalState);
  }

  /**
   * This will be called when the Workload is being destroyed. This is the place to do any cleanup work that needs to be
   * done before the Workload is removed from memory.
   */
  destroy = async () => {
    // clear off all the sequence trackers after the workload is destroyed
    this.trackers = [];

    // TODO: Add clean up for listeners of workload manager and all the sequences
    // Reset token manager if that was associated with this workload instance
    await system.invoke('tokenManager', {
      method: 'reset',
      args: [this.workloadId]
    });
  }

  /**
   * Recovers a workload from any error states
   */
  recover = () => {
    log.info(`[WorkloadManager][${this.workloadId}] Workload is being recovered`);
    return this.init();
  }

  get workloadMetadata () {
    return {
      ...this.config,
      requestSelection: this.config.requestSelection,
      loadProfile: this.config.loadProfile.id, // this contains the name of the profile: constant, ramp etc.
      duration: this.config.durationMs,
      maxVUs: this.config.loadProfile.yMax,
      runtimeOptions: this.config.runtimeOptions,
      startTime: this.startTime,
      finishTime: this.finishTime
    };
  }

  /**
   * Starting a new workload is mostly a bookkeeping activity. The meat of the business logic is handled by the event
   * loop. This method then only needs to do some data wrangling and trigger the initial set of scenario executions.
   */
  async start () {
    pm.logger.info(`WorkloadManager[${this.workloadId}] ~ About to start the workload run`);
    this._setState(WORKLOAD_STATES.STARTING);

    pm.logger.info(`WorkloadManager[${this.workloadId}] ~ Preventing power saver from kicking in`);
    system.preventPowerSaver(this.gracefulDurationMs);

    // @TODO: Add validation steps before starting the Workload.
    this.startTime = new Date();
    this.runOngoing = true;

    pm.logger.info(`WorkloadManager[${this.workloadId}] ~ Listening to events of sequences completing`);

    // Kick off the Workload's event loop. This will adjust the state of the workload every interval to keep it close
    // to the load profile.
    pm.logger.info(`WorkloadManager[${this.workloadId}] ~ Entering the event-loop of the workload`);
    this.workloadEventLoop();

    pm.logger.info(`WorkloadManager[${this.workloadId}] ~ Setting the WLM state to RUNNING`);
    this._setState(WORKLOAD_STATES.RUNNING);
  }

  /**
   * Clean up subscriptions and other resources.
   */
  onDestroy = () => {
    // TODO: Implement
  }

  async handleExecutorResponse (executorResponse) {
    const { sequenceId } = executorResponse.executionContext;

    if (this.sequenceIdMap.has(sequenceId)) {
      await this.sequenceIdMap.get(sequenceId).handleExecutorCallback(executorResponse);
    }
    else {
      pm.logger.info(`WorkloadManager[${this.workloadId}] Sequence completed, not handling the executor response`, sequenceId);
    }
  }

  async processSequenceEvents (sequenceEvent) {
    if (sequenceEvent.state === 'completed') {
      log.debug(`WorkloadManager[${this.workloadId}] ~ Sequence ${sequenceEvent.sequenceId} completed`);

      // Preserve the index of the sequence that will be removed, to reuse if a new sequence is added later
      this.usableSequenceIndexes.push(this.sequenceIdMap.get(sequenceEvent.sequenceId).workloadSequenceIndex);

      this.sequences.delete(this.sequenceIdMap.get(sequenceEvent.sequenceId));
      this.sequenceIdMap.delete(sequenceEvent.sequenceId);
    }
  }

  /**
   * Sets the data file configuration for the workload.
   *
   * @param {object} dataFileConfig - Data file configuration.
   *
   * @throws {Error} - If data file config is already set or if data file config is not valid.
   *
   * @returns {void}
   */
  setDataFileConfig (dataFileConfig) {
    if (this.dataFileConfig) {
      createError({
        error: new Error('Data file config is already set'),
        message: 'Data file config is already set',
        source: `WorkloadManager[${this.workloadId}]`,
        severity: CONSTANTS.SEVERITY.ERROR,
        subsystem: 'WORKLOAD_MANAGER',
        broadcast: false
      });
    }

    validateDataFileConfiguration(dataFileConfig);

    this.dataFileConfig = dataFileConfig;
  }

  /**
   * Returns the data for the sequence based on the distribution type.
   *
   * Called via common invocation system from the Sequence.
   *
   * @param {number} [VUIndex] - Index of the sequence.
   *
   * @returns {VUData} - Data for the sequence or scenario.
   */
  getDataForScenario = (VUIndex) => {
    if (!this.dataFileConfig) {
      return null;
    }

    if (!Array.isArray(this.dataFileConfig.contents) || !this.dataFileConfig.contents.length) {
      return null;
    }

    let sliceIndices = [];

    const { distributionType, contents } = this.dataFileConfig;

    if (distributionType === DATAFILE_DISTRIBUTION_TYPES.ORDERED && VUIndex < contents.length) {
      sliceIndices = [VUIndex];
    }
    else if (distributionType === DATAFILE_DISTRIBUTION_TYPES.RANDOM) {
      // Pick random indexes from the data file contents array
      sliceIndices = _.sampleSize(_.range(contents.length), DATAFILE_RANDOM_DISTRIBUTION.SAMPLE_SIZE);
    }

    return {
      // Create an array of objects from contents based on the sliceIndices
      data: sliceIndices.map((rowIndex) =>
        Object.entries(contents[rowIndex]).map(([key, value]) => ({ key, value }))
      ),
      keys: Object.keys(contents[0]),
      vuId: VUIndex,
      sliceIndices,
      randomize: distributionType === DATAFILE_DISTRIBUTION_TYPES.RANDOM
    };
  }
};

/**
 * Validates the data file configuration.
 *
 * @param {object} dataFileConfig - Data file configuration.
 *
 * @throws {Error} - If data file config is not valid.
 *
 * @returns {void}
 */
function validateDataFileConfiguration (dataFileConfig) {
  let error;

  if (!dataFileConfig) {
    error = new Error('Data file config is not provided');
  }
  else if (!dataFileConfig.distributionType) {
    error = new Error('Data file distribution type is not provided');
  }
  else if (!dataFileConfig.contents) {
    error = new Error('Data file contents are not provided');
  }
  else if (!Object.values(DATAFILE_DISTRIBUTION_TYPES).includes(dataFileConfig.distributionType)) {
    error = new Error(`Data file distribution type should be either ${Object.values(DATAFILE_DISTRIBUTION_TYPES).join(' or ')}`);
  }
  else if (!Array.isArray(dataFileConfig.contents) || !dataFileConfig.contents.length) {
    error = new Error('Data file contents should be a non-empty array');
  }

  if (error) {
    createError({
      error,
      message: error.message,
      source: `WorkloadManager[${this.workloadId}]`,
      severity: CONSTANTS.SEVERITY.ERROR,
      subsystem: 'WORKLOAD_MANAGER',
      broadcast: false
    });
  }
}

