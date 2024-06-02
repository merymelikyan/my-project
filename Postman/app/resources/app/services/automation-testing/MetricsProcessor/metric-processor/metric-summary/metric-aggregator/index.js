const MetricCalculator = require('./metric-calculator');
const _ = require('lodash');
const defaultFloatPrecision = 2;

/**
 * Aggregates metrics for different metric types such as response time and virtual users.
 * This is oblivious to the requestId grouping or the time window grouping
 */
class MetricAggregator {
  constructor (withDataRowIndexes = false) {
    this.metricCalculator = {
      responseTime: new MetricCalculator(true, 0),
      virtualUsers: new MetricCalculator(false),
      errorMetrics: {

      }
    };

    this.withDataRowIndexes = withDataRowIndexes;

    if (this.withDataRowIndexes) {
      this.metricCalculator.dataRowIndexes = [];
    }
  }

  /**
   * Adds the metric data point. Will impact the metrics
   * @param {Object} params
   * @param {String} params.metricName - Name of the metric for which data point is being added
   * @param {Number} params.value - Positive Number value of the metric for which data point is being added
   */
  add ({ metricName, value, isError, responseHash, dataRowIndex }) {
    let metricCalculator = this.metricCalculator[metricName];

    if (isError) {
      if (!this.metricCalculator.errorMetrics[metricName]) {
        this.metricCalculator.errorMetrics[metricName] = {}; // new MetricCalculator(false);
      }
      if (!this.metricCalculator.errorMetrics[metricName][responseHash]) {
        this.metricCalculator.errorMetrics[metricName][responseHash] = new MetricCalculator(false);
      }
       metricCalculator = this.metricCalculator.errorMetrics[metricName][responseHash];
    }

    if (this.withDataRowIndexes && dataRowIndex) {
      this.metricCalculator.dataRowIndexes.push(dataRowIndex);
    }

    metricCalculator.add(value);
  }

  /**
   * returns the metrics for the data-points that were added
   *
   * @returns {Object} metrics in the format {
   *     errors: {
   *       percentage: 50,
   *     },
   *     requestThroughput: {
   *       sum: 100,
   *     },
   *     responseTime: {
   *       avg: 24.5,
   *       count: 50,
   *       max: 49,
   *       min: 0,
   *       nullCount: 50,
   *       percentile90: 44,
   *       percentile95: 47,
   *       percentile99: 49,
   *     },
   *     virtualUsers: {
   *       avg: 74.5,
   *       count: 50,
   *       max: 99,
   *       min: 50,
   *       nullCount: 0,
   *     }
   *   }
   */
  getMetrics () {
    const responseTimeMetrics = this.metricCalculator.responseTime.getMetrics();
    const virtualUserMetrics = this.metricCalculator.virtualUsers.getMetrics();

    const response = {
      responseTime: responseTimeMetrics,
      virtualUsers: virtualUserMetrics,
      errors: {
        segmentation: {
          errorTypes: {}
        }
      },
      requestThroughput: {
        // TODO request throughput logic needs to change to account for type of error
        // this represents the total number of requests being sent
        sum: (responseTimeMetrics.count + responseTimeMetrics.nullCount)
      },
    };

    let totalErrorCount = 0;

    for (const [errorType, metricCalculatorByResponseHash] of Object.entries(this.metricCalculator.errorMetrics)) {
      let count = 0;

      if (!response.errors.segmentation.errorTypes[errorType]) {
        response.errors.segmentation.errorTypes[errorType] = {
          segmentation: {
            responseHash: {}
          }
        };
      }

      for (const [responseHash, metricCalculator] of Object.entries(metricCalculatorByResponseHash)) {
        const metrics = metricCalculator.getMetrics();
        response.errors.segmentation.errorTypes[errorType].segmentation.responseHash[responseHash] = {
          count: metrics.count
        };

        count += metrics.count;
      }

      totalErrorCount += count;

      response.errors.segmentation.errorTypes[errorType].count = count;
    }

    if (responseTimeMetrics.count || responseTimeMetrics.nullCount) {
      const errorPercentage = totalErrorCount * 100 / (responseTimeMetrics.count + responseTimeMetrics.nullCount);
        response.errors.percentage = _.round(errorPercentage, defaultFloatPrecision);
    }

    if (this.withDataRowIndexes) {
      response.dataRowIndexes = this.metricCalculator.dataRowIndexes;
    }

    return response;
  }
}

module.exports = MetricAggregator;
