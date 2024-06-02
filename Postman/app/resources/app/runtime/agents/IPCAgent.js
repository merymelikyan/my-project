const { ipcMain: actualIpcMain, session } = require('electron'),
  SerializedError = require('serialised-error'),
  lodash = require('lodash'),
  CookieStorageRemoteClient = require('../../common/services/CookieStorageRemoteClient'),
  LinkableChannel = require('../../common/channels/LinkableChannel'),
  IPCChannel = require('../../common/channels/IPCChannel'),
  CryptoService = require('../../common/services/CryptoService'),
  { VaultManager } = require('../../common/services/VaultIntegrationService'),
  { ServerMethods } = require('@postman/runtime'),
  { Server: ElectronServer } = require('@postman/runtime.runtime-rpc-electron'),

  // This is a mapping between clientId and the respective CookieStorageRemoteClient instance
  // It is required so that in case of multiple clients, we are able to keep the
  // communication channel open with all the clients and use the correct cookieStorageRemoteClient
  // instance when a query/action needs to be performed.
  cookieStorageRemoteClientMap = new Map(),

  // A map to keep track of all clients associated with each of the opened windows
  // This is required for clean up during window close event.
  windowToClientMap = new Map(),

  // A map between the clientId and the set of all open websocket request connection ids
  // This is required for clean up during window close event.
  clientToWSConnectionMap = new Map(),

  // A map between the clientId and all subscription to vault events
  // This is required to resolve appropriate vault variables before runs
  clientToVaultMapping = new Map();

/**
 * SECURITY: Sandbox visualizer session
 */
function initializeVisualizerSession () {
  const s = session.fromPartition('visualizer');

  // Deny all permission requests from visualizer
  s.setPermissionRequestHandler((webContents, permission, callback) => {
      callback(false);
  });

  // Block download dialog
  s.on('will-download', (event) => {
    event.preventDefault();
  });
}

/**
 * @private
 * @returns {VaultManager}
 */
function getOrCreateVaultManager (clientId) {
  if (clientToVaultMapping.has(clientId)) {
    return clientToVaultMapping.get(clientId);
  }

  let vault = new VaultManager();
  clientToVaultMapping.set(clientId, vault);
  return vault;
}

/**
 * @private
 */
async function createVault (clientId, vaultId, config) {
  let vaultManager = getOrCreateVaultManager(clientId);
  let vault = await vaultManager.createVault(vaultId, config);
  return vault;
}

/**
 * @param {string} clientId
 * @param {string} vaultId
 * @private
 */
function getVault (clientId, vaultId) {
  let vaultManager = getOrCreateVaultManager(clientId);
  let vault = vaultManager.getVault(vaultId);
  return vault;
}

/**
 * Agent interface to start listening and running
 */
