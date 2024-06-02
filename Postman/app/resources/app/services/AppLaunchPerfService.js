// @ts-check
const { PerformanceObserver } = require('perf_hooks');

const STATS = {
  /** @type {{[key: string]: import('perf_hooks').PerformanceEntry}} */
  MEASURES: {}
};

class AppLaunchPerfService {
  /** @type {PerformanceObserver} */
  _observer;

  init () {
    this._observer = new PerformanceObserver((perfEntryList) => {
      const measures = perfEntryList.getEntriesByType('measure');
      measures.forEach((measure) => {
        STATS.MEASURES[measure.name] = {
          name: measure.name,
          entryType: measure.entryType,
          startTime: measure.startTime,
          duration: measure.duration
        };
      });
    });
    this._observer.observe({ entryTypes: ['measure'], buffered: true });
  }

  destroy () {
    this._observer.disconnect();
  }

  /**
   * Get All Measures, to relay it to shell and later to Requester for analytics
   * @returns {import('perf_hooks').PerformanceEntry[]}
   */
  getAllMeasures () {
    return Object.keys(STATS.MEASURES).map((key) => STATS.MEASURES[key]);
  }
}

exports.AppLaunchPerfService = new AppLaunchPerfService();
