// node.js dependencies
const url = require('url');
const os = require('os');
const path = require('path');
const { performance } = require('perf_hooks');

// third-party dependencies
const electron = require('electron');
const Storage = require('electron-json-storage');
const _ = require('lodash').noConflict();
const uuidV4 = require('uuid/v4');

// internal dependencies
const menuManager = require('./menuManager').menuManager;
const WindowController = require('../common/controllers/WindowController');
const enterpriseUtils = require('./enterpriseUtil');
const { PERF_MEASURES, PERF_MARKS } = require('../constants/PerformanceAnalyticsConstants');
const {
  DEFAULT_REQUESTER_BOUNDS,
  DEFAULT_CONSOLE_BOUNDS,
  MIN_ALLOWED_WINDOW_HEIGHT,
  MIN_ALLOWED_WINDOW_WIDTH,
  MIN_ALLOWED_REQUESTER_WIDTH,
  MAC_TRAFFIC_LIGHTS_POSITIONS_DEFAULT
} = require('../constants/WindowConstants');
const { getValue } = require('../utils/processArg');
const { AppLaunchPerfService } = require('./AppLaunchPerfService');
const devUrls = require('../common/constants/dev-urls.js');
const { createEvent } = require('../common/model-event');
const getQPString = require('../utils/getQPString');
const getAppUrl = require('../services/AppUrlService');
const { getConfig } = require('./AppConfigService');
const partitionService = require('./partitionService');
const partitionUtils = require('./partitionUtils');
const { handlePartitioning, getActiveUser } = require('./userPartitionManager');
const userPartitionService = require('./userPartitionService');
const scratchPadPartitionService = require('./scratchPadPartitionService');
const {
  clearStatesPerWindow,
  store,
  STORE_KEYS
} = require('../constants/store');
const i18nService = require('./i18n/i18nService');

// constants
const { app, shell, webContents, session, nativeImage, nativeTheme } = electron;
const BrowserWindow = electron.BrowserWindow;
const SHELL_PARTITION_NAME = 'persist:postman_shell';
const MAX_WINDOW_RESTORE_COUNT = 4;
const ALL_DEV_TOOLS = ['requester', 'console'];
const devtools = getValue('dev-tools') === true ? ALL_DEV_TOOLS : getValue('dev-tools').split(',');
const RELEASE_CHANNEL = getConfig('__WP_RELEASE_CHANNEL__');
const BUILD_SCRATCHPAD = getConfig('__WP_BUILD_SCRATCHPAD__');
const BASE_URL = getConfig('__WP_DESKTOP_UI_UPDATE_URL__');
const {
  HTML_MAP,
  IPC_EVENT_NAMES,
  AUTH_ACTIONS,
  WINDOW_EVENTS_MAP,
  EVENT_BUS_EV_NAMES
} = require('../constants');
const regionService = require('./region.service.js');

// See this discussion on the invisible frame around Windows 10/11 windows.
// NOTE: This value is not affected by display scaling in testing.
// NOTE: When a window is maximized, it has x,y of -8,-8 (we don't care about position when maximized in this code)
// https://stackoverflow.com/questions/34139450/getwindowrect-returns-a-size-including-invisible-borders
const WIN_10_11_FRAME_WIDTH = 7;

const TOGGLE_WINDOW_MAXIMIZE_EVENT = 'toggle-maximize',
  OPEN_WINDOWS_APPLICATION_CONTEXT_MENU = 'open-windows-app-menu';

const IDENTITY_URL = getConfig('__WP_IDENTITY_URL__');
const POSTMAN_APP_URL = getConfig('__WP_DESKTOP_UI_UPDATE_URL__');
const APP_BASE_PATH = url.format({ protocol: 'file', pathname: `${app.getAppPath()}/html` });
const FILE_PROTOCOL = 'file:';

let isWindows10or11 = false;
if (process.platform === 'win32') {
  const osReleaseMatch = (/(\d{2})\..*/).exec(os.release());

  if (osReleaseMatch) {
    isWindows10or11 = parseInt(osReleaseMatch[1], 10) >= 10;
  }
}

/**
 * Checks if the OS is Mac
 * @returns {Boolean}
 */
function isDarwin () {
  return process.platform === 'darwin';
}

/**
 * Checks if the OS is Mac
 * @returns {Boolean}
 */
function isWindows () {
  return process.platform === 'win32';
}

/**
 * Only restore a window if is minimized, otherwise restore() will unmaximize
 * a maximized window, which is not the intended behavior.
 */
function unminimize (window) {
  if (window.isMinimized()) {
    window.restore();
  }
}

/**
 * Get bounds for a BrowserWindow and on Windows 10/11 adjust them to offset
 * the invisible frame it puts around windows.
 *
 * Refs https://github.com/electron/electron/issues/4045
 */
function getBounds (window) {
  const bounds = window.getBounds();

  // Adjust bounds to remove the invisible frame on Windows 10/11
  if (isWindows10or11) {
    bounds.x += WIN_10_11_FRAME_WIDTH;
    bounds.width -= WIN_10_11_FRAME_WIDTH * 2;
    bounds.height -= WIN_10_11_FRAME_WIDTH;
  }

  return bounds;
}

/**
 * On Windows 10/11 adjust them to include the invisible frame it puts around
 * windows, on other platforms this is a no-op.
 *
 * Refs https://github.com/electron/electron/issues/4045
 */
function adjustBounds (bounds) {
  const adjustedBounds = { ...bounds };

  // Adjust bounds to add the invisible frame on Windows 10/11
  if (isWindows10or11) {
    if (bounds.x !== undefined) {
      adjustedBounds.x = bounds.x - WIN_10_11_FRAME_WIDTH;
    }

    adjustedBounds.width = bounds.width + WIN_10_11_FRAME_WIDTH * 2;
    adjustedBounds.height = bounds.height + WIN_10_11_FRAME_WIDTH;
  }

  return adjustedBounds;
}

// #endregion

// #region Handlers
/**
 * Handler for Dom Ready, once Window -> WebContents is ready.
 *
 * @type {(param0: {
 *  window: any;
 *  launchParams: import('./windowManager').BrowserWindowLaunchParams;
 * }) => void}
 */
const handleDomReady = ({
  window,
  launchParams = {}
}) => {
  if (launchParams.devtools) {
    // Open devtools on launch.
    windowManager.openDevTools(window);
  }
};

/**
 * Handler for webContent Crashes
 *
 * @param {import('./windowManager').BrowserWindowLaunchParams} launchParams
 */
const handleCrash = (launchParams) => (event) => {
  pm.logger.error(`Render process for ${launchParams.type} webview crashed`, event);
};

// #endregion

