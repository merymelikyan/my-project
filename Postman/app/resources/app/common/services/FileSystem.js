/* eslint-disable no-labels */
const { app, dialog, BrowserWindow } = require('electron');
const path = require('path');
const pathIsInside = require('../utils/pathIsInside');
const fs = require('fs').promises;
const request = require('postman-request');
const getSystemProxy = require('../../utils/getSystemProxy');
const PostmanFs = require('../utils/postmanFs');
const { promisify } = require('util');

const REQUEST_TIMEOUT = 10000;

class FileSystem {
  constructor (defaultWorkingDir) {
    this.defaultWorkingDir = defaultWorkingDir;
  }

  // Opens a native file selector dialog for selecting schema files.
  /**
   * @param {object} options
   * @param {Array<{description?: string, accept: string[]}>} [options.types]
   * @param {boolean} [options.multiple = false]
   * @param {string} [options.cwd = this.defaultWorkingDir]
   * @returns {string[]} paths
   */
  async showOpenFilePicker (options) {
    if (process.platform === 'darwin') {
      app.focus({ steal: true });
    }
    const properties = ['openFile', 'treatPackageAsDirectory'];
    if (options.multiple)
      properties.push('multiSelections');

    const result = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), {
      filters: options.types,
      properties
    });

    if (result.canceled) {
      return null;
    }
    if (!result.filePaths) {
      pm.logger.error('FileSystem~showOpenFilePicker error: ', 'No file selected');
      return null;
    }

    return result.filePaths.map((val) => sanitizeFilePath(val, options.cwd || this.defaultWorkingDir));
  }

  /**
   * Opens a native file selector dialog for selecting folders.
   *
   * @param {Object} options - Options for configuring the folder picker.
   * @param {boolean} options.multiple - Allow multiple folder selection.
   * @returns {Array<string>} An array of selected folder paths.
   */
  async showDirectoryPicker (options = {}) {
    // Focus on the app window if running on macOS
    if (process.platform === 'darwin') {
      app.focus({ steal: true });
    }

    const { filePaths } = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), {
      properties: ['openDirectory', 'treatPackageAsDirectory', ...(options.multiple ? ['multiSelections'] : [])],
    });

    return filePaths;
  }

  /**
   * Read file
   *
   * @param {string} filePath - The path to the file to be read not expected to be UNIX style path.
   * @param {object} [options] - Options for configuring the file read.
   * @param {string} [options.cwd] - The current working directory.
   * @returns {Promise<string>} A promise that resolves with the contents of the file as a string.
   * @throws {Error} If there is an error reading the file.
   */
  async readFile (filePath, { cwd }) {
    try {
      const resolvedPath = (new PostmanFs(cwd, true)).resolvePathSync(filePath);
      const fileContent = await fs.readFile(resolvedPath, 'utf-8');

      // Return the contents of the file
      return fileContent;
    } catch (error) {
      // If an error occurs during file reading, throw an error
      throw new Error(`Error reading file at ${filePath}: ${error.message}`, 'INTERNAL_ERROR');
    }
  }


  /**
   * Fetch content from a URL.
   *
   * @param {string} url - The URL to fetch content from.
   * @param {object} [options] - Options for configuring the request.
   * @param {string} [options.cwd] - The current working directory.
   * @param {number} [options.timeout] - The current working directory.
   * @param {boolean} [options.followRedirects = true] - Enable or disable following redirects.
   * @param {boolean} [options.verifySSLCertificates = true] - Enable or disable SSL certificate verification.
   * @param {object} [options.proxy] - Proxy configuration options.
   * @param {boolean} [options.proxy.system = true] - Use system proxy settings.
   * @param {boolean} [options.proxy.env = true] - Use environment proxy settings.
   * @param {string} [options.proxy.url] - Specify a custom proxy URL.
   * @param {string} [options.ca] - Custom Certificate Authority (CA) file path.
   * @param {object} [options.certificate] - Certificate options.
   * @param {string} [options.certificate.crt] - Certificate file path.
   * @param {string} [options.certificate.key] - Key file path.
   * @param {string} [options.certificate.pfx] - PFX file path.
   * @param {string} [options.certificate.passphrase] - Passphrase for the certificate.
   * @returns {Promise<string>} A promise that resolves with the contents of the response body as a string.
   * @throws {Error} If there is an error fetching the content.
   */
  async readURL (url, options = {}) {
    const {
      followRedirects = true,
      verifySSLCertificates = true,
      proxy: proxyConfig = { system: true, env: true },
      cwd = this.defaultWorkingDir,
      timeout = REQUEST_TIMEOUT,
    } = options;

    const ca = options.ca || options.certificate?.ca ? await loadFile(options.ca || options.certificate?.ca, { cwd }) : undefined;
    const certificate = options.certificate ? await loadCertificate(options.certificate, { cwd }) : {};

    // postman-request: undefined = use environment, false = no proxy
    const envProxy = proxyConfig.env ? undefined : false;
    const systemProxy = proxyConfig.system ? await loadSystemProxy(url) : undefined;
    const proxy = proxyConfig.url ?? systemProxy ?? envProxy;

    // Send an HTTP request.
    return new Promise((resolve, reject) => {
      request.get(
        {
          url,
          timeout,
          followRedirect: followRedirects,
          followAllRedirects: followRedirects,
          strictSSL: verifySSLCertificates,
          ca,
          cert: certificate?.crt,
          key: certificate?.key,
          pfx: certificate?.pfx,
          passphrase: certificate?.passphrase,
          proxy,
        },
        (error, response, body) => {
          if (error) {
            pm.logger.error(error);
            reject(error);
          } else if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve(body);
          } else {
            reject(new Error(`Unsuccessful request, ${response.statusCode} ${response.statusMessage}`));
          }
        }
      );
    });
  }

}

