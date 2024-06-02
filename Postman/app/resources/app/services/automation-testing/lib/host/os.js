const os = require('os');

/**
 * Get the OS information
 *
 * @returns {{platform: string, release: string, kernel: string, arch: string}}
 */
function getOSInformation () {
  return {
    platform: os.platform(),
    release: os.release(),
    kernel: os.version(),
    arch: os.arch(),
  };
}

module.exports = {
  getOSInformation
};
