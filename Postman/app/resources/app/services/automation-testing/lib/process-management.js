const { processes } = require('./host');

/**
 * Kills all the child processes of a given parent process.
 * @param {Number} parentId - Parent process ID.
 * @returns {Promise<void>}
 */
const killAllChildProcesses = async (parentId) => {
  const childProcesses = await processes.getChildProcesses(parentId);

  pm.logger.info('killAllChildProcesses: Found child processes', childProcesses.map(({ pid }) => pid));

  childProcesses.forEach((child) => {
    killProcess(child.pid);
    pm.logger.info(`Force killed child process ${child.pid}`);
  });
};

/**
 * Kills a process.
 *
 * @param {Number} processId - Process ID to kill.
 */
const killProcess = (processId) => {
  try {
    process.kill(processId, 'SIGKILL');
  } catch (error) {
    // Process already exited
  }
};

module.exports = {
  killAllChildProcesses,
  killProcess
};
