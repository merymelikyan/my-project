// Allow each operation to take up to 10 seconds
const DEFAULT_TIMEOUT = 10000;

/**
 * Wraps a promise with a timeout which rejects if the promise does not resolve within the specified timeout.
 *
 * @param {Promise} promise - Promise to wrap
 * @param {Number} [timeout=DEFAULT_TIMEOUT] - Timeout in milliseconds
 *
 * @returns {Promise<T>}
 */
function runTimeoutPromise (promise, timeout = DEFAULT_TIMEOUT) {
  let timeoutId;

  // Create error beforehand to capture the stack trace correctly. If we do it inside the timeout callback,
  // the stack trace will be incorrect and will indicate the timeout callback as the source of the error.
  const error = new Error(`Operation timed out after ${timeout} ms`);
  const timeoutPromise = new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => {
      pm.logger.error(`Promise operation timed out after ${timeout} ms`, { ...error, stack: error.stack, promise });

      reject(error);
    }, timeout);
  });

  return Promise.race([promise, timeoutPromise]).then((result) => {
    clearTimeout(timeoutId);

    return result;
  });
}

module.exports = {
  runTimeoutPromise
};