/**
 * Load certificate files from paths
 */
async function loadCertificate (certificate, { cwd }) {
  const [crt, key, pfx] = await Promise.all([
    certificate.crt ? loadFile(certificate.crt, { cwd }) : undefined,
    certificate.key ? loadFile(certificate.key, { cwd }) : undefined,
    certificate.pfx ? loadFile(certificate.pfx, { cwd }) : undefined,
  ]);

  return { crt, key, pfx, passphrase: certificate.passphrase };
}

/**
 * Load a file using the Postman FileSystem
 */
async function loadFile (path, { cwd }) {
  const postmanFs = new PostmanFs(cwd);

  return promisify(postmanFs.readFile.bind(postmanFs))(path);
}

/**
 * Load proxy url for given url
 */
async function loadSystemProxy (url) {
  return new Promise((resolve, reject) => {
    getSystemProxy(url, (error, proxyConfig) => {
      if (error) return reject(error);
      resolve(proxyConfig?.getProxyUrl());
    });
  });
}

/**
 * 1. Convert paths inside working directory to corresponding relative paths, and
 * 2. Convert win32 file path to posix like path to support cross os file read
 * Note: Part of it is referenced from src/renderer/runtime-repl/_common/FsHelper.js
 * @param {String} filePath
 * @param {String} workingDir
 *
 * @returns {String} sanitized filePath
 *
 */
function sanitizeFilePath (filePath, workingDir) {
  // Set the relative path of the file from the workingDir as the selected file path
  if (pathIsInside(filePath, workingDir)) {
    filePath = path.relative(workingDir, filePath);
  }

  // Ignore sanitization is os platform is not windows
  if (global.process.platform !== 'win32' || !filePath) {
    return filePath;
  }

  // If path is absolute and it's not already sanitized then prepend path with an extra `\\`
  path.win32.isAbsolute(filePath) && filePath[0] !== '/' && (filePath = `\\${filePath}`);

  // Convert all \\ to /
  /**
   * Benchmark for using split.join vs replace regex
   * The space complexity of split/join is not a big factor
   *
   * Split#test x 18,503 ops/sec ±4.30% (76 runs sampled)
   * Regex#test x 11,308 ops/sec ±7.83% (67 runs sampled)
   * Fastest is Split#test
   */
  return filePath.split(path.win32.sep).join(path.posix.sep);
}

module.exports = FileSystem;
