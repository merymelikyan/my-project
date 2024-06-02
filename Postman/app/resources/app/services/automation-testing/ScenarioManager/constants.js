const constants = {};

constants.ELECTRON_MAIN_EVENT = 'runnerScenarioManager';

/**
 * The name of the event bus that the load testing process will use to receive
 * commands from the main process OR load generator system.
 */
constants.WORKLOAD_MANAGER_EVENT_BUS = 'workload_manager_event_bus';
constants.SEQUENCE_EVENT_BUS = 'sequence_event_bus';

/**
 * The name of events received from individual runtime instances/scenarios.
 * @type {{STARTED: string, FINISHED: string}}
 */
constants.SCENARIO_EXECUTION_EVENTS = {
  FINISHED: 'done',
  ERROR: 'error',
  STARTED: 'start',
  ABORTED: 'aborted',
  ITERATION_FINISHED: 'iteration',
  ALL_ASSIGNMENTS_COMPLETED: 'allRunFinished',
};

/**
 * The name of the events that will be sent from the execution control process to the main process via event stream.
 */
constants.EXECUTION_STATES = {
  STARTING: 'scenario-starting',
  STARTED: 'scenario-started',
  START_ERROR: 'scenario-start-error',
  STOPPING: 'scenario-stopping',
  STOPPED: 'scenario-stopped',
  PAUSING: 'scenario-pausing',
  PAUSED: 'scenario-paused',
  FINISHING: 'scenario-finishing',
  FINISHED: 'scenario-finished',
  ITERATION_FINISHED: 'iteration-finished',
  ERROR: 'scenario-execution-error', // @TODO: Figure out how error/finished/finishing emit w.r.t. each other.
  ABORTED: 'scenario-aborted'
};


constants.WORKLOAD_STATES = {
  IDLE: 'idle',
  WARMING_UP: 'warming-up',
  READY: 'ready',
  STARTING: 'starting',
  RUNNING: 'running',
  STOPPING: 'stopping',
  STOPPED: 'stopped',
  PAUSING: 'pausing',
  PAUSED: 'paused',
  FINISHING: 'finishing',
  FINISHED: 'finished',
  ERROR: 'error',
  TERMINATED: 'terminated',
};

constants.WORKLOAD_ACTIONS = {
  INIT: 'init',
  START: 'start',
  STOP: 'stop',
};

constants.WORKLOAD_ALLOWED_ACTIONS = {
  [constants.WORKLOAD_STATES.IDLE]: [constants.WORKLOAD_ACTIONS.INIT],
  [constants.WORKLOAD_STATES.WARMING_UP]: [],
  [constants.WORKLOAD_STATES.READY]: [constants.WORKLOAD_ACTIONS.START],
  [constants.WORKLOAD_STATES.STARTING]: [],
  [constants.WORKLOAD_STATES.STARTED]: [constants.WORKLOAD_ACTIONS.STOP],
  [constants.WORKLOAD_STATES.STOPPING]: [],
  [constants.WORKLOAD_STATES.STOPPED]: [],
  [constants.WORKLOAD_STATES.PAUSING]: [],
  [constants.WORKLOAD_STATES.PAUSED]: [constants.WORKLOAD_ACTIONS.STOP],
  [constants.WORKLOAD_STATES.FINISHING]: [],
  [constants.WORKLOAD_STATES.FINISHED]: [],
};

constants.SUB_SYSTEM_REQUESTS = {
  ACTION: {
    PREVENT_SLEEP: 'preventPowerSaver',
    ALLOW_SLEEP: 'releasePowerSaver',
  },
  REQUEST: {
    GET_SYSTEM_PROXY: 'getSystemProxy',
  }
};

/**
 * The types of requests a thread can send to execution process.
 * @type {{OAUTH2_TOKEN_REFRESH: string, GET_SYSTEM_PROXY: string, VU_DATA: string}}
 */
constants.THREAD_REQUESTS = {
  OAUTH2_TOKEN_REFRESH: 'oauth2-token-refresh',
  GET_SYSTEM_PROXY: 'get-system-proxy',
  VU_DATA: 'vu-data'
};

/**
 * Distribution types for data file rows.
 *
 * - ORDERED|SEQUENTIAL: Rows are distributed in-order sequentially, one after the other to each virtual user.
 * - RANDOM: Rows are distributed randomly.
 *
 * TODO: Keep one of ORDERED or SEQUENTIAL, having both for backwards compatibility
 *
 * @type {{RANDOM: string, SEQUENTIAL: string, ORDERED: string}}
 */
constants.DATAFILE_DISTRIBUTION_TYPES = {
  ORDERED: 'ordered',
  SEQUENTIAL: 'sequential', // sequential is deprecated, use ordered instead
  RANDOM: 'random',
};

/**
 * Constants for data file slice management which is done by workload manager, to pass slices of data file to workers during execution.
 *
 * @type {{SAMPLE_SIZE: integer, REFRESH_DATA_INTERVAL: integer}}
 */
constants.DATAFILE_RANDOM_DISTRIBUTION = {
  /**
   * The number of rows to be sent to each worker in a single slice of data file to worker thread during assignments and
   * data refresh requests.
   *
   * Worker thread will read this many rows from the slice and then request for a new slice. Worker threads consume
   * one slice per iteration of active assignments.
   *
   * Number 10 is chosen as a default value for this constant because:
   * - It is a small number, so that the data file slice is small enough to be sent to worker thread in a single message (IPC).
   * - It ensures a small slice size such that we don't consume too much memory in the worker thread.
   *
   * Memory consumption in worker thread is a concern because:
   * - Each worker thread will have its own copy of the data file slice.
   * - There can be N worker threads running in parallel, where N is the number of CPU cores.
   */
  SAMPLE_SIZE: 10,

  /**
   * Number of reads that a worker can perform on a single slice of data file before requesting for a new slice.
   *
   * This constant is used to prevent a worker from reading the same slice of data file too many times thus compromising
   * the randomness of the data.
   *
   * Number 10 is chosen as a default value for this constant because:
   * - It is a small number such that we don't request for a new slice too frequently as well as it assures less probability
   * of a worker reading the same row multiple times.
   */
  REFRESH_DATA_INTERVAL: 10,
};

module.exports = constants;
