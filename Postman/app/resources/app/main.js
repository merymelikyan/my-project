// IMPORTANT: This file needs to be loaded as early as possible when the app starts
require('./preload');

const { AppLaunchPerfService } = require('./services/AppLaunchPerfService'),
  { ElectronCrashReporter } = require('./services/ElectronCrashReporter');

AppLaunchPerfService.init();
ElectronCrashReporter.init();

var electron = require('electron'),
    fs = require('fs'),
    semver = require('semver'),
    app = electron.app,
    BrowserWindow = electron.BrowserWindow,
    Menu = electron.Menu,
    dialog = electron.dialog,
    circularJSON = require('circular-json'),
    _ = require('lodash').noConflict(),
    async = require('async'),
    menuManager = require('./services/menuManager').menuManager,
    windowManager = require('./services/windowManager').windowManager,
    authHandler = require('./services/AuthHandler'),
    authHandlerAdapter = require('./services/adapters/AuthHandlerAdapter'),
    appSettings = require('./services/appSettings').appSettings,
    proxyUtils = require('./utils/proxy/utils').utils,
    { getOrCreateInstallationId } = require('./services/id'),
    setupOAuth2WindowManager = require('./services/OAuth2WindowManager').initialize,
    setupRefreshTokenManager = require('./services/AppRefreshTokenManager').initialize,
    os = require('os'),
    initializeEventBus = require('./common/initializeEventBus'),
    { isAppUpdateEnabled } = require('./services/AutoUpdaterService'),
    gpu = require('./services/gpu'),
    updaterHandler = require('./services/UpdaterHandler'),
    devtoolsInstaller = require('./services/devtoolsInstaller'),
    enterpriseUtils = require('./services/enterpriseUtil'),
    ProtocolHandler = require('./services/ProtocolHandler'),
    interceptorConnection = require('./services/InterceptorConnection').interceptorConnection,
    initializeLogger = require('./services/Logger').init,
    initializePluginsHostHandler = require('./services/PluginsHostHandler').init,
    cleanupPluginsHostHandler = require('./services/PluginsHostHandler').cleanup,
    CrashReporter = require('./services/CrashReporter'),
    { getValue } = require('./utils/processArg'),
    { createDefaultDir } = require('./services/workingDirManager'),
    initializeAppBootListener = require('./common/services/AppBootListener'),
    interceptorBridgeInstaller = require('./services/interceptorBridgeInstaller').installer,
    ipcClientInitialized = false,
    webSocketServerInitialized = false,
    cloudProxyManager = require('./services/CloudProxyManager'),
    leaderSelection = require('./services/LeaderSelection'),
    proxyCertificateService = require('./services/proxyCertificateService').proxyCertificateService,
    ProxyMainManager = require('./services/ProxyMainManager'),
    VersionDependencyService = require('./services/VersionDependencyService'),
    architectureService = require('./services/ArchitectureService'),
    WindowController = require('./common/controllers/WindowController'),
    proxyMainManager = new ProxyMainManager(),
    FSProcessManager = require('./services/integrations/file-system/ProcessManager'),
    git = require('./services/integrations/git'),
    path = require('path'),
    { performShellDataMigration, isShellMigrationDone } = require('./services/shellDataMigration'),
    authDataInterface = require('./services/authDataInterface'),
    {
      MAC_TRAFFIC_LIGHTS_POSITIONS_DEFAULT,
      MAC_TRAFFIC_LIGHTS_Y_POSITION_FOR_ZOOM
    } = require('./constants/WindowConstants'),
    { runTimeoutPromise } = require('./services/automation-testing/utils/promise'),
    jsonStorage = require('electron-json-storage'),
    i18nService = require('./services/i18n/i18nService'),

    // Initialising file system interfaces and attaching handlers to the interface events via a newly spawned process
    FSManager = new FSProcessManager();

const { performance } = require('perf_hooks');
const { PERF_MEASURES, PERF_MARKS } = require('./constants/PerformanceAnalyticsConstants');
const { EVENT_BUS_EV_NAMES } = require('./constants');
const authPartitionService = require('./services/authPartitionService');
const { IPC_EVENT_NAMES } = require('./constants');

const MOVE_DIALOG_MESSAGE = 'Move to Applications Folder?',
      MOVE_DIALOG_ACTION_BUTTON = 'Move to Applications Folder',
      MOVE_DIALOG_CANCEL_BUTTON = 'Do Not Move',
      MOVE_DIALOG_CHECKBOX_MESSAGE = 'Do not remind me again',
      MOVE_DIALOG_DETAILS = 'I can move myself to the Applications folder if you\'d like. This will ensure that future updates will be installed correctly.',

      SUPPORT_LINK = 'https://go.pstmn.io/troubleshoot-could-not-open',
      COULD_NOT_OPEN_DIALOG_TITLE = 'Could not open Postman',
      COULD_NOT_OPEN_DIALOG_MESSAGE = 'Please try restarting the app. If the issue persists, please refer to ' + SUPPORT_LINK;

