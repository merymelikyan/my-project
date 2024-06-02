const _ = require('lodash'),
  fsPath = require('path'),
  async = require('async'),
  { LOCAL_FILE_SYSTEM_EVENT_IDENTIFIER, FILE_WATCHER_ACTIONS, WATCHER_EVENT_IDENTIFIER } = require('./constants'),
  FileSystemService = require('./FileSystemService'),
  FSIpc = pm.sdk.ipc;

// Initialise the FSInstance when the IPC is ready
FSIpc.onReady(() => {
  pm.logger.info('FileSystemInterface ~ The ipc is ready for communication');

  const FSInstace = new FileSystemInterface();
});

pm.sdk.ipc.onClose(() => {
  pm.logger.info('FileSystemInterface ~ The ipc is closed for now. The ipc server will be restarted and ready event will be emitted soon on success.');
});

pm.logger.info('FileSystemInterface~NodeProcess~entryModule~cwd', process.cwd());

class FileSystemInterface {
  constructor () {
    if (FileSystemInterface.instance) {
      return FileSystemInterface.instance;
    }

    this.watcherDirectory = {};
    this.startEventsListener(); // Start the event listener
    FileSystemInterface.instance = this;
  }

  /**
   * Function to start listening for local file system operation events from the renderer interface
   * for the local file system service
   */
  startEventsListener () {
    FSIpc.handle(LOCAL_FILE_SYSTEM_EVENT_IDENTIFIER, async (event, arg) => {
      if (_.isFunction(this[_.get(arg, ['action'])])) {
        const result = await _.invoke(this, arg.action, arg.data);
        return result;
      }

      return {
        error: 'invalidActionError',
        details: 'This action is not supported'
      };
    });
  }

  /**
   * Checks if the given file system path exists or not
   * @param {Object} fileMeta - Object containing the file data
   * @param {String} fileMeta.path - File system path to check the existence
   *
   * @returns {Promise} - Indicates if the file system path exists or not
   */
  checkIfPathExists ({ path }) {
    if (!path) {
      return Promise.resolve({
        error: 'pathMissingError',
        details: 'File path is required to perform this operation'
      });
    }

    return FileSystemService.checkIfPathExists({ path });
  }

  /**
   * Create a file in the given file path
   *
   * @param {Object} fileMeta - Object containing the file data
   * @param {String} fileMeta.path - File system path
   * @param {String} fileMeta.content - The file content to create the file with
   *
   * @returns {Promise} - Indicates if the file was created or not
   */
   createFile ({ path, content }) {
    if (!path) {
      return Promise.resolve({
        error: 'pathMissingError',
        details: 'File path is required to perform this operation'
      });
    }

    return FileSystemService.createFile({ path, content });
  }

  /**
   * Fetches the contents of the file from the given file path
   *
   * @param {Object} fileMeta - Object containing the file data
   * @param {String} fileMeta.path - Path of the file to fetch the contents
   *
   * @returns {Promise} - With the string file content
   */
  getFileData ({ path }) {
    return new Promise((resolve) => {
      if (!path) {
        return resolve({
          error: 'pathMissingError',
          details: 'File path is required to perform this operation'
        });
      }

      FileSystemService.getFileData({ path })
        .then(resolve)
        .catch(resolve);
    });
  }

  /**
   * Fetches the contents of the directory from the given file system path
   *
   * @param {Object} fileMeta - Object containing the file data
   * @param {String} fileMeta.path - Path of the directory to fetch the contents
   * @param {Boolean} fileMeta.recursive - The flag indicating recursive nature of fetching the contents
   *
   * @returns {Promise} - With the array of file names
   */
   getDirectoryContents ({ path, recursive }) {
    return new Promise((resolve) => {
      if (!path) {
        return resolve({
          error: 'pathMissingError',
          details: 'File path is required to perform this operation'
        });
      }

      FileSystemService.getDirectoryContents({ path, recursive })
        .then(resolve)
        .catch(resolve);
    });
  }

  /**
   * Writes the given contents to the provided file path
   *
   * @param {Object} fileMeta - Object containing the file data
   * @param {String} fileMeta.path - Path of the file to write the contents
   * @param {String} fileMeta.content - Content of the file to be written
   *
   * @returns {Promise} - With the result of the write action (success / failure)
   */
  writeFile ({ path, content }) {
    if (!path) {
      return Promise.resolve({
        error: 'pathMissingError',
        details: 'File path is required to perform this operation'
      });
    }

    if (!_.isString(content)) {
      return Promise.resolve({
        error: 'invalidContentError',
        details: 'File content is required to in string format perform this operation'
      });
    }

    return FileSystemService.writeFile({
      path,
      content
    });
  }

