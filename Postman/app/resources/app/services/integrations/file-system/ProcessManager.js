const path = require('path'),
  modulePath = path.resolve(__dirname, './index.js'),
  { FS_NODE_PROCESS } = require('./constants');

/**
 * Class which spawns a new node process for the FileSystemInterface
 */
class ProcessManager {
  constructor () {
    this.fileSystemProcess = null;
  }

  /**
   * Spawns a new node process for the File system interface
   */
  startFileSystemProcess () {
    pm.logger.info('apiGitDebugLog - ProcessManager~startFileSystemProcess: Starting node process');
    if (this.fileSystemProcess) {
      return;
    }

    /**
     * The process can be started in the debug mode by providing a third parameter to the spawn function
     * eg. pm.sdk.NodeProcess.spawn(modulePath, FS_NODE_PROCESS)
     */
    this.fileSystemProcess = pm.sdk.NodeProcess.spawn(modulePath, FS_NODE_PROCESS);

    this.fileSystemProcess.onReady(() => {
      pm.logger.info('apiGitDebugLog - ProcessManager~startFileSystemProcess: Node process ready');
    });

    this.fileSystemProcess.onExit((code, signal) => {
      // Process terminated with error.
      if (code !== 0) {
        pm.logger.info(`apiGitDebugLog - ProcessManager~startFileSystemProcess: subprocess exited with code: ${code}`);
        if (signal) {
          pm.logger.info(`in response to signal ${signal}`);
        }
      }
    });
  }

  /**
   * Kills the spawned node process
   *
   * @returns {Boolean} - Result of the operation
   */
  killFileSystemProcess () {
    try {
      if (this.fileSystemProcess) {
        !this.fileSystemProcess.isKilled() && this.fileSystemProcess.kill();

        while (!this.fileSystemProcess.isKilled()) {}
        this.fileSystemProcess = null;
      }

      pm.logger.info('apiGitDebugLog - ProcessManager~killFileSystemProcess: Killed File System node process');
      return true;
    } catch (e) {
      pm.logger.error('apiGitDebugLog - ProcessManager~killFileSystemProcess: Could not kill File System node process', e);
      return false;
    }
  }
}

module.exports = ProcessManager;