const windowManager = {

  // #region Member Properties
  primaryId: '1',
  openWindowIds: [],
  initUrl: null,
  eventBus: null,
  windowState: {},
  isWindowVisibleByDefault: true,
  isFirstRequesterBooted: false,
  hasWebPlatformNavigatedToMonolith: false,

  // #endregion

  initialize () {
    if (process.env.PM_BUILD_ENV !== 'development') {
      const htmlFolderPath = path.resolve(__dirname, '..', 'html'),
        webProxyPath = path.resolve(htmlFolderPath, 'webProxy.html');

      // url.format helps in encoding any not allowed special characters in the path
      // The fix has been added where it was not possible to load the url for case below,
      // if user name contains #, creates # in the path, which is delimiter breaking the url.
      this.webProxyPath = url.format({ protocol: 'file', pathname: webProxyPath });
    }
    else {
      this.webProxyPath = devUrls.WEB_PROXY;
    }

    this.closedHandler = this.closedHandler.bind(this);
    this.enterFullScreenHandler = this.enterFullScreenHandler.bind(this);
    this.leaveFullScreenHandler = this.leaveFullScreenHandler.bind(this);
    this.maximizeHandler = this.maximizeHandler.bind(this);
    this.unmaximizeHandler = this.unmaximizeHandler.bind(this);
    this.debouncedResizeHandler = _.debounce(this.resizeHandler.bind(this), 100);
    this.debouncedStateChangeHandler = _.debounce(this.stateChangeHandler.bind(this), 100);
    this.windowBoundsHandler = this.windowBoundsHandler.bind(this);
    this.focusHandler = this.focusHandler.bind(this);
    this.blurHandler = this.blurHandler.bind(this);
    this.channel = this.eventBus.channel('requester-window-events');


    this.eventBus.channel('app-events').subscribe((event = {}) => {
      if (_.get(event, 'name') === 'booted') {
        let process = event.namespace,
          err = event.data,
          meta = event.meta;

        if (process === 'requester' && meta && meta.isFirstRequester) {
          if (err) {
            return;
          }

          // open requester only if the window is not available, otherwise it will open on all hot-reload of first requester process
          if (!this.isFirstRequesterBooted) {
            pm.logger.info('windowManager: First requester booted successfully.');

            // Set first requester booted
            this.setFirstRequesterBooted();

            // we don't want to restore any windows, if the app is offline or is the no-scratchpad window
            if (meta && (meta.isOfflineView || meta.isNoScratchPadView)) {
              return;
            }

            // Restore the rest of the requester windows
            return this.restoreWindows({
              windowIdsToSkip: [meta.windowId]
            });
          }
        }
      }
    });

    /**
     * Subscribe to requester window events to listen to maximize/minimize toggle
     */
    this.channel.subscribe((windowEvent) => {
      if (!windowEvent || (!windowEvent.windowId && windowEvent.windowId !== 0) ||
        [OPEN_WINDOWS_APPLICATION_CONTEXT_MENU, TOGGLE_WINDOW_MAXIMIZE_EVENT].indexOf(windowEvent.type) === -1) {
        return;
      }

      // Get the window instance
      const focusedWindow = BrowserWindow.fromId(windowEvent.windowId);

      // If window instance is not found then bail out
      if (!focusedWindow) {
        return;
      }

      switch (windowEvent.type) {
        case TOGGLE_WINDOW_MAXIMIZE_EVENT:
          // If the window is full screen then bail out
          if (focusedWindow.isFullScreen()) {
            return;
          }

          if (focusedWindow.isMaximized()) {
            focusedWindow.unmaximize();
          } else {
            focusedWindow.maximize();
          }
          break;
        case OPEN_WINDOWS_APPLICATION_CONTEXT_MENU:
          if (!menuManager || !menuManager.windowsApplicationContextMenu) {
            return;
          }

          menuManager.windowsApplicationContextMenu.popup && menuManager.windowsApplicationContextMenu.popup(focusedWindow);
          break;
      }
    });

    attachRendererIPCHandlers();
  },

  hideAllWindows () {
    for (let i = 0; i < this.openWindowIds.length; i++) {
      let openWindow = BrowserWindow.fromId(parseInt(this.openWindowIds[i]));
      openWindow && openWindow.hide();
    }
  },

  /**
   * Sets default visibility state of window.
   * This effect Requester and Console Windows.
   * @param {Boolean} visible whether to show windows by default.
   */
  setWindowsDefaultVisibilityState (visible) {
    this.isWindowVisibleByDefault = visible;
  },

  isPureWebPlatformMode () {
    // For use when serving from web platform and need to allow operations specific to the requester
    // that are limited by isFirstRequesterBooted like closing, new requester window and new console window
    const isRunningWebPlatform = getConfig('__WP_MODULE_FEDERATION__');

    // The moment the user switches to a monolith route in any window, the control flow goes back to the default state.
    const hasWPNavigatedToMonolithYet = this.hasWebPlatformNavigatedToMonolith;
    return isRunningWebPlatform && !hasWPNavigatedToMonolithYet;
  },

  /**
    * Show all windows.
  */
  showAllWindows () {
    return WindowController
      .getAll({})
      .then((allWindows) => {
        // We get all windows from db and choose the one which are currently opened(they are hidden)
        // We apply the full screen transformation to opened windows
        allWindows.filter((window) => {
          return this.openWindowIds.includes(window.browserWindowId);
        }).forEach((window) => {
          let browserWindow = BrowserWindow.fromId(parseInt(window.browserWindowId));

          if (!browserWindow) {
            return;
          }

          this.setWindowMode({
            isFullScreen: window.visibility && window.visibility.isFullScreen,
            maximized: window.visibility && window.visibility.maximized
          }, browserWindow);

          browserWindow.show();
        });
      })
      .catch((e) => {
        pm.logger.error('WindowManager - Error in showing windows from db', e);

        // show windows even if there was an error,
        // skip setting window mode for now
        for (let i = 0; i < this.openWindowIds.length; i++) {
          let openWindow = BrowserWindow.fromId(parseInt(this.openWindowIds[i]));
          openWindow && openWindow.show();
        }
      });
  },


  sendCustomInternalEvent (action, object) {
    var message = {
      name: 'internalEvent',
      data: {
        event: action,
        object: object
      }
    };
    var bWindow = BrowserWindow.getFocusedWindow();
    if (!bWindow) {
      return;
    }
    bWindow.webContents.send('electronWindowMessage', message);
  },

  sendToFirstWindow (message) {
    var numWindowsLeft = this.openWindowIds.length;
    for (var i = 0; i < numWindowsLeft; i++) {
      var bWindow = BrowserWindow.fromId(parseInt(this.openWindowIds[i]));
      if (!bWindow) {
        continue;
      }
      bWindow.webContents.send('electronWindowMessage', message);
      return;
    }
  },

  sendToAllWindows (message) {
    // send event to all other windows
    var numWindowsLeft = 0;
    let openWindowIds = _.compact(this.openWindowIds);
    if (openWindowIds && openWindowIds.length) {
      numWindowsLeft = openWindowIds.length;
    }

    for (var i = 0; i < numWindowsLeft; i++) {
      var bWindow = BrowserWindow.fromId(parseInt(openWindowIds[i]));
      if (!bWindow) {
        continue;
      }
      bWindow.webContents.send('electronWindowMessage', message);
    }
  },

  sendInternalMessage (message) {
    this.sendToAllWindows({
      name: 'internalEvent',
      data: message
    });
  },

  hasExtension (extensionName) {
    return session.defaultSession.getAllExtensions().hasOwnProperty(extensionName);
  },

  getDefaultWindowState (windowName) {
    if (windowName === 'console') {
      return {
        center: true,
        height: 450,
        width: 950
      };
    }
    else {
      return {
        center: true,
        height: 800,
        width: 1280
      };
    }
  },


  newRequesterOpened () {
    if (this.listenForRequesterWindow && this.initUrl && this.initWindowId) {

      let channel = this.eventBus.channel('protocol-handler');
      channel.publish({
        url: this.initUrl,
        windowId: this.initWindowId
      });

      this.initUrl = this.initWindowId = this.listenForRequesterWindow = null;
    }

    this.channel.publish({
      type: 'window-opened'
    });
  },

  quitApp () {
    app.quit();
  },

  /**
   * @typedef {{
   *  title: string;
   *  backgroundColor: string;
   *  icon?: string;
   *  webPreferences: {
   *    webSecurity?: boolean;
   *    backgroundThrottling?: boolean;
   *    partition: string;
   *    nodeIntegration?: boolean;
   *    webviewTag?: boolean;
   *    contextIsolation?: boolean;
   *    preload?: string;
   *  };
   * }} BrowserWindowOptions
   *
   * @param {string} title
   * @returns {BrowserWindowOptions}
   */
  getWindowPref (title, partition) {
    if (enterpriseUtils.isEnterpriseApplication()) {
      title = _.startCase(title);
    }

    const themeToPaint = nativeTheme && nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
    const backgroundColor = themeToPaint === 'dark' ? '#212121' : '#FFFFFF';

    return {
      title: title,
      backgroundColor: backgroundColor,
      webPreferences: {
        webSecurity: false,
        backgroundThrottling: false,
        partition: partitionUtils.getPersistedPartitionString(partition),
        nodeIntegration: true,
        webviewTag: true,
        contextIsolation: false,
        preload: path.resolve(app.getAppPath(), 'preload/desktop/index.js')
      },
      icon: nativeImage.createFromPath(path.resolve(app.getAppPath(), 'assets/icon.png'))
    };
  },

  setWindowMode (windowState, activeWindow) {
    if (windowState.isFullScreen) { activeWindow.setFullScreen(true); }
    else if (windowState.maximized) {
      activeWindow.maximize();
    }
  },

  sanitizeCoordinates (bounds) {
    if (!_.isInteger(bounds.x) || !_.isInteger(bounds.y)) {
      return { x: null, y: null };
    }

    let screen = electron.screen,
      nearestDisplay = screen.getDisplayNearestPoint({ x: bounds.x + 16, y: bounds.y + 16 });

    // TODO - Adjust this logic to allow negative x,y coordinates as long as enough
    // of the window is visible, to prevent an x value of -1 from causing the window
    // to go back to 0, 0 unexpectedly. This logic also allows a window that only has
    // a 1 pixel edge visible on the display to be considered 'visible', which is
    // likely to cause user complaints because they can't actually see the window.
    // Look at how Chromium acts and try to emulate that, or even find the logic
    // in the codebase and use that as a basis for this behavior.
    let isWindowVisible = (
      (bounds.x >= nearestDisplay.bounds.x && bounds.x < nearestDisplay.bounds.x + nearestDisplay.bounds.width) &&
      (bounds.y >= nearestDisplay.bounds.y && bounds.y < nearestDisplay.bounds.y + nearestDisplay.bounds.height)
    );

    if (!isWindowVisible) {
      return {
        // TODO - This should really center the window, with default size, rather than going to the top-left corner.
        // APPSDK-34 - return nearest display x,y instead of null, so that in multi monitor it returns the x,y of the
        // nearest display rather than null which results in the app opening in the default monitor ignoring where it
        // was last closed.
        x: nearestDisplay.bounds.x,
        y: nearestDisplay.bounds.y
      };
    }

    return bounds;
  },

  getOpenWindows (type) {
    return WindowController
      .getAll({ type })
      .then((allTypeWindows) => {
        let allTypeWindowIds = _.map(allTypeWindows, (window) => window.browserWindowId),
          openWindowIds = this.openWindowIds,
          allOpenTypeWindows = _.intersection(openWindowIds, allTypeWindowIds);
        return allOpenTypeWindows;
      });
  },

  createOrRestoreRequesterWindow () {
    return this
      .getOpenWindows('requester')
      .then((allOpenRequesterWindows) => {
        if (_.isEmpty(allOpenRequesterWindows)) {
          // If no requester windows are open, there will be only one requester window in the Window table
          // Restore that.
          return WindowController
            .getAll({ type: 'requester' })
            .then((allRequesterWindows) => {
              if (_.size(allRequesterWindows) === 1) {
                return this.newRequesterWindow(allRequesterWindows[0]);
              }

              // Worst case. if there are more than one requester window in the DB, create a window normally
              return this.newRequesterWindow();
            });
        }
        else {
          // Create a new window normally
          return this.newRequesterWindow();
        }
      });
  },

  /**
   * This method helps to reload last active user session, for the provided BrowserWindow
   *
   * @param {BrowserWindow} browserWindow
   */
  async reloadBrowserWindow (browserWindow) {
    const partitionToLoad = await userPartitionService.getActivePartition(),
      isLoggedOut = _.isEmpty(await userPartitionService.getAllUsers()),
      rootPageType = isLoggedOut ? 'scratchpad' : 'requester';

    let defaultWindowOptions = this.getWindowPref(app.getName(), partitionToLoad);
    const launchParams = browserWindow.launchParams;

    const pageUrl = await getAbsolutePageURL(
      rootPageType, // This should change to scratchpad, when user is logged out
      launchParams,
      defaultWindowOptions.webPreferences
    );

    pm.logger.info(`Main~reloadBrowserWindow: Loading page: ${pageUrl}`);
    browserWindow.loadURL(pageUrl);
  },

  async newRequesterWindow (window = {}, params = {}) {
    const partitionToLoad = await handlePartitioning(params.authResponse);

    /**
     * `handlePartitioning` method is responsible to mutate the active partition and
     * set it with the latest logged in user's partition. This ensures calling
     * `getUserContextForActivePartition` method will always return the correct
     * active partition based on latest logged in user.
     */
    const userContext = await userPartitionService.getUserContextForActivePartition();
    pm.logger.info(`Main:windowManager~newRequesterWindow: Fetch and update runtime config: ${userContext?.region}`);
    await regionService.fetchRegionConfigAndOverride(userContext?.region);

    const isLoggedOut = _.isEmpty(await userPartitionService.getAllUsers()),
      rootPageType = isLoggedOut ? 'scratchpad' : 'requester';

    let startTime = Date.now(),
      windowName = 'requester',
      bounds = {
        x: _.get(window, 'position.x'),
        y: _.get(window, 'position.y'),
        width: _.get(window, 'size.width'),
        height: _.get(window, 'size.height')
      },
      sanitizedBounds = this.sanitizeBounds(bounds, windowName);

    // If we are trying to open a requester window (except first requester) before the first requester is booted, we bail
    if (!this.isPureWebPlatformMode() && !params.isFirstRequester && !this.isFirstRequesterBooted) {
      pm.logger.warn('WindowManager~newRequesterWindow - Bailing requester window creation as first requester is not booted.');
      return;
    }

    let defaultWindowOptions = this.getWindowPref(app.getName(), partitionToLoad);
    let browserWindowOptions = Object.assign(
      defaultWindowOptions,
      {
        ...adjustBounds({
          width: sanitizedBounds.width,
          height: sanitizedBounds.height,
          x: sanitizedBounds.x,
          y: sanitizedBounds.y
        }),
        center: !window.position,
        show: this.isWindowVisibleByDefault,
        minWidth: MIN_ALLOWED_REQUESTER_WIDTH,
        minHeight: MIN_ALLOWED_WINDOW_HEIGHT
      }
    );

    // For Mac OS, we hide the title bar and place the traffic light on header
    if (isDarwin()) {
      Object.assign(browserWindowOptions, {
        titleBarStyle: 'hidden',
        titleBarOverlay: true,
        trafficLightPosition: MAC_TRAFFIC_LIGHTS_POSITIONS_DEFAULT
      });
    }

    // For Windows OS, we make a frameless app and build custom window controls
    if (isWindows()) {
      Object.assign(browserWindowOptions, {
        frame: false
      });
    }

    let mainWindow = new BrowserWindow(browserWindowOptions);
    this.openWindowIds.push(mainWindow.id);
    const launchParams = await getWindowLaunchParams(rootPageType, {
      window: mainWindow,
      authResponse: params.authResponse,
      partitionId: await userPartitionService.getActivePartition(),
      isFirstRequester: params.isFirstRequester || false
    });

    // When user signs in, the locale is sent in the auth response
    // check if locale exists in auth response and change the locale accordingly
    const authResponseLocale = _.get(params, ['authResponse', 'authData', 'userData', 'locale']);
    authResponseLocale && i18nService.changeLocale(authResponseLocale);

    performance.mark(PERF_MARKS.MAIN_PROCESS_BROWSER_OPEN_COMPLETE);
    performance.measure(PERF_MEASURES.MAIN_PROCESS_BROWSER_OPEN_TIME, PERF_MARKS.MAIN_PROCESS_APP_READY);

    this.windowState[windowName] = window;

    require('@electron/remote/main').enable(mainWindow.webContents);

    mainWindow.webContents.on('did-attach-webview', (event, webviewWebContents) => {
      require('@electron/remote/main').enable(webviewWebContents);
    });

    mainWindow.once('ready-to-show', () => {

      // We do not want to apply fullScreen flag for windows created in hidden mode
      // since applying it will make these windows visible. Instead, We will apply this flag later
      // (after the auth window is closed) when we want to show these windows.
      this.isWindowVisibleByDefault && this.setWindowMode({
        isFullScreen: window.visibility && window.visibility.isFullScreen,
        maximized: window.visibility && window.visibility.maximized
      }, mainWindow);
    });

    if (this.openWindowIds.length === 1) {
      this.primaryId = mainWindow.id;
    } // this is the only window. make it primary

    let windowId = window.id || uuidV4();

    mainWindow.webContents.on('dom-ready', () => {
      // From electron v11, there are some rendering issues with the chromium side which is affecting webview, browserViews and browserWindows.
      // This issue is only seen when there is a hidden window launched and another window is opened on top of it. In our case shared window is the hidden window
      // Adding a workaround for the issue with electron v11 where the requester window appears blank while launching the app.
      // Taking the focus away from requester window fixes the problem. This workaround needs to be put in when the content is ready. Similar issue is reported here https://github.com/electron/electron/issues/27353
      if (this.isWindowVisibleByDefault && process.platform === 'win32') {
        mainWindow.showInactive();
        mainWindow.focus();
      }

      // broadcast an event to the handler on the main process
      // the main process defers some initialization steps till the first window can be launched
      // this event marks that the first window has been opened
      pm.eventBus.channel('main-internal-lifecycle').publish({
        name: EVENT_BUS_EV_NAMES.WINDOW_LOADED,
        namespace: 'main-internal-lifecycle'
      });

      mainWindow.webContents.setVisualZoomLevelLimits(1, 1);

      handleDomReady({
        window: mainWindow,
        launchParams
      });

      if (this.initUrl) {
        this.listenForRequesterWindow = true;
        this.initWindowId = windowId;
      }
    });

    let windowParams = [{
      type: 'requester',
      id: windowId,
      browserWindowId: mainWindow.id,
      activeSession: window.activeSession || '',
      position: { x: sanitizedBounds.x, y: sanitizedBounds.y },
      size: { width: sanitizedBounds.width, height: sanitizedBounds.height },
      visibility: window.visibility || { maximized: false, isFullScreen: false }
    }, {
      id: windowId,
      session: {
        id: window.activeSession,
        workspace: params.workspace
      },
      triggerSource: params && params.triggerSource,
      authResponse: params.authResponse
    }];

    mainWindow.windowName = windowName;
    mainWindow.type = 'requester';
    mainWindow.params = windowParams;
    mainWindow.launchParams = launchParams;

    attachWebcontentListeners({
      window: mainWindow,
      launchParams,
      webPreferences: defaultWindowOptions.webPreferences
    });

    Promise.resolve()
      .then(() => {
        if (window.id) {
          // Checking if the window to restore actually does exist in DB Or not before updating.
          // This makes sure that when the window starts booting, a record always exists in the DB
          return WindowController.get({ id: window.id });
        }
        return;
      })
      .then((dbWindow) => {
        if (dbWindow) {
          // Restoring
          return WindowController
            .update({
              id: window.id,
              browserWindowId: mainWindow.id,
              position: { x: sanitizedBounds.x, y: sanitizedBounds.y },
              size: { width: sanitizedBounds.width, height: sanitizedBounds.height }
            });
        }
        else {
          // Not restoring
          return WindowController
            .create.apply(WindowController, windowParams);
        }
      })
      .then(() => {
        return getAbsolutePageURL(
          rootPageType, // This should change to scratchpad, when user is logged out
          launchParams,
          defaultWindowOptions.webPreferences
        );
      })
      .then((pageURL) => {
        performance.measure(
          PERF_MEASURES.MAIN_PROCESS_SHELL_LAUNCH_TIME,
          PERF_MARKS.MAIN_PROCESS_BROWSER_OPEN_COMPLETE
        );
        mainWindow.loadURL(pageURL);
      })
      .catch((e) => {
        pm.logger.error('WindowManager~newRequesterWindow - Error in loading window from db', e);
      });

    this.addListeners(mainWindow);

    this.sendInternalMessage({
      event: 'pmWindowOpened',
      object: mainWindow.id
    });
    return mainWindow;
  },

  async newConsoleWindow (window = {}, params = {}) {
    const rootPageType = 'console';
    let startTime = Date.now(),
      windowName = 'console',
      bounds = {
        x: _.get(window, 'position.x'),
        y: _.get(window, 'position.y'),
        width: _.get(window, 'size.width'),
        height: _.get(window, 'size.height')
      },
      sanitizedBounds = this.sanitizeBounds(bounds, windowName);

    if (!this.isPureWebPlatformMode() && !this.isFirstRequesterBooted) {
      pm.logger.warn('WindowManager~newConsoleWindow - Bailing requester window creation as first requester is not booted!');
      return;
    }

    if (!this.consoleWindowId) {
      let defaultWindowOptions = this.getWindowPref('Postman Console', await userPartitionService.getActivePartition());
      let mainWindow = new BrowserWindow(Object.assign(
        defaultWindowOptions,
        {
          ...adjustBounds({
            width: sanitizedBounds.width,
            height: sanitizedBounds.height,
            x: sanitizedBounds.x,
            y: sanitizedBounds.y
          }),
          center: !window.position,
          show: this.isWindowVisibleByDefault,
          minWidth: MIN_ALLOWED_WINDOW_WIDTH,
          minHeight: MIN_ALLOWED_WINDOW_HEIGHT
        }
      ));
      this.consoleWindowId = mainWindow.id;
      this.openWindowIds.push(this.consoleWindowId);
      const launchParams = await getWindowLaunchParams(rootPageType, {
        window: mainWindow,
        authResponse: params.authResponse,
        isFirstRequester: false
      });

      this.windowState[windowName] = window;

      // We do not want to apply fullScreen flag for windows created in hidden mode
      // since applying it will make these windows visible. Instead, We will apply this flag later
      // (after the auth window is closed) when we want to show these windows.
      this.isWindowVisibleByDefault && this.setWindowMode({
        isFullScreen: window.visibility && window.visibility.isFullScreen,
        maximized: window.visibility && window.visibility.maximized
      }, mainWindow);

      require('@electron/remote/main').enable(mainWindow.webContents);

      mainWindow.webContents.on('dom-ready', () => {
        mainWindow.webContents.setVisualZoomLevelLimits(1, 1);
        handleDomReady({
          window: mainWindow,
          launchParams
        });
      });

      let windowId = window.id || uuidV4();
      let windowParams = [{
        type: 'console',
        id: windowId,
        browserWindowId: mainWindow.id,
        activeSession: window.activeSession || '',
        position: { x: sanitizedBounds.x, y: sanitizedBounds.y },
        size: { width: sanitizedBounds.width, height: sanitizedBounds.height },
        visibility: window.visibility || { maximized: false, isFullScreen: false }
      }, {
        id: windowId,
        session: { id: window.activeSession },
        triggerSource: params && params.triggerSource
      }];

      mainWindow.windowName = windowName;
      mainWindow.type = 'console';
      mainWindow.params = windowParams;
      mainWindow.launchParams = launchParams;

      attachWebcontentListeners({
        window: mainWindow,
        launchParams,
        webPreferences: defaultWindowOptions.webPreferences
      });

      Promise.resolve()
        .then(() => {
          if (window.id) {
            // Checking if the window to restore actually does exist in DB Or not before updating.
            // This makes sure that when the window starts booting, a record always exists in the DB
            return WindowController.get({ id: window.id });
          }
          return;
        })
        .then((dbWindow) => {
          if (dbWindow) {
            // Restoring
            return WindowController
              .update({
                id: window.id,
                browserWindowId: mainWindow.id,
                position: { x: sanitizedBounds.x, y: sanitizedBounds.y },
                size: { width: sanitizedBounds.width, height: sanitizedBounds.height }
              });
          }
          else {
            // Not restoring
            return WindowController
              .create.apply(WindowController, windowParams);
          }
        })
        .then(() => {
          return getAbsolutePageURL(
            rootPageType, // This should change to scratchpad, when user is logged out
            launchParams,
            defaultWindowOptions.webPreferences
          );
        })
        .then((pageURL) => {
          mainWindow.loadURL(pageURL);
        })
        .catch((e) => {
          pm.logger.error('WindowManager~newConsoleWindow - Error in loading console window from db', e);
        });

      // Reset console ID when 'closed' is emitted.
      // 'close' not used as it is not emitted when destroy() is called.
      // This makes sure console can be launched after switching accounts while it is open.
      // Github issue - https://github.com/postmanlabs/postman-app-support/issues/5409
      mainWindow.on('closed', () => {
        if (this.consoleWindowId) {
          this.consoleWindowId = null;
        }
      });

      this.addListeners(mainWindow);
    }
    else {
      let consoleWindow = BrowserWindow.fromId(parseInt(this.consoleWindowId));
      if (!consoleWindow) {
        return;
      }
      consoleWindow.show();
      unminimize(consoleWindow);
    }
  },

  addListeners (activeWindow) {
    activeWindow.on('close', this.closedHandler);
    activeWindow.on('move', this.debouncedStateChangeHandler);
    activeWindow.on('resize', this.debouncedStateChangeHandler);
    activeWindow.on('restore', this.windowBoundsHandler);
    activeWindow.on('focus', this.focusHandler);

    if (activeWindow.type === 'requester') {
      activeWindow.on('enter-full-screen', this.enterFullScreenHandler);
      activeWindow.on('leave-full-screen', this.leaveFullScreenHandler);
      activeWindow.on('maximize', this.maximizeHandler);
      activeWindow.on('unmaximize', this.unmaximizeHandler);
      activeWindow.on('resize', this.debouncedResizeHandler);
      activeWindow.on('blur', this.blurHandler);
    }
  },

  updateWindowState (windowName, activeWindow) {
    const bounds = getBounds(activeWindow);
    const maximized = activeWindow.isMaximized();
    const isFullScreen = activeWindow.isFullScreen();
    const currentState = this.windowState[windowName];

    // If maximized or fullscreen, retain original size for restoring
    this.windowState[windowName] = {
      x: maximized || isFullScreen ? currentState.x : bounds.x,
      y: maximized || isFullScreen ? currentState.y : bounds.y,
      width: maximized || isFullScreen ? currentState.width : bounds.width,
      height: maximized || isFullScreen ? currentState.height : bounds.height,
      maximized,
      isFullScreen
    };
  },

  stateChangeHandler (e) {
    const activeWindow = e.sender;

    if (!activeWindow || activeWindow.isDestroyed()) {
      return Promise.resolve();
    }

    const bounds = getBounds(activeWindow);

    this.updateWindowState(activeWindow.windowName, e.sender);

    return WindowController.get({ browserWindowId: activeWindow.id })
      .then((window) => {
        const maximized = activeWindow.isMaximized();
        const isFullScreen = activeWindow.isFullScreen();

        // If maximized or fullscreen, retain original size for restoring
        WindowController.update({
          id: window.id,
          position: {
            x: maximized || isFullScreen ? window.position.x : bounds.x,
            y: maximized || isFullScreen ? window.position.y : bounds.y
          },
          size: {
            width: maximized || isFullScreen ? window.size.width : bounds.width,
            height: maximized || isFullScreen ? window.size.height : bounds.height
          },
          visibility: { maximized, isFullScreen }
        });
      });
  },

  deleteWindowFromDB (browserWindow) {
    let windowType = browserWindow.type,
      windowId = browserWindow.id;
    if (windowType !== 'requester') {
      return WindowController
        .get({ browserWindowId: browserWindow.id })
        .then((closedWindow) => {
          return WindowController.delete({ id: closedWindow.id });
        });
    }
    else {
      return WindowController
        .count({ type: 'requester' })
        .then((requesterWindowCount) => {
          if (requesterWindowCount > 1) {
            return WindowController
              .get({ browserWindowId: windowId })
              .then((window) => {
                return WindowController.delete({ id: window.id });
              });
          }

          return;
        });
    }
  },

  closedHandler (e) {
    if (!this.isPureWebPlatformMode() && !this.isFirstRequesterBooted) {
      e.preventDefault();
      return;
    }

    if (app.quittingApp) {
      // Windows are being closed because the app was quit, don't try to
      // delete window records
      return;
    }

    let window = e.sender,
      windowId = window.id;

    pm.logger.info(`WindowManager~closeHandler - Closed Window (id: ${windowId} )`);

    this.removeListeners(window);
    this.removeWindowId(windowId);
    clearStatesPerWindow(window);

    this.deleteWindowFromDB(window);

    this.channel.publish({
      type: 'window-closed',
      windowId
    });
  },

  focusHandler (e) {
    let window = _.get(e, 'sender', {});

    menuManager.updateMenuItems(window.type);

    this.channel.publish({
      type: 'focus',
      windowId: window.id
    });
  },

  blurHandler (e) {
    let window = _.get(e, 'sender', {});

    this.channel.publish({
      type: 'blur',
      windowId: window.id
    });
  },

  resizeHandler (e) {
    let window = _.get(e, 'sender', {});
    this.channel.publish({
      type: 'resize',
      windowId: window.id
    });
  },

  enterFullScreenHandler (e) {
    let window = _.get(e, 'sender', {});
    this.channel.publish({
      type: 'enter-full-screen',
      windowId: window.id
    });
  },

  leaveFullScreenHandler (e) {
    let window = _.get(e, 'sender', {});
    this.channel.publish({
      type: 'leave-full-screen',
      windowId: window.id
    });
  },

  maximizeHandler (e) {
    let window = _.get(e, 'sender', {});
    this.channel.publish({
      type: 'maximize',
      windowId: window.id
    });
  },

  unmaximizeHandler (e) {
    let window = _.get(e, 'sender', {});
    this.channel.publish({
      type: 'unmaximize',
      windowId: window.id
    });
  },

  removeListeners (activeWindow) {
    activeWindow.removeListener('close', this.closedHandler);
    activeWindow.removeListener('resize', this.debouncedStateChangeHandler);
    activeWindow.removeListener('move', this.debouncedStateChangeHandler);
    activeWindow.removeListener('restore', this.windowBoundsHandler);
    activeWindow.removeListener('focus', this.focusHandler);

    if (activeWindow.type === 'requester') {
      activeWindow.removeListener('enter-full-screen', this.enterFullScreenHandler);
      activeWindow.removeListener('leave-full-screen', this.leaveFullScreenHandler);
      activeWindow.removeListener('maximize', this.maximizeHandler);
      activeWindow.removeListener('unmaximize', this.unmaximizeHandler);
      activeWindow.removeListener('resize', this.debouncedResizeHandler);
      activeWindow.removeListener('blur', this.blurHandler);
    }
  },

  getFirstRequesterWindow () {
    return WindowController
      .getAll({ type: 'requester' })
      .then((allRequesterWindows) => {
        let requesterWindowIds = _.map(allRequesterWindows, (window) => window.browserWindowId),
          openWindowIds = this.openWindowIds,
          openRequesterWindows = _.intersection(openWindowIds, requesterWindowIds);

        if (openRequesterWindows.length) {
          return _.find(allRequesterWindows, (window) => window.browserWindowId === openRequesterWindows[0]);
        }
        return;
      });
  },

  openUrl (url) {
    this.getFirstRequesterWindow()
      .then((window) => {
        if (window) {
          let channel = this.eventBus.channel('protocol-handler');
          channel.publish({
            url,
            windowId: window.id
          });

          var bWindow = BrowserWindow.fromId(window.browserWindowId);
          if (bWindow) {
            bWindow.show();
            unminimize(bWindow);
          }

          this.initUrl = null;
        }
        else {
          // Open a new window
          this.initUrl = url;
          this.createOrRestoreRequesterWindow();
        }
      });
  },

  removeWindowId (windowId) {
    // remove windowId from openWindowIds
    var index = this.openWindowIds.indexOf(windowId);

    if (index !== -1) {
      this.openWindowIds.splice(index, 1);
    }
  },

  openCustomURL (url) {
    shell.openExternal(url);
  },

  hasOpenWindows () {
    return !_.isEmpty(BrowserWindow.getAllWindows());
  },

  restoreWindows (options = {}) {
    pm.logger.info('windowManager~restoreWindows: Restoring requester windows');

    if (!this.isFirstRequesterBooted) {
      pm.logger.error('windowManager~restoreWindows: Bailing out of restoreWindows as the first requester is not booted');
      return;
    }

    let windowIdsToSkip = options.windowIdsToSkip || [];

    return WindowController.getAll({})
      .then((allWindows) => {
        let allWindowIds = _.map(allWindows, (window) => window.id),
          windowsToRestore = _.slice(allWindows, 0, MAX_WINDOW_RESTORE_COUNT),
          windowsToRestoreIds = _.slice(allWindowIds, 0, MAX_WINDOW_RESTORE_COUNT),
          idsToDelete = _.differenceWith(allWindowIds, windowsToRestoreIds);

        if (_.isEmpty(idsToDelete)) {
          return windowsToRestore;
        }
        return WindowController
          .delete({ id: idsToDelete })
          .then(() => {
            return windowsToRestore;
          });
      })
      .then((allWindows = []) => {
        // Filter out the IDs of the windows to skip. These will not be restored
        allWindows = allWindows.filter((window = {}) => {
          // We keep the window ID if the list of IDs to skip does not have the
          // current window's ID
          return !windowIdsToSkip.includes(window.id);
        });

        if (!_.isEmpty(allWindows)) {
          _.each(allWindows, (window) => {
            switch (window.type) {
              case 'requester':
                this.newRequesterWindow(window);
                break;
              case 'console':
                this.newConsoleWindow(window);
                break;
            }
          });
        }
      });
  },

  /**
   * Closes all requester windows
   */
  closeRequesterWindows () {
    this.unsetFirstRequesterBooted();
    this.closeAllWindows();
  },

  closeAllWindows () {
    _.each(this.openWindowIds, (windowId) => {
      let window = BrowserWindow.fromId(parseInt(windowId));
      window && this.removeListeners(window);
      window && window.destroy();
    });

    this.openWindowIds = [];

    /**
     * Earlier there was a windowController.delete() which used to wipe out the complete window file,
     * so on restore actions it never used to find any window and would open a new one.
     * Case where user does a add new account, cancels that operation and clicks take me back to signed in account
     *
     * Also, when the shared process is booted that calls windowManager.restoreWindows, which keeps the
     * MAX_WINDOW_RESTORE_COUNT number of windows and clears the rest of them. Hence clean up is done on
     * every shared booted.
     */
  },

  /**
   * This function handles the case when the position at which the window is to be restored is outside
   * the bounds of the current display configuration. This causes the bug where the app is loaded off-screen.
   * If this case arises, this function displays the window on the primary display.
   *
   * NOTE: This function is triggered by the 'restore' event emitted by the window on being restored from a minimized state.
   * The 'show' event would have been more appropriate but 'restore' is used because the 'show' event is inconsistent
   * across different platforms. So it would have worked well on macOS but not on Windows and Linux.
   *
   * Electron issue - https://github.com/electron/electron/issues/8664
   */
  windowBoundsHandler (e) {
    let window = e.sender;
    if (!window) {
      return;
    }

    let primaryDisplay = electron.screen.getPrimaryDisplay(),
      bounds = getBounds(window),
      sanitizedCoordinates = this.sanitizeCoordinates({ x: bounds.x, y: bounds.y }),
      finalBounds = {
        x: sanitizedCoordinates && sanitizedCoordinates.x,
        y: sanitizedCoordinates && sanitizedCoordinates.y,
        width: bounds.width,
        height: bounds.height
      };

    // Case where the sanitized bounds returns null i.e. the bounds were outside the current display
    if (_.isNull(finalBounds.x) || _.isNull(finalBounds.y)) {
      finalBounds = primaryDisplay.bounds;
    }

    // While upgrading electron from v15 tov18, we were impacted by an underneath issue in electron
    // where calling the setBounds function inside the restore event lead to the main process crash.
    // Issue got reported here https://github.com/postmanlabs/postman-app-support/issues/11548 & acknowledged
    // by electron here https://github.com/electron/electron/issues/36705. As a workaround mentioned in the thread
    // we are moving setBounds behind setImmediate.
    setImmediate(() => {
      window.setBounds(adjustBounds(finalBounds));
    });
  },

  /**
   * Function to bring the requester window in focus
   *
   * If no requester window is open, a new requester window is opened with state of the last closed requester window
   * else the existing requester window in brought in focus
   */
  focusRequesterWindow () {
    let window;
    return this.getOpenWindows('requester')
      .then((allOpenRequesterWindows) => {
        if (_.isEmpty(allOpenRequesterWindows)) {
          return WindowController.getAll({ type: 'requester' })
            .then((allRequesterWindows) => {
              if (!_.isEmpty(allRequesterWindows)) {
                window = this.newRequesterWindow(allRequesterWindows[0]);
              }
              if (!window) {
                return Promise.reject(new Error('windowManager~focusRequesterWindow: Unable to restore the last closed requester window'));
              }
              return window;
            });
        }
        else {
          window = BrowserWindow.fromId(allOpenRequesterWindows[0]);
          if (!window) {
            return Promise.reject(new Error('windowManager~focusRequesterWindow: Unable to focus the existing requester window'));
          }
          unminimize(window);
          window.focus();
          return window;
        }
      });
  },

  /**
   * Function to sanitize position coordinates and dimensions for window. It makes sure when
   * window is restored or opened its position coordinates and size are valid.
   * @param {Object} bounds - Object which has window's position and size values
   * @param {String} windowName - Window type
   */
  sanitizeBounds (bounds = {}, windowName) {
    let defaultBounds,
      sanitizedCoordinates;
    let WINDOW_MIN_WIDTH = MIN_ALLOWED_WINDOW_WIDTH;
    switch (windowName) {
      case 'requester':
        defaultBounds = DEFAULT_REQUESTER_BOUNDS;
        WINDOW_MIN_WIDTH = MIN_ALLOWED_REQUESTER_WIDTH;
        break;
      case 'console':
        defaultBounds = DEFAULT_CONSOLE_BOUNDS;
        break;
      default:
        defaultBounds = DEFAULT_REQUESTER_BOUNDS;
        break;
    }

    // Addded this safe check for the issue: https://github.com/postmanlabs/postman-app-support/issues/6304
    if (!_.isInteger(bounds.width) ||
      !_.isInteger(bounds.height) ||
      bounds.width < WINDOW_MIN_WIDTH ||
      bounds.height < MIN_ALLOWED_WINDOW_HEIGHT) {
      return defaultBounds;
    }

    sanitizedCoordinates = this.sanitizeCoordinates({ x: bounds.x, y: bounds.y });

    return {
      x: sanitizedCoordinates.x,
      y: sanitizedCoordinates.y,
      width: bounds.width,
      height: bounds.height
    };
  },

  /**
   * Close and Open all requester windows for the app
   * @param {Object} data - The authentication response
   */
  reLaunchRequesterWindows (data = {}) {
    this.closeRequesterWindows();
    return this.openRequesterWindows(data);
  },

  /**
   * Open all requester windows for the app
   * @param {Object} data - The authentication response
   */
  openRequesterWindows (data = {}) {
    this.unsetFirstRequesterBooted();
    return this.openFirstRequesterWindow(data);
  },

  /**
   * Open a new requester window with the isFirstRequester flag set as true
   *
   * If there are windows to be restored, we take the first window from the
   * list and open that as the first requester.
   * Otherwise, we just create a new requester window and set the isFirstRequester
   * flag for that as true
   * @param {Object} response An object containing authentication response
   */
  openFirstRequesterWindow ({ authResponse } = {}) {
    // If the first requester is already booted, bail out
    if (this.isFirstRequesterBooted) {
      pm.logger.info('windowManager~openFirstRequesterWindow: Bailing out as first requester is already open');
      return Promise.resolve();
    }

    return WindowController.getAll({ type: 'requester' })
      .then((requesterWindows) => {
        let params = {
          isFirstRequester: true,
          authResponse
        };

        if (_.size(requesterWindows) === 0) {
          return this.newRequesterWindow({}, params);
        }

        let firstRequester = requesterWindows[0];
        return this.newRequesterWindow(firstRequester, params);
      });
  },

  async openWebBasedProxyWindow () {
    if (this.webProxyWindowID) {
      let window = BrowserWindow.fromId(parseInt(this.webProxyWindowID, 10));
      if (window && !window.isFocused()) {
        window.show();
      }
      return;
    }

    const mainWindow = new BrowserWindow(
      {
        title: 'Proxy Window',
        backgroundColor: '#FFFFFF',
        ...adjustBounds({
          width: 1280,
          height: 800
        }),
        webPreferences: {
          webSecurity: true,
          backgroundThrottling: false,
          partition: await userPartitionService.getActivePartition(),
          nodeIntegration: true,
          contextIsolation: false,
          webviewTag: true,
          preload: path.resolve(app.getAppPath(), 'preload/desktop/index.js')
        },
        icon: nativeImage.createFromPath(path.resolve(app.getAppPath(), 'assets/icon.png'))
      }
    );

    require('@electron/remote/main').enable(mainWindow.webContents);

    this.webProxyWindowID = mainWindow.id;
    mainWindow.loadURL(`${this.webProxyPath}`);

    let unsubscribe,
      ipcMain = pm.sdk.IPC;

    unsubscribe = ipcMain.subscribe('webproxy-authenticate-close-window-event', () => {
      mainWindow && mainWindow.close();
    });

    mainWindow.on('close', () => {
      unsubscribe();
      this.webProxyWindowID = null;

      // Handle the case where app is getting closed, don't restore the windows in that case
      if (app.quittingApp) {
        return;
      }

      this.setWindowsDefaultVisibilityState(true);
      this.openRequesterWindows();
    });
  },

  setFirstRequesterBooted () {
    AppLaunchPerfService.destroy();
    this.isFirstRequesterBooted = true;
  },

  setHasWPNavigatedToMonolithRouteOnce () {
    this.hasWebPlatformNavigatedToMonolith = true;
  },

  openDevTools: (window) => {
    window.webContents.openDevTools({ mode: 'detach', activate: true });
  },

  toggleDevTools (window) {
    if (window.webContents.isDevToolsOpened()) {
      window.webContents.closeDevTools();
    } else {
      this.openDevTools(window);
    }
  },

  unsetFirstRequesterBooted () {
    this.isFirstRequesterBooted = false;
  }
};


