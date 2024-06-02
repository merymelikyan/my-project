const os = require('os'),
    { app } = require('electron'),
    _ = require('lodash'),
    { getConfig } = require('./AppConfigService'),
    sentry = require('@sentry/node'),
    newrelic = require('./NewRelic'),
    environment = getConfig('__WP_RELEASE_CHANNEL__'),
    isEnabled = getConfig('__WP_ENABLE_CRASH_REPORTING__'),
    appVersion = app.getVersion(),
    PROCESS_NAME = 'main',

    /**
     * @class CrashReporter
     * @description Crash reporter module for main process
     */
    CrashReporter = {
      sentry,
      newrelic,
      isEnabled,

      /**
       * @method init
       * @description It initiate the sentry if the crash reporting is enabled.
       */
      init (cb) {
        if (!isEnabled) {
          cb && cb();
          return;
        }

        const breadCrumbAllowCategories = ['navigation', 'error', 'exception'];
        const newRelicAccount = getConfig('__WP_NEWRELIC_ACCOUNT_ID__');
        const newRelicIngestKey = getConfig('__WP_NEWRELIC_INGEST_KEY__');

        newrelic.init(newRelicIngestKey, newRelicAccount);

        newrelic.setMetadata({
          appVersion,
          environment,

          electron: process.versions.electron,
          node: process.version,
          os: os.type(),
          processName: PROCESS_NAME,
          v8: process.versions.v8
        });

        const sentryDsn = getConfig('__WP_SENTRY_DSN__');
        sentry.init({
          dsn: sentryDsn,
          environment,
          maxBreadcrumbs: 3,

          beforeSend (event) {
            // Drop the exception if it is not a crash -- invoked via CrashHandler
            if (event.tags && !event.tags.fromCrashHandler) {
              return null;
            }

            return event;
          },


          beforeBreadcrumb (breadcrumb) {
            return breadCrumbAllowCategories.includes(breadcrumb.category) ? breadcrumb : null;
          }
        });

        sentry.configureScope((scope) => {
          scope.setTag('os', os.type());
          scope.setTag('processName', PROCESS_NAME);
          scope.setTag('node', process.version);
          scope.setTag('electron', process.versions.electron);
          scope.setExtra('versions', process.versions);
          cb && cb();
        });
      },

      /**
       * @method setUserScope
       * @description This will be called to set the user scope anytime in sentry
       * @param {Object} data
       * @param {Function} cb
       */
      setUserScope (data, cb) {
        if (!isEnabled) {
          cb && cb();
          return;
        }

        newrelic.setMetadata(data);

        sentry.configureScope((scope) => {
          scope.setUser(data);
          cb && cb();
        });
      },

      /**
       * @method setExtraScope
       * @description This will be called to set the extra data anytime in sentry
       * @param {Object} data
       * @param {Function} cb
       */
      setExtraScope (data, cb) {
        if (!isEnabled) {
          cb && cb();
          return;
        }

        newrelic.setMetadata(data);

        sentry.configureScope((scope) => {
          _.forEach(_.keys(data), (k) => { scope.setExtra(k, data[k]); });
          cb && cb();
        });
      },

      /**
       * @method getRawCrashReporterOptions
       * @description provides the crash reporter raw options.
       * @returns {String}
       */
      getRawCrashReporterOptions () {
        const sentryDsn = getConfig('__WP_SENTRY_DSN__');
        return JSON.stringify({
          sentryDsn,
          isEnabled,
          environment,
          appVersion
        });
      }
    };

module.exports = CrashReporter;