  /**
   * Deletes a file in the given file path
   *
   * @param {Object} fileMeta - Object containing the file data
   * @param {String} fileMeta.path - File system path to delete the file
   *
   * @returns {Promise} - Indicates if the file was deleted or not
   */
   deleteFile ({ path }) {
    if (!path) {
      return Promise.resolve({
        error: 'pathMissingError',
        details: 'File path is required to perform this operation'
      });
    }

    return FileSystemService.deleteFile({ path });
  }

  /**
   * Watches the given path for file system events and adds an entry to the watcher directory to keep
   * the track of all of the watched paths
   *
   * @param {Object} Options - Object containing the path to watch and the paths to include in the events
   * @param {String} Options.path - Path to start watching
   * @param {Array} [Options.pathsToInclude] - Array of absolute file paths to filter the events
   * so that only events matching to these paths will be sent
   *
   * @returns {Promise} - With the result of the watch action (success / failure) along with the watched path
   */
  watchPath ({ path, pathsToInclude }) {
    if (!path) {
      return Promise.resolve({
        error: 'pathMissingError',
        details: 'File path is required to perform this operation'
      });
    }

    // Watcher already exists for the file path
    if (this.watcherDirectory[path]) {
      return Promise.resolve({
        action: 'watchPath',
        path: path,
        success: true
      });
    }

    return new Promise((resolve) => {
      FileSystemService.watchPath({ path }, this.processWatcherEvent.bind({ path, pathsToInclude }))
        .then((watcher) => {
          this.watcherDirectory[path] = watcher;
          resolve({
            action: 'watchPath',
            path: path,
            success: true
          });
        })
        .catch((err) => {
          resolve(err);
        });
    });
  }

  /**
   * Utility function which processes the watcher events by filtering the events based on the pathsToInclude array.
   * Only events matching to the paths given in pathsToInclude array will be sent back to the renderer process
   *
   * @param {Array} events - An array of objects containing the details of the file system events
   */
  processWatcherEvent (events) {
    let eventsToSend = [];

    async.eachSeries(events, (event, cb) => {
      event.action = FILE_WATCHER_ACTIONS[event.action];

      try {
        // Handle if file was renamed or moved
        if (event.newDirectory && event.newFile) {
          event.oldPath = fsPath.resolve(event.directory, event.oldFile);
          event.newPath = fsPath.resolve(event.newDirectory, event.newFile);
          event.file = event.oldFile;
        }

        if (_.isArray(this.pathsToInclude)) {
          // Check if the event falls inside the interested paths
          const trackedPath = _.find(this.pathsToInclude, (pathToInclude) => {
            return _.startsWith(fsPath.resolve(event.directory, event.file), pathToInclude);
          });

          if (trackedPath) {
            eventsToSend.push(event);
          }
        }
        else {
          eventsToSend.push(event);
        }
      }
      catch (e) {
        pm.logger.error('FSNodeProcess ~ processWatcherEvent: Something went wrong while processing watcher event', event, e);
      }
      finally {
        return cb();
      }
    }, () => {
      FSIpc.broadcast(WATCHER_EVENT_IDENTIFIER, {
        path: this.path,
        events: eventsToSend
      });
    });
  }

  /**
   * Warning: Not to be consumed directly as this will close the watcher to which multiple
   * consumers may be subscribed from the renderer process
   *
   * Stops the file watched using the watcher.stop() action to close the file watcher
   *
   * @param {Object} fileMeta - Object containing the file data
   * @param {String} fileMeta.path - Path of an already watched file
   *
   * @returns {Promise} - With the result of the close watcher action (success / failure)
   */
  closeWatcher ({ path }) {
    return new Promise((resolve) => {
      if (!path) {
        resolve({
          error: 'pathMissingError',
          details: 'File path is required to perform this operation'
        });
      }

      if (!this.watcherDirectory[path]) {
        resolve({
          error: 'pathNotWatchedError',
          details: 'The path is not being watched currently'
        });
      }

      this.watcherDirectory[path].stop();
      delete this.watcherDirectory[path];

      resolve({
        action: 'closeWatcher',
        path: path,
        success: true
      });
    });
  }
}
