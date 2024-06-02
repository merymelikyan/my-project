const EventEmitter = require('events');
const {
  clearListeners,
  broadcastError,
} = require('../communication');
const invoke = require('./invoke');
const { log } = require('../logging');
const { startParentWatchdog } = require('../watchdog');

const EXECUTION_PROCESS_NAME = 'PostmanExecution';

const callbacks = {
  onStartup: new Set([]),
  onExit: new Set([]),
  onIPCConnection: new Set([]),
  onIPCDisconnection: new Set([])
};

// This is a global object that is used to store all the lifecycle callbacks. This will be registered by system.js
// inside the global scope.
const globals = {
  lifecycle: callbacks
};

/**
 * Executes all onStartup lifecycle callbacks
 */
const startup = async () => {
  for (const callback of callbacks.onStartup) {
    await callback();
    callbacks.onStartup.delete(callback);
  }
};

/**
 * Executes all onExit lifecycle callbacks
 */
const exit = async () => {
  for (const callback of callbacks.onExit) {
    try {
      await callback();
      callbacks.onExit.delete(callback);
    } catch (err) {
      log.error('ExecutionSystem:LifeCycle ~ error while executing onExit callback', err);
    }
  }

  process.exit(0);
};

/**
 * Adds a onStartup lifecycle callback
 * @param callback
 */
function onStartup (callback) {
  if (callback && typeof callback !== 'function') {
    log.warn('ExecutionSystem:LifeCycle ~ onStartup callback is not a function', callback);
    return;
  }

  callbacks.onStartup.add(callback);
}

/**
 * Adds a onExit lifecycle callback
 * @param callback
 */
function onExit (callback) {
  if (callback && typeof callback !== 'function') {
    log.warn('ExecutionSystem:LifeCycle ~ onExit callback is not a function', callback);
    return;
  }

  callbacks.onExit.add(callback);
}

/**
 * To be called when the IPC connection is established
 * @private
 * @returns {Promise<void>}
 */
const _handleIPCConnection = async () => {
  for (const callback of callbacks.onIPCConnection) {
    pm.logger.info('Invoking onIPCConnection callback', callback.name);

    await callback();

    callbacks.onIPCConnection.delete(callback);
  }
};

/**
 * To be called when the IPC connection is lost
 * @returns {Promise<void>}
 * @private
 */
const _handleIPCDisconnection = async () => {
  for (const callback of callbacks.onIPCDisconnection) {
    await callback();
    callbacks.onIPCDisconnection.delete(callback);
  }
};

/**
 * Attaches all lifecycle hooks on an object
 * @param object - The object that is a sub-system that has lifecycle hooks
 */
function registerHooks (object) {
  for (const stageHook of Object.keys(globals.lifecycle)) {
    if (typeof object?.[stageHook] === 'function') {
      globals.lifecycle[stageHook].add(object[stageHook]);
    }
  }
}

/**
 * Registers all process listeners
 */
function registerProcessListeners () {
  process.on('unhandledRejection', (reason, p) => {
    // Log to console as well for the cases where the logger is not initialized yet
    // eslint-disable-next-line no-console
    console.error('Unhandled Rejection at:', p, 'reason:', reason);
    pm.logger.error('ExecutionSystem ~ Unhandled Rejection', 'reason:' + reason.message, reason.stack);
  });

  process.on('SIGABRT', () => {
    pm.logger.error('ExecutionSystem:LifeCycle~SIGABRT');
  });

  process.on('SIGINT', () => {
    pm.logger.error('ExecutionSystem:LifeCycle~SIGINT');
  });

  process.on('SIGTERM', () => {
    pm.logger.error('ExecutionSystem:LifeCycle~SIGTERM', 'Received SIGTERM. Exiting.');

    // TODO: Kill all child processes before exiting
    process.exit(143);
  });

  process.on('SIGKILL', () => {
    pm.logger.error('ExecutionSystem:LifeCycle~SIGKILL');
  });

  process.on('SIGALRM', () => {
    pm.logger.error('ExecutionSystem:LifeCycle~SIGALRM');
  });

  process.on('SIGBREAK', () => {
    pm.logger.error('ExecutionSystem:LifeCycle~SIGBREAK');
  });

  process.on('SIGUSR1', () => {
    pm.logger.error('ExecutionSystem:LifeCycle~SIGUSR1');
  });

  process.on('SIGUSR2', () => {
    pm.logger.error('ExecutionSystem:LifeCycle~SIGUSR2');
  });

  process.on('SIGQUIT', () => {
    pm.logger.error('ExecutionSystem:LifeCycle~SIGQUIT');
  });

  process.on('SIGTRAP', () => {
    pm.logger.error('ExecutionSystem:LifeCycle~SIGTRAP');
  });

  process.on('uncaughtException', (err) => {
    // Log to console as well for the cases where the logger is not initialized yet
    // eslint-disable-next-line no-console
    console.error('Uncaught Exception thrown', err);
    pm.logger.error('Uncaught Exception thrown', err.message, err.stack);
  });
}

