const { exec } = require('node:child_process');
const { platform } = require('node:process');
const { log } = require('../logging');
const EXECUTION_TIMEOUT = 5000;

/**
 * Check if a command is available.
 *
 * @param {string} command - Command to check.
 *
 * @returns {Promise<Boolean>} - Promise that resolves to true if the command is available, false otherwise.
 */
function isCommandAvailable (command) {
  return new Promise((resolve) => {
    try {
      exec(`where ${command}`, { timeout: EXECUTION_TIMEOUT, windowsHide: true }, (error, stdout, stderr) => {
        if (error || stderr) {
          resolve(false);
        }

        resolve(true);
      });
    }
    catch (error) {
      log.error('Error while checking if command is available', error);

      resolve(false);
    }
  });
}

/**
 * Get child processes of a given parent process.
 *
 * @param {Number} parentProcessId - Parent process ID.
 *
 * @returns {Array<{pid: Number, ppid: Number}>}
 */
async function getChildProcesses (parentProcessId) {
  let command;

  // os.platform() returns 'win32' on both 32-bit and 64-bit versions of Windows
  // https://nodejs.org/api/os.html#osplatform
  if (platform === 'win32') {
    // Check if wmic is available
    if (await isCommandAvailable('wmic')) {
      log.debug('Using wmic to get child processes');

      command = 'wmic process get ParentProcessId,ProcessId';
    } else {
      // Fallback to PowerShell
      command = 'powershell "Get-CimInstance Win32_Process | select-Object ParentProcessId, ProcessId"';

      log.debug('Using PowerShell to get child processes');
    }
  }
  else {
    // Unix-like systems (Linux, macOS)
    command = 'ps -e -o ppid,pid';
  }

  return new Promise((resolve, reject) => {
    try {
      exec(command, { timeout: EXECUTION_TIMEOUT, windowsHide: true }, (error, stdout, stderr) => {
        if (error || stderr) {
          log.error('Error while getting child processes', error || stderr);

          reject(error || stderr);
        }
        else {
          const output = stdout.trim().split('\n').slice(1); // Remove the header line from the output

          // For each line, extract the parent process ID and the process ID since they are the first two columns
          // separated by whitespace
          const result = output.map((line) => {
            const [ppid, pid] = line.trim().split(/\s+/);

            return { parentPid: Number(ppid), pid: Number(pid) };
          })

          // Filter the processes to only include the ones that have the given parent process ID
          .filter((process) => process.parentPid === parentProcessId);

          resolve(result);
        }
      });
    }
    catch (error) {
      log.error('Error while getting child processes', error);

      reject(error);
    }
  });
}

module.exports = {
  getChildProcesses
};
