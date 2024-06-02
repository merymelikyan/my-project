const os = require('os');
const { spawn, IPCNode } = require('../../preload/desktop/node-process');
const sdk = {
  NodeProcess: { spawn },
  IPCNode
};

/**
 * Attaches the IPCNode for communication with the sub process. If the sub process already has an IPCNode attached,
 * it detaches the existing IPCNode and attaches the new one. This is done to avoid multiple IPCNodes being attached
 * to the same sub process.
 *
 * @param {number|string} id - Id of the sub process
 *
 * @returns {Promise<IPCNode>} - Promise that resolves with the IPCNode
 */
const attachIpcNode = (id) => new Promise((resolve) => {
  const ipcNode = new sdk.IPCNode(id, pm.logger);

  ipcNode.onConnect(() => {
    pm.logger.info(`ExecutionSystem ${id} ~ ipc connection successfully established`);

    resolve(ipcNode);
  });

  ipcNode.onClose(() => {
    pm.logger.info(`ExecutionSystem ${id} ~ ipc connection closed.`);
  });
});


/**
 * Starts a sub process and attaches the IPCNode for communication with it and returns the sub process item object.
 *
 * @param {Number} id - Id of the sub process
 * @param {String} path - Path of the sub process
 * @param {Number} priority - Priority of the sub process
 * @param {Boolean} inspect - Flag to enable debugging
 * @param {Boolean} attachIPC - Flag to attach the IPCNode, if set to false, the IPCNode will not be attached
 *
 * @returns {Promise<Object>} - Sub process item object
 */
const startSubProcess = ({ id, path, priority, inspect = false, attachIPC = true }) => new Promise((resolve, reject) => {
  const subprocess = sdk.NodeProcess.spawn(path, id, { inspect });

  let isResolved = false;

  // Assign a lower priority to the subprocess so that it doesn't hog the CPU
  os.setPriority(subprocess.pid, priority);

  // When the subprocess is ready, attach the IPCNode
  subprocess.onReady(async () => {
    const subProcessItem = {
      process: subprocess,
      ...(attachIPC ? {
        ipcNode: await attachIpcNode(id)
      } : {})
    };

    isResolved = true;
    resolve(subProcessItem);
  });

  subprocess.onError((error) => {
    pm.logger.error(`ExecutionSystem ${id} ~ Error in starting subprocess`, error);

    reject(error);
  });

  // When the subprocess exits, reset the pointers to the subprocess and IPCNode via _resetMainManager
  subprocess.onExit((code, signal) => {
    // Process terminated with error.
    if (code !== 0) {
      pm.logger.error(`ExecutionSystem ${id} ~ subprocess exited with code: ${code}`);

      if (signal) {
        pm.logger.error(`ExecutionSystem ${id} ~ sub process exited in response to signal ${signal}`);
      }
    }

    pm.logger.info(`ExecutionSystem ${id} ~ Sub process terminated with`, code);

    if (!isResolved) {
      pm.logger.error(`ExecutionSystem ${id} ~ Failed to start process.`, code, signal);

      reject({ code, signal });
    }
  });
});

/**
 * Detaches the IPCNode for communication with the sub process.
 *
 * @param {object} node - IPCNode to detach
 *
 * @returns {void}
 */
const detachIpcNode = (node) => {
  try {
    node && node?.dispose();
  } catch (e) {
    pm.logger.error('ExecutionSystem ~ Error in detaching IPCNode', e);
  }
};

/**
 * Invokes a method on the IPCNode.
 *
 * @param {IPCNode} ipcNode - IPCNode to invoke the method on
 * @param {object} options - Options for invoking the method
 * @param {string} [options.action] - Action to perform
 * @param {string} options.method - Method to invoke
 * @param {Array<*>} options.args - Arguments to pass to the method
 *
 * @returns {Promise<*>}
 */
const invokeOnIPC = (ipcNode, { action, method, args }) =>
  ipcNode.invoke(action, { method, args });

const detachIpcNodes = (ipcNodes) => {
  Object.values(ipcNodes).forEach(detachIpcNode);
};

/**
 * Sends a message to the main process.
 *
 * @deprecated Use sendEventOnIPC instead from lib/communication.js
 *
 * @param {object} channel - The channel ID.
 * @param {object} data - The data to send to the main process.
 */
function broadcastOnIPC (channel, data) {
  pm.sdk.ipc.broadcast(channel, JSON.stringify(data));
}

module.exports = {
  attachIpcNode,
  startSubProcess,
  detachIpcNode,
  broadcastOnIPC,
  invokeOnIPC,
  detachIpcNodes
};
