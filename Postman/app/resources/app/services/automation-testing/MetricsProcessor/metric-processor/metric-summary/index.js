'use strict';
const MetricAggregator = require('./metric-aggregator');

/**
 * Calculates metrics for different metrics as well as their request id grouping.
 * This is oblivious to the time window grouping
 */
class MetricSummary {
	constructor () {
		this.metricsAggregator = {
      aggregatedMetrics: new MetricAggregator(),
      groupedByRequest: {},
      groupedByVu: {}
    };
	}

	_addRequestMetric ({ metricName, requestId, value, isError, responseHash, virtualUser }) {
		if (!this.metricsAggregator.groupedByRequest[requestId]) {
			this.metricsAggregator.groupedByRequest[requestId] = new MetricAggregator();
		}

		this.metricsAggregator.groupedByRequest[requestId].add({ metricName, value, isError, responseHash, virtualUser });
	}

  _addVuMetric ({ metricName, vuId, value, isError, responseHash, virtualUser, dataRowIndex }) {
		if (!this.metricsAggregator.groupedByVu[vuId]) {
			this.metricsAggregator.groupedByVu[vuId] = new MetricAggregator(true);
		}

		this.metricsAggregator.groupedByVu[vuId].add({ metricName, value, isError, responseHash, virtualUser, dataRowIndex });
	}

  /**
   * Adds the metric data point. Will impact the metrics
   * @param {Object} params
   * @param {String} params.metricName - Name of the metric for which data point is being added
   * @param {String} params.requestId - Request id for which the metric is emitted.
   * @param {String} params.vuId - vu id for which the metric is emitted.
   * @param {Number} params.value - Value of the metric for which data point is being added
   */
  add ({ metricName, requestId, vuId, calculateVUMetrics, dataRowIndex, value, isError, responseHash, virtualUser }) {
    this.metricsAggregator.aggregatedMetrics.add({ metricName, value, isError, responseHash, virtualUser });
    requestId && this._addRequestMetric({ metricName, requestId, value, isError, responseHash, virtualUser });

    vuId && calculateVUMetrics && this._addVuMetric({ metricName, vuId, value, isError, responseHash, virtualUser, dataRowIndex });
  }

  /**
   * returns the metrics for the data-points that were added, with aggregates as well as grouped by request id
   * @returns {Object}
   */
	getMetrics () {
    const summary = {
      aggregatedMetrics: this.metricsAggregator.aggregatedMetrics.getMetrics(),
      groupedByRequest: {},
      groupedByVu: {}
    };

    Object.keys(this.metricsAggregator.groupedByRequest).forEach((key) => {
      summary.groupedByRequest[key] = { aggregatedMetrics: this.metricsAggregator.groupedByRequest[key].getMetrics() };
    });

    Object.keys(this.metricsAggregator.groupedByVu).forEach((key) => {
      summary.groupedByVu[key] = { aggregatedMetrics: this.metricsAggregator.groupedByVu[key].getMetrics() };
    });

    return summary;
	}
}

module.exports = MetricSummary;
