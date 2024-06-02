const { constants: osConstants } = require('os');
const path = require('path');
const uuid = require('uuid/v4');
const system = require('../../lib/system');
const { createError, subscribeOnIPC, CONSTANTS } = require('../../lib/communication');
const { detachIpcNode, startSubProcess } = require('../../sub-process-functions');
const { invokeOnIPC } = require('../../utils/ipcUtils');
const { runTimeoutPromise } = require('../../utils/promise');
const { log } = require('../../lib/logging');
const { WORKLOAD_STATES } = require('../../ScenarioManager/constants');

const THREAD_GROUP_EXECUTABLE = path.resolve(__dirname, 'ThreadGroupExecutable.js');
const WORKER_CONTAINER_IDENTIFIER = 't_group';

// Using a static limit on restarts of the container process
const MAX_PROCESS_RESTART_COUNT = 5;

/**
 * This class is responsible for managing the execution of a group of threads. It will be responsible for spawning the
 * threads
 */
class ThreadGroup {
  // Priority of the container process is set to below normal so that it does not interfere with the main process
  // or renderer processes or any other OS processes. Rest of the OS functions will be given priority over this
  // process. This is done to ensure that the main process and renderer processes are not starved of CPU cycles and
  // the OS is responsive.
  static defaultProcessPriority = osConstants.priority.PRIORITY_BELOW_NORMAL;

  /**
   * We will be storing a worker thread object (returned by Executable over IPC) against composite id.
   * The composite ID will have group id prefixed with '#' as a separator.
   * @type {Map<string, Object>}
   */
  threads = new Map();

  // This will be set to true if stop command is issued.
  isStopping = false;

  // This will point reference to IPC node attached to the executable.
  ipcNode = null;

  // This will hold reference to the executable process.
  process = null;
  initializing = false;
  initialized = false;

  /**
   * @param {Symbol|String|Number} id - Id of the container to set
   * @param {Function} workerEventCallback - Callback function which will be called by the worker thread for sending data
   * @param {Function} onExitHandler - Callback function which will be called when the container process exits
   */
  constructor (id, workerEventCallback, onExitHandler) {
    this.id = id;
    this.workerEventCallback = workerEventCallback;
    this.processPriority = ThreadGroup.defaultProcessPriority;
    this.onExitHandler = onExitHandler;
  }

  /**
   * Subscribe to the IPC events from the executable process which includes runtime events from the workers and runtime
   * requests from the workers.
   *
   * - Runtime events are the events which are emitted by the workers during the execution of the collections.
   * - Runtime requests are the special requests which are sent by the workers to the container process. These requests
   *  are used to perform some special actions like token refresh, etc. These requests are handled by the container
   *  process and the response is sent back to the workers.
   *
   * @param {string} threadId - Id of the thread to subscribe to
   *
   * @returns {{unsubscribeRuntimeEvents: *, unsubscribeRuntimeRequests: *}} - Returns the unsubscribe functions for
   * runtime events and runtime requests.
   */
  subscribeForThread (threadId) {
    return {
      unsubscribeRuntimeEvents: this.ipcNode.subscribe(threadId, this.workerEventCallback),
      unsubscribeRuntimeRequests: this.ipcNode.subscribe(`${threadId}:runtimeRequest`, this.handleRuntimeRequest.bind(null, threadId)),
    };
  }