function start (R, done) {
  const ipcMain = pm.sdk.IPC;

  ipcMain.subscribe('runtime-ipc-command', (event, clientId, message) => {
    if (message.namespace === 'init' && message.name === 'mapClientToWindow') {
      const windowId = message.data && message.data.windowId,
        clientIds = windowToClientMap.get(windowId) || new Set();

      // Map the client id to its window
      // This is done for enabling us to do the required cleanup when a window closes
      clientIds.add(clientId);
      windowToClientMap.set(windowId, clientIds);

      // Listen to close event for requester window,
      // 1.to clean the attached cookieStorageRemoteClient instances
      // 2.to close all open websocket request connections
      // 3.remove from the vault subscriptions
      pm.eventBus.channel('requester-window-events').subscribe((windowEvent) => {
        if (!windowEvent || windowEvent.type !== 'window-closed') {
          return;
        }

        const closedWindowId = windowEvent.windowId,
          clientIdsForClosedWindow = windowToClientMap.get(closedWindowId);

        // No client for this window, bail out
        if (!clientIdsForClosedWindow || clientIdsForClosedWindow.size === 0) {
          return;
        }

        clientIdsForClosedWindow.forEach((clientId) => {
          // Delete cookieStorageRemoteClient instances for each client
          cookieStorageRemoteClientMap.delete(clientId);

          // Clean up all open websocket connections
          R.wsBulkDisconnect(Array.from(clientToWSConnectionMap.get(clientId) || []));
          clientToWSConnectionMap.delete(clientId);

          // Remove the vault associated
          clientToVaultMapping.delete(clientId);
        });

        // Delete clientId mapping for closed window
        windowToClientMap.delete(closedWindowId);
      });

      return;
    }

    if (message.namespace === 'execution' && message.name === 'terminate') {
      R.stopRun(message.data.execution, (message) => {
        event.reply('runtime-ipc-event', message);
      });

      return;
    }

    if (message.name === 'execute') {
      R.startRun(message.data.info, message.data.collection, message.data.variables, message.data.options, cookieStorageRemoteClientMap.get(clientId), clientToVaultMapping.get(clientId), (message) => {
        event.reply('runtime-ipc-event', message);
      });
      return;
    }

    if (message.namespace === 'execution' && message.name === 'pause') {
      R.pauseRun(message.data.execution, (message) => {
        event.reply('runtime-ipc-event', message);
      });
    }

    if (message.namespace === 'execution' && message.name === 'resume') {
      R.resumeRun(message.data.execution, (message) => {
        event.reply('runtime-ipc-event', message);
      });
    }

    if (message.namespace === 'cookie' && message.name === 'initializeManager') {
      cookieStorageRemoteClientMap.set(clientId, new CookieStorageRemoteClient((request) => {
        event.reply('runtime-ipc-cookie-request', request);
      }));
    }
  });

  ipcMain.subscribe('runtime-ipc-cookie-response', (event, clientId, message) => {
    const cm = cookieStorageRemoteClientMap.get(clientId);

    cm && cm.handleResponse(message);
  });

  ipcMain.handle('runtime-ipc-cb', async (e, clientId, event, fn, args) => {
    return new Promise((resolve) => {


      if (event === 'runtime' && fn === 'previewRequest') {
        return R.previewRequest(...args, cookieStorageRemoteClientMap.get(clientId), (err, result) => {
          resolve([err, result]);
        });
      }

      if (event === 'oauth2' && fn === 'clearAllCookies') {
        // Clearing all the electron cookies as only
        // OAuth2 cookies are stored in the electron session
        return R.clearAllElectronCookies(...args, (err) => {
          resolve([err]);
        });
      }

      if (event === 'files' && fn === 'create-temp') {
        return R.createTemporaryFile(...args, (err, tempFilePath) => {
          resolve([err, tempFilePath]);
        });
      }

      if (event === 'files' && fn === 'read') {
        return R.readFile(...args, (err, content) => {
          resolve([err, content]);
        });
      }

      if (event === 'files' && fn === 'access') {
        return R.accessFile(...args, (err) => {
          resolve([err]);
        });
      }

      if (event === 'files' && fn === 'saveResponse') {
        return R.saveStreamToFile(...args, (err, success) => {
          resolve([err, success]);
        });
      }

      if (event === 'cloudFiles' && fn === 'saveCloudFileLocally') {
        return R.saveCloudFileLocally(...args, (err, success) => {
          resolve([err, success]);
        });
      }

      if (event === 'cloudFiles' && fn === 'deleteSavedCloudFile') {
        return R.deleteSavedCloudFile(...args, (err, success) => {
          resolve([err, success]);
        });
      }

      if (event === 'cloudFiles' && fn === 'deleteCloudFileDir') {
        return R.deleteCloudFileDir(...args, (err, success) => {
          resolve([err, success]);
        });
      }

      if (event === 'files' && fn === 'deleteScriptFileDir') {
        return R.deleteScriptFileDir(...args, (err, success) => {
          resolve([err, success]);
        });
      }

      if (event === 'files' && fn === 'saveScriptFileLocally') {
        return R.saveScriptFileLocally(...args, (err, success) => {
          resolve([err, success]);
        });
      }

      if (event === 'files' && fn === 'getDefaultWorkingDir') {
        return resolve([R.defaultWorkingDir]);
      }

      return resolve([]);
    });
  });

  ipcMain.subscribe('ws-ipc-command', (event, clientId, message) => {
    const connectionIds = clientToWSConnectionMap.get(clientId) || new Set();

    if (message.name === 'wsConnect') {
      R.wsConnect(message.data.connectionId, message.data.connectionConfig, (message) => {
        event.reply('ws-ipc-event', message);

        // To clean up the map, when connection gets terminated without any user interaction
        if (message.event === 'end') {
          connectionIds.delete(message.connectionId);
          connectionIds.size === 0 ? clientToWSConnectionMap.delete(clientId) : clientToWSConnectionMap.set(clientId, connectionIds);
        }
      });

     // Map connection to its corresponding client when a new connection is opened
      connectionIds.add(message.data.connectionId);
      clientToWSConnectionMap.set(clientId, connectionIds);

      return;
    }

    if (message.name === 'wsDisconnect') {
      R.wsDisconnect(message.data.connectionId);

      // Clean up mapped connection, when a connection is closed
      connectionIds.delete(message.data.connectionId);
      connectionIds.size === 0 ? clientToWSConnectionMap.delete(clientId) : clientToWSConnectionMap.set(clientId, connectionIds);

      return;
    }
  });

  ipcMain.handle('ws-ipc-cb', async (e, clientId, event, fn, args) => {
    return new Promise((resolve) => {
      if (event === 'ws' && fn === 'wsSend') {
        return R.wsSend(...args, () => { resolve([]); });
      }

      return resolve([]);
    });
  });

  ipcMain.subscribe('socketIO-ipc-command', (event, clientId, message) => {
    const connectionIds = clientToWSConnectionMap.get(clientId) || new Set();

    if (message.name === 'socketIOConnect') {
      R.socketIOConnect(message.data.connectionId, message.data.connectionConfig, (message) => {
        event.reply('socketIO-ipc-event', message);

        // To clean up the map, when connection gets terminated without any user interaction
        if (message.event === 'end') {
          connectionIds.delete(message.connectionId);
          connectionIds.size === 0 ? clientToWSConnectionMap.delete(clientId) : clientToWSConnectionMap.set(clientId, connectionIds);
        }
      });

      // Map connection to its corresponding client when a new connection is opened
      connectionIds.add(message.data.connectionId);
      clientToWSConnectionMap.set(clientId, connectionIds);

      return;
    }

    if (message.name === 'socketIODisconnect') {
      R.socketIODisconnect(message.data.connectionId);

      // Clean up mapped connection, when a connection is closed
      connectionIds.delete(message.data.connectionId);
      connectionIds.size === 0 ? clientToWSConnectionMap.delete(clientId) : clientToWSConnectionMap.set(clientId, connectionIds);

      return;
    }
  });

  ipcMain.handle('socketIO-ipc-cb', async (e, clientId, event, fn, args) => {
    return new Promise((resolve) => {
      if (event === 'socketIO' && fn === 'socketIOPublish') {
        return R.socketIOPublish(...args, () => { resolve([]); });
      }

      if (event === 'socketIO' && fn === 'socketIOSubscribe') {
        return R.socketIOSubscribe(...args, () => { resolve([]); });
      }

      if (event === 'socketIO' && fn === 'socketIOUnsubscribe') {
        return R.socketIOUnsubscribe(...args, () => { resolve([]); });
      }

      return resolve([]);
    });
  });

  // For backwards compatibility with old app versions.
  ipcMain.handle('grpc-ipc', async (e, fnName, args) => {
    return handleAPIClientIPC(e, `grpc.${fnName}`, args);
  });

  ipcMain.handle('api-client-ipc', async (e, fnPath, args) => {
    return handleAPIClientIPC(e, fnPath, args);
  });

  ipcMain.handle('vault-ipc', async (e, clientId, event, fn, args) => {
    let vault = getVault(clientId, args[0]);
    try {
      if (fn == 'status') {
        return [null, vault.getUserInformation()];
      }
      if (fn == 'logout') {
        await vault?.logout();
        return [null];
      }
      if (fn == 'resolve-secret') {
        const isSecretValid = await vault.isValidSecret(args[1]);
        return [null, isSecretValid];
      }
      if (fn == 'resolve-secrets') {
        let vaultManager = getOrCreateVaultManager(clientId);
        const resolutionResult = await vaultManager.resolveSecrets(args[0], new AbortController());
        return [null, resolutionResult];
      }
      if (fn == 'getUserDetails') {
        const details = await vault.fetchAWSConfig();
        return [null, details];
      }

      if (fn == 'getMFADetails') {
          const details = await vault.fetchMFAConfig(args[1]);
          return [null, details];
      }

      if (fn == 'manualLogin') {
        const result = await vault.performLoginFlow(null, args[1]);
        return [null, result];
      }

      if (['saveVaultUserKey', 'retrieveVaultUserKey'].includes(fn)) {
        return new Promise(async (resolve, reject) => {
          if (fn === 'saveVaultUserKey') {
            const [namespace, userKey, userId] = args;
            CryptoService.storeInKeychain(namespace, userKey, userId).then(() => resolve([null])).catch(reject);
          } else if (fn === 'retrieveVaultUserKey') {
            const [namespace, userId] = args;
            CryptoService.retrieveFromKeychain(namespace, userId).then((key) => resolve([null, key])).catch(reject);
          }
        });
      }

    } catch (e) {
      return [new SerializedError(e)];
    }
  });

  ipcMain.subscribe('vault-ipc-command', async (event, clientId, message) => {
    if (message.name == 'init') {
      let vault = await createVault(clientId, message.vaultId, message.data);
      event.reply('vault-ipc-event', { event: 'VAULT_INITIALIZED', vaultId: message.vaultId });

      vault.on('event', (msg) => {
        event.reply('vault-ipc-event', { ...msg, vaultId: message.vaultId });
      });
    } else if (message.name == 'login') {
      let vault = getVault(clientId, message.vaultId);
      if (vault == null) {
        event.reply('vault-ipc-event', { event: 'error', type: 'vault_not_authenticated', vaultId: message.vaultId });
      }
      vault.handleLogin((msg) => {
        event.reply('vault-ipc-event', { ...msg, vaultId: message.vaultId });
      }, message.params);
    } else if (message.name === 'clearCache') {
      let vault = getVault(clientId, message.vaultId);
      if (vault === null) {
        return;
      }
      vault.resetCache();
    } else if (message.name === 'updateCacheTtl') {
      let vault = getVault(clientId, message.vaultId);
      if (vault === null) {
        return;
      }
      vault.updateCacheTtl(message.params.updatedTtl);
    }
  });

  async function handleAPIClientIPC (e, fnPath, args) {
    let result;

    try {
      const pathParts = String(fnPath).split('.');
      const thisObj = lodash.get(R, pathParts.slice(0, -1));
      const fn = lodash.get(R, pathParts);

      if (!fn) {
        throw new ReferenceError(`IPCAgent function "${fnPath}" does not exist`);
      }

      result = await fn.apply(thisObj, args);
    } catch (err) {
      const serializedError = new SerializedError(err);

      return { error: serializedError };
    }

    if (result instanceof LinkableChannel) {
      const ipcChannel = new IPCChannel(e.sender, actualIpcMain);
      result.link(ipcChannel);
      return {
        result: Object.assign({}, result),
        channel: ipcChannel.getId()
      };
    }

    return { result };
  }

  ipcMain.subscribe('postman-runtime-ipc-sync', (event, fn, args) => {
    if (fn === 'isInWorkingDir') {
      return event.returnValue = R.isInWorkingDir(...args);
    }
  });

  // If this file is imported in a "browser" environment, ElectronServer is intentionally undefined
  // (this shouldn't happen except in unusual test cases)
  if (ElectronServer) {
    // Start the server and listen on the "@postman/runtime" channel
    //
    // Electron IpcListener API:
    //
    // - on(channel: string, listener): void
    // - removeListener(channel: string, listener): void
    //
    // vs. Postman IPC API:
    //
    // - subscribe(channel: string, listener): Unsubscribe
    // - handle(channel: string, listener)
    const unsubscribes = {},
      ipcAdapter = {
        subscribe: ipcMain.subscribe.bind(ipcMain),
        handle: ipcMain.handle.bind(ipcMain),

        on: (channel, listener) => {
          const unsubscribe = ipcMain.subscribe(channel, listener),
            group = unsubscribes[channel] ?? (unsubscribes[channel] = new Map());

          group.set(listener, unsubscribe);
        },
        removeListener: (channel, listener) => {
          const group = unsubscribes[channel];

          group?.delete(listener);
        }
      },
      runtime = new ElectronServer(ServerMethods, { ipc: ipcAdapter });
  } else {
    console.warn('Unable to start Electron server for @postman/runtime');
  }

  // this event is triggered for every window when it starts
  // if the callback is received, it means that the agent was initialized
  // before the window was launched. So we just tell the window
  // agent is available
  pm.eventBus.channel('runtime-ipc-lifecycle').subscribe((event) => {
    if (event.name === 'queryStatus' && event.namespace === 'ipcAgent') {
      pm.eventBus.channel('runtime-ipc-lifecycle').publish({ name: 'statusBroadcast', namespace: 'ipcAgent' });
    }
  });

  // if a window was opened before the agent could initialize itself
  // we have to broadcast an event to all of them that agent is initialized.
  pm.eventBus.channel('runtime-ipc-lifecycle').publish({ name: 'statusBroadcast', namespace: 'ipcAgent' });

  initializeVisualizerSession();

  pm.logger.info('RuntimeIPCAgent~started: Success');

  done && done();
}

module.exports = { start };
