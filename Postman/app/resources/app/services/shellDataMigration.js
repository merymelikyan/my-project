const authDataInterface = require('./authDataInterface'),
  path = require('path'),
  electron = require('electron'),
  BrowserWindow = electron.BrowserWindow,
  app = electron.app,
  sendAnalyticsEvent = require('./sendAnalytics'),
  devUrls = require('../common/constants/dev-urls'),
  url = require('url'),

  MIGRATION_TRY_COUNT = 2,
  SHOW_MIGRATION_UI_TIMEOUT = 1 * 1000,
  SHELL_PARTITION = 'persist:postman_shell',
  MIGRATION_COMPLETE_KEY = 'migrationCompleted';

let migratorWindow;

/**
 *
 */
async function performShellDataMigration () {
  const migrationStartTime = Date.now();

  try {
    if (await isShellMigrationDone()) {
      pm.logger.info('performShellDataMigration: Migration has already been done. Bailing out');
      return;
    }

    pm.logger.info('performShellDataMigration: Starting shell data migration');

    for (let i = 0; i < MIGRATION_TRY_COUNT; i++) {
      try {
        await migrateShellData();

        pm.logger.info(`performShellDataMigration: Migration successful on try count ${i + 1}`);
        sendAnalyticsEvent('shell-migration', 'successful', '', { load_time: Date.now() - migrationStartTime });

        // We break the loop if the migration is successful
        break;
      }
      catch (e) {
        pm.logger.warn(`performShellDataMigration: Migration failed on try count ${i + 1}`, e);

        // If the final retry also failed, then we throw the error
        if (i + 1 === MIGRATION_TRY_COUNT) {
          throw e;
        }
      }
    }
  }
  catch (e) {
    pm.logger.error('performShellDataMigration: Error while performing migration', e);

    sendAnalyticsEvent('shell-migration', 'failed', `${e && e.name}:${e && e.message}`, { load_time: Date.now() - migrationStartTime });

    throw e;
  }
  finally {
    migratorWindow && migratorWindow.close();
  }
}

/**
 *
 */
async function migrateShellData () {
  pm.logger.info('migrateShellData:Starting');

  // Cleanup the storage before starting a new migration
  await cleanupAuthStorage();
  pm.logger.info('migrateShellData: Old storage cleaned up');

  // Before we try to get the data from shell, we wait for the electron app to be ready.
  // This is because we need to create a BrowserWindow to access the shell partition. But
  // if the app is not ready, then creating a BrowserWindow will fail and the migration
  // will error out.
  await app.whenReady();

  const shellData = await getDataFromShell();

  if (!shellData) {
    pm.logger.info('migrateShellData: Got no data from shell. Bailing out');
    return;
  }

  shellData[MIGRATION_COMPLETE_KEY] = true;

  pm.logger.info('migrateShellData: Got data from shell. Writing to storage');

  await authDataInterface.setData(shellData);
}

/**
 *
 */
function getDataFromShell () {
  // Maintain an array of known keys which will be present in the app
  const SHELL_KEYS = new Set(['v8PartitionsNamespaceMeta', 'partitions', 'v8Partitions', 'users']),
    V7_SHELL_KEYS = new Set(['activePartition', 'lastActiveUser', 'isPartitionDirty']);

  return new Promise((resolve, reject) => {
    pm.sdk.IPC.subscribe('shellData', (event, arg = {}) => {
      Object.keys(arg).forEach((key) => {
          try {
            arg[key] = V7_SHELL_KEYS.has(key) ? arg[key] : JSON.parse(arg[key]);
          }
          catch (e) {
            sendAnalyticsEvent('get-data-from-shell', 'failed', `${e && e.name}:${key}:${e && e.message}`);
            return (SHELL_KEYS.has(key) || V7_SHELL_KEYS.has(key)) && reject(e);
          }
      });

      sendAnalyticsEvent('get-data-from-shell', 'successful');
      resolve(arg);
    });

    migratorWindow = new BrowserWindow({
      width: 1000,
      height: 1000,
      show: false,
      webPreferences: {
        nodeIntegration: true,
        partition: SHELL_PARTITION,
        devTools: false,
        contextIsolation: false,
        preload: path.resolve(app.getAppPath(), 'preload/desktop/index.js')
      }
    });

    let srcUrl;

    if (process.env.PM_BUILD_ENV !== 'development') {
      const htmlFolderPath = path.resolve(__dirname, '..', 'html'),
            shellMigrator = path.resolve(htmlFolderPath, 'shell-migrator.html');

      // url.format helps in encoding any not allowed special characters in the path
      // The fix has been added where it was not possible to load the url for case below,
      // if user name contains #, creates # in the path, which is delimiter breaking the url.
      srcUrl = url.format({ protocol: 'file', pathname: shellMigrator });
    }
    else {
      srcUrl = devUrls.SHELL;
    }

    migratorWindow.loadURL(srcUrl);

    migratorWindow.webContents.on('dom-ready', () => {
      migratorWindow.webContents.send('shellMessage', { type: 'getShellData' });
    });
  });
}

/**
 *
 */
async function isShellMigrationDone () {
  return (await authDataInterface.exists()) &&
    (await authDataInterface.getItem(MIGRATION_COMPLETE_KEY) === true);
}

/**
 *
 */
function cleanupAuthStorage () {
  return authDataInterface.clear();
}

module.exports = {
  performShellDataMigration,
  isShellMigrationDone
};