const onIPCConnection = (callback) => {
  callbacks.onIPCConnection.add(callback);
};

const onIPCDisconnection = (callback) => {
  callbacks.onIPCDisconnection.add(callback);
};

/**
 * Returns the configuration options passed to the execution process
 * @returns {*}
 */
function getConfigurationOptions () {
  return globals.lifecycle.options;
}

/**
 * Registers all IPC handles
 * @returns {Promise<void>}
 */
function registerIPCHandles () {
  if (global.SUBSYSTEM_REGISTER.ipcHandlesRegistered) {
    pm.logger.info('ExecutionSystem:LifeCycle ~ IPC handles already registered');
    return;
  }

  global.SUBSYSTEM_REGISTER.ipcHandlesRegistered = true;

  pm.logger.info('ExecutionSystem:LifeCycle ~ Registering IPC handles');

  pm.sdk.ipc.handleOnce('exit', async () => {
    pm.logger.info('ExecutionSystem:LifeCycle ~ exit');
    await exit();
  });

  // Called by main once the app boots up and the IPC is ready for communication.
  // This handle is called only once to set up the initial steps as soon as the execution process is spawned by main.
  pm.sdk.ipc.handleOnce('ready', async (_, options) => {
    globals.lifecycle.options = options;

    try {
      await startup();
    } catch (err) {
      broadcastError({
        error: err,
        message: 'Error in starting up the ExecutionSystem',
        source: 'ExecutionSystem:LifeCycle',
        subsystem: 'system.startup'
      });
    }

    // Set the ready flag to true such that we can check in the rest of the subsystems if the execution process is ready.
    // In the ready state, all the subsystems are initialized and ready to communicate.
    globals.isReady = true;

    pm.logger.info('ExecutionSystem:LifeCycle ~ ready', options);
  });

  // Register handlers for all the subsystems which are defined in singletons and factories.
  for (const subsystemId of [
    ...Object.keys(global.SUBSYSTEM_REGISTER.factories),
    ...Object.keys(global.SUBSYSTEM_REGISTER.singletons)
  ]) {
    pm.sdk.ipc.handle(subsystemId, (_, { action, args, method }) => {
      return invoke(subsystemId, { action, args, method }, false);
    });
  }
}

/**
 * Create an event bus if it doesn't exist.
 *
 * @returns {void}
 */
function init () {
  try {
    if (global.SUBSYSTEM_REGISTER.isInitialized) {
      return;
    }

    // Set the process title, works on UNIX only
    process.title = EXECUTION_PROCESS_NAME;

    pm.logger.info('ExecutionSystem:LifeCycle~system.lifecycle.init~cwd', process.cwd());

    // Start a watchdog to kill all child processes if the parent dies
    startParentWatchdog(async () => {
      pm.logger.info('ExecutionSystem:LifeCycle~Parent died. Killing process.');

      try {
        // Initiate a graceful shutdown
        log.debug('ExecutionSystem:LifeCycle~Graceful shutdown initiated.');
        await exit();
        log.debug('ExecutionSystem:LifeCycle~Graceful shutdown complete.');
      }
      finally {
        // 9 => SIGKILL
        process.exit(9);
      }
    });

    if (!global.eventBus) {
      log.debug('ExecutionSystem:LifeCycle~Creating event bus');
      global.eventBus = new EventEmitter();
    }

    pm.sdk.ipc.onReady(() => {
      log.debug('ExecutionSystem:LifeCycle~IPC is ready.');
      registerIPCHandles();
      _handleIPCConnection();
    });

    pm.sdk.ipc.onClose(() => {
      pm.logger.info('ExecutionSystem:LifeCycle~IPC is closed.');

      _handleIPCDisconnection();
      clearListeners();
    });

    global.SUBSYSTEM_REGISTER.isInitialized = true;

    registerProcessListeners();
  }
  catch (err) {
    pm.logger.error('Something unexpected happened while boot.', err);

    // TODO: Once we implemented, health checking system within the execution system, we should check if we
    // can recover from this error and if not, we should exit with a non-zero exit code.

    // process.exit(1);
  }
}

module.exports = {
  global: globals,
  exports: {
    // Manual hooks
    exit,

    // Lifecycle callback registration
    onStartup,
    onExit,
    onIPCConnection,
    onIPCDisconnection,
    getConfigurationOptions,
  },
  registerHooks,
  init
};
