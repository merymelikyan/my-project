const fs = require('fs'),
  path = require('path'),
  Readable = require('stream').Readable,
  util = require('util'),

  _ = require('lodash'),

  pathIsInside = require('./pathIsInside'),
  { isBrowser } = require('./processUtils'),

  PPERM_ERR = 'PPERM: insecure file access outside working directory',
  FUNCTION = 'function',
  DEPRECATED_SYNC_WRITE_STREAM = 'SyncWriteStream',
  EXPERIMENTAL_PROMISE = 'promises',
  REMOTE_FILE_PREFIX = 'postman-cloud:///',
  remoteFilePathMap = new Map(),

  // Use simple character check instead of regex to prevent regex attack
  /**
   * Windows root directory can be of the following from
   *
   * | File System | Actual           | Modified          |
   * |-------------|------------------|-------------------|
   * | LFS (Local) | C:\Program       | /C:/Program       |
   * | UNC         | \\Server\Program | ///Server/Program |
   */
  isWindowsRoot = function (path) {
    const drive = path.charAt(1);

    return ((path.charAt(0) === '/') &&
      ((drive >= 'A' && drive <= 'Z') || (drive >= 'a' && drive <= 'z')) &&
      (path.charAt(2) === ':')) ||
      path.slice(0, 3) === '///'; // Modified UNC path
  };

/**
 * Postman file resolver wrapper over fs
 *
 * @param {String} workingDir
 * @param {Boolean=false} insecureFileRead
 * @param {String[]} fileWhitelist
 * @param {Boolean=true} allowRemoteFile
 */
function PostmanFs (workingDir, insecureFileRead = false, fileWhitelist = [], allowRemoteFile = true) {
    this._fs = fs;
    this._path = path;
    this.constants = this._fs.constants;

    this.workingDir = workingDir;
    this.insecureFileRead = insecureFileRead;
    this.fileWhitelist = fileWhitelist;
    this.allowRemoteFile = allowRemoteFile;

    this.isWindows = !isBrowser() && global.process.platform === 'win32';
}

/**
 * Private method to resole the path based based on working directory
 *
 * @param {String} relOrAbsPath - Relative or absolute path to resolve
 * @param {Boolean} insecureFileRead - Resolve path outside of working directory
 * @param {String[]} whiteList - A list of absolute path to whitelist
 *
 * @returns {String} The resolved path
 */
PostmanFs.prototype._resolve = function (relOrAbsPath, insecureFileRead, whiteList = []) {
  // Special handling for windows absolute paths to work cross platform
  this.isWindows && isWindowsRoot(relOrAbsPath) && (relOrAbsPath = relOrAbsPath.substring(1));

  // Resolve the path from the working directory. The file should always be resolved so that
  // cross os variations are mitigated
  let resolvedPath = this._path.resolve(this.workingDir, relOrAbsPath);

  // Check file is within working directory
  if (!insecureFileRead && // insecureFile read disabled
    !pathIsInside(resolvedPath, this.workingDir) && // File not inside working directory
    !_.includes(whiteList, resolvedPath)) { // File not in whitelist
      // Exit
      return;
  }

  return resolvedPath;
};

/**
 * Asynchronous path resolver function
 *
 * @param {String} relOrAbsPath - Relative or absolute path to resolve
 * @param {String|String[]} [whiteList] - A optional list of additional absolute path to whitelist
 * @param {Function} callback -
 */
PostmanFs.prototype.resolvePath = function (relOrAbsPath, whiteList, callback) {
  if (!callback && typeof whiteList === 'function') {
    callback = whiteList;
    whiteList = [];
  }

  let resolvedPath = this._resolve(relOrAbsPath, this.insecureFileRead, _.concat(this.fileWhitelist, whiteList));

  if (!resolvedPath) {
    return callback(new Error(PPERM_ERR));
  }

  return callback(null, resolvedPath);
};

/**
 * Synchronous path resolver function
 *
 * @param {String} relOrAbsPath - Relative or absolute path to resolve
 * @param {String|String[]} [whiteList] - A optional list of additional absolute path to whitelist
 *
 * @returns {String} The resolved path
 */
PostmanFs.prototype.resolvePathSync = function (relOrAbsPath, whiteList) {
  // Resolve the path from the working directory
  const resolvedPath = this._resolve(relOrAbsPath, this.insecureFileRead, _.concat(this.fileWhitelist, whiteList));

  if (!resolvedPath) {
    throw new Error(PPERM_ERR);
  }

  return resolvedPath;
};

// Attach all functions in fs to postman-fs
Object.getOwnPropertyNames(fs).map((prop) => {
  // Bail-out early to prevent fs module from logging warning for deprecated and experimental methods
  if (prop === DEPRECATED_SYNC_WRITE_STREAM || prop === EXPERIMENTAL_PROMISE || typeof fs[prop] !== FUNCTION) {
    return;
  }

  PostmanFs.prototype[prop] = fs[prop];
});

/**
 * Checks if the file is remote
 * @param {String} path - path of the file
 * @returns {Boolean} - true if file is remote
 */
PostmanFs.prototype._isFileRemote = function (path) {
  return path.includes(REMOTE_FILE_PREFIX);
};

// Override the required functions
PostmanFs.prototype.stat = function (path, callback) {
  if (this._isFileRemote(path)) {

    if (!this.allowRemoteFile) {
      return callback(new Error('Cloud file fetch failed, Cloud files not supported with performance testing'));
    }

    const unsubscribeRemoteFileEventListener = pm.eventBus.channel('remote-file-ipc-event')
      .subscribe((event) => {
        const { name, data } = event ?? {};

        if (name === 'remote-file-fetch-failed') {
          unsubscribeRemoteFileEventListener();

          return callback(new Error('Cloud file fetch failed'));
        }

        if (name === 'remote-file-fetch-completed') {
          unsubscribeRemoteFileEventListener();

          this.resolvePath(data.filePath, (err, resolvedPath) => {
            remoteFilePathMap.set(path, resolvedPath);

            return err ? callback(err) : this._fs.stat(resolvedPath, callback);
          });
        }
      });

    pm.eventBus.channel('remote-file-ipc-event').publish({
      name: 'remote-file-fetch-start',
      data: {
        filePath: path
      }
    });

    return;
  }
  this.resolvePath(path, (err, resolvedPath) => {
    if (err) {
      return callback(err);
    }

    return this._fs.stat(resolvedPath, callback);
  });
};

PostmanFs.prototype.createReadStream = function (path, options) {
    try {
      let fileSrc = path;

      if (this.allowRemoteFile && this._isFileRemote(path) && remoteFilePathMap.has(path)) {
        fileSrc = remoteFilePathMap.get(path);
      }

      return this._fs.createReadStream(this.resolvePathSync(fileSrc), options);
    } catch (err) {
      // Create a fake read steam that emits and error and
      const ErrorReadStream = function () {
        // Replicating behavior of fs module of disabling emitClose on destroy
        Readable.call(this, { emitClose: false });

        // Emit the error event with insure file access error
        this.emit('error', new Error(PPERM_ERR));

        // Options exists and disables autoClose then don't destroy
        (options && !options.autoClose) || this.destroy();
      };

      util.inherits(ErrorReadStream, Readable);

      return new ErrorReadStream();
    }
};

// @note: This will always allow reading file outside of working directory. Because we
// only use this function to read certificate files in `postman-runtime` and working directory
// restrictions don't apply to certificates.
PostmanFs.prototype.readFile = function (path, ...args) {
  let resolvedPath = this._resolve(path, true);

  return this._fs.readFile(resolvedPath, ...args);
};

module.exports = PostmanFs;
