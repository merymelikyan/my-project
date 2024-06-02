const system = require('../lib/system');
const { log } = require('../lib/logging');
const { EXECUTION_STATES, SCENARIO_EXECUTION_EVENTS } = require('./constants');
const ExecutionEngine = require('./ExecutionEngine/Engine');

/**
 * This class is responsible for executing and managing scenario runs.
 *
 * It works by spawning multiple subprocesses and distributing the scenario runs across them. It will be responsible
 * for managing the state of the execution and the progress of the execution.
 *
 * It will be emitting events to two separate event buses. One is the event bus for sending the data received from the
 * individual runtime instance/scenario run. The other is the event bus for sending the metadata related to the progress
 * and state of the execution.
 *
 * There will be an input bus as well for accepting commands via event stream but it might not be initialized at the time
 * of creation of this class. The input bus will be initialized during the start of the execution.
 *
 * @class ScenarioManager
 */
module.exports = class ScenarioManager {
  constructor () {}

  /**
   * This is a lifeCycle function which ExecutionSystem(system) will call during lifecycle events of the execution system.
   * This function will be invoked when the execution process is booted up.
   *
   * @returns {Promise<void>}
   */
  onStartup = async () => {
    const config = system.getConfigurationOptions();

    this.workloadDistributor = new ExecutionEngine({
      runtimeEventHandler: this.handleSubprocessEvent.bind(this)
    });

    // Setup containers for the workers
    await this.workloadDistributor.setup();

    log.info('ScenarioManager - onStartup: Engine warmup complete.', config);
  }

  /**
   * This is a lifeCycle function which ExecutionSystem(system) will call during lifecycle events of the execution system.
   * This function will be invoked when the execution process is shutting down.
   *
   * @returns {Promise<void>}
   */
  onExit = async () => {
    await this.workloadDistributor.forceKill();
  }

  /**
   * Initializes the ScenarioManager. This will initialize the process manager and returns promise.
   *
   * @param {Number} maxVUs - Maximum number of VUs to be used for the execution
   *
   * @returns {Promise<*>}
   */
  init = (maxVUs) => {
    this.workloadDistributor.adjustEndurance(maxVUs);
    return this.workloadDistributor.init();
  }

  /**
   * Handles the events received from the sub-process. This will invoke the corresponding methods to handle the events
   * The data received from the sub-process can be in the JSON.stringify format. So, it will be parsed before emitting
   * the event to the event bus channel (if required). The event bus channel will be used to send the data to the main
   * process.
   *
   * @param {string|object} data - Event payload
   */
  handleSubprocessEvent (data) {
    // There is no relevance of processRef in an abstracted interface of workload distributor,
    // which can be worker thread manager or process manager.
    // we will be using executorReferenceId going forward to have same key among both kind of
    // interfaces.
    data.processRef = data?.processRef || data?.executorReferenceId;

    log.debug('ScenarioManager ~ Received event from sub-process', data?.event, {
      hasError: !!data?.data?.err,
      errorCode: data?.data?.err?.code,
      responseCode: data?.data?.response?.code,
      executionId: data?.executionContext?.executionContextId,
      executorReferenceId: data?.processRef
    });

    // Emit all low level events to the event bus channel. This will include all the run events from individual runners
    // and the execution context events.
    this.emitRuntimeEventsToMetricsChannel(data);

    // Emit the execution context events to the event bus channel. This will include the events related to the execution
    // context like adding, started, finished, etc.
    this.updateExecutionContextStateFromRuntimeEvents(
      data?.event,
      data?.processRef,
      data?.executionContext
    );
  }

  /**
   * Emits events to the metrics channel. This will include all the run events from individual runners. The data will
   * contain the event name, executionContextId, runnerId, and whatever data is sent by runner for the corresponding event.
   *
   * @param {object} data - Event payload
   */
  emitRuntimeEventsToMetricsChannel = async (data) => {
    await system.invoke('metricsProcessor', { method: 'processRunData', args: [data] });
  };

  /**
   * Updates the state of the execution context and emits the event to the event bus channel.
   *
   * @param {object} executionContext - Execution context, contains the runId and the sequence ID
   * @param {string} processRef - Process reference
   * @param {string} eventName - Event name
   */
  updateExecutionContextStateFromRuntimeEvents = (eventName, processRef, executionContext) => {
    switch (eventName) {
      case SCENARIO_EXECUTION_EVENTS.STARTED:
        this.emitScenarioMetaEvents(EXECUTION_STATES.STARTED, executionContext, processRef);
        break;

      case SCENARIO_EXECUTION_EVENTS.FINISHED:
        this.emitScenarioMetaEvents(EXECUTION_STATES.FINISHED, executionContext, processRef);
        break;

      case SCENARIO_EXECUTION_EVENTS.ABORTED:
        this.emitScenarioMetaEvents(EXECUTION_STATES.ABORTED, executionContext, processRef);
        break;

      case SCENARIO_EXECUTION_EVENTS.ITERATION_FINISHED:
        this.emitScenarioMetaEvents(EXECUTION_STATES.ITERATION_FINISHED, executionContext, processRef);
        break;
    }
  };

  /**
   * Emits events to the meta channel. This will include the events related to the execution context like running, finished etc.
   * @param {object} executionContext - execution context received, contains the runId and the sequence ID
   * @param {string} eventName - Event name
   * @param {string} processRef - Process reference
   */
  emitScenarioMetaEvents = async (eventName, executionContext, processRef) => {
    const workloadId = executionContext.executionContextId;

    await system.invoke('workloadManager', {
      method: 'handleExecutorResponse',
      args: [workloadId, {
        executionContext,
        processRef,
        name: eventName
      }]
    });
  }

  /**
   *
   * @param {object} data - Data to be used for the runs, contains the collection/scenario, environment, request selection etc.
   * @param {object} executionContext - Execution context, contains the runId and the sequence ID
   */
  runScenario = async ({ data, executionContext }) => {
    if (!data || !executionContext) {
      // @TODO: Figure out how we should handle this error. I doubt we should be bailing out silently.
      log.error('ScenarioManager~runScenario: Invalid Arguments.');
      await this.emitScenarioMetaEvents(EXECUTION_STATES.START_ERROR, executionContext, { error: 'ScenarioManager~runScenario: Invalid Arguments.' });

      return;
    }

    try {
      await this.workloadDistributor.assignScenario({ executionContext, data });
      await this.emitScenarioMetaEvents(EXECUTION_STATES.STARTING, executionContext);
    } catch (e) {
      // @TODO: Handle error case properly.
      log.error('ScenarioManager ~ Error in execution', e.toString());
      await this.emitScenarioMetaEvents(EXECUTION_STATES.START_ERROR, executionContext, { error: e });
    } finally {
      // @TODO: Clean up?
    }
  }

  /**
   * Aborts a scenario run as soon as possible, even it is in the middle of execution
   *
   * @param {object} executionContext - Execution context, contains the runId and the sequence ID
   *
   * @returns {Promise<*>}
   */
  abortScenario = (executionContext) => {
    if (!executionContext) {
      log.error('ScenarioManager~abortScenario: Invalid Arguments.');

      return;
    }

    return this.workloadDistributor.abortScenario(executionContext);
  }

  /**
   * Stops a scenario run gracefully after the next iteration is completed
   *
   * @param {object} executionContext - Execution context, contains the runId and the sequence ID
   *
   * @returns {Promise<*>}
   */
  stopScenario = (executionContext) => {
    if (!executionContext) {
      log.error('ScenarioManager~stopScenario: Invalid Arguments.');

      return;
    }

    return this.workloadDistributor.stopScenario(executionContext);
  }

  /**
   * Stops all the executions ongoing in the system.
   */
  stop () {
    log.debug('ScenarioManager ~ stop: Stopping all the executions.');
    return this.workloadDistributor.stopAll();
  }

  /**
   * Kills all the executions ongoing in the system.
   */
  kill = () => {
    return this.workloadDistributor.forceKill();
  }
};
