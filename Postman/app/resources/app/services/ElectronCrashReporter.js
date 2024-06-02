var _ = require('lodash'),
  electron = require('electron'),
  crashReporter = electron.crashReporter,
  releaseChannel = _.lowerCase(require('./AppConfigService').getConfig('__WP_RELEASE_CHANNEL__'));

class ElectronCrashReporter {
  init () {
    let sentryURL;
    if (releaseChannel === 'prod') {
      sentryURL = 'https://o1224273.ingest.sentry.io/api/6543787/minidump/?sentry_key=4657359d34004de980b15867cd04eb7a';
    }
    else if (releaseChannel === 'canary') {
      sentryURL = 'https://o1224273.ingest.sentry.io/api/6702904/minidump/?sentry_key=e8a4f1f6a54b42cfaf566a35a388fad0';
    }
    else {
      sentryURL = 'https://o1224273.ingest.sentry.io/api/6567626/minidump/?sentry_key=474eeea76b4d438496a9c1f839dc1711';
    }

    // Initialize the crash reporter from electron to collect crash dumps for crashes happening in main & renderer process.
    // Crash dumps will be present inside user data directory.

    // This logic generates random number b/w 1-100. Since the volume of the crash reports uploaded to sentry is too high as of today
    // We are randomly opting in to upload these crash dumps to sentry.
    let randomNumber = Math.floor((Math.random() * 100) + 1);

    if (randomNumber >= 50) {
      crashReporter.start({
        uploadToServer: true,
        rateLimit: true,
        submitURL: sentryURL,
        compress: true
      });
    }
    else {
      crashReporter.start({
        uploadToServer: false
      });
    }
  }
}

exports.ElectronCrashReporter = new ElectronCrashReporter();