  /**
   * Handles the runtime requests from the workers. Currently, only token refresh requests are handled.
   *
   *  For the token refresh request, the flow is as follows:
   *  1. Token manager acts as a central authority for all the tokens. It is responsible for refreshing the tokens
   *  asynchronously and persisting them in memory and serving them on demand.
   *  2. Workers will send a token refresh request to the container process when runtime requests for a token.
   *  3. Container process will forward the request to the token manager.
   *  4. Token manager will check for the token and send the response back to the container process.
   *  5. Container process will forward the response to the worker.
   *  6. Worker will forward the token to runtime for using it in the request.
   *
   * @param {string} threadId - Id of the thread which sent the request
   * @param {string|object} payload - Payload of the request
   *
   * @throws {Error} - Throws error if the payload is string and not a valid JSON
   *
   * @returns {Promise<void>}
   */
  handleRuntimeRequest = async (threadId, payload) => {
    const { data, requestType, workloadId, sequenceId } = typeof payload === 'string' ? JSON.parse(payload) : payload;

    switch (requestType) {
      case 'oauth2-token-refresh':
        try {
          // Get the access token from the token manager
          const { accessToken } = await system.invoke('tokenManager', {
            method: 'getToken',
            args: [data]
          });

          // Send the response with token, back to the worker
          this.ipcNode.send('runtimeRequestResponse', {
            threadId,
            requestType,
            refreshId: data.refreshId,
            accessToken,
            sequenceId
          });
        }
        catch (e) {
          // Continue with the execution even if the token refresh fails as runtime will be able to use last known
          // token for the request.
          log.error(`ThreadGroup ~ Error while refreshing token for thread ${threadId}`, e);
        }

        break;

      case 'get-system-proxy':
        try {
          const proxyConfig = await system.getSystemProxy(data.url);

          // Send the response with proxy-config, back to the worker
            this.ipcNode.send('runtimeRequestResponse', {
            threadId,
            requestType,
            proxyFetchId: data.proxyFetchId,
            url: data.url,
            proxyConfig,
            sequenceId
          });
        }
        catch (e) {
          // Continue with the execution even if the token refresh fails as runtime will be able to use last known
          // token for the request.
          log.error(`ThreadGroup ~ Error while getSystemProxy for thread ${threadId}`, e.toString());
        }

        break;

      case 'refreshVUData':
        try {
          // Get new data for the workload scenario
          const VUData = await system.invoke('workloadManager', {
            method: 'getDataForScenario',
            args: [workloadId]
          });

          // Send the response with vuData, back to the worker
          this.ipcNode.send('runtimeRequestResponse', {
            threadId,
            requestType: 'vu-data',
            workloadId,
            VUData,
            sequenceId
          });
        } catch (e) {
          // Continue with the execution even if the vu data fetch fails as there will be some slice of data
          // available for runs and every new assignment will have a new slice of data which will act like a
          // refreshed data for the run.
          log.error(`ThreadGroup ~ Error while sending refresh VU data for thread ${threadId}`, e.toString());
        }

        break;

      default:
        log.warn(`ThreadGroup ~ Received unknown runtime request type ${requestType} for thread ${threadId}`);
    }
  }

  /**
   * Unsubscribe from the IPC events from the executable process for the given thread.
   *
   * @param {string} threadId - Id of the thread to unsubscribe from
   *
   * @throws {Error} - Throws error if the thread does not exist
   *
   * @returns {void}
   */
  unsubscribeForThread (threadId) {
    if (this.threads.has(threadId)) {
      this.threads.get(threadId).unsubscribeRuntimeEvents();
      this.threads.get(threadId).unsubscribeRuntimeRequests();
    }
    else {
      createError({
        message: 'ThreadGroup ~ Attempted to unsubscribe from a thread that does not exist',
        source: 'Engine.ThreadGroup.unsubscribeForThread',
        subsystem: 'ScenarioManager',
        severity: CONSTANTS.SEVERITY.ERROR
      });
    }
  }

