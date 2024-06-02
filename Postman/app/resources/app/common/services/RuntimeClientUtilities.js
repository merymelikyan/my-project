const { promisify } = require('util');
const PostmanFs = require('../utils/postmanFs');
const getSystemProxy = require('../../utils/getSystemProxy');

class RuntimeClientUtilities {
  constructor (defaultWorkingDir) {
    this.defaultWorkingDir = defaultWorkingDir;
  }

  async loadFile (path, { cwd, encoding } = {}) {
    const postmanFs = new PostmanFs(cwd || this.defaultWorkingDir);
    const buffer = await promisify(postmanFs.readFile.bind(postmanFs))(path);

    return encoding ? buffer.toString(encoding) : buffer;
  }

  async loadSecureContext (config, options) {
    const [ca, cert, key, pfx] = await Promise.all([
      config.ca ? this.loadFile(config.ca, options) : undefined,
      config.cert ? this.loadFile(config.cert, options) : undefined,
      config.key ? this.loadFile(config.key, options) : undefined,
      config.pfx ? this.loadFile(config.pfx, options) : undefined,
    ]);

    return { ca, cert, key, pfx, passphrase: config.passphrase };
  }

  async loadSystemProxy (url) {
    return new Promise((resolve, reject) => {
      getSystemProxy(url, (error, proxyConfig) => {
        if (error) return reject(error);
        resolve(proxyConfig?.getProxyUrl());
      });
    });
  }
}


module.exports = RuntimeClientUtilities;