// We upgraded Electron to v7 that comes with node v12 in Postman v7.25.1. The default minimum
// supported version of TLS in node v10 was v1 which was changed to v1.2 in node v12
// Due to this, users still using the old servers won't be able to use Postman to send request
// See https://github.com/postmanlabs/postman-app-support/issues/8565
// As a fix, we are overriding this default minimum version of TLS back to v1
require('tls').DEFAULT_MIN_VERSION = 'TLSv1';

process.env.LOCAL_GIT_DIRECTORY = path.resolve(process.resourcesPath, 'data', 'git');

performance.mark(PERF_MARKS.MAIN_PROCESS_IMPORTS_COMPLETE);
performance.measure(PERF_MEASURES.MAIN_PROCESS_IMPORTS_TIME);

const ipcMain = pm.sdk.IPC;

let executionProcess;

try {
  // set the path for the directory storing app's configuration files
  getValue('user-data-path') && app.setPath('userData', getValue('user-data-path'));
}
catch (e) {
  pm.logger.error(e);
}

app.sessionId = process.pid; // set the current process id as sessionId

let gotTheLock = app.requestSingleInstanceLock();

// Quit if this is another instance of app trying to open
if (!gotTheLock) {
  pm.logger.info('Could not get the lock, quitting');
  app.quit();

  // NOTE: once we turn on minification, this will throw an error
  // We can use an IIFE or an else clause
  return;
}

// Initializing ProtocolHandler as early as possible to handle Run-In-Postman even when the app is closed.
// Recommended to do it on will-finish-launching event in electron docs - https://electronjs.org/docs/api/app#event-will-finish-launching
app.on('will-finish-launching', function () {
  ProtocolHandler.init();
});

// Disable GPU if needed. It is important to make sure this
// is done *before* the application emits the "ready" event,
// otherwise disabling the GPU might not have any effect.
if (gpu.shouldDisableGPU()) {
  gpu.disableGPU().catch((error) => {
    pm.logger.error('Main~GPU - Error while trying to disable GPU', error);
  });
} else {
  pm.logger.info('Not disabling GPU');
}

/**
 * These are initialization steps that do not have to block the launch of the first app window.
 *
 * They are executed after the first window is opened.
 */
function deferredInitSteps (cb) {
  let RuntimeIPCAgent = require('./runtime/agents/IPCAgent'),
      RuntimeExecutionService = require('./common/services/RuntimeExecutionService');

  RuntimeIPCAgent.start(RuntimeExecutionService(), (e) => {
    if (e) {
      pm.logger.warn('main.js: Could not initialise runtime module', e);
    }
    cb(e);
  });
}

/**
 * Initialize the host process used to execution collections within the app. This step isn't critical to the boot
 * sequence of the app and only needs to be triggered after the user has expressed an intent to trigger some sort of
 * collection execution -- a performance test, a collection run, or something else.
 *
 * @returns {boolean} True if the process is available for use, false otherwise.
 */
async function bootExecutionProcess ({ type, options }) {
  try {
    if (executionProcess && executionProcess.isAlive()) {
      pm.logger.info('ExecutionProcess ~ Already booted');

      return true;
    }

    pm.logger.info('ExecutionProcess ~ First boot');

    const ExecutionProcess = require('./services/automation-testing/ExecutionProcessLauncher');

    // @TODO: This doesn't necessarily have to be a class; to be cleaned up.
    executionProcess = new ExecutionProcess();

    try {
      await executionProcess.init({ type, options });
    }
    catch (e) {
      pm.logger.error('ExecutionProcess ~ Boot error', e);

      return false;
    }
  }
  catch (e) {
    pm.logger.error('main.js: Unable to boot execution process', e);

    return false;
  }

  return true;
}

