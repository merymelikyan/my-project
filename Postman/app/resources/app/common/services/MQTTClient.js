const mqtt = require('mqtt');
const FileType = require('file-type');
const EventChannel = require('../channels/EventChannel');
const { EventEmitter } = require('events');
const PostmanFs = require('../utils/postmanFs');
const { promisify } = require('util');
const WebSocket = require('postman-ws');
const net = require('net');
const tls = require('tls');
const stripJSONComments = require('strip-json-comments');
const _ = require('lodash');

class MQTTClient {
  constructor (cwd) {
    this.cwd = cwd;
  }

  // Creates a channel that can be used to subscribe to events from the MQTT client.
  async request ({ request, protocol, isSecure }) {
    const channel = new EventChannel();

    const { url, options, auth, certs } = request;

    options.protocolId = 'MQTT';
    options.protocolVersion = options.version;

    if (options.autoReconnect === false) {
      options.reconnectPeriod = 0;
    } else {
      options.reconnectPeriod = 1000;
    }

    if (auth.type === 'basic' && auth.basic) {
      auth.basic.forEach((auth) => {
        if (auth.key === 'username') {
          options.username = auth.value;
        } else {
          options.password = auth.value;
        }
      });
    }

    if (options.will && options.will.type === 'json') {
      const json = `${options.will.message}`;
      options.will.message = stripJSONComments(json);
    }

    const certificate = certs ? await loadCertificate(certs, { cwd: this.cwd }) : {};

    try {
      let client;

      /**
       * Channel Event Handlers
       * subscribe                    - Subscribe to a topic
       * unsubscribe                  - Unsubscribe from a topic
       * publish                      - Publish a message to a topic
       * disconnect                   - Disconnect from the broker
       * error                        - Error event
       * cleanup                      - Cleanup event
      */

      channel
        .on('subscribe', (event) => {
          try {
            subscribe(event, client);
          } catch (err) {
            pm.logger.error(`Error in MQTT Client: ${err.message}`);
            emit(channel, 'error', { error: `Unable to subscribe to topic - ${event.topics}: ${err.message}` });
            channel.destroy();
          }
        })
        .on('unsubscribe', (event) => {
          try {
            unsubscribe(event, client);
          } catch (err) {
            pm.logger.error(`Error in MQTT Client: ${err.message}`);
            emit(channel, 'error', { error: `Unable to unsubscribe from topic - ${event.topic}: ${err.message}` });
            channel.destroy();
          }
        })
        .on('publish', (event) => {
          try {
            publish(event, client);
          } catch (err) {
            pm.logger.error(`Error in MQTT Client: ${err.message}`);
            emit(channel, 'error', { error: `Unable to publish message: ${err.message}` });
            channel.destroy();
          }
        })
        .on('disconnect', (event) => {
          try {
            disconnect(event, client);
          } catch (err) {
            pm.logger.error(`Error in MQTT Client: ${err.message}`);
            channel.destroy();
          }
        })
        .on('error', () => {
          channel.destroy();
        })
        .addCleanup(() => client && client.end(true));

      const buildStreamImpl = () => buildStream({ protocol, url, options, certificate, isSecure, channel });
      client = mqtt.Client(buildStreamImpl, options);

      let errorFlag = false;

      // This will keep track of which subscription packets receive a suback.
      const subscribeMap = new Map();
      let receivedDisconnect = false; // Flag for a disconnect packet was received from the broker. MQTT5 only.

      client.on('connect', (incomingPacket) => {
        const packet = parsePacket(incomingPacket, incomingPacket.cmd);

        emit(channel, 'connected', { packet, connected: client.connected, url });
      }).on('error', (err) => {
        if (errorFlag === true) {
          errorFlag === false;
          return;
        }
        emit(channel, 'error', { error: `An error occurred: ${err.message}` });
        client.end();
      }).on('close', () => {
        if (receivedDisconnect === false) {
          emit(channel, 'disconnected', { message: 'Connection closed.' });
        }
        channel.destroy();
      }).on('reconnect', () => {
        emit(channel, 'reconnecting', { message: 'Reconnecting to the broker.' });
      }).on('packetreceive', async (incomingPacket) => {
        const packet = parsePacket(incomingPacket, incomingPacket.cmd);
        const event = { packet };

        switch (packet.cmd) {
          case 'suback':
            // Check if the packet has a subscription map entry.
            if (subscribeMap.has(packet.messageId)) {
              const subscriptions = subscribeMap.get(packet.messageId);

              // Update the packet with the topic names
              subscriptions.forEach((subscription, index) => {
                packet.granted[index] = { topic: subscription.topic, qos: packet.granted[index] };
              });
            }
            break;
          case 'unsuback':
            // Check if the packet has a subscription map entry.
            if (subscribeMap.has(packet.messageId)) {
              const unsubscriptions = subscribeMap.get(packet.messageId);
              unsubscriptions.forEach((topic) => {
                // MQTT.js doesn't seem to return a reason code for unsuback packets that can be used to check for errors.
                packet.granted = [{ topic }];
              });
            }
            break;
          case 'connack':
            // Check is the server is on a different protocol version and the client is receiving reason codes instead
            // of return codes. CONNACK Packets shouldn't have reason codes in this range.
            if (packet.reasonCode > 0 && packet.reasonCode <= 5 && !packet.returnCode) {
              packet.returnCode = packet.reasonCode;
              delete packet.reasonCode;
            }

            // client connected successfully and will be handled by the connect event.
            if (packet.returnCode === 0 || packet.reasonCode === 0) return;

            // Set error flag so that error event is not emitted twice.
            errorFlag = true;
            const { connected } = client;
            emit(channel, 'connected', { packet, connected, url });
            return;
          case 'disconnect':
            if (packet.reasonCode > 25) {
              errorFlag = true;
            }

            emit(channel, 'disconnected', { packet, message: packet.reasonCode === 0 || packet.reasonCode === 4 ? 'Disconnected from broker.' : undefined });
            receivedDisconnect = true;
            return;
          case 'publish':
            // Check if the packet has a content type.
            event.contentType = await getContentType(packet).then((contentType) => contentType).catch((err) => {
              emit(channel, 'error', { error: `Unable to detect content type: ${err}` });
            });

            break;
          case 'puback':
          case 'pubrel':
          case 'pubrec':
          case 'pubcomp':
            // Need to decide how to represent these packets in the UI.
            return;
          case 'pingreq':
          case 'pingresp':
          case 'auth':
            // Need to decide how to represent these packets in the UI.
            return;
        }

        emit(channel, 'incoming-packet', event);
      }).on('packetsend', (packet) => {
        switch (packet.cmd) {
          case 'connect':
            emit(channel, 'connect', { packet });
            break;
          case 'publish':
            emit(channel, 'outgoing-packet', { packet });
          case 'puback':
          case 'pubrel':
          case 'pubcomp':
          case 'pubrec':
          case 'pingreq':
          case 'pingresp':
          case 'auth':
            // Need to decide how to represent these packets in the UI.
            break;
          case 'subscribe':
            subscribeMap.set(packet.messageId, packet.subscriptions);
            break;
          case 'unsubscribe':
            subscribeMap.set(packet.messageId, packet.unsubscriptions);
            break;
        }
      });

      return channel;
    } catch (err) {
      pm.logger.error(`Error in MQTT Client: ${err.message}`);
      setImmediate(() => emit(channel, 'error', { error: `Error: ${err.message}` }));
    }
  }
}

