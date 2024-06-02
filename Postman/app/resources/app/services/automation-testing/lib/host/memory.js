const os = require('os');
const _ = require('lodash');
const si = require('systeminformation');
const { log } = require('../logging');
const { exec } = require('node:child_process');

const COMMAND_EXECUTION_TIMEOUT_MS = 10000;
const MB_TO_BYTES_MULTIPLIER = 1024 * 1024;

/**
 * Get the available physical memory in windows machine
 * uses "systemInfo" command to extract the memory value
 * in MB and converts to bytes
 *
 * @returns {Number} available memory in BYTES
 */
async function getAvailableMemoryForWindows () {
  const command = 'systeminfo | find "Available Physical Memory"';

  let memInBytes;

  return new Promise((resolve, reject) => {
    try {
      exec(command, { timeout: COMMAND_EXECUTION_TIMEOUT_MS, windowsHide: true }, (error, stdout, stderr) => {
        if (error || stderr) {
          log.error('Error while getting available memory', error || stderr);

          reject(error || stderr);
        }
        else {
          const output = stdout.trim();
          const value = parseInt(output.replace(/\D/g, ''), 10);

          if (!value) {
            memInBytes = os.freemem();
            log.debug('getAvailableMemoryForWindows ~ falling back to os module free memory while calculating available memory in windows', memInBytes);
          } else {
            memInBytes = value * MB_TO_BYTES_MULTIPLIER;
          }

          resolve(memInBytes);
        }
      });
    }
    catch (error) {
      log.error('getAvailableMemoryForWindows ~ Error while getting available memory in windows', error);

      reject(error);
    }
  });
}

/**
 * Get the memory information
 *
 * @returns {{total: number, available: number, active: number, used: number, free: number}}
 */
async function getMemoryInformation () {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;

  return {
    total: totalMemory,
    free: freeMemory,
    used: usedMemory,
    active: (os.platform() === 'win32') ? (os.totalmem() - os.freemem()) : _.pick(await si.mem(), ['active']).active,
    available: (os.platform() === 'win32') ? await getAvailableMemoryForWindows() : _.pick(await si.mem(), ['available']).available,
  };
}

module.exports = {
  getMemoryInformation
};