async.series([
  /**
   * Initialize the remote module
   */
   (cb) => {
    // Ref: https://www.electronjs.org/docs/latest/breaking-changes#removed-remote-module
    require('@electron/remote/main').initialize();
    cb();
  },

  (cb) => {
    try {
      // Perform cleanup of redundant storage file + lock files. We do this early in the boot lifecycle because
      // we only want to cleanup stale lockfiles here. So, we do this here to avoid deleting any actual
      // lock files
      // Presence of stale lock files created by electron-json-storage causes an issue where multiple write
      // operations lead to a deadlock and the CPU usage of the app spikes
      // Refer to - https://github.com/postmanlabs/postman-app-support/issues/7294#issuecomment-1669001260

      pm.logger.info('Main: Starting cleanup of stale files');

      // List of lock files to remove
      const LOCK_FILES_LIST = [
        'requester.json.lock',
        'settings.json.lock',
        'userPartitionData.json.lock',
        'newAccountRegionSettings.json.lock'
      ],
        DATA_PATH = jsonStorage.getDataPath();

      // Remove the requester storage file (This is a redundant legacy file which is not used anymore)
      const requesterRemovePromise = new Promise((resolve, reject) => {
        jsonStorage.remove('requester', (err) => {
          if (err) {
            pm.logger.info('Main: Cleanup of requester.json file failed. This is non-blocking for app boot', err);
            reject(err);
          }

          resolve();
        });
      });

      // Remove each of the lockfiles
      const lockFilesCleanupPromises = LOCK_FILES_LIST.map((lockFile) => {
        const filePath = path.resolve(DATA_PATH, lockFile);

        return fs.promises.rm(filePath)
          .catch((err) => {
            // If the lock file does not exist, it's expected, so it's fine. Otherwise
            // we log the error
            if (err.code !== 'ENOENT') {
              pm.logger.info('Main: Lock file could not be deleted - ', filePath, err);
            }
          });
      });

      // We use Promise.allSettled here as even if the cleanup fails, we don't want to block the app boot
      Promise.allSettled([requesterRemovePromise, ...lockFilesCleanupPromises])
        .then((results) => {
          pm.logger.info('Main: Cleanup of stale files completed');
          cb();
        });
    }
    catch (e) {
      cb();
    }
  },

  /**
   * Try creating the default working directory if running for the first time
   */
  (cb) => {
    appSettings.get('createdDefaultWorkingDir', (err, created) => {
      if (err) {
        pm.logger.error('Main~createDefaultWorkingDir - Error while trying to get from appSettings', err);
      }

      if (created) {
        pm.logger.info('Main~createDefaultWorkingDir - Default working dir creation already attempted');
        return cb();
      }

      // Record the attempt regardless of success of the creation. Prevents unnecessary attempts in
      // future.
      // @todo update the only update once successfull when robust file system API's are in place
      appSettings.set('createdDefaultWorkingDir', true);

      createDefaultDir((err) => {
        // Ignore any errors, this is single attempt flow
        if (err) {
          // Logging just for debugging
          pm.logger.error('Main~createDefaultWorkingDir - Error while creating default working dir', err);
        }

        return cb();
      });
    });
  },

  /**
   * Iniitialize crash reporter
   */
  CrashReporter.init,

  /**
   * initializeLogger
   */
  initializeLogger,

  (cb) => {
    // Initialize the devtools installer
    devtoolsInstaller.init(cb);
  },

  /**
   * Initialize the event bus in the global.pm object
   */
  (cb) => {

    // initializes event bus on global `pm` object
    initializeEventBus();
    cb(null);
  },


  (cb) => {
    cloudProxyManager.init(cb);
  },

  /**
   * Initialize the architecture service
   */
  (cb) => {
    architectureService.init();
    cb(null);
  },

  (cb) => {
    /**
     * This step migrates the data from the shell partition to the main process. This is a
     * critical step requester for the rest of the app. This is dependeny on the app `ready`
     * event so it internally waits for the same.
     * We can also move this and the subsequent steps into the onReady handler
     */
    performShellDataMigration()
      .then(() => {
        cb();
      })
      .catch((e) => {
        cb(e);
      });
  },

  /**
   * It initialize the updateHandler and assigns the updaterInstance to the app object
   */
  (cb) => {
    // For enterprise application, do not intiialize the updateHandler
    if (enterpriseUtils.isEnterpriseApplication()) {
      cb();
    }
    else {
      updaterHandler.init((err, updaterInstance) => {
        app.updaterInstance = updaterInstance;
        cb(err);
      });
    }
  },

  initializePluginsHostHandler
], (err) => {

  if (err) {
    // We are continue proceeding for now. even we see error.
    pm.logger.error('Main~booting: Failed', err);
  }

  leaderSelection.initialize();

  initializeAppBootListener();


  const eventBus = pm.eventBus;
  windowManager.eventBus = eventBus;

  // setup OAuth 2 window manager
  setupOAuth2WindowManager();

  setupRefreshTokenManager();

  // flag set to perform tasks before quitting
  app.quittingApp = false;

  /**
   * Populate installation id
   * it gets the installation id
   * and keep it in app object
   *
   */
  function populateInstallationId () {
    getOrCreateInstallationId()
    .then(({ id, isCreatedNow }) => {
      // Assign the values in app so that the renderers can make use of it.
      app.firstLoad = isCreatedNow;
      app.installationId = id;

      // Set the user scope for crash reporter
      CrashReporter.setUserScope({ app_id: app.installationId }, _.noop);
      CrashReporter.setExtraScope({ session: app.sessionId }, _.noop);
    })
    .catch((err) => {
      pm.logger.error('main~populateInstallationId: Failed to get or create installationId', err);
    });
  }

  /**
   * Setting whether App Updates are enabled or disabled
   */
  function populateUpdateSettings () {
    app.isUpdateEnabled = isAppUpdateEnabled();
  }

  /** */
  function attachIpcListeners () {
    ipcMain.subscribe('newConsoleWindow', function (event, arg) {
      windowManager.newConsoleWindow({}, arg);
    });

    ipcMain.subscribe('messageToElectron', function (event, arg) {
      if (arg.event === 'rendererProxyIpcNodeStart') {
        pm.logger.info('All communication channels established. Starting proxy server...');

        // Start proxy server
        proxyMainManager.sendStartProxyServer();
      } else if (arg.event === 'requestProxyState') {
        windowManager.sendInternalMessage({
          event: 'proxyStateResponse',
          'object': proxyMainManager.isProxyConnected()
        });
      }
      else if (arg.event === 'requestCaptured') {
        proxyMainManager.recordCaptureStats();
      }
      else if (arg.event === 'regenerateCertificates') {

        // Regenerating certificates in proxy to support android clients and hiding android banner
        proxyCertificateService.regenerateCertificates(app.getPath('userData'))
        .then(() => {
          pm.logger.info('Main~IPC-MessageToElectron - Certificates regenerated');

          // sending internal message to renderer to update showRegenerateCertBanner
          windowManager.sendInternalMessage({
            event: 'updateRegenerateCertBanner',
            'object': {
              value: false
            }
          });

          // sending internal message to renderer to update cert trust status as the user will have to re trust the certificates
          windowManager.sendInternalMessage({
            event: 'certsRegenerated',
            'object': {
              certTrusted: false
            }
          });
        })
        .catch((e) => {
          pm.logger.error('Main~IPC-MessageToElectron - Error regenerating certificates', e);
        });
      }
      else if (arg.event === 'installCertificates') {
        proxyUtils.installAndTrustCertificate();
      }
      else if (arg.event === 'isCertAddedToKeyChain') {
        proxyUtils.isCertificateAddedToKeyChain()
          .then((isAdded) => {
            windowManager.sendInternalMessage({
              event: 'certAdditionStatus',
              'object': {
                value: isAdded
              }
            });
          });
      }
      else if (arg.event === 'startProxy') {
        var port = 8080;
        if (arg.data && arg.data.port) {
          port = arg.data.port;
        }
        if (typeof port === 'string') {
          port = parseInt(port);
        }
        pm.logger.info('Main~IPC-MessageToElectron - Starting proxy on port: ' + port);
        try {
          var ret = 0;
          proxyMainManager.startProxyProcess({
            env: {
              port,
              useImprovedFTUX: arg.data.useImprovedFTUX,
              STORE_LOC: app.getPath('userData'),
              ...process.env
            },
          });

          // TODO: handle proxy close on user log-out
          // Setting up listener to listen for logout event. We need to close the proxy
          // when the current user logs out
          pm.eventBus.channel('model-events').subscribe((event) => {
            let eventName = _.get(event, 'name'),
              eventNamespace = _.get(event, 'namespace');

            if (eventNamespace === 'user' && eventName === 'logout') {
              try {
                proxyMainManager.killProxyProcess();
                windowManager.sendInternalMessage({
                  event: 'proxyNotif',
                  'object': 'stop',
                  'object2': 'success'
                });
              }
              catch (e) {
                windowManager.sendInternalMessage({
                  event: 'proxyNotif',
                  'object': 'stop',
                  'object2': 'failure'
                });
                pm.logger.error('Main~IPC-MessageToElectron - Error while stopping proxy: ', e);
              }
            }
          });

          event.sender.send('proxyStarted', ret);
        }
        catch (e) {
          // error while starting proxy
          pm.logger.error('Main~IPC-MessageToElectron - Error while starting proxy: ', e);
          windowManager.sendInternalMessage({
            event: 'proxyNotif',
            'object': 'start',
            'object2': 'failure'
          });
        }
      }
      else if (arg.event === 'stopProxy') {
        pm.logger.info('Main~IPC-MessageToElectron - stopping proxy');
        try {
          proxyMainManager.killProxyProcess();
          windowManager.sendInternalMessage({
            event: 'proxyNotif',
            'object': 'stop',
            'object2': 'success'
          });
        }
        catch (e) {
          windowManager.sendInternalMessage({
            event: 'proxyNotif',
            'object': 'stop',
            'object2': 'failure'
          });
        }
      }
      else if (arg.event === 'postmanInitialized') {
        // sent by the primary window when indexedDB has loaded
        windowManager.newRequesterOpened();
      }
      else if (arg.event === 'installInterceptorBridge') {
        interceptorBridgeInstaller.installInterceptorBridge();
      }
      else if (arg.event === 'checkInstallationStatus') {
        interceptorBridgeInstaller.checkInstallationStatus();
      }
      else if (arg.event === 'installNode') {
        try {
          interceptorBridgeInstaller.installNode();
        }
        catch (err) {
          console.log('Error occurred while installing Node: ', err);
        }
      }
      else if (arg.event === 'resetInterceptorBridgeInstallation') {
        interceptorBridgeInstaller.resetInstallation();
      }
      else if (arg.event === 'forwardInterceptorRequest') {
        interceptorConnection.sendEncryptedMessageToInterceptor(arg.message);
      }
      else if (arg.event === 'initializeInterceptorBridge') {
        // creating IPC bridge with native server
        if (!ipcClientInitialized) {
          interceptorConnection.initializeIpcClient();
          ipcClientInitialized = true;
        }
      }
      else if (arg.event === 'initializeWebSocketServer') {
        if (!webSocketServerInitialized) {
          interceptorConnection.initializeWebSocketServer(arg.message);
          webSocketServerInitialized = true;
        }
      }
      else if (arg.event === 'disconnectInterceptorBridge') {
        interceptorConnection.disconnect();
      }
      else if (arg.event === 'changeActiveConnection') {
        interceptorConnection.changeActiveConnection(arg.message);
      }
      else if (arg.event === 'sendActiveSessionStatus') {
        interceptorConnection.sendActiveSessionStatus(arg.message);
      }
      else if (arg.event === 'setEncryptionKeyForInterceptor') {
        // setting the encryption key for App ~ Interceptor communication
        interceptorConnection.setEncryptionKeyForInterceptor(arg.message.encryptionKeyForInterceptor);

        if (ipcClientInitialized) {
          // checking for the same key at interceptor
          interceptorConnection.startKeyValidationFlow();
        }
      }
      else if (arg.event === 'getEncryptionKeyForInterceptor') {
        interceptorConnection.sendEncryptionKeyToRenderer();
      }
      else if (arg.event === 'getSyncDomainListForInterceptor') {
        interceptorConnection.sendSyncDomainListToRenderer();
      }
      else if (arg.event === 'fetchCustomEncryptionKey') {
        interceptorConnection.sendCustomEncryptionKeyToRenderer();
      }
      else if (arg.event === 'removeEncryption') {
        interceptorConnection.removeCustomEncryptionKeyFromInterceptor();
      }
    });

    // Local git operations
    ipcMain.handle('performGitOperation', async (event, arg) => {
      const result = await git.gitFactory(arg.data);
      return result;
    });

    ipcMain.handle('getSaveTarget', function (event, arg) {
      return new Promise((resolve, reject) => {
        showSaveDialog(event.sender, arg, (retPath) => {
          if (!retPath) {
            resolve(null);
          }
          else {
            resolve(retPath);
          }
        });
      });
    });

    ipcMain.handle('checkRootCAValidity', () => {
      return new Promise((resolve, reject) => {
        proxyCertificateService.isRootCAValid(path.resolve(app.getPath('userData'), 'proxy'))
          .then((isRootCAValid) => {
            resolve(isRootCAValid);
          });
      });
    });

    ipcMain.subscribe('sendToAllWindows', function (event, arg) {
      try {
        let parsedArg = circularJSON.parse(arg);
        if (parsedArg.event === 'pmWindowPrimaryChanged') {
          windowManager.primaryId = arg.object;
          pm.logger.info('Main~IPC-sendToAllWindows - Primary Window set (id: ' + windowManager.primaryId + ')');
        }
        else if (parsedArg.event === 'quitApp') {
          windowManager.quitApp();
        }
        if (parsedArg.event !== 'quitApp') {
          windowManager.sendInternalMessage(parsedArg);
        }
      }
      catch (e) {
        pm.logger.warn('Main~IPC-sendToAllWindows - Malformed message, ignoring.', e);
      }
    });

    ipcMain.subscribe('newRequesterWindow', function (event, arg) {
      windowManager.newRequesterWindow({}, arg);
    });

    ipcMain.subscribe('reLaunchRequesterWindows', function () {
      windowManager.reLaunchRequesterWindows();
    });

    ipcMain.subscribe('closeRequesterWindow', function (event, arg) {
      windowManager.closedHandler(event, arg);
    });

    ipcMain.subscribe('closeWindow', (event, arg) => {
      var win = BrowserWindow.fromId(parseInt(arg));
      win && win.close();
    });

    ipcMain.subscribe('enableShortcuts', () => {
      menuManager.createMenu(false).then(() => {
        appSettings.set('shortcutsDisabled', false);
      });
    });

    ipcMain.subscribe('disableShortcuts', () => {
      menuManager.createMenu(true).then(() => {
        appSettings.set('shortcutsDisabled', true);
      });
    });

    if (process.platform === 'darwin') {
      ipcMain.subscribe('ui-zoom-change-event', (event, arg) => {
        if (!arg || !_.isNumber(arg)) {
          return;
        }

        const currentWindow = BrowserWindow.getFocusedWindow();
        const newTrafficLightPositions = {
          x: MAC_TRAFFIC_LIGHTS_POSITIONS_DEFAULT.x * arg,
          y: MAC_TRAFFIC_LIGHTS_Y_POSITION_FOR_ZOOM[arg] || MAC_TRAFFIC_LIGHTS_POSITIONS_DEFAULT.y * arg
        };

        currentWindow && currentWindow.setTrafficLightPosition(newTrafficLightPositions);
      });
    }

    ipcMain.handle('getActivePartitionIdFromMain', async (event, arg) => {
      if (await isShellMigrationDone()) {
        return {
          isMigrationDone: true,
          partitionId: await authPartitionService.getActivePartition()
        };
      }
      else {
        return {
          isMigrationDone: false
        };
      }
    });

    /**
     * Send hardware metrics to renderer from main process
     * Handler invoked by getHardwareInfoMetricsToSend in renderer process to obtain hardware metrics
     * Used by sendHardwareInfo in client load analytics to send hardware metrics
     */
    ipcMain.handle('getHardwareMetrics', async () => {
      try {
        // Using native node API to fetch cpu information
        const cpuInfo = os.cpus();

        /**
         * getGPUInfo is an electron API to fetch GPU information
         * Using basic - Minimal gpu information needed
         * Use complete for more information
         */
        const gpuInfo = await app.getGPUInfo('basic');

        return {
          cpuInfo,
          gpuInfo
        };
      }
      catch (e) {
        pm.logger.error('Main~IPC-getHardwareMetrics - Failed to get hardware metrics.', e);
      }
    });

    // Updates the electron OS menu when user updates a customizable shortcut
    // arg shape: {'shortcutName1' => 'newAccelerator1', 'shortcutName2' => 'newAccelerator2'}
    ipcMain.subscribe('updateShortcut', function (event, arg) {
      menuManager.updateMenu(arg);
    });

    ipcMain.handle('bootExecutionProcess', async (event, arg) => {
      return await bootExecutionProcess(arg);
    });

    let hiddenWindow = null;

    ipcMain.handle('handle-export-as-PDF', async (event, arg) => {
      return new Promise((resolve, reject) => {
        hiddenWindow = new BrowserWindow({ show: false });

        hiddenWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(arg.data)}`);

        hiddenWindow.webContents.session.on('will-download', (event, item, webContents) => {
          // Set the save path, making Electron not to prompt a save dialog.
          item.setSavePath(arg.name);

          item.once('done', (event, state) => {
            if (hiddenWindow && !hiddenWindow.isDestroyed()) {
              hiddenWindow.close();
              hiddenWindow = null;
            }

            if (state !== 'completed') {
              reject(new Error(`Download failed: ${state}`));
            }

            resolve();
          });
        });
      });
    });
  }

  process.on('uncaughtException', function (e) {
    handleUncaughtError(e);
  });

  /**
   *
   * @param {*} e
   */
  function handleUncaughtError (e) {
    // Logger might not be there in this state, hence the safe check
    pm.logger && pm.logger.error('Main~handleUncaughtError - Uncaught errors', e) ||
      console.error('Main~handleUncaughtError - Uncaught errors', e); // eslint-disable-line no-console
  }

  /**
   *
   * @param {*} action
   * @param {*} url
   */
  function runPostmanShortcut (action) {
    if (action == 'newWindow') {
      windowManager.newRequesterWindow();
    }
    else {
      windowManager.sendToFirstWindow({
        name: action
      });
    }
  }

  // Quit when all windows are closed.
  app.on('window-all-closed', function () {
     // Kill proxy process when all windows are closed.
     // As renderer TCP reader will not be listening to proxied traffic anymore
     proxyMainManager.killProxyProcess();

    // If all the windows are closed, we quit the application only on linux and windows platform.
    // We don't want to quit the application when user choose to switch b/w multiple accounts
    if (process.platform != 'darwin' && windowManager.isFirstRequesterBooted) {
      app.quit();
      return;
    }
  });

  app.on('web-contents-created', (event, contents) => {
    if (contents.getType() === 'webview') {
      contents.on('new-window', (event) => {
        event.preventDefault();
      });
    }
  });

  app.on('did-attach-webview', (event, wc) => {
    wc.setWindowOpenHandler((details) => {
      app.webContents.send('webview-new-window', wc.id, details);
      return { action: 'deny' };
    });
  });


  app.on('before-quit', function (event) {
    pm.logger.info('Quitting app');

    app.quittingApp = true;

    // Kill execution process before quitting
    executionProcess && typeof executionProcess.onExit === 'function' &&
      runTimeoutPromise(executionProcess.onExit()).catch(() => {
        pm.logger.error('Failed to cleanup the execution process');
      });

    // Kill proxy before quitting
    proxyMainManager.killProxyProcess();

    // terminate the plugin process
    cleanupPluginsHostHandler();

    if (os.type() !== 'Linux') {
      app.updaterInstance = null;
    }
    else {
      const downloadedVersion = _.attempt(appSettings.getSync, 'downloadedVersion'),
       currentVersion = app.getVersion();

      // Update has been downloaded if `downloadedVersion` exists
      // Update the app and quit
      if (_.isNil(downloadedVersion) === false && semver.valid(semver.coerce(downloadedVersion)) && currentVersion !== downloadedVersion) {

        // applyUpdateAndQuit() internally calls swapAndRelaunch.sh
        // Which servers the purpose of applying update & quit the app by killing the parent process
        // If called, any statement after this function call in `before-quit` event will be skipped.
        pm.logger.info('Applying update and quit the app');
        updaterHandler.applyUpdateAndQuit(app.updaterInstance);
      }
    }
  });

  /**
   *
   * @param {*} window
   * @param {*} fileName
   */
  function showSaveDialog (window, fileName, cb) {
    dialog.showSaveDialog({
      title: 'Select path to save file',
      defaultPath: '~/' + fileName,
      properties: ['treatPackageAsDirectory']
    }).then((result) => {
      return cb(result.filePath);
    }, (err) => {
      return cb();
    });
  }
  attachIpcListeners();

  VersionDependencyService.initialize();

  windowManager.initialize();

  var dockMenu = Menu.buildFromTemplate([
    {
      label: 'New Collection',
      click: function () { runPostmanShortcut('newCollection'); }
    },
    {
      label: 'New Window ',
      click: function () { runPostmanShortcut('newWindow'); }
    }
  ]);

  /**
   * Determines whether to show the prompt for moving the current app to applications folder
   */
  function shouldShowMovePrompt (cb) {
    if (process.env.PM_BUILD_ENV === 'development' ||
        process.env.SKIP_MOVE_PROMPT === 'true' ||
        os.type() !== 'Darwin' ||
        app.isInApplicationsFolder()) {
      return cb(false);
    }

    appSettings.get('doNotRemindMoveToApplications', (err, doNotRemind) => {
      if (err) {
        pm.logger.error('Main~shouldShowMovePrompt - Error while trying to get "mode" from appSettings', err);
        return cb(false);
      }

      doNotRemind && pm.logger.info('Main~shouldShowMovePrompt - Not showing the prompt since user has chosen not to be reminded again');
      return cb(!doNotRemind);
    });
  }

  /**
   * This will show a prompt for moving the current app to applications folder when running on a mac
   */
  function promptMoveToApplicationsFolder (cb) {
    shouldShowMovePrompt((shouldShow) => {
      if (!shouldShow) {
        return cb();
      }

      pm.logger.info('Main~promptMoveToApplicationsFolder - Postman is not in applications folder, showing a prompt to move it there');

      dialog.showMessageBox({
        type: 'question',
        buttons: [MOVE_DIALOG_ACTION_BUTTON, MOVE_DIALOG_CANCEL_BUTTON],
        defaultId: 0, // Does not change the default selected button as mentioned in docs but only specifies the primary button (changes the color to blue)
        message: MOVE_DIALOG_MESSAGE,
        detail: MOVE_DIALOG_DETAILS,
        checkboxLabel: MOVE_DIALOG_CHECKBOX_MESSAGE
      }).then((result) => {
        // If the checkbox was selected, we need to wait for persisting this setting first before performing any action
        if (result.checkboxChecked) {
          appSettings.set('doNotRemindMoveToApplications', true, (err) => {
            if (err) {
              pm.logger.error('Main~promptMoveToApplicationsFolder - Failed to write the do not show prompt setting swallowing the error and continuing');
            }

            // Performing the action now
            if (result.response !== 0) {
              return cb();
            }

            // If user asked to move the application to applications directory we are not calling the callback here since the current app will be quitting anyway
            app.moveToApplicationsFolder();
          });
        }
        else {
          // If the checkbox was not selected, we can perform the action directly

          // If user didn't selected the move to application folder button
          if (result.response !== 0) {
            return cb();
          }

          // not calling the callback here since we the current app will be quitting anyway
          app.moveToApplicationsFolder();
        }
      });
    });
  }

  // This is the first instance, and another instance tried to open, here we should
  // 1. focus the first instance (current one)
  // 2. Allow protocol handler to parse the arguments and act accordingly
  app.on('second-instance', (event, commandLine) => {
    /**
     * bringing requester window in focus when an user tries to create another instance of the app.
     */
    windowManager.focusRequesterWindow()
    .catch((error) => {
      /**
       * Fallback step, if in  windowManager.focusRequesterWindow():
       * 1. openRequesterWindows has an id which actually does not exists.
       * 2. BrowserWindow.fromId() receives an argument which is not a number.
       * 3. openRequesterWindows does not contains the id of an already opened requester window.
       * 4. there is a failure while restoring the last closed requester window, when there are no open requester windows.
       */

      let errorMessage = error ? error.message : 'windowManager~focusRequesterWindow: Something went wrong while creating/focussing requester window';
      pm.logger.error(`main~makeSingleInstance: ${errorMessage}`);

      return windowManager.newRequesterWindow()
      .then((window) => {
        if (!window) {
          pm.logger.error('main~makeSingleInstance: New Requester window instance not found');
          return;
        }
      })
      .catch((e) => {
        pm.logger.error('main~makeSingleInstance: Error while creating a new Requester window', e);
        return;
      });
    })
    .finally(() => {
      return ProtocolHandler.processArg(commandLine);
    });
  });

  /**
   * Determines whether to shortcuts should be removed from menu.
   */
  function shouldHaveShortcuts (cb) {
    appSettings.get('shortcutsDisabled', (err, shortcutsDisabled) => {
      if (err) {
        pm.logger.error('Main~shouldHaveShortcuts - Error while trying to get "shortcutsDisabled" from appSettings. Assuming shortcuts are enabled.', err);
        return cb(err, false);
      }

      return cb(null, shortcutsDisabled);
    });
  }

  /**
   * Updates the version on the app about panel
   * @param {String} version
   * @param {String} UIVersion
   */
  function updateVersionOnAppAboutPanel (productVersion, UIVersion) {
    if (!productVersion || !UIVersion || process.platform !== 'darwin') {
      return;
    }

    app.setAboutPanelOptions({ applicationVersion: `${productVersion}\nUI Version: ${UIVersion}\nDesktop Platform Version: ${app.getVersion()}` });
  }

  /**
   * This will be called when app is ready
   */
  function onAppReady () {
    performance.mark(PERF_MARKS.MAIN_PROCESS_APP_READY);
    performance.measure(PERF_MEASURES.MAIN_PROCESS_APP_READY_TIME, PERF_MARKS.MAIN_PROCESS_IMPORTS_COMPLETE);

    // Initialize i18n in main process
    i18nService.init();

    promptMoveToApplicationsFolder(() => {
      // Populates the installation id
      populateInstallationId();
      populateUpdateSettings();

      let runningDeferredInitSteps = false;

      let unsubscribe = eventBus.channel('main-internal-lifecycle').subscribe((event) => {
        if (!event || event.namespace != 'main-internal-lifecycle' || event.name !== EVENT_BUS_EV_NAMES.WINDOW_LOADED) {
          return;
        }

        // flag to prevent running this step more than once
        if (runningDeferredInitSteps) {
          return;
        }
        runningDeferredInitSteps = true;

        // run deferred init steps
        deferredInitSteps((e) => {
          runningDeferredInitSteps = false;

          // unsubscribe handler to prevent running steps for next requester window
          unsubscribe();

          if (e) {
            pm.logger.warn('main.js: Could not complete deferred init steps', e);
          }
        });
      });

      // initialize event bus
      let appEvents = eventBus.channel('app-events');

      Promise.resolve()
        .then(() => {
          if (process.env.SKIP_SIGNIN !== 'true') {
            return authHandler.init(authHandlerAdapter);
          }
        })
        .then(() => {
          return WindowController.initialize({ eventBus });
        })
        .then(() => {
          appEvents.subscribe((event = {}) => {
            // If it is a boot process;
            if (_.get(event, 'name') === 'booted') {
              let process = event.namespace,
                  err = event.data,
                  meta = event.meta;

              if (process === 'requester' && meta && meta.isFirstRequester) {
                if (err) {
                  pm.logger.error('Main~AppEvents - First requester window boot failed', err);

                  let errorMessageToShow = err.name + ': ' + err.message;
                  dialog.showErrorBox(COULD_NOT_OPEN_DIALOG_TITLE, errorMessageToShow + '\n\n' + COULD_NOT_OPEN_DIALOG_MESSAGE);

                  return;
                }

                updateVersionOnAppAboutPanel(meta.productVersion, meta.UIVersion);
              }

              pm.logger.info(`Main~AppEvents - Received booted event for process ${process}.Version ${meta.productVersion} UI Version: ${meta.UIVersion} Desktop Platform Version: ${app.getVersion()}`);
            }
          });

          windowManager.openRequesterWindows();
        });

      appSettings.set('downloadedVersion', null);


      shouldHaveShortcuts((err, shortcutsDisabled) => {
        app.shortcutsDisabled = shortcutsDisabled;
        menuManager.createMenu(shortcutsDisabled);
      });

      if (app.dock) { // app.dock is only available on OSX
        app.dock.setMenu(dockMenu);
      }
    });

    proxyCertificateService.generateRootCAForProxy(app.getPath('userData'))
      .then((result) => {
        if (result.certsRegenerated) {
          // sending internal message to renderer to update cert trust status as the user will have to re trust the certificates
          windowManager.sendInternalMessage({
            event: 'certsRegenerated',
            'object': {
              certTrusted: false
            }
          });
        }
      })
      .catch((e) => {
        pm.logger.error('HTTPSProxy~Unable to generate certificates', e);
      });
  }

  // This method will be called when Electron has done everything
  // initialization and ready for creating browser windows.
  app.isReady() ? onAppReady() : app.on('ready', onAppReady);

  app.on('activate', function () {
    // bail out if first requester window is not booted
    if (!windowManager.isFirstRequesterBooted) {
      return;
    }

    windowManager
    .getOpenWindows('requester')
    .then((openRequesterWindows) => {
      // if there are open requester windows do nothing
      if (!_.isEmpty(openRequesterWindows)) {
        return;
      }

      // if there are no open requester windows open or restore a requester window
      windowManager.createOrRestoreRequesterWindow();
    });
  });
});
