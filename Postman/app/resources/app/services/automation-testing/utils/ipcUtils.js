const { runTimeoutPromise } = require('./promise');
const { log } = require('../lib/logging');

/**
 * Attaches the IPCNode for communication with the sub process. If the sub process already has an IPCNode attached,
 * it detaches the existing IPCNode and attaches the new one. This is done to avoid multiple IPCNodes being attached
 * to the same sub process.
 *
 * @param {number|string} id - Id of the sub process
 * @param {string} source - Caller component for logging
 *
 * @returns {Promise<IPCNode>} - Promise that resolves with the IPCNode
 */
const _attachIPC = (id, source) => new Promise((resolve) => {
    const ipcNode = new pm.sdk.IPCNode(id, pm.logger);

    ipcNode.onConnect(() => {
      log.info(`${source} <> ${id} ~ ipc connection successfully established`);

      resolve(ipcNode);
    });

    ipcNode.onClose(() => {
      log.info(`${source} <> ${id} ~ ipc connection closed.`);
    });
  }),
  _invokeOnIPC = (ipcNode, target, parameters) => {
    if (!ipcNode) {
      const error = new Error('Couldn\'t communicate with the performance run execution system.');

      log.error('_invokeOnIPC: IPCNode not found', { error, target, parameters });

      throw error;
    }

    return ipcNode.invoke(target, parameters);
  },
  attachIPC = (id, source) => runTimeoutPromise(_attachIPC(id, source)),
  invokeOnIPC = (ipcNode, parameters) => runTimeoutPromise(_invokeOnIPC(ipcNode, 'invoke', parameters)),
  isAlive = async (ipcNode) => {
    try {
      return await runTimeoutPromise(_invokeOnIPC(ipcNode, 'healthChecker', { method: 'isAlive' }), 2000);
    } catch (error) {
      log.warn('IPCNode is not alive', ipcNode);

      return false;
    }
  };

module.exports = {
  attachIPC,
  invokeOnIPC,
  isAlive
};
