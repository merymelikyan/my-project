const _ = require('lodash');
const RunnerMetricStore = require('./RunnerMetricStore');

/**
 * This Queue class is used as a buffer to delay writes to duck db
 * It is implemented using an array.
 */
class Queue {
  constructor () {
    this.queue = [];
  }

  getQueueSize () {
    return this.queue.length;
  }

  isEmpty () {
    return !this.queue.length;
  }

  enqueue (item) {
    this.queue.push(item);
  }

  dequeue () {
    if (this.isEmpty()) return null;

    return this.queue.shift();
  }

  dequeueAll () {
    // We will clone to avoid any pass by reference.
    const result = _.cloneDeep(this.queue);

    this.queue = [];

    return result;
  }
}

/**
 * This is a singleton class that keeps track of metrics data stores for each
 * execution of a performance test.
 *
 * It also listens to the events from the workers running the performance test, and ingests
 * the relevant metrics into the respective store.
 */
module.exports = class PerformanceTestMetricsProcessor {
  constructor () {
    this.queue = new Queue();
    this.getMetrics = this.getMetrics.bind(this);

    // Contains the metrics stores by execution ID.
    this.stores = {};

    if (PerformanceTestMetricsProcessor.instance) {
      return PerformanceTestMetricsProcessor.instance;
    }

    PerformanceTestMetricsProcessor.instance = this;

    // Map of execution ID to set of running sequence IDs.
    this.runningVUCount = new Map();
  }

  async processSetVUCount ({ executionContext, currentVuCount }) {
    const { executionContextId } = executionContext;

    // Set the running VU count for a performance run
    this.runningVUCount.set(executionContextId, currentVuCount);
  }

  async processRunData (runData) {
    const { event, data, executionContext, timestamp } = runData;

    const { executionContextId, workloadSequenceIndex: vuId } = executionContext;

    /**
     * Get Metric name from response and error
     * @param {*} response - The response object with response.code and response.status
     * @param {*} err - The error object with err.code
     * @returns
     */
    function getErrorMetricName (response, err) {
      if (response && response.code) {
        const status = _.startCase(_.lowerCase(response.status));

        return [response.code, status].join(' ').trim(' ');
      }
      else if (err && err.code) {
        return err.code;
      }
      else if (err && err.message) {
        return err.message;
      }
      else return 'Unknown';
    }

    if (event === 'response') {
      // Data has additional info now about the request and response body
      // Data.response.stream.toString() will give the response body
      // Data.request.body will give the request body
      // Data.request.headers will give the request headers
      // Data.response.headers will give the response headers
      const { code, responseTime } = data.response ?? {};

      // If metric store does not exist for this execution, create one.
      if (!this.stores[executionContextId]) {
        this.stores[executionContextId] = new RunnerMetricStore(executionContextId);
      }

      this.stores[executionContextId].emit({
        metricName: 'virtualUsers',
        requestId: data.item.id,
        calculateVUMetrics: !!data.virtualUser.dataUsed,
        dataRowIndex: data.virtualUser.dataRowIndex,
        vuId,
        value: this.runningVUCount.get(executionContextId) || 0,
        timestamp
      });

      this.stores[executionContextId].emit({
        metricName: 'responseTime',
        requestId: data.item.id,
        calculateVUMetrics: !!data.virtualUser.dataUsed,
        dataRowIndex: data.virtualUser.dataRowIndex,
        vuId,
        value: responseTime || null,
        timestamp
      });

      if (code < 200 || code >= 300 || !responseTime) {
        const metricName = getErrorMetricName(data.response, data.err);
        const hash = this.stores[executionContextId].addResponse({ request: { id: data.item.id, ...data.request },
          errorMetricName: metricName, response: data.response, item: data.item, virtualUser: data.virtualUser });
        this.stores[executionContextId].emit({
          metricName,
          requestId: data.item.id,
          vuId,
          value: 1,
          timestamp,
          isError: true,
          response: {
            hash
          },
          virtualUser: data.virtualUser
        });
      }
    }
  }

  getMetrics (executionContextId) {
    return this.stores[executionContextId]?.getMetrics() ?? {};
  }

  getResponseDetails (executionContextId, requestId, errorMetricName, hash) {
    return this.stores[executionContextId].getResponseDetails(requestId, errorMetricName, hash);
  }

  updateWindowSize (executionContextId, windowSize) {
    this.stores[executionContextId]?.updateWindowSize(windowSize);
  }

  /**
   * @public
   * [Available on IPC]
   *
   * This function is used to get the metrics for a given execution ID.
   *
   * @param {String} executionId - The execution ID for which metrics are to be fetched.
   *
   * @returns {object} - The metrics for the given execution ID.
   */
  getRequestDetails (executionId) {
    const store = this.stores[executionId];

    if (!store) {
      throw new Error('No such execution found');
    }

    return store.requestDetails;
  }

  /**
   * Discard the reference to the in-memory performance run metric store so that it can be garbage collected.
   * This function should only be called after the run has been saved.
   *
   * TODO: maybe add a guardrail so we call this only for finished runs? [Discuss]
   *
   * @param {String} performanceRunId
   */
  clearRunResults (performanceRunId) {
    delete this.stores[performanceRunId];
  }
};