/**
 * Subscribes to MQTT topics using the provided client.
 * @param {Object} options - The options for the subscription.
 * @param {Array<string>} options.topics - The topics to subscribe to.
 * @param {Object} options.options - The options for the subscription.
 * @param {Object} client - The MQTT client to use for the subscription.
 * @throws {Error} If unable to subscribe to the MQTT topics.
 */
  function subscribe ({ topics, options }, client) {
    if (!client || !client.connected) {
      throw new Error('MQTT client is not connected.');
    }

    client.subscribe(topics, options);
}

/**
 * Unsubscribes from an MQTT topic using the provided client.
 * @param {Object} options - The options for the unsubscription.
 * @param {string} options.topic - The topic to unsubscribe from.
 * @param {Object} options.options - The options for the unsubscription.
 * @param {Object} client - The MQTT client to use for the unsubscription.
 * @throws {Error} If unable to unsubscribe from the MQTT topic.
 */
function unsubscribe ({ topic, options }, client) {
    if (!client || !client.connected) {
      throw new Error('MQTT client is not connected.');
    }

    client.unsubscribe(topic, options, (err) => {
      if (err) {
        throw err;
      }
    });
  }

/**
 * Publishes an MQTT message using the provided client.
 * @param {Object} options - The options for the message.
 * @param {string} options.topic - The topic to publish the message to.
 * @param {string} options.message - The message to publish.
 * @param {Object} options.options - The options for the message.
 * @param {string} options.type - The type of the message.
 * @param {Object} client - The MQTT client to use for the message.
 * @throws {Error} If unable to publish the MQTT message.
 */
