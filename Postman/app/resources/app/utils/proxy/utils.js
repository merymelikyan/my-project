const _ = require('lodash'),
  electron = require('electron'),
  app = electron.app,
  os = require('os'),
  { getConfig } = require('../../services/AppConfigService'),
  windowManager = require('../../services/windowManager').windowManager,
  sh = require('shelljs'),
  path = require('path'),
  sudo = require('sudo-prompt'),
  osTypes = { // allowed types of OS i.e. MACOS/LINUX/WINDOWS
    MACOS: 'MACOS',
    LINUX: 'LINUX',
    WINDOWS: 'WINDOWS'
  },
  PROMPT_OPTIONS = {
    name: 'Electron'
  },
  RELEASE_CHANNEL = getConfig('__WP_RELEASE_CHANNEL__'),
  proxyConstants = require('../../constants/ProxyConstants'),
  pathToLoginKeyChain = '~/Library/Keychains/login.keychain',
  winRegProxyAddr = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

let currentOS,
  self,
  appFolder,
  pathToCertificate;

/**
 *
 * returns the current OS where process is running.
 * returns null if the  current OS is not present in osTypes
 * @returns {osTypes} returns either MACOS/LINUX/WINDOWS or null
 *
 */
function getCurrentOS () {
  switch (process.platform) {
    case 'darwin':
      return osTypes.MACOS;
    case 'win32':
    case 'win64':
      return osTypes.WINDOWS;
    case 'linux':
      return osTypes.LINUX;
    default:
      return null;
  }
}

function getAppName () {
  return electron.app.getName();
}

/**
 * Returns the path to the proxy certificate
 */
function setPathToCertificate () {
  const rootCADir = path.resolve(app.getPath('userData'), 'proxy');

  pathToCertificate = path.resolve(rootCADir, `${proxyConstants.CA_SUFFIX_NAME}.crt`).replace(/ /g, '\\ ');
}

/**
 *
 * fixed os-specific path to native messaging host location where manifest is added,
 * in case of windows, the manifest file can be located anywhere in the file system.
 * the native messaging host must create a registry key.
 *
 * Learn more: https://developer.chrome.com/apps/nativeMessaging
 */
const SYSTEM_APPDATA_DIRECTORY = {
  MACOS: `~/Library/Application\\ Support/${getAppName()}/`
},

/**
 *
 * Categorizing the installation and download errors into four major sub types based on their resolution steps.
 *
 * Note: This will be used to map the manual resolution steps mentioned in troubleshooting doc
 * Link: https://go.pstmn.io/interceptor-installation-troubleshooting
 */
errorSubTypes = {
  chromeNotInstalled: 'CHROME_NOT_INSTALLED',
  internetConnectivity: 'INTERNET_CONNECTIVITY',
  registryAccessNeeded: 'REGISTRY_ACCESS_NEEDED',
  permissionRequired: 'FILE_PERMISSIONS_REQUIRED'
};

currentOS = getCurrentOS();

appFolder = getAppName();

setPathToCertificate();

