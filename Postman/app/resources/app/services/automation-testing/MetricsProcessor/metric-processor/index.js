'use strict';
const MetricSummary = require('./metric-summary');
const MS_IN_SECONDS = 1000;

/**
 * Calculates metrics for different metrics as well as their time window specific metrics.
 */
class MetricProcessor {
  constructor (windowSize) {
    this.windowSize = windowSize;
    this.values = [];

    this.metricSummary = {
      summary: new MetricSummary(),
      timeSeries: {}
    };
  }


  /**
   * Adds the metric data point. Will impact the metrics
   * @param {Object} params
   * @param {String} params.metricName - Name of the metric for which data point is being added
   * @param {Number} param.timestamp - Epoch time in milliseconds when the metric needs to be added
   * @param {String} params.requestId - Request id for which the metric is emitted.
   * @param {Number} params.value - Value of the metric for which data point is being added
   * @param {isError} params.isError - is the metric an error metric;
   */
  add ({ metricName, timestamp, value, requestId, vuId, calculateVUMetrics, dataRowIndex, isError, response, virtualUser }) {
    const valueObject = {
      metricName, timestamp, value, requestId, vuId, calculateVUMetrics, dataRowIndex, isError, responseHash: response?.hash, virtualUser };

    this._addValue(valueObject);
    this._addSummary(valueObject);
    this._addTimeSeries(valueObject);
  }

  _addValue ({ metricName, timestamp, value, requestId, vuId, calculateVUMetrics, isError, responseHash, virtualUser }) {
    const objectToPush = { metricName, timestamp, value, requestId, vuId, calculateVUMetrics, isError, responseHash, virtualUser };
    const metricValues = this.values;

    metricValues.push(objectToPush);
  }

  _addSummary ({ metricName, value, requestId, vuId, calculateVUMetrics, dataRowIndex, isError, responseHash, virtualUser }) {
    this.metricSummary.summary.add({ metricName, value, requestId, vuId, calculateVUMetrics, isError, responseHash, virtualUser, dataRowIndex });
  }

  _addTimeSeries ({ metricName, timestamp, value, requestId, isError }) {
    const window = (Math.floor(new Date(timestamp).getTime() / (this.windowSize * MS_IN_SECONDS))) * (this.windowSize * MS_IN_SECONDS);
    if (!this.metricSummary.timeSeries[window]) {
      this.metricSummary.timeSeries[window] = new MetricSummary();
    }
    this.metricSummary.timeSeries[window].add({ metricName, value, requestId, isError });
  }

  /**
   * returns the metrics for the data-points that were added, with  total summary as well as by time window
   * @returns {Object}
   */
  getMetrics () {
    const response = {
      summary: this.metricSummary.summary.getMetrics(),
      timeSeries: {}
    };

    Object.keys(this.metricSummary.timeSeries).forEach((key) => {
      response.timeSeries[key] = this.metricSummary.timeSeries[key].getMetrics();
    });

    return response;
  }

  updateWindowSize (windowSize) {
    if (this.windowSize !== windowSize) {
      this.windowSize = windowSize;

      // Clearing timeseries data
      this.metricSummary.timeSeries = {};

      // Adding timeseries data with new window
      this.values.forEach((valueObject) => { this._addTimeSeries(valueObject); });
    }
  }
}

module.exports = MetricProcessor;
