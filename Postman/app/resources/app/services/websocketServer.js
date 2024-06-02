const app = require('electron').app,
  { WebSocketServer } = require('ws'),
  appSettings = require('./appSettings').appSettings,
  windowManager = require('./windowManager').windowManager,
  CryptoJS = require('crypto-js'),
  appVersion = app.getVersion(),
  uuid = require('uuid'),
  { getConfig } = require('./AppConfigService');

let server;

// default encryption key for Postman
const POSTMAN_DEFAULT_KEY = 'postman_default_key',

// default payload used for key validation
DEFAULT_KEY_VALIDATION_PAYLOAD = {
  type: 'KEY_VALIDATION_STRING',
  message: 'Default key validation string'
};

// key (passphrase to be used for encryption/decryption)
let encryptionKey = POSTMAN_DEFAULT_KEY,

  // number of open renderer windows
  currentOpenWindows = 1;

/**
 * @description it fetches the encryption key stored in appSettings and sets it in the global variable i.e. encryptionKey
 * if not found, sets the POSTMAN_DEFAULT_KEY as encryptionKey
 */
function initializeEncryptionKey () {
  appSettings.get('encryptionKeyForInterceptor', (err, encryptionKeyForInterceptor) => {
    if (err) {
      pm.logger.info('INTERCEPTOR CONNECTIVITY: Error getting encryption key', err);
    }
    else {
      if (!encryptionKeyForInterceptor) {
        encryptionKey = POSTMAN_DEFAULT_KEY;
      }
      else {
        encryptionKey = encryptionKeyForInterceptor;
      }
    }
  });
}

/**
 *
 * @param {string} data encrypted string
 * @param {string} key the key to use for encryption
 * @description used to decrypt the string using encryption key stored as global variable
 */
function decrypt (data, key) {
  try {
    let bytes = CryptoJS.AES.decrypt(data, key ? key : encryptionKey);
    let decryptedData;
    try {
      decryptedData = bytes.toString(CryptoJS.enc.Utf8);
    }
    catch (err) {
      return {
        type: 'KEY_MISMATCH',
        data: {
          message: 'InterceptorBridge : keys are not same at interceptor and app'
        }
      };
    }
    return decryptedData;
  }
  catch (err) {
    pm.logger.info(err);
    return {
      type: 'KEY_MISMATCH',
      data: {
        message: 'InterceptorBridge : keys are not same at interceptor and app'
      }
    };
  }
}

/**
 *
 * @param {object} data payload to be encrypted
 * @param {string} key the key to use for encryption
 * @description used to encrypt the payload using encryption key stored as global key
 */
function encrypt (data, key) {
  try {
    let encrypted = CryptoJS.AES.encrypt(data, key ? key : encryptionKey);
    return encrypted.toString();
  }
  catch (err) {
    pm.logger.info(err);
    return {
      type: 'INVALID_KEY',
      data: {
        message: 'unable to encrypt, key might be invalid'
      }
    };
  }
}

/**
 *
 * @param {string} data encrypted payload
 * @description used to check whether the same key exists at App and Interceptor or not.
 * It validates the key by using encryption/decryption of same default payload at Interceptor and App
 * Interceptor encrypts a default paylaod using it's own key and sends it to app, app tries to decrypt it
 * if both are same, validation true otherwise false.
 */
function validateKey (data) {
  try {
    let decryptedData = JSON.parse(decrypt(data));
    return {
      type: 'KEY_VALIDATION_RESULT',
      data: {
        validation: (decryptedData.type === DEFAULT_KEY_VALIDATION_PAYLOAD.type
        && decryptedData.message === DEFAULT_KEY_VALIDATION_PAYLOAD.message
        )
      }
    };
  }
  catch (err) {
    return {
      type: 'KEY_VALIDATION_RESULT',
      data: {
        validation: false
      }
    };
  }
}

// encryption key is initialized once the main process of app loads
initializeEncryptionKey();

