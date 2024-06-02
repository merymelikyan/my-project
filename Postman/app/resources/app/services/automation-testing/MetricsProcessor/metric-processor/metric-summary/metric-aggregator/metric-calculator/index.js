const MedianCalculator = require('./medianCalculator');
const _ = require('lodash');
const defaultFloatPrecision = 2;

/**
 * returns metric calculations for a particular metric and time period.
 * This is oblivious to the requestId grouping or the time window grouping as well as te
 */
class MetricCalculator {
  /**
   * Constructor for metricCalculator
   * @param {boolean} isPercentileNeeded - This defines if we need percentiles for the metric
   * @param {Number} precision - This defines if we need specific precision for the metric
   */
  constructor (isPercentileNeeded = true, precision = defaultFloatPrecision) {
    this.sum = 0;
    this.count = 0;
    this.nullCount = 0;
    this.min = undefined;
    this.max = undefined;
    this.precision = precision;
    if (isPercentileNeeded) {
      this.medianCalculator = new MedianCalculator();
    }
  }

  /**
   * Adds the metric data point. Will impact the metrics
   * @param {Number} value - Positive Number value of the metric data point to be added
   */
  add (value) {
    if (value === null) {
      this.nullCount++;
    }
    else {
      this.sum += value;
      this.count++;
      this.min = this.min !== undefined ? Math.min(this.min, value) : value;
      this.max = this.max !== undefined ? Math.max(this.max, value) : value;
      this.medianCalculator && this.medianCalculator.add(value);
    }
  }

  /**
   * returns the metrics for the data-points that were added
   * @returns {Object} - metrics in the format {
   *                     'avg': 49.5,
   *                     'count': 100,
   *                     'max': 99,
   *                     'min': 0,
   *                     'nullCount': 0,
   *                     'percentile90': 89,
   *                     'percentile95': 94,
   *                     'percentile99': 98,
   *                   }
   */
  getMetrics () {
    const percentiles = this.medianCalculator ? this.medianCalculator.getPercentile() : {};

    return {
      ...this.min !== undefined && { min: this.min },
      ...this.max !== undefined && { max: this.max },
      ...this.count && { avg: _.round((this.sum / this.count), this.precision) },
      count: this.count,
      nullCount: this.nullCount,
      ...percentiles
    };
  }
}

module.exports = MetricCalculator;
