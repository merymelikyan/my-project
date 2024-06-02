// @todo move this file to appropriate location

const { URL } = require('url'),
  WebSocket = require('postman-ws'),
  FileType = require('file-type'),
  SerializedError = require('serialised-error'),
  PostmanFs = require('../utils/postmanFs'),
  { promisify } = require('util');

/**
 * Helper function to detect whether a give value is JSON or not
 *
 * @note This function only determines whether a given value is
 * JSON on best-effort basis and thus might result in false positives
 *
 * @param {String} value
 * @returns {Boolean}
 */
function isJSON (value) {
  value = value.trim();

  switch (value.charAt(0) + value.charAt(value.length - 1)) {
    case '[]':
    case '{}':
    case '0}': // socket.io open prefix
    case '4]': // socket.io message prefix
      return true;
    default:
      return false;
  }
}

/**
 * Load a file using the Postman FileSystem
 */
async function loadFile (path, { cwd }) {
  const postmanFs = new PostmanFs(cwd);
  const readFile = promisify(postmanFs.readFile.bind(postmanFs));

  return readFile(path);
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

/** */
function serializeError (err) {
  return new SerializedError(err);
}

class WebSocketClient {
  constructor (url, protocols = [], options = {}) {
    if (typeof options.retryCount !== 'number') {
      options.retryCount = 0;
    }

    if (typeof options.retryDelay !== 'number') {
      options.retryDelay = 5000;
    }

    this.protocols = protocols;
    this.options = { followRedirects: true, ...options };
    this.reconnectAttempts = -1; // -1 signify not connected

    // Track whether connection was aborted (closed before getting established)
    this.isConnectionAborted = false;

    // @todo throw synchronous error
    setImmediate(() => {
      if (!(url && typeof url === 'string')) {
        this.onError(serializeError(new Error('Request URL is empty')));
        return this.onEnd();
      }

      if (!(url.startsWith('ws://') || url.startsWith('wss://'))) {
        url = 'ws://' + url;
      }

      try {
        // Create URL object
        this.url = new URL(url);

        // Open connection
        this._open();
      } catch (error) {
        this.onError(serializeError(error));
        return this.onEnd();
      }
    });
  }

  async _open () {
    const { cwd, certificates, strictSSL: rejectUnauthorized, ...coreOptions } = this.options;
    const certificateContent = certificates ? await loadCertificate(certificates, { cwd }) : {};

    // Since load certificate is an async operation, the user might've requested to close the connection, in which case
    // we mark the connection as aborted. Thus we are checking if the connection was aborted even before it was setup,
    // we return without setting up the socket
    if (this.isConnectionAborted) {
      return;
    }

    const options = {
      ...coreOptions,
      rejectUnauthorized,
      ...certificateContent
    };

    const ws = this.ws = new WebSocket(this.url, this.protocols, options);

    ws.on('upgrade', () => {
      if (ws._debug) {
        const request = ws._debug[0].request,
          response = ws._debug[ws._debug.length - 1].response;

        return this.onUpgrade(request, response);
      }

      this.onUpgrade();
    });

    ws.on('open', () => {
      this.reconnectAttempts = 0;

      if (!ws._debug) {
        return this.onOpen(ws);
      }

      const request = ws._debug[0].request,
        response = ws._debug[ws._debug.length - 1].response;

      ws._debug = null;

      this.onOpen(ws, request, response);
    });

    ws.on('close', (code, reason) => {
      if (!this.reconnectAttempts) {
        this.onClose(code, reason);
      }

      // Only try to reconnect if:
      // 1. It was not a Normal Closure
      // 2. The connection was not aborted
      // 3. Connected at least once
      if (code === 1000 || this.isConnectionAborted || this.reconnectAttempts === -1) {
          return this.onEnd(code, reason);
      }

      this._reconnect(code, reason);
    });

    ws.on('message', (message) => {
      const meta = {
        mimeType: 'text/plain',
        size: 0,
        timestamp: Date.now()
      };

      if (typeof message === 'string') {
        meta.size = Buffer.byteLength(message);
        isJSON(message) && (meta.mimeType = 'application/json');

        return this.onMessage(message, meta);
      }

      meta.size = message.length;

      FileType.fromBuffer(message)
        .then(({ mime, ext } = {}) => {
          meta.mimeType = mime || 'application/octet-stream';
          meta.ext = ext || 'bin';
        })
        .catch(() => {
          meta.mimeType = 'application/octet-stream';
          meta.ext = 'bin';
        })
        .finally(() => {
          this.onMessage(message, meta);
        });
    });

    ws.on('error', (error) => {
      // If connection was aborted, absorb the error
      if (this.isConnectionAborted) {
        return;
      }

      // Emit error only for the final reconnect attempt
      if (this.reconnectAttempts > 0 && this.reconnectAttempts < this.options.retryCount) {
        return;
      }

      if (ws._debug) {
        const request = ws._debug[0].request,
          response = ws._debug[ws._debug.length - 1].response;

        ws._debug = null;

        const serializedError = serializeError(error);

        // Remove cert from error if exists since it contains self references to issuer certificate which causes stack
        // overflow.
        serializedError.cert = null;

        return this.onError(serializedError, request, response);
      }

      this.onError(serializeError(error));
    });
  }

  _reconnect (code, reason) {
    this.ws && this.ws.removeAllListeners();

    if (this.reconnectAttempts >= this.options.retryCount) {
      return this.onEnd(code, reason);
    }

    setTimeout(() => { this._open(); }, this.options.retryDelay);
    this.onReconnect(++this.reconnectAttempts, this.options.retryDelay);
  }

  send (data, { messageType, ...options } = {}, callback) {
    if (messageType === 'binary' && typeof data === 'string') {
      const buf = Buffer.from(data, 'base64');
      data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
    }

    this.ws.send(data, options, callback);
  }

  close (code, reason) {
    if (!this.ws) {
      // Mark connection as aborted if it's closed before getting established
      this.isConnectionAborted = true;
      this.onEnd();
      return;
    }

    // Mark connection as aborted if it's closed in non-open state
    // Refer: https://github.com/websockets/ws/blob/7.4.4/lib/websocket.js#L26
    if (this.ws.readyState !== 1) {
      this.isConnectionAborted = true;
    }

    this.ws.close(code, reason);
  }

  onClose (code, reason) {}

  onEnd () {}

  onError (error) {}

  onMessage (message, isBinary) {}

  onOpen () {}

  onReconnect (attempt, timeout) {}

  onUpgrade (response) {}
}

module.exports = WebSocketClient;