exports.windowManager = windowManager;

/**
 * This method needs to be called only at launch once, as this response is not cached
 * and may change when called for a different window id.
 *
 * @typedef {{
 *  browserWindowId: string; // Could be console/browser window.id
 *  logPath: string;
 *  sessionId: string;
 *  startTime: number;
 *  scratchpadPartitionId: string;
 *  isFirstRequester: boolean;
 *  signInAction?: boolean;
 *  authConfig?: Record<string, any>;
 *  appPath: string;
 *  type: RootPageTypes;
 *  devtools: boolean;
 *  primaryId: string;
 *  allIds: string[];
 *  partitionId: string;
 *  isNewUser?: boolean;
 *  isSwitchUser?: boolean;
 * }} BrowserWindowLaunchParams
 *
 * @param {RootPageTypes} rootPage
 * @param {{
 *  window: any; // Should've been import('electron').BrowserWindow
 *  authResponse: any;
 *  partitionId: string;
 *  isFirstRequester?: boolean;
 *  devtools?: boolean;
 * }} options
 *
 * @return {BrowserWindowLaunchParams}
 */
const getWindowLaunchParams = async (rootPage, options) => {
  const { window, authResponse, isFirstRequester, partitionId } = options;

  // authResponse can be undefined
  const signInAction = _.get(authResponse, ['authData', 'additionalData', 'action']);
  const isNewUser = [AUTH_ACTIONS.SIGN_UP, AUTH_ACTIONS.LOGIN].includes(signInAction);
  const isSwitchUser = [AUTH_ACTIONS.SWITCH_USER].includes(signInAction);
  const authConfig = _.get(authResponse, ['authResponse', 'authData', 'config']);
  return {
    browserWindowId: window.id,
    logPath: app.logPath,
    sessionId: app.sessionId,
    startTime: Date.now(),
    scratchpadPartitionId: await scratchPadPartitionService.getCurrent(), // Need to hardcode a scratchpad partition id
    isFirstRequester: isFirstRequester,
    signInAction: signInAction,
    authConfig: authConfig,
    appPath: app.getAppPath(),
    type: rootPage,
    devtools: _.includes(devtools, rootPage),
    primaryId: windowManager.primaryId,
    allIds: windowManager.openWindowIds,
    partitionId: partitionId,
    isNewUser: isNewUser,
    isSwitchUser: isSwitchUser,
    preloadFile: url.pathToFileURL(path.resolve(app.getAppPath(), 'preload/desktop/index.js')).href,
    authResponse: authResponse,
    activeUser: await getActiveUser(),
    systemLocale: app.getLocale()
  };
};