  init = async () => {
    if (this.initializing || this.initialized) {
      return;
    }

    // Priority of the container process is set to below normal so that it does not interfere with the main process
    // or renderer processes or any other OS processes. Rest of the OS functions will be given priority over this
    // process. This is done to ensure that the main process and renderer processes are not starved of CPU cycles and
    // the OS is responsive.
    let configuredWorkerPriority = osConstants.priority.PRIORITY_BELOW_NORMAL;

    // If the priority was overridden by engine, validate it and use it.
    if (Object.values(osConstants.priority).includes(this.processPriority)) {
      configuredWorkerPriority = this.processPriority;
    }

    log.info('ThreadGroup ~ Starting subprocess with priority', configuredWorkerPriority, 'for thread group', this.id);

    this.initializing = true;

    if (this.isStopping) {
      // Assignment is stopped, so we don't want to start any subprocesses. Not doing so might cause the subprocesses
      // to be orphaned and continue running.
      createError({
        message: 'ThreadGroup ~ Starting subprocess while process manager is stopping',
        source: 'processManager.startSubProcess',
        subsystem: 'ScenarioManager',
        severity: CONSTANTS.SEVERITY.CRITICAL
      });
    }

    const processItem = await startSubProcess({
      id: `${WORKER_CONTAINER_IDENTIFIER}_${this.id}`,
      path: THREAD_GROUP_EXECUTABLE,
      priority: configuredWorkerPriority
    });

    if (this.isStopping) {
      // If the process manager is stopped while the subprocess is starting, we need to kill the subprocess and detach
      // its IPC node. Not doing so might cause the subprocess to be orphaned and continue running.
      detachIpcNode(processItem.ipcNode);
      processItem?.process?.kill('SIGKILL');

      createError({
        message: 'ThreadGroup ~ Started a subprocess while process manager is stopping, killing it.',
        source: 'Engine.Engine.ThreadGroup.create',
        subsystem: 'ScenarioManager',
        severity: CONSTANTS.SEVERITY.CRITICAL
      });
    }

    // Let the process perform its startup tasks and pass down system config options before proceeding.
    await runTimeoutPromise(processItem.ipcNode.invoke('ready', system.getConfigurationOptions()));

    // Consume the bytes on stdout and stderr of the child processes
    // so that their buffers are flushed
    processItem.process._spawnedProcess.stdout.on('data', (data) => {
      // console.log(`Received stdout from child of length : ${data.length}`);
    });

    processItem.process._spawnedProcess.stderr.on('data', (data) => {
      log.error(`Received error from thread group executable: ${data?.toString()}`);
    });

    processItem.process._spawnedProcess.on('close', (code) => {
      log.info(`child process exited with code ${code}`);
    });

    processItem.process.onExit(async () => {
      pm.logger.info('Container process exited, starting another process to replace it');

      try {
        // Container process has died, if the engine is still running, we need to terminate all the active workloads since
        // the container process is dead and there is no way to communicate with the worker threads and the test performance
        // might have degraded.
        if (!this.isStopping) {
          const activeWorkloads = system.getInstances('workloadManager');

          for (const [_, workload] of activeWorkloads) {
            if (workload.state === WORKLOAD_STATES.RUNNING) {
              await workload.terminate();
            }
          }
        }
      }
      catch (e) {
        log.error('Failed to terminate active workloads', e);
      }

      this.onExitHandler && this.onExitHandler(this);
    });

    this.process = processItem.process;
    this.ipcNode = processItem.ipcNode;
    this.initializing = false;
    this.initialized = true;
    this.isStopping = false;
  }

  destroy = () => {
    process.exit(this.process.pid, 'SIGKILL');
  }

  stop = async () => {
    this.isStopping = true;

    try {
      await invokeOnIPC(this.ipcNode, { method: 'stopAll' });
    }
    catch (e) {
      log.error('[ThreadGroup] Failed to stop all threads. Killing group explicitly.', e);

      try {
        this.kill();
      }
      catch (e) {
        log.debug('[ThreadGroup] Process might have exited already.', e);
      }
    }
    finally {
      this.isStopping = false;
    }
  }

  createThread = async () => {
    if (this.isStopping) {
      // Assignment is stopped, so we don't want to start any workers. Not doing so might cause the workers
      // to be orphaned and continue running.
      createError({
        message: 'ThreadGroup ~ Starting worker while group is stopping',
        source: 'Engine.ThreadGroup.startWorkerThread',
        subsystem: 'ScenarioManager',
        severity: CONSTANTS.SEVERITY.CRITICAL
      });
    }

    const thread = await invokeOnIPC(this.ipcNode, { method: 'addThread', args: [`${this.id}#${uuid()}`] });

    if (this.isStopping) {
      // If the worker manager is stopped while the worker is starting, we need to kill the worker.
      // Not doing so might cause the worker to be orphaned and continue running.
      try {
        await invokeOnIPC(this.ipcNode, { method: 'removeThread', args: [thread.id] });
      }
      catch (e) {
        await this.kill();

        createError({
          error: e,
          message: 'ThreadGroup ~ Failed to remove unwanted thread while stopping. Killing Group.',
          source: 'Engine.ThreadGroup.startWorkerThread',
          subsystem: 'ScenarioManager',
          severity: CONSTANTS.SEVERITY.CRITICAL
        });
      }

      createError({
        message: 'ThreadGroup ~ Started a worker while worker manager is stopping, killing it.',
        source: 'Engine.ThreadGroup.startWorkerThread',
        subsystem: 'ScenarioManager',
        severity: CONSTANTS.SEVERITY.CRITICAL
      });
    }

    thread.group = this;
    thread.stop = this.removeThread.bind(this, thread.id);
    thread.assignRun = this.assignRun.bind(this, thread.id);
    thread.stopRun = this.stopRun.bind(this, thread.id);
    thread.abortRun = this.abortRun.bind(this, thread.id);

    this.threads.set(thread.id, this.subscribeForThread(thread.id));

    return thread;
  }

