const { log } = require('./logging');
const { isProcessAlive } = require('@postman/app-plugins-host/lib/helpers/process');
const { killAllChildProcesses } = require('./process-management');

// Symbol to store global data in the global object so that it is isolated. This will avoid conflicts with other modules
// that might be using the same variable names inside global.
const $watchdog = Symbol('ExecutionProcessWatchdog');
const defaultInterval = 2000; // ms

// Initialize the global object with the required data.
global[$watchdog] = {
  idsToWatch: new Set(),
  watchdogs: new Set(),
};

/**
 * Sets a processId to run watchdog on.
 *
 * @param {Number} processId - Process ID to watch.
 */
const setProcessIdToWatch = (processId) => {
  global[$watchdog].idsToWatch.add(processId);
};

/**
 * Removes a processId from the list of processIds to watch.
 *
 * @param {Number} processId - Process ID to watch.
 */
const removeProcessIdFromWatching = (processId) => {
  global[$watchdog].idsToWatch.delete(processId);
};

/**
 * Checks if a processId is being watched.
 *
 * @param {Number} processId - Process ID to watch.
 *
 * @returns {boolean}
 */
const isProcessIdBeingWatched = (processId) => {
  return global[$watchdog].idsToWatch.has(processId);
};

/**
 * Starts the watchdog for the parent process. It will kill all the child processes if the parent process is not alive or
 * calls the onMissingParent callback if provided.
 *
 * @param {function} [onMissingParent] - Callback to be called if the parent process is not alive.
 * @param {Number} [timeout=defaultInterval] - Timeout in milliseconds.
 *
 * @returns {*}
 */
const startParentWatchdog = (onMissingParent, timeout = defaultInterval) => {
  // Set parent process as the process to watch at the start of the watchdog as the parent process might be taken over
  // by operating system if that has become orphan depending on the operating system. So we cannot rely on the parent
  // process ID that we have at the time of check.
  setProcessIdToWatch(process.ppid);

  const intervalId = setInterval(() => {
    for (const parentPID of global[$watchdog].idsToWatch) {
      if (!isProcessAlive(parentPID)) {
        if (onMissingParent && typeof onMissingParent === 'function') {
          log.debug(`Parent process ${parentPID} not responding, calling missing-parent handler from watchdog`);
          onMissingParent();
        }
        else {
          log.debug(`Killing all child processes of ${parentPID} from watchdog`);
          killAllChildProcesses(process.pid);
        }
        stopParentWatchdog(intervalId);
      }
    }
  }, timeout);

  global[$watchdog].watchdogs.add(intervalId);

  return intervalId;
};

/**
 * Stops the watchdog for the parent process.
 *
 * @param {Number} intervalId - Interval ID returned by startParentWatchdog.
 */
const stopParentWatchdog = (intervalId) => {
  clearInterval(intervalId);
  global[$watchdog].watchdogs.delete(intervalId);
};

module.exports = {
  setProcessIdToWatch,
  removeProcessIdFromWatching,
  stopParentWatchdog,
  startParentWatchdog,
  isProcessIdBeingWatched,
};
