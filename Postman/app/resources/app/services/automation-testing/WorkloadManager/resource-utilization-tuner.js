const NO_OF_CONSECUTIVE_MEASUREMENTS = 3,
    CPU_HIGH_THRESHOLD = 90,
    CPU_LOW_THRESHOLD = 80,
    HIGH_CPU_CODE = 'CPU_HIGH',
    LOW_CPU_CODE = 'CPU_LOW',
    MAX_SLEEP_DURATION = 2000,
    MIN_SLEEP_DURATION = 100,
    SLEEP_STEP_SIZE = 200;

/**
 * Based on the resource utilization measurements, this function calculates the delta between recommended
 * config, and current config for sleep duration.
 *
 * @param {Object} input
 * @param {Object[]} input.resourceUtilizationMetrics - the array containing resource util measurements.
 * @returns
 */
function _calculateSleepDelta ({ resourceUtilizationMetrics }) {
  let resultStepSize = 0;

  // Bail out early if not enough metrics
  if (resourceUtilizationMetrics.length < NO_OF_CONSECUTIVE_MEASUREMENTS) {
    return resultStepSize;
  }

  const breachedCPUThreshold = _getBreachedCPUThresholdCode(resourceUtilizationMetrics);

  // Return the step size based on CPU breach code.
  if (breachedCPUThreshold === HIGH_CPU_CODE) {
    resultStepSize = SLEEP_STEP_SIZE;
  }
  else if (breachedCPUThreshold === LOW_CPU_CODE) {
    resultStepSize = -SLEEP_STEP_SIZE;
  }

  return resultStepSize;
}

/**
 * Checks last NO_OF_CONSECUTIVE_MEASUREMENTS measurements to see if CPU threshold were continuously
 * breached, and returns the code for the broken threshold.
 *
 * @param {Object[]} resourceUtilizationMetrics - Array of resource utilization measurements
 *
 * @returns {String}
 */
function _getBreachedCPUThresholdCode (resourceUtilizationMetrics) {
  const startIndex = resourceUtilizationMetrics.length - NO_OF_CONSECUTIVE_MEASUREMENTS;

  // Pick CPU percentage from last NO_OF_CONSECUTIVE_MEASUREMENTS elements.
  const reducedArray = resourceUtilizationMetrics.slice(startIndex, resourceUtilizationMetrics.length).map(
    (element) => { return element.system.cpu; }
  ),
  minOfConsecutive = Math.min(...reducedArray),
  maxOfConsecutive = Math.max(...reducedArray);

  if (minOfConsecutive > CPU_HIGH_THRESHOLD) {
    // We have consecutive breaches for high threshold
    return HIGH_CPU_CODE;
  }
  else if (maxOfConsecutive < CPU_LOW_THRESHOLD) {
    // We have consecutive breaches for low threshold
    return LOW_CPU_CODE;
  }
  else {
    return null;
  }
}

/**
 * This module is responsible for suggesting modification to the resource utilization configs
 * such as process sleep duration. The logic to calculate it is abstracted out, and only one
 * interface - getUtilizationConfigDelta is exposed.
 */
module.exports = {
 /**
  * This function recommends the delta to the resource utilization configs, so we can extract
  * maximum performance from the client.
  *
  * @param {Object} input
  * @param {Object[]} input.resourceUtilizationMetrics - the array containing resource util measurements.
  * @param {Object} input.currentConfigs - The current resource usage configs.
  * @param {Number} input.currentConfigs.sleepDuration - The sleep duration for processes between scenarios.
  *
  * @returns {Object}
  */
  getUtilizationConfigDelta ({ resourceUtilizationMetrics, currentConfigs = { sleepDuration: 1000 } }) {
    const sleepDelta = _calculateSleepDelta({ resourceUtilizationMetrics });

    return {
      sleepDuration: sleepDelta
    };
  }
};