/**
 * @param {{ sender: { webContents: any }}} ev
 * @param {string} url
 */
const reloadBrowserWindow = (ev, url) => {
  const webContents = ev.sender;
  if (webContents && url) {
    const win = BrowserWindow.fromWebContents(webContents);
    pm.logger.info(`Main~reloadBrowserWindow (To Url): ${url}`);
    win.loadURL(url);
  }
};

/**
 * Attaches Main process BrowserWindow to Renderer process
 * IPC handlers.
 */
function attachRendererIPCHandlers () {
  /** @type {import('../sdk/ipc')} */
  const ipcMain = pm.sdk.IPC;

  /**
   * Send updated LoggedIn users data, when the event is triggered, once
   * at launch.
   * Trigger a send from main for every updates in logged-in users post that.
   */
  ipcMain.subscribe(IPC_EVENT_NAMES.GET_LOGGEDIN_USERS, (ev) => {
    const webContents = ev.sender;
    sendUsersDataToRenderer(webContents);
  });

  /**
   * Clear Service Worker Cache and reload the active view.
   */
  ipcMain.subscribe(IPC_EVENT_NAMES.CLEAR_CACHE_AND_RELOAD, (ev) => {
    try {
      const webContents = ev.sender;
      webContents && webContents.session && webContents.session.clearCache();
      webContents.reload();
      pm.logger.warn('Main~IPC-clearCacheAndReload success');
    } catch (e) {
      pm.logger.warn('Main~IPC-clearCacheAndReload error: ', e);
    }
  });

  /**
   * Updates the URL of the BrowserWindow which triggered this event.
   */
  ipcMain.subscribe(IPC_EVENT_NAMES.UPDATE_WEBVIEW_URL, (ev, targetUrl) => {
    const webContents = ev.sender;
    if (webContents && targetUrl) {
      pm.logger.info(`Main~${IPC_EVENT_NAMES.UPDATE_WEBVIEW_URL}: `, targetUrl);
      const win = BrowserWindow.fromWebContents(webContents);
      win.loadURL(targetUrl);
    }
  });

  /**
   * Reload active root page, when needed
   */
  ipcMain.subscribe(IPC_EVENT_NAMES.RELOAD, async (ev) => {
    const webContents = ev.sender;
    if (webContents) {
      try {
        const currentURL = new url.URL(webContents.getURL());
        if (currentURL.protocol === 'file:') {
          // Do not reload to the same file system link, try getting proper URL for
          // last saved user session and load that URL
          const win = BrowserWindow.fromWebContents(webContents);
          await windowManager.reloadBrowserWindow(win);
          pm.logger.info(`Main~${IPC_EVENT_NAMES.RELOAD} :: Reloading last saved user session.`);
          return;
        }
        pm.logger.info(`Main~${IPC_EVENT_NAMES.RELOAD}: ${currentURL}`);
        webContents.reload();
      } catch (e) {
        pm.logger.error(`Main~${IPC_EVENT_NAMES.RELOAD}: Failed to reload -> ${webContents.getURL()}:: `, e);
      }
    }
  });

  /**
   * Reload active root page, when needed
   */
  ipcMain.handle(IPC_EVENT_NAMES.GET_PARTITION_ID, () => userPartitionService.getActivePartition());


  /**
   * Check whether monolith is loading from Web Platform for the first time
   * And set the flag to true for subsequent navigations/calls.
   */
  ipcMain.handle(IPC_EVENT_NAMES.SET_HAS_WEB_PLATFORM_NAVIGATED_TO_MONOLITH, () => {
    const isFirstNavigationToMonolith = !windowManager.hasWebPlatformNavigatedToMonolith;
    windowManager.setHasWPNavigatedToMonolithRouteOnce();
    return isFirstNavigationToMonolith;
  });

  /**
   * Handler to open Electron context menu on right click for WEB PLATFORM
   */
  ipcMain.handle(IPC_EVENT_NAMES.OPEN_NATIVE_MENU, async (event, payload) => {

    function sendMenuResponse (resp) {
      return event.sender.send('CLOSE_POPUP_MENU', resp);
    }
    function addCbToMenuItems (template) {
      if (!Array.isArray(template)) return;
      return template.map((item) => {
        const clickID = item.click;
        return {
          ...item,
          click: () => sendMenuResponse(clickID),
          submenu: addCbToMenuItems(item.submenu)
        };
      });
    }

    if (payload && payload.menu) {
        const menu = electron.Menu.buildFromTemplate(addCbToMenuItems(payload.menu));
        menu.on('menu-will-close', () => {
          // emit event on menu close
          sendMenuResponse();
        });
        menu.popup({ window: BrowserWindow.fromWebContents(event.sender) });
    }
  });

  ipcMain.handle(IPC_EVENT_NAMES.GET_PLATFORM_LAUNCH_PERF_METRICS, async () => {
    pm.logger.info(`Main~${IPC_EVENT_NAMES.GET_PLATFORM_LAUNCH_PERF_METRICS}`);
    return AppLaunchPerfService.getAllMeasures();
  });
  ipcMain.handle(IPC_EVENT_NAMES.SCRATCHPAD_THEME_ACTION,

    /**
     * @param {'get' | 'set'} type
     * @param {string=} value
     */
    async (_, type, value) => {
      pm.logger.info(`Main~${IPC_EVENT_NAMES.SCRATCHPAD_THEME_ACTION}:: action: ${type}, value: ${value}`);
      switch (type) {
        case 'get':
          return store.get(STORE_KEYS.SCRATCHPAD_THEME);
        case 'set':
          store.set(STORE_KEYS.SCRATCHPAD_THEME, value);
      }
    }
  );

  /**
   * Handles Page navigations from file:// -> http:// protocols
   * for Postman App
   */
  ipcMain.handle(IPC_EVENT_NAMES.GET_REMOTE_INIT_PATH, async () => {
    pm.logger.info(`Main~${IPC_EVENT_NAMES.GET_REMOTE_INIT_PATH}:: ${store.get(STORE_KEYS.REMOTE_INIT_PATH)}`);
    return store.get(STORE_KEYS.REMOTE_INIT_PATH);
  });
  ipcMain.handle(IPC_EVENT_NAMES.NAVIGATE_TO_REMOTE_URL, async (ev, initPath) => {
    store.set(STORE_KEYS.REMOTE_INIT_PATH, initPath);

    /** Passing userId/teamId as strings is important */
    const to = getAppUrl(HTML_MAP['requester'], { userId: '0', teamId: '0' });
    pm.logger.info(`Main~${IPC_EVENT_NAMES.NAVIGATE_TO_REMOTE_URL}: ${initPath}, To Url: ${to}`);
    reloadBrowserWindow(ev, to);
  });
  ipcMain.handle(IPC_EVENT_NAMES.NAVIGATE_TO_SCRATCHPAD, async (ev, initPath) => {
    const webContents = ev.sender;
    const scratchpadUrlMap = store.get(STORE_KEYS.BASE_SCRATCHPAD_URL_PATHS);

    if (!webContents) { return; }

    try {
      const win = BrowserWindow.fromWebContents(webContents);
      const basePath = scratchpadUrlMap.get(win.id);
      if (basePath) {
        const baseUrl = new url.URL(basePath);
        initPath && baseUrl.searchParams.append('initialPath', initPath);
        pm.logger.info(`Main~${IPC_EVENT_NAMES.NAVIGATE_TO_SCRATCHPAD} (To Url): ${baseUrl}`);
        win.loadURL(baseUrl.toString());
      }
    } catch (e) {
      pm.logger.error(`Error: Main~${IPC_EVENT_NAMES.NAVIGATE_TO_SCRATCHPAD} Failed to parse URL:`, e);
    }
  });

  /**
   * Retrieves and sends data for offline page rendering
   */
  ipcMain.handle(IPC_EVENT_NAMES.GET_OFFLINE_DATA, async () => {
    const activePartition = await partitionService.findOne(await userPartitionService.getActivePartition());
    const userName = _.get(activePartition, 'meta.name');
    const email = _.get(activePartition, 'meta.email');

    pm.logger.info(`Main~${IPC_EVENT_NAMES.GET_OFFLINE_DATA}`);
    return { userName, email };
  });

  /**
   * Returns the userPartition, including access_token
   * This is used by Web Platform which does not have access (yet) to indexedDb
   * @param {object} user
   * @param {string} user.id
   */
  ipcMain.handle(IPC_EVENT_NAMES.GET_USER_PARTITION, async (event, user) => {
    const partitionId = await userPartitionService.getPartitionForUser(user);
    const userPartition = await partitionService.findOne(partitionId);

    pm.logger.info(`Main~${IPC_EVENT_NAMES.GET_USER_PARTITION}`);
    return userPartition;
  });

  /**
   * Navigates to an external url
   * This is used by Web Platform which does not have access (yet) to electron APIs directly
   * @param {string} url
   */
  ipcMain.handle(IPC_EVENT_NAMES.OPEN_EXTERNAL_URL, async (event, url) => {
    windowManager.openCustomURL(url);
  });

  /**
   * Retrieves and sends partition data for the userId passed to this RPC
   *
   * @param {any} _ event
   * @param {{ id: string }} user the user for which we are finding the partition for
   */
  ipcMain.handle(IPC_EVENT_NAMES.CHECK_USERS_PARTITION, async (event, user) => {
    const partitionData = await userPartitionService.getPartitionForUser(user.id);

    pm.logger.info(`Main~${IPC_EVENT_NAMES.CHECK_USERS_PARTITION}: `, partitionData);
    return partitionData;
  });
}

