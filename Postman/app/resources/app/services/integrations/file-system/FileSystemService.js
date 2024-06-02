const async = require('async'),
  fs = require('fs'),
  path = require('path'),
  _ = require('lodash'),
  { ENCODING, WRITE_STREAM_EVENTS, DIRECTORY_CHILDREN } = require('./constants'),

  /**
   * Utility function to traverse the given file system path and return the child files and directories
   *
   * @param {String} pathToTraverse - The path of the directory to read the contents
   * @param {Boolean} cb - The callback function
   *
   * @returns {Array} - The array of directory child objects containing directories only
   */
   traverseDirectory = function (pathToTraverse, cb) {
    fs.readdir(pathToTraverse, (err, directoryChildren) => {
      if (err) {
        return cb({
          error: 'traverseDirectoryError'
        });
      }

      directoryChildren = _.map(directoryChildren, (directoryChild) => {
        let absolutePath = path.resolve(pathToTraverse, directoryChild),
          childObj = {
            name: directoryChild,
            path: absolutePath,
            type: DIRECTORY_CHILDREN.FILE
          };

        if (fs.statSync(absolutePath).isDirectory()) {
          childObj.type = DIRECTORY_CHILDREN.DIRECTORY;
        }

        return childObj;
      });

      return cb(null, directoryChildren);
    });
  },

  /**
   * Utility function to get the directory children of a file system path
   *
   * @param {String} directoryPath - The path of the directory to get the contents
   * @param {Boolean} isRecursive - Flag indicating recursive nature of the operation
   * @param {Function} callback
   *
   * @returns {Array} - The children of the given path
   */
  getDirectoryChildren = function (directoryPath, isRecursive, callback) {
    let directoryContents = [],
    pathsToTraverse = [directoryPath];

    // Traverse the directories to fetch the contents
    async.doUntil(
      (next) => {
        traverseDirectory(pathsToTraverse.pop(), (err, traversedContents) => {
          if (err) {
            return next(err);
          }

          // If the directory contents are to be fetched recursively
          // Append the new directories received from the traverse call to the pathsToTraverse array
          (isRecursive) && _.each(traversedContents, (directoryChild) => {
            if (directoryChild.type === DIRECTORY_CHILDREN.DIRECTORY) {
              pathsToTraverse.push(directoryChild.path);
            }
          });

          directoryContents = _.concat(directoryContents, traversedContents);
          return next();
        });
      },

      () => {
        // Function to check if there is any directory that is yet to be traversed.
        // This will return true when the pathsToTraverse array becomes empty meaning that there are no directories yet to be traversed.
        return _.isEmpty(pathsToTraverse);
      },

      (err) => {
        return callback(err, directoryContents);
      }
    );
  },

  /**
    * Utility function to write the contents to the given file path
    *
    * @param {String} path - The absolute path of the file to write the content
    * @param {String} content - The content of the file
    * @param {Function} callback - The callback to invoke on success/failure
    */
  _writeToFile = (path, content, callback) => {
      let writeStream = fs.createWriteStream(path, { encoding: ENCODING });

      // Check if it is safe to write to the write stream
      if (writeStream.writable) {
        // Begin writing to the stream
        writeStream.write(content, (err) => {
          if (err) {
            return callback({
              error: 'writeFileError',
              details: err
            });
          }

          // Close the stream after writing is done
          writeStream.end();
        });
      } else {
        writeStream.on(WRITE_STREAM_EVENTS.DRAINED, () => {
          writeStream.write(content, (err) => {
            if (err) {
              return callback({
                error: 'writeFileError',
                details: err
              });
            }

            // Close the stream after writing is done
            writeStream.end();
          });
        });
      }

      // Resolve the promise once the writing is done and the stream is closed
      writeStream.on(WRITE_STREAM_EVENTS.FINISHED, () => {
        return callback({
          action: 'writeFile',
          success: true
        });
      });
  },

  /**
    * Utility function to write the contents to the given file path
    *
    * @param {String} path - The absolute path of the file to be created
    * @param {String} content - The content of the file
    * @param {Function} callback - The callback to invoke on success/failure
    */
  _createFile = (path, content, callback) => {
      fs.writeFile(path, content, (err) => {
        if (err) {
          return callback({
            error: 'createFileError',
            details: err
          });
        }

        return callback({
          action: 'createFile',
          success: true
        });
      });
  },

    /**
     * Utility function which can be used to check the existence of given file system path
     *
     * @param {Object} fileMeta - Object containing the file path to get the contents
     * @param {String} fileMeta.path - The file system path to check the existence
     *
     * @returns {Promise}
     */
    checkIfPathExists = ({ path }) => {
      return new Promise((resolve) => {
        if (fs.existsSync(path)) {
          return resolve({
            action: 'checkIfPathExists',
            success: true
          });
        }

        return resolve({
          error: 'fileSystemPathNotFoundError',
          message: 'The given path does not exists'
        });
      });
    },
  self = module.exports = {
    checkIfPathExists,

    /**
     * Function which can be used to create a file in the given file path.
     * If the path does not exist , the directories would be added.
     *
     * @param {Object} fileMeta - Object containing the file path
     * @param {String} fileMeta.path - The file system path to create the file
     * @param {String} fileMeta.content - The file content to create the file with
     *
     * @returns {Promise}
     */
    createFile: ({ path: filePath, content = '' }) => {
      return new Promise((resolve) => {
        checkIfPathExists({ path: filePath }).then((response) => {
          if (response.success) {
            // Reject the create file call if the file already exists at the given path
            return resolve({
              error: 'createFileError',
              details: {
                errno: -100, // Setting a custom errno to keep format consistent with other error objects
                code: 'FILEEXISTS',
                syscall: 'write',
                path: filePath
              }
            });
          }

          const folderPath = path.dirname(filePath);
          fs.mkdir(folderPath, { recursive: true }, (err) => {
            if (err) {
              pm.logger.error('apiGitDebugLog - FileSystemService~createFile: Error encountered while creating file ', filePath, err);
              return resolve({
                error: 'createFileError',
                details: err
              });
            }
            _createFile(filePath, content, (res) => {
              resolve(res);
            });
          });
        });
      });
    },

    /**
     * Function to get the contents of the file path
     *
     * @param {Object} fileMeta - Object containing the file path to get the contents
     * @param {String} fileMeta.path - The path of the file to fetch the contents
     *
     * @returns {Promise} - Promise containing the content of the file
     */
    getFileData: ({ path }) => {
      return new Promise((resolve) => {
        fs.readFile(path, 'utf8', (err, data) => {
          if (err) {
            pm.logger.error('apiGitDebugLog - FileSystemService~getFileData: Error encountered while getting file data ', path, err);
            return resolve({
              error: 'getFileDataError',
              details: err
            });
          }

          return resolve({
            data
          });
        });
      });
    },

    /**
     * Function to get the contents of the file system path
     *
     * @param {Object} fileMeta - Object containing the file system path to get the contents
     * @param {String} fileMeta.path - The path of the directory to fetch the contents
     * @param {Boolean} fileMeta.recursive - The flag indicating recursive nature of fetching the contents
     *
     * @returns {Promise} - Promise containing the content of the file system path
     */
    getDirectoryContents: ({ path, recursive }) => {
      return new Promise((resolve) => {

        // Check if the file system path is not a directory
        if (!fs.statSync(path).isDirectory()) {

          // Resolve the promise with an empty object
          return resolve({});
        }

        let directoryContents = {};

        getDirectoryChildren(path, recursive, (err, files) => {
          if (err) {
            pm.logger.error('apiGitDebugLog - FileSystemService~getDirectoryContents: Error encountered while getting directory children ', path, recursive, err);
            return resolve({
              error: 'getDirectoryContentsError',
              message: 'Something went wrong while reading the directory contents',
              details: err
            });
          }

          async.each(files, (file, cb) => {
            let { name, path, type } = file;
            directoryContents[name] = file;

            // No need to fetch the directory contents if the file is a directory
            if (type === DIRECTORY_CHILDREN.DIRECTORY) {
              return cb();
            }

            self.getFileData({ path })
              .then(({ data }) => {
                directoryContents[name].contents = data;
              })
              .catch((err) => {
                pm.logger.error('apiGitDebugLog - FileSystemService~getDirectoryContents: Error encountered while getting file data ', path, recursive, err);
                directoryContents[name].error = true;
                directoryContents[name].message = 'Something went wrong while reading the file';
                directoryContents[name].details = err;
              })
              .finally(() => {
                return cb();
              });
          }, () => {
            return resolve(directoryContents);
          });
        });
      });
    },

    /**
     * Function to write the contents to the given file path
     *
     * @param {Object} fileMeta - Object containing the file path
     * @param {String} fileMeta.path - The path of the file to write the content
     * @param {String} fileMeta.content - The content of the file
     *
     * @returns {Promise}
     */
    writeFile: ({ path: filePath, content }) => {
      const folderPath = path.dirname(filePath);

      return new Promise((resolve) => {
        fs.mkdir(folderPath, { recursive: true }, (err) => {
          if (err) {
            pm.logger.error('apiGitDebugLog - FileSystemService~writeFile: Error encountered while writing to file  ', filePath, err);
            return resolve({
              error: 'writeFileError',
              details: err
            });
          }
          _writeToFile(filePath, content, (res) => {
            resolve(res);
          });
        });
      });
    },

    /**
     * Utility function which can be used to delete a file in the given file path
     *
     * @param {Object} fileMeta - Object containing the file path
     * @param {String} fileMeta.path - The file system path to delete the file
     *
     * @returns {Promise}
     */
    deleteFile: ({ path }) => {
      return new Promise((resolve) => {
        fs.unlink(path, (err) => {
          if (err) {
            pm.logger.error('apiGitDebugLog - FileSystemService~deleteFile: Error encountered while deleting file  ', path, err);
            return resolve({
              error: 'deleteFileError',
              details: err
            });
          }

          return resolve({
            action: 'deleteFile',
            success: true
          });
        });
      });
    },

    /**
     * Function to watch a file system path for the file system events
     *
     * @param {Object} metadata - Object containing the file system path to begin watching
     * @param {Function} watcherEventHandler - An utility function which is invoked every time the watcher detects a file system event
     *
     * @returns {Promise}
     */
    watchPath: ({ path: filePath }, watcherEventHandler) => {
      return Promise.resolve();
    }
  };
