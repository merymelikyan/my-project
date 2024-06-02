const { powerSaveBlocker } = require('electron');
const { constants } = require('os');
const { join } = require('path');
const { SUB_SYSTEM_REQUESTS } = require('./ScenarioManager/constants');
const { startSubProcess, detachIpcNode } = require('./sub-process-functions');
const { isProcessAlive } = require('@postman/app-plugins-host/lib/helpers/process');
const getSystemProxy = require('../../utils/getSystemProxy');

class ExecutionProcessLauncher {
  subProcess = null;
  _initializing = false;
  _initialized = false;
  _powerSaveBlockerId = null;
  _powerSaveBlockerTimeout = null;

  constructor () {
    if (ExecutionProcessLauncher.instance) {
        return ExecutionProcessLauncher.instance;
    }

    ExecutionProcessLauncher.instance = this;
  }

  /**
   * Starts the sub process for performance testing execution.
   * If the sub process is already started, it does nothing.
   *
   * @returns {Promise<void>}
   */
  async init ({ type = 'performance', options = {} }) {
    let target;

    // We could be supporting multiple types of execution systems that have different needs.
    // For each of them, we should be able to specify the required sub-systems to compose
    // the whole execution system.
    if (type === 'performance') {
      target = 'ExecutionProcess.js';
    }
    else {
      throw new Error(`Unknown system type requested: ${type}`);
    }

    if (this.subProcess && !this.isAlive()) {
      this.subProcess = null;
      this._initializing = false;
    }

    if (!this.subProcess && !this._initializing) {
      // Setting priority to NORMAL such that it gets more CPU cycles than workers and IPC remains responsive for querying
      // and ingestion of data.
      let processPriority = constants.priority.PRIORITY_NORMAL;

      this._initializing = true;

      this.subProcess = await startSubProcess({
        id: 'execution',
        path: join(__dirname, target),
        priority: processPriority,
        inspect: !!options.inspect,
      });

      pm.logger.info('[ExecutionProcessLauncher] Spawned the execution process, pid: ', this.subProcess.process.pid);

      await this.subProcess.ipcNode.invoke('ready', options);

      pm.logger.info('[ExecutionProcessLauncher] Execution process is ready');

      this.disposeSystemRequestSubscription = this.subProcess.ipcNode.subscribe('system-request', (request) => {
        this.processSystemRequest(request);
      });

      // Consume the bytes on stdout and stderr of the child processes
      // so that their buffers are flushed
      this.subProcess.process._spawnedProcess.stdout.on('data', (data) => {
        // console.log(`Received stdout from child of length : ${data.length}`);
      });

      this.subProcess.process._spawnedProcess.stderr.on('data', (data) => {
        pm.logger.error('Received stderr from Execution System', data.toString());
      });

      this.subProcess.process._spawnedProcess.on('close', (code) => {
        pm.logger.info(`child process exited with code ${code}`);
      });

      this._initializing = false;
      this._initialized = true;
    }
  }

  /**
   * This function serves the specific actions requested by child process which the child process itself is unable to
   * perform due to various reasons. In such cases, Child Process's system module broadcasts events on a specific channel
   * which are handled here.
   *
   * An example of such action could be an Electron API, which is not possible to be called by child process.
   *
   * @param {string} action - Identifies the action to be performed.
   * @param {object} [data=undefined] - Data required to perform the action.
   */
  processSystemRequest = async ({ action, data }) => {
    if (action === SUB_SYSTEM_REQUESTS.ACTION.ALLOW_SLEEP) {
      this.allowPowerSaver();
    }
    else if (action === SUB_SYSTEM_REQUESTS.ACTION.PREVENT_SLEEP) {
      if (!data?.maxDuration) {
        throw new Error('ExecutionProcessLauncher ~ processSystemRequest: Missing required data for action: preventPowerSaver');
      }

      const { maxDuration } = data;

      this.preventPowerSaver(maxDuration);
    }
    else if (action === SUB_SYSTEM_REQUESTS.REQUEST.GET_SYSTEM_PROXY) {
      const proxyConfig = await new Promise((resolve) => {
        getSystemProxy(data.url, (err, proxyConfig) => {
          resolve(proxyConfig);
        });
      });

      this.subProcess.ipcNode.send(data.responseChannels.data, [JSON.stringify(proxyConfig)]);
    }
  }

  isAlive () {
    return this.subProcess?.process && isProcessAlive(this.subProcess.process.pid);
  }

  onExit () {
    try {
      this.subProcess.ipcNode.invoke('exit')
        .catch(() => {
          this.subProcess?.kill?.('SIGKILL');
        });

      this.disposeSystemRequestSubscription?.();
      this.allowPowerSaver();
      this.subProcess.ipcNode.removeAllListeners();

      detachIpcNode(this.subProcess.ipcNode);
    }
    catch (error) {
      pm.logger.error('Error in onExit of execution process launcher', error);
    }
  }

  /**
   * Allows the system to go to sleep by clearing the power-save-blocker set via `preventPowerSaver`.
   */
  allowPowerSaver = () => {
    // Since the ID is a number starting 0, we can't use `!this._powerSaveBlockerId` to check if the blocker is active.
    // We need to check if the ID is finite and if the blocker is active.
    // See https://www.electronjs.org/docs/latest/api/power-save-blocker for more details about the API.
    if (!Number.isFinite(this._powerSaveBlockerId) || !powerSaveBlocker.isStarted(this._powerSaveBlockerId)) {
      pm.logger.info('ExecutionProcessLauncher ~ No actively running power-save-blocker');
      return;
    }

    powerSaveBlocker.stop(this._powerSaveBlockerId);

    pm.logger.info('ExecutionProcessLauncher ~ allowPowerSaver ~ id', this._powerSaveBlockerId);

    clearTimeout(this._powerSaveBlockerTimeout);

    this._powerSaveBlockerId = null;
  }

  /**
   * Prevents the system from going to sleep for the specified duration.
   *
   * It uses Electron's power-save-blocker API to achieve this. The blocker is cleared after the specified duration to
   * allow the system to go to sleep even if the caller forgets to clear it.
   *
   * `prevent-display-sleep` is used as the type of power-save-blocker as it is the most restrictive one.
   *
   * @param {Number} maxDuration - The maximum duration for which the system should not go to sleep.
   */
  preventPowerSaver = (maxDuration) => {
    if (this._powerSaveBlockerId) {
      pm.logger.info('ExecutionProcessLauncher ~ preventPowerSaver: Blocker is already active. Deactivating old lock on power-saver');
      this.allowPowerSaver();
    }

    this._powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep');

    if (this._powerSaveBlockerTimeout) {
      pm.logger.info('ExecutionProcessLauncher ~ preventPowerSaver: Clearing old timer');
      clearTimeout(this._powerSaveBlockerTimeout);
    }

    this._powerSaveBlockerTimeout = setTimeout(() => {
      this.allowPowerSaver();
    }, maxDuration);

    pm.logger.info(`ExecutionProcessLauncher ~ preventPowerSaver: Max Duration ${maxDuration}`);
  }
}

module.exports = ExecutionProcessLauncher;
