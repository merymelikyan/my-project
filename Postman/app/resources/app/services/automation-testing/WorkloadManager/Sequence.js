const uuid = require('uuid');
const system = require('../lib/system');

const {
  EXECUTION_STATES
} = require('../ScenarioManager/constants');

/**
 * Class that represents and manages a sequence within load test. A sequence is a series of scenarios executed in series.
 *
 * Each instance of this class represents one sequence and it will provide functions to
 * 1. Start running the scenarios
 * 2. Tell it stop creating new scenarios
 * 3. Kill the running scenario
 */
module.exports = class Sequence {
  /**
   *
   * @param {Object} params: The parameters to be used
   * @param {Object} params.sequence: The sequence to be run
   * @param {Object} params.environment: The environment to be used
   * @param {Object} params.requestSelection: The request and folder selection and order to be used
   * @param {Object} params.globals: The global variables to be used
   * @param {Object} params.runOptions: The options to be used in the run
   * @param {Object} params.executionContext: The execution context to be used
   * @param {Object} params.getSleepDuration: The function to be used to get the sleep duration
   * @param {Object} params.dataVariables: The data variables to be used
   */
  constructor (params) {
    const {
      workloadSequenceIndex, sequence, environment, globals, requestSelection, runOptions,
      executionContext, getSleepDuration, sequenceFinishCallback, sequenceOptions
    } = params;

    this.sequenceId = uuid.v4();
    this.sequence = sequence;
    this.environment = environment;
    this.globals = globals;
    this.requestSelection = requestSelection;
    this.runOptions = runOptions;
    this.config = { getSleepDuration };
    this.workloadSequenceIndex = workloadSequenceIndex;
    this.sequenceOptions = sequenceOptions;

    // assign to a fresh object to avoid sequences sharing the context
    this.executionContext = Object.assign({}, executionContext, {
      sequenceId: this.sequenceId,
      workloadSequenceIndex: this.workloadSequenceIndex
    });
    this.newScenariosStopped = false;
    this.sequenceCompleted = false;
    this.workloadId = this.executionContext?.executionContextId;

    // Explicitly bind the method which we know will be passed around by reference so that the method maintains context
    // of this instances.
    this.start = this.start.bind(this);
    this.handleExecutorCallback = this.handleExecutorCallback.bind(this);
    this.abortScenario = this.endScenario.bind(this, true);
    this.stopScenario = this.endScenario.bind(this, false);
    this.timers = new Set();

    this.sequenceFinishCallback = sequenceFinishCallback;
  }

  /**
   * The executor continuously emits events once we've triggered it, when execution starts, finishes, or errors out. The
   * Workload can elect to react to one or more of these events by adding handlers for them.
   *
   * @param  {String} _data - The payload associated with the event, if any.
   */
  async handleExecutorCallback (data) {
    // @TODO: Add safety checks before accessing data -- it's an object we don't control.

    // handle event only if it belongs this run and this sequence else we can return
    if (data.executionContext.executionContextId !== this.executionContext.executionContextId
      || data.executionContext.sequenceId !== this.sequenceId) {
      return;
    }
    switch (data.name) {

      // Handling the case of scenario finishing and erroring out by starting another scenario run
      // @TODO: Handle the case of EXECUTION_STATES.START_ERROR where the starting of the scenario itself fails
      // we might not have the meta data in that case

      case EXECUTION_STATES.FINISHED:
      case EXECUTION_STATES.ERROR:
        // tell executor to run the scenario again after the sleep duration, if this sequence has not been asked to stop
        if (!this.sequenceCompleted) {
          let didStopSequence = this.sequenceFinishCallback(this.sequenceId);

          if (didStopSequence) {
            return;
          }

          if (!this.newScenariosStopped) {
            const timer = setTimeout(async () => {
              // TODO: Remove this line, a sequence should already kow its ID
              this.executionContext.sequenceId = this.sequenceId;

              await this.assignScenarioRun();

              this.timers.delete(timer);
            }, this.config.getSleepDuration());

            this.timers.add(timer);
          }

          // the last scenario execution is completed, we should not be getting this event in this sequence again
          else {
            this.sequenceCompleted = true;

            const workloadId = this.executionContext.executionContextId;

            await system.invoke('workloadManager', {
              method: 'processSequenceEvents',
              args: [
                workloadId,
                {
                  sequenceId: this.sequenceId,
                  state: 'completed'
                }
              ]
            });
          }
        }
        break;

      case EXECUTION_STATES.ITERATION_FINISHED:
        if (!this.sequenceCompleted) {
          let didStopSequence = this.sequenceFinishCallback(this.sequenceId, 'stopping');

          if (didStopSequence) {
            await system.invoke('scenarioManager', {
              method: 'stopScenario',
              args: [this.executionContext]
            });

            // setup a timer to hard-stop (abort) this scenario after a timeout
            // abortScenario is called unconditionally here since it will not fail or cause any
            // side effects if the scenario has already ended gracefully.

            // TODO: This is not setting up any way to keep a count on the number of scenarios that
            // are gracefully stopped and the ones that are forcefully stopped. We should have a way
            // to keep that check.
            setTimeout(async () => {
              await system.invoke('scenarioManager', {
                method: 'abortScenario',
                args: [this.executionContext]
              });
            }, this.sequenceOptions.sequenceGracePeriod);
          }
        }

        break;

      case EXECUTION_STATES.ABORTED:
        this.sequenceFinishCallback(this.sequenceId, 'aborted');
        break;

      default:
        break;
    }
  }

  // Kick starts the scenario runs in the sequence
  async start () {
    // Call executor to start a scenario run
    // @TODO: This call only works if this is reached from the renderer thread
    //       If this is moved to the main process, we need to get IPC working or do function calls into the executor

    await this.assignScenarioRun();
  }

  /**
   * Assigns a scenario run to the executor to run
   *
   * @returns {Promise<void>}
   */
  assignScenarioRun = async () => {
    await system.invoke('scenarioManager', {
      method: 'runScenario',
      args: [{
        data: {
          collection: this.sequence,
          environment: this.environment || null,
          globals: this.globals || null,
          requestSelection: this.requestSelection || null,
          runOptions: this.runOptions || null,
          VUData: await system.invoke('workloadManager', {
            method: 'getDataForScenario',
            args: [this.workloadId, this.workloadSequenceIndex]
          })
        },
        executionContext: this.executionContext,
        count: 1
      }]
    });
  }

  // After this method is called, no new scenario should be run
  stopNewScenarios () {
    this.newScenariosStopped = true;
  }

  // There can only be one scenario run at a time, this is the interface to kill that
  async endScenario (abort = false) {
    this.stopNewScenarios();
    this.sequenceCompleted = true;

    for (const timer of this.timers) {
      clearInterval(timer);
      this.timers.delete(timer);
    }

    const method = abort ? 'abortScenario' : 'stopScenario';

    await system.invoke('scenarioManager', {
      method,
      args: [this.executionContext]
    });

    await system.invoke('workloadManager', {
      method: 'processSequenceEvents',
      args: [
        this.executionContext.executionContextId,
        {
          sequenceId: this.sequenceId,
          state: 'completed'
        }
      ]
    });
  }

  get id () {
    return this.sequenceId;
  }
};
