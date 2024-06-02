const { getReplacer } = require('../utils/string');
const ERROR_CHANNEL = 'error';

/**
 * Clear all listeners from the event bus.
 * @returns {module:events.EventEmitter}
 */
function clearListeners () {
  return global.eventBus.removeAllListeners();
}

/**
 * Send an event to the event bus.
 * @param {string} channel - Name of the channel
 * @param {string} source - Name of the emitter
 * @param {object} data - Data to be sent
 */
function sendEvent (channel, source, data) {
  global.eventBus.emit(channel, createEventPayload(data, source));
}

/**
 * Send an event via IPC channel.
 *
 * @param {string} channel - Name of the channel
 * @param {string} source - Name of the emitter
 * @param {object} data - Data to be sent
 * @param {boolean} [stringify=true] - Whether to stringify the data
 */
function sendEventOnIPC (channel, source, data, stringify = true) {
  const payload = createEventPayload(data, source);

  return pm.sdk.ipc.broadcast(channel, stringify ? JSON.stringify(payload, getReplacer()) : payload);
}

/**
 * Subscribe to an event on the IPC event bus.
 *
 * @param {string} channel - Name of the channel
 * @param {function} callback - Callback to be called when the event is received
 *
 * @returns {function} - Disposer function to unsubscribe from the event
 */
function subscribeOnIPC (channel, callback) {
  const handler = (event, data) => {
    callback(typeof data === 'string' ? JSON.parse(data) : data);
  };

  pm.sdk.ipc.on(channel, handler);

  return () => pm.sdk.ipc.off(channel, handler);
}

/**
 * Pipe an event from one channel of an IPC event bus to a channel of own IPC event bus.
 *
 * @param {IPCNode} node - Node to be used for subscribing to the event
 * @param {string} sourceChannel - Name of the source channel
 * @param {string} [targetChannel=sourceChannel] - Name of the target channel
 *
 * @returns {function} - Disposer function to unsubscribe from the event
 */
function pipeOnIPCFromNode (node, sourceChannel, targetChannel) {
  const _targetChannel = targetChannel || sourceChannel;

  return node.subscribe(sourceChannel, (data) => pm.sdk.ipc.broadcast(_targetChannel, data));
}

/**
 * Unsubscribe from all events on the IPC event bus.
 * @param {string} channel - Name of the channel
 */
function unsubscribeAllOnIPC (channel) {
  pm.sdk.ipc.removeAllListeners(channel);
}

/**
 * Unsubscribe from an event on the IPC event bus.
 * @param {string} channel - Name of the channel
 * @param {function} callback - Callback to be unsubscribed
 */
function unsubscribeOnIPC (channel, callback) {
  pm.sdk.ipc.removeListener(channel, callback);
}

/**
 * Create a payload to be sent over the event bus.
 *
 * @param {object} data - Data to be sent
 * @param {string} source - Name of the subsystem
 *
 * @returns {*&{source, timestamp: number}}
 */
function createEventPayload (data, source) {
  return {
    ...data,
    timestamp: new Date().toISOString(),
    source,
  };
}

/**
 * Subscribe to an event on the event bus.
 *
 * @param {string} event - Name of the event
 * @param {function} callback - Callback to be subscribed
 */
function subscribe (event, callback) {
  global.eventBus.on(event, callback);
}

/**
 * Unsubscribe from an event on the event bus.
 *
 * @param {string} event - Name of the event
 * @param {function} callback - Callback to be unsubscribed
 */
function unsubscribe (event, callback) {
  global.eventBus.removeListener(event, callback);
}

/**
 * Create an error payload.
 *
 * @param {string} subsystem - Name of the subsystem
 * @param {object|string} error - Error object or string
 * @param {string} source - Name of the subsystem
 * @param {CONSTANTS.SEVERITY} severity - Severity of the error
 * @param {string} [message] - Error message
 *
 * @returns {{severity, source, error, timestamp: number}}
 */
function getErrorPayload ({ subsystem, error, message, source, severity }) {
  return {
    subsystem,
    error: {
      message: error?.message || error,
      stack: error?.stack
    },
    source,
    message,
    severity,
    timestamp: Date.now(),
  };
}

/**
 * Broadcast an error over the event bus and IPC.
 *
 * @param {object|string} error - Error object or string
 * @param {string} source - Name of the subsystem
 * @param {string} subsystem - Name of the subsystem
 * @param {CONSTANTS.SEVERITY} severity - Severity of the error
 * @param {boolean} [includeIPC=true] - Whether to broadcast the error over IPC
 * @param {string} [message] - Error message
 *
 * @returns {void}
 */
function broadcastError ({ error, message, source, subsystem, severity }, includeIPC = true) {
  const payload = getErrorPayload({ subsystem, error, message, source, severity });

  pm.logger.error(payload);

  sendEvent(ERROR_CHANNEL, source, payload);
  includeIPC && sendEventOnIPC(ERROR_CHANNEL, source, payload);
}

/**
 * Creates an error, Throws it and sends it over the event bus.
 *
 * @param {object} error - Error object or string
 * @param {string} [message] - Error message
 * @param {string} source - Name of the subsystem
 * @param {string} subsystem - Name of the subsystem
 * @param {CONSTANTS.SEVERITY} severity - Severity of the error
 * @param {boolean} [broadcast=true] - Whether to broadcast the error over the event bus
 * @param {boolean} [emitOnIPC=true] - Whether to broadcast the error over IPC
 *
 * @throws {Error}
 *
 * @returns {never}
 */
function createError ({ error, message, source, subsystem, severity, broadcast = true }, emitOnIPC = true) {
  broadcast && broadcastError({ error, message, source, subsystem, severity }, emitOnIPC);

  // TODO: Implement our own error class.
  const errObject = new Error(message || error?.message);

  Object.assign(errObject, error);

  throw errObject;
}

/**
 * Generates and returns dynamic channels that can be used for waiting for the response
 * @param {string} channel
 * @returns {Object} - An object containing `data` and `error` keys for the respective channels.
 * The receiver is expected to send the response back on these channels. This depends on the
 * implementation of the handler.
 */
function getResponseChannels (channel) {
  const uid = process.hrtime.bigint();
  return {
      data: `${channel}-data-channel-${uid}`,
      error: `${channel}-error-channel-${uid}`
  };
}

/**
 * Constants related to communication.
 * @type {{ERROR_CHANNEL: string, SEVERITY: {ERROR: string, INFO: string, WARNING: string, CRITICAL: string}}}
 */
const CONSTANTS = {
  ERROR_CHANNEL,
  SEVERITY: {
    INFO: 'info',
    WARNING: 'warning',
    ERROR: 'error',
    CRITICAL: 'critical',
  }
};

module.exports = {
  sendEvent,
  subscribe,
  unsubscribe,
  createError,
  broadcastError,
  getErrorPayload,
  clearListeners,
  subscribeOnIPC,
  unsubscribeOnIPC,
  sendEventOnIPC,
  unsubscribeAllOnIPC,
  pipeOnIPCFromNode,
  getResponseChannels,
  CONSTANTS,
};