  removeThread = async (threadId) => {
    const thread = this.threads.has(threadId);

    if (thread) {
      try {
        await invokeOnIPC(this.ipcNode, {
          method: 'removeThread',
          args: [threadId]
        });

        this.unsubscribeForThread(threadId);
      }
      catch (e) {
        createError({
          error: e,
          message: 'ThreadGroup ~ Failed to remove thread',
          source: 'Engine.ThreadGroup.removeWorkerThread',
          subsystem: 'ScenarioManager',
          severity: CONSTANTS.SEVERITY.ERROR
        });
      }

      this.threads.delete(threadId);
    }
    else {
      createError({
        message: 'ThreadGroup ~ Attempted to remove a worker that does not exist',
        source: 'Engine.ThreadGroup.removeWorkerThread',
        subsystem: 'ScenarioManager',
        severity: CONSTANTS.SEVERITY.ERROR
      });
    }
  }

  kill = () => {
    process.kill(this.process.pid, 'SIGKILL');
  }

  assignRun = async (workerId, [{ executionContext, data }]) => {
    if (!this.threads.has(workerId)) {
      createError({
        message: `ThreadGroup ~ Attempted to assign a run to a worker [${workerId}] that does not exist`,
        source: 'Engine.ThreadGroup.assignScenario',
        subsystem: 'ScenarioManager',
        severity: CONSTANTS.SEVERITY.CRITICAL
      });
    }

    if (!executionContext) {
      log.error('ThreadGroup ~ No execution context provided for scenario execution');

      createError({
        message: 'ThreadGroup ~ No execution context provided for scenario execution',
        source: 'Engine.ThreadGroup.assignScenario',
        subsystem: 'ScenarioManager',
        severity: CONSTANTS.SEVERITY.CRITICAL
      });
    }

    if (!data || !data.collection) {
      log.error('ThreadGroup ~ No collection provided for scenario execution');

      createError({
        message: 'ThreadGroup ~ No collection provided for scenario execution',
        source: 'Engine.ThreadGroup.assignScenario',
        subsystem: 'ScenarioManager',
        severity: CONSTANTS.SEVERITY.CRITICAL
      });
    }

    try {
      await invokeOnIPC(this.ipcNode, {
        method: 'assignRun',
        args: [workerId, executionContext, data]
      });
    } catch (e) {
      createError({
        error: e,
        message: 'ThreadGroup ~ Failed to assign run to worker',
        source: 'Engine.ThreadGroup.assignScenario',
        subsystem: 'ScenarioManager',
        severity: CONSTANTS.SEVERITY.ERROR
      });
    }
  }

  /**
   * Sends a message to the thread group process to signal a particular thread to stop a run.
   *
   * @param {string} workerId - The id of the worker to stop the run on
   * @param {object} executionContext - The execution context of the run to stop
   *
   * @returns {Promise<*>}
   */
  stopRun = async (workerId, executionContext) => {
    try {
      return await invokeOnIPC(this.ipcNode, {
        method: 'stopRun',
        args: [workerId, executionContext]
      });
    } catch (e) {
      createError({
        error: e,
        message: 'ThreadGroup ~ Failed to stop run',
        source: 'Engine.ThreadGroup.stopRun',
        subsystem: 'ScenarioManager',
        severity: CONSTANTS.SEVERITY.ERROR
      });
    }
  }

  /**
   * Sends a message to the thread group process to signal a particular thread to abort a run.
   *
   * @param {string} workerId - The id of the worker to abort the run on
   * @param {object} executionContext - The execution context of the run to abort
   *
   * @returns {Promise<*>}
   */
  abortRun = async (workerId, executionContext) => {
    try {
      return await invokeOnIPC(this.ipcNode, {
        method: 'abortRun',
        args: [workerId, executionContext]
      });
    } catch (e) {
      createError({
        error: e,
        message: 'ThreadGroup ~ Failed to abort run',
        source: 'Engine.ThreadGroup.abortRun',
        subsystem: 'ScenarioManager',
        severity: CONSTANTS.SEVERITY.ERROR
      });
    }
  }
}

module.exports = ThreadGroup;
