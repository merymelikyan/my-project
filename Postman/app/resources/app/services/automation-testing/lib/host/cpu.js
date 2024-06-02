const os = require('os');

/**
 * Get the CPU information
 *
 * @returns {{model: *, speed: *}[]}
 */
function getCPUInformation () {
  return os.cpus().map(({ model, speed }) => ({ model, speed }));
}

/**
 * Get the CPU stats
 *
 * @returns {{idle: number, total: number}}
 * @private
 */
function _getCPUStats () {
  const cpus = os.cpus();

  let user = 0;
  let nice = 0;
  let sys = 0;
  let idle = 0;
  let irq = 0;

  for (const cpu in cpus) {
    if (!cpus.hasOwnProperty(cpu)) continue;

    user += cpus[cpu].times.user;
    nice += cpus[cpu].times.nice;
    sys += cpus[cpu].times.sys;
    irq += cpus[cpu].times.irq;
    idle += cpus[cpu].times.idle;
  }

  const total = user + nice + sys + idle + irq;

  return {
    idle,
    total
  };
}

/**
 * Get the CPU usage percentage
 *
 * @param {function} callback - Callback function to return the CPU usage percentage
 * @param {boolean} [free=false] - Return free CPU percentage
 * @param {number} [observationInterval=1000] - Observation interval in milliseconds
 */
function getCPUUsage (callback, free = false, observationInterval = 1000) {
  const intervalStart = _getCPUStats();
  const startIdle = intervalStart.idle;
  const startTotal = intervalStart.total;

  setTimeout(function () {
    const intervalEnd = _getCPUStats();
    const endIdle = intervalEnd.idle;
    const endTotal = intervalEnd.total;
    const idle 	= endIdle - startIdle;
    const total 	= endTotal - startTotal;
    const percentage	= idle * 100 / total;

    if (free === true) {
      callback(percentage);
    }
    else {
      callback((100 - percentage));
    }
  }, observationInterval);
}

/**
 * Get the CPU usage percentage as a promise
 *
 * @param {boolean} [free=false] - Return free CPU percentage
 * @param {number} [observationInterval=1000] - Observation interval in milliseconds
 *
 * @returns {Promise<number>} - CPU usage percentage
 */
const getCPUUsagePromise = (observationInterval = 1000, free = false) => new Promise((resolve) => {
  getCPUUsage(resolve, free, observationInterval);
});

module.exports = {
  getCPUInformation,
  getCPUUsage,
  getCPUUsagePromise
};
