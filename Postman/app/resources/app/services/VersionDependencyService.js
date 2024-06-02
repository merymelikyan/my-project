const ipcMain = pm.sdk.IPC,
  { getEventName, getEventNamespace } = require('../common/model-event');


/**
 * VersionDependencyService takes care of ensuring that the correct web app version
 * is shown in the Postman App windows at all times
 */
class VersionDependencyService {
  /**
   * Initialize the VersionDependencyService. This initializes the
   * webAppVersion and sets up listeners to handle updation of the
   * webAppVersion
   */
  initialize () {
    try {
      // The web app version that needs to be shown in the app window. If this
      // is present, this is given priority over the latest version
      this.webAppVersion = '';

      this.eventBus = pm.eventBus.channel('version-dependency');
      this.disposers = [];

      this.setupListeners();

      pm.logger.info('VersionDependencyService: Initialized successfully');
    }
    catch (e) {
      pm.logger.error('VersionDependencyService: Initialization failed ', e);
    }
  }

  /**
   * Set up listeners to update the web version
   */
  setupUpdateWebVersionListener () {
    let unsubscribe = ipcMain.subscribe('updateWebAppVersion', (event, version) => {
      if (!version) {
        return;
      }

      this.updateVersion(version);
    });

    this.disposers.push(unsubscribe);
  }

  /**
   * Set up listeners to manage the cached web version
   */
  setupListeners () {
    ipcMain.subscribe('getWebAppVersion', (event) => {
      event && event.reply('webAppVersion', this.webAppVersion);
    });

    ipcMain.subscribe('resetWebAppVersion', () => {
      this.resetVersion();
    });

    // Setting up listener to listen for add, switch, & logout user account events. We need to reset the
    // UI version when these events occur to load the latest version
    pm.eventBus.channel('model-events').subscribe((event) => {
      let eventName = getEventName(event),
          eventNamespace = getEventNamespace(event);

      if ((eventNamespace === 'users' && (eventName === 'add' || eventName === 'switch' || eventName === 'addAndSwitch')) ||
            (eventNamespace === 'user' && eventName === 'logout')) {
        pm.logger.info('VersionDependencyService: Resetting UI version as user logged out/switched account');
        this.resetVersion();
      }
    });

    this.setupUpdateWebVersionListener();
  }

  /**
   * Dispose the event listeners
   */
  disposeListeners () {
    this.disposers.forEach((disposer) => {
      disposer && disposer();
    });
  }

  /**
   * Update the current web version that needs to be opened in the app windows
   *
   * @param {String} version
   */
  updateVersion (version) {
    if (!version) {
      return;
    }

    // Update the version
    this.webAppVersion = version;

    // As soon as we have updated the web app version, we only need to use that until
    // the app is restarted. So, we dispose the listeners so that no further updates are
    // possible
    this.disposeListeners();
  }

  /**
   * Reset web app version cache and its associated update listener
   */
  resetVersion () {
    this.webAppVersion = '';

    // `Update web version listener` is disposed off when the version is updated at least once.
    // So we need to set the listener up again to allow updating web version after it is cleared.
    this.setupUpdateWebVersionListener();
  }
}

module.exports = new VersionDependencyService();