self = exports.utils = {

  currentOS, // as it's used at other places

  /**
   *
   * returns current user's home directory
   */
  getUserHome: function () {
    return process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];
  },

  /**
   *
   * Enables proxy on the client machine via localhost with provided port.
   * Depending upon the OS of machine, we use different method for setting the proxy settings
   *  as electron doesn't have any standard APIs to do so.
   *
   * @param {Function} callback
   */
  enableClientProxy: function (port, callback) {
    if (currentOS === osTypes.MACOS) {
      const setProxyCmd = `networksetup -setwebproxy wi-fi 127.0.0.1 ${port} && ` +
        `networksetup -setsecurewebproxy wi-fi 127.0.0.1 ${port}`;

      sh.exec(setProxyCmd, function (code, stdout, stderr) {
        if (code !== 0) {

          // In cases when elevated permission is needed to setup the proxy for users with non root permission setup
          sudo.exec(setProxyCmd, PROMPT_OPTIONS, function (error, stdout, stderr) {
            if (error || stderr) {
              pm.logger.info('ProxySession~enableClientProxy:', error || stderr);

              const errObj = new Error('Error occurred while enabling proxy settings', error || stderr);
              errObj.type = 'ProxySetup';
              errObj.subType = 'ProxySettingsEnable';
              return callback(errObj);
            }
            else {
              windowManager.sendInternalMessage({
                'event': 'proxySessionProxyEnabled',
                'object': {
                  status: 'ProxySettingsEnabled'
                }
              });
              pm.logger.info('ProxySession~enableClientProxy: Web proxy has been enabled with elevated permissions');
              return callback(null);
            }
          });
        }
        else {
          windowManager.sendInternalMessage({
            'event': 'proxySessionProxyEnabled',
            'object': {
              status: 'ProxySettingsEnabled'
            }
          });
          pm.logger.info('ProxySession~enableClientProxy: Web proxy has been enabled');
          return callback(null);
        }
      });
    }
    else if (currentOS === osTypes.WINDOWS) {
      const setProxyCmd = `REG ADD "${winRegProxyAddr}" /v "ProxyServer" /t REG_SZ /d "127.0.0.1:${port}" /f && ` +
        `REG ADD "${winRegProxyAddr}" /v "ProxyEnable" /t REG_DWORD /d "1" /f`;

      sh.exec(setProxyCmd, function (code, stdout, stderr) {
        if (code !== 0) {
          pm.logger.info('ProxySession~enableClientProxy: Failed to enable proxy settings.');

          const errObj = new Error('Error occurred while enabling HTTPS proxy', stderr);
          errObj.type = 'ProxySetup';
          errObj.subType = 'HTTPSProxyEnable';
          return callback(errObj);
        }
        else {
          windowManager.sendInternalMessage({
            'event': 'proxySessionHTTPSProxyEnabled',
            'object': {
              status: 'HTTPSProxyEnabled'
            }
          });
          pm.logger.info('ProxySession~enableClientProxy: Web proxy has been enabled');
          return callback(null);
        }
      });
    }
    else {
      return callback(null);
    }
  },

  /**
   *
   * Disables proxy on the client machine.
   * Depending upon the OS of machine, we use different method for setting the proxy settings
   *  as electron doesn't have any standard APIs to do so.
   *
   * @param {Function} callback
   */
  disableClientProxy: function (callback) {
    if (currentOS === osTypes.MACOS) {
      const disableProxyCmd = 'networksetup -setsecurewebproxystate wi-fi off && ' +
        'networksetup -setwebproxystate wi-fi off';

      sh.exec(disableProxyCmd, function (code, stdout, stderr) {
        if (code !== 0) {
          // In cases when elevated permission is needed to setup the proxy for users with non root permission setup
          sudo.exec(disableProxyCmd, PROMPT_OPTIONS, function (error, stdout, stderr) {
            if (error || stderr) {
              pm.logger.error('ProxySession~disableClientProxy:', error || stderr);

              const errObj = new Error('Error occurred while disabling proxy settings', stderr);
              errObj.type = 'ProxySetup';
              errObj.subType = 'ProxySettingsDisable';
              return callback(errObj);
            }
            else {
              windowManager.sendInternalMessage({
                'event': 'proxySessionProxyDisabled',
                'object': {
                  status: 'ProxySettingsDisabled'
                }
              });
              pm.logger.error('ProxySession~disableClientProxy: Web proxy has been disabled with elevated permissions');
              return callback(null);
            }
          });
        }
        else {
          windowManager.sendInternalMessage({
            'event': 'proxySessionProxyDisabled',
            'object': {
              status: 'ProxySettingsDisabled'
            }
          });
          pm.logger.error('ProxySession~disableClientProxy: Web proxy has been disabled');
          return callback(null);
        }
      });
    }
    else if (currentOS === osTypes.WINDOWS) {
      const disableProxyCmd = `REG ADD "${winRegProxyAddr}" /v "ProxyEnable" /t REG_DWORD /d "0" /f`;

      sh.exec(disableProxyCmd, function (code, stdout, stderr) {
        if (code !== 0) {
          pm.logger.info('ProxySession~disableClientProxy: Unable to disable HTTPS proxy with code: ', code,
            'and Error: ', stderr);

          const errObj = new Error('Error occurred while disabling proxy settings', stderr);
          errObj.type = 'ProxySetup';
          errObj.subType = 'ProxySettingsDisable';
          return callback(errObj);
        }
        else {
          windowManager.sendInternalMessage({
            'event': 'proxySessionProxyDisabled',
            'object': {
              status: 'ProxySettingsDisabled'
            }
          });
          pm.logger.error('ProxySession~disableClientProxy: Web proxy has been disabled');
          return callback(null);
        }
      });
    }
    else {
      return callback(null);
    }
  },

  /**
   *
   * Removes redundant *.sock file that gets created as part of child node process listening to traffic via proxy
   *
   * @param {String} proxyProcessIdentifier
   * @param {Function} callback
   * @returns
   */
  removeRedundantSockFile: function (proxyProcessIdentifier, callback) {
    if (currentOS === osTypes.MACOS) {
      sh.exec(`rm ${SYSTEM_APPDATA_DIRECTORY[currentOS]}${proxyProcessIdentifier}*`, function (code, stdout, stderr) {
        if (code !== 0) {
          return callback(null, {
            error: true,
            message: `Could not remove "${proxyProcessIdentifier}*", please remove it manually`
          });
        }
        else {
          pm.logger.info(`ProxySession~removeRedundantSockFile: ${proxyProcessIdentifier}.* has been removed.`);
          return callback(null, {
            error: false
          });
        }
      });
    }
    else {
      return callback(null);
    }
  },

  /**
   * Checks if the SSL certificate is trusted on macOS.
   *
   * @returns {Promise<boolean>} - A Promise that resolves to a boolean indicating if the certificate is trusted.
   */
  isCertificateTrusted () {
    let isTrusted = false;

    return new Promise((resolve) => {
      if (currentOS === osTypes.MACOS) {
        const command = `security verify-cert -c ${pathToCertificate}`;

        sh.exec(command, (code, stdout, stderr) => {
          if (code !== 0 || stderr) {
            // Log and swallow the error
            pm.logger.error(`isCertificateTrusted~ Unable to verify certificate with code: "${code}" and error: "${stderr}"`);

            resolve(false);
          } else {
            const output = stdout.trim();

            // Check if the certificate is trusted based on the output of the command
            isTrusted = output.includes('certificate verification successful');

            resolve(isTrusted);
          }
        });
      } else {
        resolve(true);
      }
    });
  },

  /**
   * Checks if the SSL certificate is added to the keychain and trusted (if applicable) on macOS.
   *
   * @returns {Promise<boolean>} A Promise that resolves to a boolean indicating whether the certificate is added and trusted.
   */
  isCertificateAddedToKeyChain () {
    const proxyCertName = proxyConstants.COMMON_NAME[RELEASE_CHANNEL] || proxyConstants.COMMON_NAME.prod;

    let isAddedToKeyChain = false;

    return new Promise((resolve) => {
      if (currentOS === osTypes.MACOS) {
        const command = `security find-certificate -c "${proxyCertName}" -a ${pathToLoginKeyChain}`;

        sh.exec(command, (code, stdout, stderr) => {
          if (code !== 0 || stderr) {
            // Log and swallow the error
            pm.logger.info('proxy/utils~isCertificateAddedToKeyChain~ Unable to find certificate.' +
              ` code: "${code}" and error: "${stderr}"`);

            resolve(false);
          } else {
            const output = stdout.trim();

            // Check if the certificate is added to the key chain already based on the output of the command
            isAddedToKeyChain = output.includes(proxyCertName);

            // To handle the case when user clicks on install but cancels the password prompt
            // A certificate is said to be setup if it is added to the key chain and trusted as well
            if (isAddedToKeyChain) {
              this.isCertificateTrusted()
                .then((value) => {
                  return resolve(value);
                });
            } else {
              return resolve(false);
            }
          }
        });
      }
      else if (currentOS === osTypes.WINDOWS) {
        /**
         * This command will check existence of the certificate in store and
         * verify that it's not expired hence extra verification is not needed.
         */
        const command = `certutil -user -verifystore Root "${proxyCertName}"`;

        sh.exec(command, (code, stdout, stderr) => {
          if (code !== 0 || stderr) {
            // Log and swallow the error
            pm.logger.info('proxy/utils~isCertificateAddedToKeyChain~ Unable to find certificate.' +
              ` code: "${code}" and error: "${stderr}"`);

            resolve(false);
          } else {
            const output = stdout.trim();

            // Check if the certificate is added to the key chain already based on the output of the command
            isAddedToKeyChain = output.includes(proxyCertName);

            // To handle the case when user clicks on install but cancels the password prompt
            // A certificate is said to be setup if it is added to the key chain and trusted as well
            return resolve(isAddedToKeyChain);
          }
        });
      }
      else {
        return resolve(isAddedToKeyChain);
      }
    });
  },

  /**
   * Installs and trusts the specified SSL certificate in the system's keychain (macOS only).
   *
   * @returns {void}
   */
  installAndTrustCertificate () {
    pm.logger.info('proxy/utils~installAndTrustCertificate: Installing and trusting certificate ~ path to certificate: ' +
      `"${pathToCertificate}"`);

    if (currentOS === osTypes.MACOS) {
      const command = `security add-trusted-cert -r trustRoot -k ${pathToLoginKeyChain} ` + pathToCertificate;

      sh.exec(command, (code, stdout, stderr) => {
        if (code !== 0 || stderr) {
          pm.logger.info('proxy/utils~installAndTrustCertificate: Error while trusting proxy certificate.' +
            ` code: "${code}" and error: "${stderr}"`);

          /**
           * SecTrustSettingsSetTrustSettings: The authorization was canceled by the user.
           * We check if the user has canceled the operation and send an event to track the same
           */
          const stdErrOutput = stderr.trim(),
            didUserCancelAuth = stdErrOutput.includes('canceled');

          windowManager.sendInternalMessage({
            event: 'certAdditionStatus',
            'object': {
              value: false,
              didUserCancelAuth: didUserCancelAuth,
              isUserTriggered: true,
              result: { code, stderr, stdout }
            }
          });

          return;
        }

        pm.logger.info('proxy/utils~installAndTrustCertificate: Successfully added the cert to login key chain.');

        windowManager.sendInternalMessage({
          event: 'certAdditionStatus',
          'object': {
            value: true,
            didUserCancelAuth: false,
            isUserTriggered: true
          }
        });
      });
    } else if (currentOS === osTypes.WINDOWS) {
      const addCertCommandWindows = `certutil -user -addstore Root ${pathToCertificate}`;

        sh.exec(addCertCommandWindows, function (code, stdout, stderr) {
          if (code !== 0 || stderr) {
            pm.logger.info('proxy/utils~installAndTrustCertificate~ Error while adding cert to trust authorities.' +
              ` code: "${code}" and error: "${stderr}"`);

            /**
             * In case when the authorization was canceled by the user.
             * We check if the user has canceled the operation and send an event to track the same
             */
            const stdOutput = stdout.trim(),
              didUserCancelAuth = stdOutput.includes('canceled');

            windowManager.sendInternalMessage({
              event: 'certAdditionStatus',
              'object': {
                value: false,
                didUserCancelAuth: didUserCancelAuth,
                isUserTriggered: true,
                result: { code, stderr, stdout }
              }
            });

            return;
          }

          pm.logger.info('proxy/utils~installAndTrustCertificate~ Successfully added the cert to the Trust Root Certification Authorities');

          windowManager.sendInternalMessage({
            event: 'certAdditionStatus',
            'object': {
              value: true,
              didUserCancelAuth: false,
              isUserTriggered: true
            }
          });

          return;
        });
    }
  }
};