/**
 * @param {{
 *  window: any;
 *  launchParams: BrowserWindowLaunchParams;
 *  webPreferences: WindowWebPreferences;
 * }} param0
 */
async function attachWebcontentListeners ({
  window,
  launchParams = {},
  webPreferences
}) {
  window.webContents.on('crashed', handleCrash(launchParams));

  const allUsers = await userPartitionService.getAllUsers();

  window.webContents.on('did-fail-load', async (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    let errorObj = {
      isNavigationError: false,
      errorUrl: validatedURL,
      errorCode: errorCode,
      isSignedOutUser: !allUsers || allUsers.length === 0
    };
    const eventName = 'did-fail-load';
    pm.logger.info(`Main ~ ${eventName}: Couldn\'t load the app.`, errorObj, errorCode, errorDescription, isMainFrame);

    // bailing out in case the did-fail-load did not triggered from main frame
    // reference: https://postmanlabs.atlassian.net/browse/CUE-3617
    if (!isMainFrame) {
      return;
    }

    return getAbsolutePageURL('offline', launchParams, webPreferences, {
      eventName,
      errorObj
    })
    .then((url) => {
      pm.logger.info(`Main ~ ${eventName}: Navigating to offline page.`, url);
      window.loadURL(url);
    })
    .catch((e) => {
      pm.logger.error('Error: did-fail-load: ', errorObj);
    });
  });

  window.webContents.on('did-navigate', async (__, url, httpResponseCode) => {
    if (httpResponseCode >= 400 && httpResponseCode <= 599) {
      let errorObj = {
        isNavigationError: true,
        errorUrl: url,
        errorCode: httpResponseCode,
        isSignedOutUser: !allUsers || allUsers.length === 0
      };
      const eventName = 'did-navigate';
      pm.logger.info(`Main ~ ${eventName}: Couldn\'t load the app.`, errorObj);
      getAbsolutePageURL('offline', launchParams, webPreferences, {
        eventName,
        errorObj
      })
      .then((url) => {
        pm.logger.info(`Main ~ ${eventName}: Navigating to offline page.`, url);
        window.loadURL(url);
      })
      .catch((e) => {
        pm.logger.error('Error: did-navigate: ', errorObj);
      });
    }
  });

  if (['requester', 'scratchpad', 'console'].includes(launchParams.type)) {
    // This is to prevent transition to unwanted URLs in the app. We attach a listener
    // when the webContents are created. Subsequent transitions are caught in the will-navigate
    // listener and we check the destination URL to see if it is allowed or not. If not, we
    // prevent the navigation
    window.webContents.on('will-navigate', (event, navigationUrl) => {
      try {
        pm.logger.error('Main~will-navigate: Navigating to URL', navigationUrl);

        // We only check for the validity of the URL in prod app
        if (RELEASE_CHANNEL !== 'prod') {
          return;
        }

        const parsedUrl = new URL(navigationUrl),
          parsedAppPath = new URL(APP_BASE_PATH);

        // We check if the URL is allowed to be opened -
        // 1. If it is from the Postman app domain
        // 2. If it is from the identity domain
        // 3. If it is loading the file from the app path in the user's system
        const isURLAllowed = parsedUrl.origin === POSTMAN_APP_URL || parsedUrl.origin === IDENTITY_URL ||
          (parsedUrl.protocol === FILE_PROTOCOL && parsedUrl.pathname && parsedUrl.pathname.startsWith(parsedAppPath.pathname));

        if (!isURLAllowed) {
          pm.logger.warn('Main~will-navigate: Prevented navigation to URL', navigationUrl);
          event.preventDefault();

          return;
        }
      }
      catch (e) {
        pm.logger.error('Main~will-navigate: Error while navigating to URL', e);
        event.preventDefault();
      }
    });
  }
}

