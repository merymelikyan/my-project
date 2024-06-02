const { runTimeoutPromise } = require('../../utils/promise');
const TIMEOUT_DURATION = 30 * 1000; // 30 seconds

module.exports = {
  /**
   * Invokes a method on the instance.
   *
   * @param {object} instance - Instance to invoke the method on
   * @param {string} method - Name of the method to invoke
   * @param {Array<any>} args - Arguments to pass to the method
   *
   * @returns {Promise<T>}
   */
  invoke: function invoke (instance, { method, args = [] }) {
    // Run timeout promise to ensure that the invoke call does not hang forever and rejects after a timeout.
    return runTimeoutPromise(
      instance.ipcNode.invoke('invoke', { method, args }),
      TIMEOUT_DURATION
    );
  },
};
