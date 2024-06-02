const { startParentWatchdog } = require('../../lib/watchdog');
const { setLogLevel, log } = require('../../lib/logging');

const PROCESS_NAME = 'PostmanExecution';

/**
 * Registers the ipc handles for the thread group which will be used to communicate with the main process.
 * This will be called only once during the startup of the thread group. This will register the ipc handles
 * for the invoke method which will be used to invoke the methods of the thread group.
 *
 * The invoke method will be called from the parent process.
 *
 * @param object - The object which will be used to invoke the methods on the thread group
 */
const registerIPCHandles = (object) => {
  pm.sdk.ipc.onReady(() => {
    // We should never register the ipc handles again if they are already registered. Doing that will start
    // causing "n" invocations of the same method since this registration happens via a pub sub channel which is
    // related to the name of invoke handle.
    if (global.ipcHandlesRegistered) {
      log.info('ThreadGroup ~ the ipc handles are already registered');
      return;
    }

    global.ipcHandlesRegistered = true;

    // Register the invoke handle which will be used to invoke the methods on the thread group.
    pm.sdk.ipc.handle('invoke', async (_event, { method, args = [] }) => {
      if (!object[method]) {
        throw Error(`No such method ${method} defined on ${object.name}`);
      }

      return object[method](...args);
    });

    pm.sdk.ipc.handle('ready', (_, { logLevel } = {}) => {
      log.debug('[ready] Setting log level to ', logLevel);

      setLogLevel(logLevel);
    });

    log.info('ThreadGroup ~ the ipc is ready for communication');
  });
};

/**
 * This will be called during the startup of the thread group. This will set the process title and call the onStartup
 * method on the thread group. This will also register the ipc handles for the thread group. The ipc handles will be
 * used to invoke the methods on the thread group.
 *
 * @param {ThreadGroupExecutable} threadGroupExecObject - Thread group object
 */
const startup = (threadGroupExecObject) => {
  process.title = PROCESS_NAME;
  onStartup();
  registerIPCHandles(threadGroupExecObject);
  threadGroupExecObject?.onStartup?.();
};

/**
 * Calls the onStartup method on the thread group.
 */
function onStartup () {
  log.info('ExecutionProcess~entryModule~cwd', process.cwd());

  // Catch all uncaught exceptions and unhandled rejections and exit the process.
  process.on('uncaughtException', (error) => {
    pm.logger.error('ThreadGroup~uncaughtException', error);
    process.exit(1);
  });

  // Catch all uncaught exceptions and unhandled rejections and exit the process.
  process.on('unhandledRejection', (error, promise) => {
    pm.logger.error('ThreadGroup~unhandledRejection', error, promise);
    process.exit(1);
  });

  startParentWatchdog();
}

module.exports = {
  startup
};