/**
 * @param {*} webContents Active BrowserWindow webContents
 * @param {BrowserWindowLaunchParams} launchParams Launch Params with which window was launched
 */
function initializeView (webContents, launchParams) {
  // Send updated launch params
  webContents.send('electronWindowMessage', {
    name: WINDOW_EVENTS_MAP[launchParams.type],
    data: _.assign(
      launchParams,
      {
        partitionId: launchParams.partitionId,
        allIds: windowManager.openWindowIds,
        primaryId: windowManager.primaryId
      }
    )
  });

  if (launchParams.type === 'runner') {
    // Not sure if runner logic is required anymore??
    pm.eventBus.channel('runner-events')
      .publish(createEvent('set', 'runner', launchParams.testAttr));
  }
  else {
    sendUsersDataToRenderer(webContents);
  }

  if (launchParams.isNewUser) {
    const config = launchParams.authConfig;
    pm.eventBus.channel('onboarding-events')
      .publish(createEvent('onboard_user', 'onboarding', { config }));
  }
}

/**
 * Send updated LoggedIn users data, when the event is triggered, once
 * at launch.
 * Trigger a send from main for every updates in logged-in users post that.
 */
async function sendUsersDataToRenderer (webContents) {
  if (webContents) {
    const allUserAccounts = await userPartitionService.getAllUsers();

    pm.logger.info(`Main~${IPC_EVENT_NAMES.GET_LOGGEDIN_USERS}: `, allUserAccounts.map((userAccount) => userAccount.id));
    webContents.send(IPC_EVENT_NAMES.GET_LOGGEDIN_USERS, allUserAccounts);
  }
}