function publish ({ topic, message, options, type }, client) {
    if (!client || !client.connected) {
      throw new Error('MQTT client is not connected.');
    }

    if (type === 'json') {
        const json = `${message}`;
        message = stripJSONComments(json);
    }

    if (_.isEmpty(options.properties.userProperties)) {
      delete options.properties.userProperties;
    }

    client.publish(topic, message, options, (err) => {
      if (err) {
        throw err;
      }
    });
  }

/**
 * Disconnects from the MQTT broker using the provided client.
 * @param {Object} options - The options for the disconnection.
 * @param {boolean} options.force - Whether to force the disconnection.
 * @param {Object} options.options - The options for the disconnection.
 * @param {Object} client - The MQTT client to use for the disconnection.
 * @throws {Error} If unable to disconnect from the MQTT broker.
 */
function disconnect ({ force, options }, client) {
    if (!client || !client.connected) {
      throw new Error('MQTT client is not connected.');
    }

    client.end(force, options);
}

/**
 * This emits an event to the given channel, using the format expected by Scribe.
 */
function emit (channel, eventName, payload) {
  channel.emit(eventName, {
    type: eventName,
    timestamp: new Date().toISOString(),
    payload,
  });
}

/**
 * Load certificate files from paths
 */
async function loadCertificate (certificate, { cwd }) {
  const [ca, cert, key, pfx] = await Promise.all([
    certificate.ca ? loadFile(certificate.ca, { cwd }) : undefined,
    certificate.cert ? loadFile(certificate.cert, { cwd }) : undefined,
    certificate.key ? loadFile(certificate.key, { cwd }) : undefined,
    certificate.pfx ? loadFile(certificate.pfx, { cwd }) : undefined,
  ]);

  return { ca, cert, key, pfx, passphrase: certificate.passphrase };
}

/**
 * Load a file using the Postman FileSystem
 */
async function loadFile (path, { cwd }) {
  const postmanFs = new PostmanFs(cwd);
  const readFile = promisify(postmanFs.readFile.bind(postmanFs));

  return await readFile(path);
}

/**
 * Creates a net.socket or websocket based on the transport protocol.
 */
function buildStream ({ protocol, url, options, certificate, isSecure, channel }) {
  const { hostname = 'localhost', port: parsedPort } = new URL(url);
  const port = parsedPort || 1883;
  const certs = isSecure ? certificate : null;

  const { rejectUnauthorized = false } = options;

  let stream;

  try {
    if (protocol === 'mqtt' && isSecure) {
      stream = tls.connect({ port, host: hostname, rejectUnauthorized, ...certs });
    } else if (protocol === 'mqtt') {
      stream = net.createConnection({ port, host: hostname });
    } else if (protocol === 'ws') {
      const websocketEvents = new EventEmitter();
      websocketEvents.on('error', (ws, err) => {
        emit(channel, 'error', { error: `An error occurred: ${err.message || 'An unknown error occurred'}` });
      });

      const websocketImpl = createCustomWebSocket({ rejectUnauthorized, ...certs }, websocketEvents);
      const socket = new websocketImpl(url);
      stream = WebSocket.createWebSocketStream(socket);
    }

    stream.on('error', (err) => {
      emit(channel, 'error', { error: `An error occurred: ${err.message || err.code}` });
    });

    return stream;
  } catch (err) {
    setImmediate(() => emit(channel, 'error', { error: `An error occurred: ${err.message}` }));
  }
}

/**
 * Creates a subclass of WebSocket that emits lifecycle events to a given EventEmitter.
 */
function createCustomWebSocket (options, eventEmitter) {
  return class CustomWebSocket extends WebSocket {
    constructor (url) {
      super(url, ['mqtt'], options);

      if (eventEmitter) {
        this.on('open', (...args) => eventEmitter.emit('open', this, ...args));
        this.on('close', (...args) =>
          eventEmitter.emit('close', this, ...args)
        );
        this.on('error', (...args) =>
          eventEmitter.emit('error', this, ...args)
        );
      }
    }

    getHandshakeRequest () {
      return this._debug ? this._debug[0].request : undefined;
    }

    getHandshakeResponse () {
      return this._debug
        ? this._debug[this._debug.length - 1].response
        : undefined;
    }
  };
}

/**
 * Check if value is non-null + non-Array object
 */
