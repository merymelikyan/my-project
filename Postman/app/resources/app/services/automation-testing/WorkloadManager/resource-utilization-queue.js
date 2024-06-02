const MAX_QUEUE_LENGTH = 5;

/**
 * This class contains a fixed-length array of objects, each containing observations
 * of system utilization. This includes CPU utilization, memory, etc.
 *
 * It is assumed that this queue is sorted by time, since newer observations are added
 * later in time.
 *
 * Also, we will assume queue is only valid when full - otherwise we don't have
 * enough data to make decisions.
 */
module.exports = class ResourceUtilizationQueue {
  constructor (maxLength = MAX_QUEUE_LENGTH) {
    this.values = [];
    this.maxLength = maxLength;
  }

  /**
   * Returns if the queue is full.
   *
   * @returns {Boolean}
   */
  isFull = () => {
    return this.values.length === this.maxLength;
  }

  /**
   * Add a new system utilization observation to the queue.
   *
   * @param {Object} element - A system utilization observation.
   */
  enqueue = (element) => {
    this.values.push(element);

    // Ignore anything other than the most recent MAX_QUEUE_LENGTH number of values.
    if (this.values.length > this.maxLength) {
      this.values = this.values.splice(-this.maxLength);
    }
  }

  /**
   * Clear the queue. This is to be used when the existing data is not valid anymore.
   * For example, once we make changes to scenario config, the past observations are not valid.
   */
  clear = () => {
    this.values = [];
  }
};