exports.webSocketServer = {
  connections: {},

  sendMessageToInterceptor: function (msg, conn) {
    const releaseChannel = getConfig('__WP_RELEASE_CHANNEL__').toLowerCase();

    msg.appVersion = appVersion;
    msg.releaseChannel = releaseChannel;
    conn.send(JSON.stringify(msg));
  },

  handleAppCommand: function (data, connId) {
    let msg;
    try {
      let decryptedText = decrypt(data.payload);
      if (decryptedText.type === 'KEY_MISMATCH') {
        this.sendMessageToInterceptor(decryptedText, this.connections[connId]);
      }
      else {
        try {
          msg = JSON.parse(decryptedText);
        }
        catch (err) {
          msg = {
            type: 'KEY_MISMATCH',
            data: {
              message: 'InterceptorBridge : keys are not same at interceptor and app'
            }
          };
        }
      }
    }
    catch (err) {
      msg = {
        type: 'KEY_MISMATCH',
        data: {
          message: 'InterceptorBridge : keys are not same at interceptor and app'
        }
      };
    }
    this.sendInternalMessage({
      'event': 'interceptorResponse',
      'object': msg
    }, connId);
  },

  initialize: function ({ onConnect, onDisconnect, sendInternalMessage, portIndex, port }) {
    if (!portIndex) {
      portIndex = 0;
    }
    this.onDisconnect = onDisconnect;
    this.sendInternalMessage = sendInternalMessage;
      try {
        port = port + portIndex;
        pm.logger.info(`INTERCEPTOR CONNECTIVITY: Attempting to start websocket server on port ${port}`);
        server = new WebSocketServer({ port });
      }
      catch (e) {
        pm.logger.info('INTERCEPTOR CONNECTIVITY: Got error while initializing web socket', e);
        return;
      }

    let channel = pm.eventBus.channel('requester-window-events');
    channel.subscribe(this.requesterWindowHandler.bind(this));

    server.on('connection', (conn) => {

      conn.on('message', (data) => {
        try {
          data = JSON.parse(data.toString('utf8'));

          if (data.type === 'HELO') {
            const decryptedPayload = decrypt(data.payload, POSTMAN_DEFAULT_KEY);

            if (!decryptedPayload === '"POSTMAN_INTERCEPTOR"') {
              return;
            }
            this.sendMessageToInterceptor({
              type: 'HELO_ACK'
            }, conn);

            conn.$interceptorID = uuid();
            this.connections[conn.$interceptorID] = conn;
            onConnect(conn.$interceptorID);

            conn.on('close', () => {
              this.handleConnectionClose(conn);
            });
            conn.on('error', (err) => {
              this.handleConnectionClose(conn);
            });

            let msg = {
              type: 'UPDATE_CONNECTION_STATUS',
              data: {
                connectedToPostman: true,
                source: 'websocket'
              }
            },
              encryptedMessage = {
                type: 'UPDATE_CONNECTION_STATUS',
                data: encrypt(JSON.stringify({
                  connectedToPostman: true,
                  source: 'websocket'
                }), POSTMAN_DEFAULT_KEY)
              };

            this.sendMessageToInterceptor(encryptedMessage, conn);

            this.sendInternalMessage({
              'event': 'updateInterceptorBridgeConnectionStatus',
              'object': msg
            },
              conn.$interceptorID);
          }
          else if (data.type === 'APP_COMMAND') {
            this.handleAppCommand(data, conn.$interceptorID);
          }
          else if (data.type === 'REMOVE_ENCRYPTION') {
            this.removeCustomEncryptionKey(conn.$interceptorID);
          }
          else if (data.type === 'VALIDATE_KEY') {
            let keyValidationResult = validateKey(data.data);
            this.sendMessageToInterceptor(keyValidationResult, conn);
            this.sendInternalMessage({
              'event': 'interceptorResponse',
              'object': keyValidationResult
            },
              conn.$interceptorID);
          }
          else {
            this.sendInternalMessage({
              'event': 'interceptorResponse',
              'object': data
            },
              conn.$interceptorID);
          }
        } catch (e) {
          pm.logger.info('INTERCEPTOR CONNECTIVITY: Failed to parse json', e);
        }
      });
    });

    server.on('error', (e) => {
      pm.logger.info('INTERCEPTOR CONNECTIVITY: Got error while initializing web socket', e);
      server && server.close();
      if (portIndex < 5) {
        this.initialize({ onConnect, onDisconnect, sendInternalMessage, portIndex: portIndex + 1, port });
      }
    });
  },

  sendEncryptionKeyToRenderer: function (connId) {
    let secretKey = {
      key: encryptionKey
    };
    this.sendInternalMessage({
      'event': 'fetchEncryptionKey',
      'object': secretKey
    }, connId);
  },

  setEncryptionKeyForInterceptor: function (key, connId) {
    // reinitializes the encryption key as new key will be stored in appSettings
    encryptionKey = key;
    appSettings.set('encryptionKeyForInterceptor', key, (err) => {
      pm.logger.info('INTERCEPTOR CONNECTIVITY: Error persisting encryption key', err);
    });

    // sending the encryption key to renderer to update the UI
    this.sendCustomEncryptionKeyToRenderer(connId);
  },

  /**
  *
  * Sends the custom encryption key to the renderer
  * Note: The custom key is shown in the UI
  */
  sendCustomEncryptionKeyToRenderer: function (connId) {
    this.sendInternalMessage({
      'event': 'fetchCustomEncryptionKey',
      'object': {
        key: encryptionKey
      }
    }, connId);
  },

  sendSyncDomainListToRenderer: function (connId) {
    this.sendInternalMessage({
      'event': 'getSyncDomainListForInterceptor'
    }, connId);
  },

  startKeyValidationFlow: function (connId) {
    // encrypts default validation payload and sends it to interceptor
    // to check whether the same key exists at interceptor or not
    let encryptedData = encrypt(JSON.stringify(DEFAULT_KEY_VALIDATION_PAYLOAD));

    this.sendMessageToInterceptor({
      type: 'VALIDATE_KEY',
      data: encryptedData
    }, this.connections[connId]);
  },

  /**
   * Handle interceptor disconnection
   */
  handleConnectionClose: function (conn) {
    delete this.connections[conn.$interceptorID];
    conn.close();
    this.onDisconnect(conn.$interceptorID);
  },

  sendEncryptedMessageToInterceptor: function (message, connId) {
    const releaseChannel = getConfig('__WP_RELEASE_CHANNEL__').toLowerCase();

    message.appVersion = appVersion;
    message.releaseChannel = releaseChannel;

    this.sendMessageToInterceptor({
      type: 'INTERCEPTOR_COMMAND',
      payload: encrypt(JSON.stringify(message), encryptionKey)
    }, this.connections[connId]);
  },

  /**
   *
   * Handler for the events published by `windowManager`,
   * fired when a renderer window is opened or closed.
   *
   * Does following:
   * 1. Sends connected status as false when there's no renderer window open
   * 2. Sends connection status when number of open windows goes from zero to one
   *
   * @param {Object} event contains type (can be `window-opened` or `window-closed`)
   */
  requesterWindowHandler: function (event) {
    if (event.type === 'window-opened') {
      if (currentOpenWindows === 0 && windowManager.openWindowIds.length >= 1) {
        // number of open windows going from zero to one
        // updating the connection status
        this.sendMessageToInterceptor({
          type: 'UPDATE_CONNECTION_STATUS',
          data: {
            connectedToPostman: (this.connections.size > 0)
          }
        });
      }
    }
    else if (event.type === 'window-closed') {
      if (currentOpenWindows >= 1 && windowManager.openWindowIds.length === 0) {
        // last window is closed, no open windows any more
        // sending connection as false
        this.sendMessageToInterceptor({
          type: 'UPDATE_CONNECTION_STATUS',
          data: {
            connectedToPostman: false
          }
        });
      }
    }
    currentOpenWindows = windowManager.openWindowIds.length;
  },

  /**
   * Removes the custom encryption key from the interceptor.
   */
  removeCustomEncryptionKeyFromInterceptor: function (connId) {
    encryptionKey = POSTMAN_DEFAULT_KEY;
    appSettings.set('encryptionKeyForInterceptor', '', (err) => {
      if (err) {
        pm.logger.info('INTERCEPTOR CONNECTIVITY: Error removing encryption key', err);
      }
    });
    this.sendMessageToInterceptor({
      type: 'REMOVE_ENCRYPTION'
    }, this.connections[connId]);
  },

  /**
   * Removes the custom encryption key by resetting it to the default key.
   * @function removeCustomEncryptionKey
   * @returns {void}
   */
  removeCustomEncryptionKey: function (connId) {
    encryptionKey = POSTMAN_DEFAULT_KEY;
    this.startKeyValidationFlow(connId);

    appSettings.set('encryptionKeyForInterceptor', '', (err) => {
      if (err) {
        pm.logger.info('INTERCEPTOR CONNECTIVITY: Error removing encryption key', err);
      }
    });


    this.sendInternalMessage({
      'event': 'interceptorResponse',
      'object': {
        type: 'REMOVE_ENCRYPTION'
      }
    },
      connId);
  }
};