/**
 * This function will help generate and get proper URL for the provided window
 * and release channel.
 * @param {RootPageTypes} _type
 * @param {BrowserWindowLaunchParams} launchParams
 * @param {WindowWebPreferences} webPreferences
 * @param {{
 *  eventName?: string;
 *  errorObj?: any;
 * }} webPreferences
 */
const getAbsolutePageURL = async (_type, launchParams, webPreferences, options = {}) => {
  let type = _type;
  const isScratchpad = (/scratchpad/).test(type);
  let additionalParams = {};

  if (type === 'scratchpad' && RELEASE_CHANNEL === 'dev' && !BUILD_SCRATCHPAD) {
    type = 'no-scratchpad';
  }
  if (type === 'offline') {
    const { eventName, errorObj = {} } = options;
    pm.logger.info(`Main ~ ${eventName}: Couldn\'t load the app.`, errorObj);
    additionalParams = {
      ...errorObj
    };
  }

  let signInAction = false; // Same for desktop-offline as well
  if (!isScratchpad) {
    signInAction = launchParams.signInAction;
  }

  let params = {
    browserWindowId: launchParams.browserWindowId,
    logPath: launchParams.logPath,
    sessionId: launchParams.sessionId,
    startTime: launchParams.startTime,
    preloadFile: webPreferences.preload,
    scratchpadPartitionId: await scratchPadPartitionService.getCurrent(),
    isFirstRequester: launchParams.isFirstRequester,
    ...(!!signInAction && { signInAction }),
    ...additionalParams
  };

  const htmlFileName = HTML_MAP[type];
  const srcUrl = `${htmlFileName}${getQPString(params)}`;

  let basePath = BASE_URL;
  if (['scratchpad', 'offline'].includes(type)) {
    basePath = url.format({ protocol: 'file', pathname: `${app.getAppPath()}/html` });
    const fileUrl = `${basePath}/${srcUrl}`;

    if (type === 'scratchpad') {
      const scratchpadUrlMap = store.get(STORE_KEYS.BASE_SCRATCHPAD_URL_PATHS);
      scratchpadUrlMap.set(params.browserWindowId, fileUrl);
    }

    return fileUrl;
  }

  let absoluteSrcUrl = `${basePath}/${srcUrl}`;

  const isLoggedOut = _.isEmpty(await userPartitionService.getAllUsers());
  if (!isLoggedOut) {
    const userContext = await userPartitionService.getUserContextForActivePartition();
    absoluteSrcUrl = getAppUrl(htmlFileName, userContext);
  }

  return absoluteSrcUrl;
};
