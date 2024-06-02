const webSocketServer = require('./websocketServer').webSocketServer,
  ipcClient = require('./ipcClient').ipcClient,
  windowManager = require('./windowManager').windowManager,
  CONN_WEBSOCKET = 'websocket',
  CONN_BRIDGE = 'ipcBridge';

let connectionTypeMap = new Map(),
  activeConnection = null,

  // These commands should be broadcasted to all connected clients
  commandsForBroadcast = ['UPDATED_DOMAIN_LIST', 'CONFIGURE_WORKSPACE_DATA', 'CONFIGURE_REQUEST_CAPTURE_FILTERS'],

  // Messages that will be passed on to Interceptor manager despite not coming
  // from a client which is not "active"
  whiteListedMessages = ['REQUEST_ADD_DOMAIN', 'REQUEST_REMOVE_DOMAIN', 'REQUEST_CONFIGURE_REQUEST_CAPTURE', 'REQUEST_ENABLE_COOKIE_SYNC'];


exports.interceptorConnection = {
  /**
   * Callback to be called when connection to interceptor is established
   *
   * @param {string} connectionType Whether the connection is websocket or bridge
   * @param {string} connId The id of the connection
   */
  onConnect: function (connectionType, connId) {
    connectionTypeMap.set(connId, connectionType);

    if (activeConnection === null) {
      activeConnection = connId;
    }

    windowManager.sendInternalMessage({
      'event': 'newInterceptorConnection',
      'object': {
        connId
      }
    });
  },

  /**
   * Handler to be called on disconnect
   *
   * @param {string} connId The id of the connection
   */
  onDisconnect: function (connId) {
    let source = connectionTypeMap.get(connId);

    if (connId === activeConnection) {
      this.removeActiveConnection();
    }
    else {
      connectionTypeMap.delete(connId);
    }

    if (activeConnection === null) {
      var msg = {
        type: 'UPDATE_CONNECTION_STATUS',
        data: {
          connectedToPostman: false,
          source
        }
      };
      windowManager.sendInternalMessage({
        'event': 'updateInterceptorBridgeConnectionStatus',
        'object': msg
      });
    }
  },

  /**
   * Remove the currently active connection
   */
  removeActiveConnection: function () {
    if (connectionTypeMap.has(activeConnection)) {
      connectionTypeMap.delete(activeConnection);
    }

    if (connectionTypeMap.size > 0) {
      activeConnection = connectionTypeMap.keys().next().value;
    }
    else {
      activeConnection = null;
    }
  },

 /**
  * Send internal message to UI if the request is coming from
  * active Connection
  */
  sendInternalMessage: function (message, connId) {
    message.object.connId = connId;

    // Only pass white-listed messages or which comes from active connection
    if (connId === activeConnection || whiteListedMessages.includes(message?.object?.type)) {
      windowManager.sendInternalMessage(message);
    }
  },

  initializeIpcClient: function () {
    ipcClient.initialize({
      onConnect: this.onConnect.bind(this, CONN_BRIDGE),
      onDisconnect: this.onDisconnect.bind(this),
      sendInternalMessage: this.sendInternalMessage.bind(this)
    });
  },

  initializeWebSocketServer: function ({ port }) {
    webSocketServer.initialize({
      onConnect: this.onConnect.bind(this, CONN_WEBSOCKET),
      onDisconnect: this.onDisconnect.bind(this),
      sendInternalMessage: this.sendInternalMessage.bind(this),
      port: port
    });
  },

  sendActiveSessionStatus ({ isActive }) {
    let message = {
      type: 'ANOTHER_SESSION_ACTIVE',
      postmanMessage: {
        value: isActive
      }
    };
    if (isActive) {
      for (let connId of connectionTypeMap.keys()) {
        if (connId !== activeConnection) {
          if (connectionTypeMap.get(connId) === CONN_WEBSOCKET) {
            webSocketServer.sendEncryptedMessageToInterceptor(message, connId);
          }
          else {
            ipcClient.sendEncryptedMessageToInterceptor(message);
          }
        }
        else {
          // To the connection client, reverse the message value
          this.sendEncryptedMessageToInterceptor({
            type: 'ANOTHER_SESSION_ACTIVE',
            postmanMessage: {
              value: false
            } });
        }
      }
    }
    else {
      this.broadcastToAllConnectedClients(message);
    }
  },

  broadcastToAllConnectedClients (message) {
    for (let connId of connectionTypeMap.keys()) {
      if (connectionTypeMap.get(connId) === CONN_WEBSOCKET) {
        webSocketServer.sendEncryptedMessageToInterceptor(message, connId);
      }
      else {
        ipcClient.sendEncryptedMessageToInterceptor(message);
      }
    }
  },

  sendEncryptedMessageToInterceptor: function (message) {
    if (commandsForBroadcast.includes(message?.type)) {
      this.broadcastToAllConnectedClients(message);
    }
    else if (connectionTypeMap.get(activeConnection) === CONN_WEBSOCKET) {
      webSocketServer.sendEncryptedMessageToInterceptor(message, activeConnection);
    }
    else {
      ipcClient.sendEncryptedMessageToInterceptor(message);
    }

  },

  disconnect: function () {
    if (connectionTypeMap.get(activeConnection) === CONN_WEBSOCKET) {
      webSocketServer.disconnect(activeConnection);
    }
    else {
      ipcClient.disconnect();
    }
  },

  setEncryptionKeyForInterceptor: function (key) {
    if (connectionTypeMap.get(activeConnection) === CONN_WEBSOCKET) {
      webSocketServer.setEncryptionKeyForInterceptor(key, activeConnection);
    }
    else {
      ipcClient.setEncryptionKeyForInterceptor(key);
    }
  },

  startKeyValidationFlow: function () {
    if (connectionTypeMap.get(activeConnection) === CONN_WEBSOCKET) {
      webSocketServer.startKeyValidationFlow(activeConnection);
    }
    else {
      ipcClient.startKeyValidationFlow();
    }
  },

  sendEncryptionKeyToRenderer: function () {
    if (connectionTypeMap.get(activeConnection) === CONN_WEBSOCKET) {
      webSocketServer.sendEncryptionKeyToRenderer(activeConnection);
    }
    else {
      ipcClient.sendEncryptionKeyToRenderer();
    }
  },

  sendSyncDomainListToRenderer: function () {
    if (connectionTypeMap.get(activeConnection) === CONN_WEBSOCKET) {
      webSocketServer.sendSyncDomainListToRenderer(activeConnection);
    }
    else {
      ipcClient.sendSyncDomainListToRenderer();
    }
  },

  sendCustomEncryptionKeyToRenderer: function () {
    if (connectionTypeMap.get(activeConnection) === CONN_WEBSOCKET) {
      webSocketServer.sendCustomEncryptionKeyToRenderer(activeConnection);
    }
    else {
      ipcClient.sendCustomEncryptionKeyToRenderer();
    }
  },

  removeCustomEncryptionKeyFromInterceptor: function () {
    if (connectionTypeMap.get(activeConnection) === CONN_WEBSOCKET) {
      webSocketServer.removeCustomEncryptionKeyFromInterceptor(activeConnection);
    }
    else {
      ipcClient.removeCustomEncryptionKeyFromInterceptor();
    }
  },

  changeActiveConnection: function ({ connectionId }) {
    activeConnection = connectionId;
  }
};
