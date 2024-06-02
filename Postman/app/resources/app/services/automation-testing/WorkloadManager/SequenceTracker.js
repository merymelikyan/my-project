const uuid = require('uuid');

module.exports = class SequenceTracker {
  /**
   *
   * @param {integer} target - The target number to be counted down before the tracker completes
   * @param {integer} gracePeriodMs - The duration after which to call the function to kill
   * @param {function} killFunction - The function to be called at the end of the gracePeriodMs
   */
  constructor (target, gracePeriodMs, killFunction) {
    this.target = target;
    this.timeout = null;
    this.killFunction = killFunction;
    this.uuid = uuid.v4();

    this.forceKillAfterTimeout(gracePeriodMs);
  }

  /**
   * The method that needs to be called when the target can be reduced by 1.
   */
  countDown () {
    if (this.target > 0) {
      this.target = this.target - 1;

      if (this.target === 0) {
        clearTimeout(this.timeout);
      }
    }
  }

  /**
   * The function that sets up a timer to call the function to kill the remaining
   * number of targets after the expiry of grace period
   *
   * @param {integer} timeout - The timeout in milliseconds after which to call the given function
   */
  forceKillAfterTimeout (timeout) {
    this.timeout = setTimeout(() => {
      this.killFunction(this.target);

      this.target = 0;
    }, timeout);
  }
};