function isObject (value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Checks if a value is a JSON object.
*/
function isMessageObject (value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (_) {
    return false;
  }

  if (!isObject(parsed)) return false;
  return true;
}


/**
 * Checks if a value is a WebSocket CloseEvent.
 */
function isCloseEvent (value) {
  return isObject(value) && 'code' in value && 'reason' in value;
}

/**
 * Returns the contextual WebSocket handshake data expected by Scribe.
 */
function getWSHandshakeContext (ws) {
  return _.omitBy(
    {
      handshakeRequest: _.pick(ws.getHandshakeRequest(), ['method', 'headers']),
      handshakeResponse: _.pick(ws.getHandshakeResponse(), [
        'statusCode',
        'statusMessage',
        'headers',
      ]),
    },
    _.isEmpty
  );
}

/**
 * Gets the MQTT content type by checking the packet payload.
 * If content type is not found, it uses the FileType library to try and detect the content type.
 *
 * @param {Object} packet MQTT packet
 * @returns {String} Content type
 */
async function getContentType (packet) {
  const { payload, properties = undefined } = packet;

  if (properties) {
    // Not using content type from properties because it could be any string.
    const { payloadFormatIndicator = undefined } = properties;

    if (payloadFormatIndicator === true) {
      return 'text/plain';
    }
  }

  let contentType;
  let payloadString = payload;

  if (payload instanceof ArrayBuffer || Buffer.isBuffer(payload)) {
    try {
      const fileType = await FileType.fromBuffer(payload);
      contentType = fileType?.mime;

      if (contentType) {
        return contentType;
      } else if (hasNonPrintableCharacters(payload)) {
        return 'application/octet-stream';
      } else {
        payloadString = payload.toString('utf8');
      }
    } catch (error) {
      throw new Error(`Unable to detect content type: ${error}`);
    }
  }

  contentType = isMessageObject(payloadString) ? 'application/json' : 'text/plain';

  return contentType;
}

/**
 * A function to remove null and extra properties from a packet. So the packets match their documentation.
 * https://github.com/mqttjs/mqtt-packet
 * @param {Object} obj
 * @param {string} packet.cmd - The command of the packet
 * @returns {Object} Object with values removed.
 */
function parsePacket (obj, cmd) {
  switch (cmd) {
    case 'connack':
      const connackFields = new Set(['cmd', 'returnCode', 'reasonCode', 'sessionPresent', 'properties', 'length']);
      return _.pickBy(obj, (value, key) => value !== null && value !== undefined && connackFields.has(key));
    case 'suback':
      const subackFields = new Set(['cmd', 'messageId', 'granted', 'properties', 'length']);
      return _.pickBy(obj, (value, key) => value !== null && value !== undefined && subackFields.has(key));
    case 'unsuback':
      const unsubackFields = new Set(['cmd', 'messageId', 'properties', 'length']);
      return _.pickBy(obj, (value, key) => value !== null && value !== undefined && unsubackFields.has(key));
    case 'puback':
    case 'pubrec':
    case 'pubrel':
    case 'pubcomp':
      const pubackFields = new Set(['cmd', 'messageId', 'reasonCode', 'properties', 'length']);
      return _.pickBy(obj, (value, key) => value !== null && value !== undefined && pubackFields.has(key));
    case 'publish':
      const publishFields = new Set(['cmd', 'topic', 'payload', 'qos', 'retain', 'dup', 'length', 'properties', 'messageId']);
      return _.pickBy(obj, (value, key) => value !== null && value !== undefined && publishFields.has(key));
    case 'disconnect':
      const disconnectFields = new Set(['cmd', 'reasonCode', 'properties']);
      return _.pickBy(obj, (value, key) => value !== null && value !== undefined && disconnectFields.has(key));
    default:
      return _.pickBy(obj, (value) => value !== null && value !== undefined);
  }
}

/**
 * A function to check if a payload has non-printable ASCII characters and should be displayed as binary.
 * @param {string | ArrayBuffer} payload - The payload to check.
 * @returns {boolean} True if the payload should be displayed as binary.
 */
function hasNonPrintableCharacters (payload) {
	if (typeof payload === 'string') {
		return (/[\u0000-\u0009\u000B-\u000C\u000E-\u001F\u007F-\u009F\uFFFD]/).test(
			payload,
		);
	} else {
		const uint8Array = new Uint8Array(payload);
		return uint8Array.some((byte) => {
			// ASCII values for line breaks are 10 (LF) and 13 (CR)
			if (byte === 10 || byte === 13) {
				return false;
			}
			return byte < 32 || byte > 126;
		});
	}
}

module.exports = MQTTClient;
