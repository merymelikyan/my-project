/* eslint-disable no-labels */
const { app, dialog, BrowserWindow } = require('electron');
const collectionSDK = require('postman-collection');
const { URL } = require('url');
const fs = require('fs');
const tls = require('tls');
const path = require('path');
const util = require('util');
const crypto = require('crypto');
const uuid = require('uuid');
const lodash = require('lodash');
const request = require('postman-request');
const grpc = require('@postman/grpc-js');
const grpcReflection = require('@postman/grpc-reflection-js');
const ProtoLoader = require('@postman/proto-loader');
const Protobuf = require('@postman/protobufjs');
const EventChannel = require('../channels/EventChannel');
const PostmanFs = require('../utils/postmanFs');
const pathIsInside = require('../utils/pathIsInside');

// Definitions included:
//  - google/api/annotations.proto
//  - google/api/http.proto
//  - google/protobuf/api.proto
//  - google/protobuf/descriptor.proto
//  - google/protobuf/source_context.proto
//  - google/protobuf/type.proto
const COMMON_PROTO_FILES = path.resolve(require.resolve('@postman/protobufjs'), '..');
const TO_JSON_OPTIONS = { keepComments: true };
const PROTOBUF_OPTIONS = {
  keepCase: true,
  alternateCommentMode: true,
  json: true,
  enums: String,
  bytes: String,
  longs: String
};

const PROXY_ENV = {
  grpc_proxy: process.env.grpc_proxy,
  http_proxy: process.env.http_proxy,
  https_proxy: process.env.https_proxy,
  no_grpc_proxy: process.env.no_grpc_proxy,
  no_proxy: process.env.no_proxy
};

const unwrapStatusDetails = (function loadStatusRoot () {
  const root = new Protobuf.Root();
  let Status;

  root.load([
    COMMON_PROTO_FILES + '/google/rpc/status.proto',
    COMMON_PROTO_FILES + '/google/rpc/error_details.proto'
  ], PROTOBUF_OPTIONS, (err) => {
    if (err) {
      pm.logger.error('GRPCClient~loadStatusRoot error: ', err);
      return;
    }

    Status = root.lookup('google.rpc.Status');
  });

  return function unwrapStatusDetails (statusDetails) {
    if (!(Status && statusDetails instanceof Buffer)) {
      return;
    }

    try {
      return Status.decode(statusDetails).toJSON();
    } catch (_) {
      return;
    }
  };
})();

class GRPCClient {
  constructor (defaultWorkingDir) {
    this.defaultWorkingDir = defaultWorkingDir;
  }

  // Opens a native file selector dialog for selecting proto files.
  async openProtoSelectorDialog (workingDir) {
    if (process.platform === 'darwin') {
      app.focus({ steal: true });
    }

    const { filePaths } = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), {
      filters: [{ name: 'Protobuf', extensions: ['proto'] }],
      properties: ['openFile', 'treatPackageAsDirectory']
    });

    return sanitizeFilePath(filePaths[0], workingDir || this.defaultWorkingDir) || null;
  }

  // Opens a native file selector dialog for selecting folders.
  async openFolderSelectorDialog () {
    if (process.platform === 'darwin') {
      app.focus({ steal: true });
    }

    const { filePaths } = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), {
      properties: ['openDirectory', 'multiSelections', 'treatPackageAsDirectory']
    });

    return filePaths;
  }

  // Generates a Protobuf JSON descriptor from local proto files.
  async loadProtoFromFilename (rootFilename, importPaths = [], workingDir) {
    const root = new Protobuf.Root();
    const imports = new Map();
    const files = [];

    rootFilename = (new PostmanFs(workingDir || this.defaultWorkingDir, true)).resolvePathSync(rootFilename);

    importPaths = [...importPaths, COMMON_PROTO_FILES];

    // Overwrite the default "resolvePath" function to utilize import paths.
    const originalResolvePath = root.resolvePath;
    const resolvePath = (relativeTo, filename) => {
      if (path.isAbsolute(filename)) {
        if (isFileReadable(filename)) return filename;
      } else {
        const defaultLocation = originalResolvePath(relativeTo, filename);
        const alternativeLocations = importPaths.map((dir) => pathJoinSafe(dir, filename)).filter(Boolean);
        for (const location of [defaultLocation, ...alternativeLocations]) {
          if (isFileReadable(location)) return location;
        }
      }
      const err = new Error(`unresolved import: ${filename}`);
      err.code = 'UNRESOLVED_IMPORT';
      err.filename = filename;
      throw err;
    };
    root.resolvePath = (relativeTo, filename) => {
      const resolved = resolvePath(relativeTo, filename);

      // Capture the resolved imports, so we can rewrite them later.
      if (relativeTo) {
        let importsForFile = imports.get(relativeTo);
        if (!importsForFile) imports.set(relativeTo, importsForFile = new Map());
        importsForFile.set(filename, resolved);
      }
      return resolved;
    };

    // Overwrite the default "fetch" function to capture all source files.
    root.fetch = (filename, callback) => {
      fs.readFile(filename, (err, buffer) => {
        if (err) {
          callback(err);
        } else {
          const content = decodeProtobuf(buffer);
          files.push({ filename, content, isRoot: !files.length });
          callback(null, content);
        }
      });
    };

    await root.load(rootFilename, PROTOBUF_OPTIONS);
    root.resolveAll();

    return {
      files: rewriteLocalImports(files, imports),
      descriptor: root.toJSON(TO_JSON_OPTIONS)
    };
  }

  async loadFromServerReflection ({ url, certs, auth, metadata = [], workingDir, options, proxyOptions }) {
    url = urlParse(url);
    const { host } = url;
    setupProxy(host, options?.secureConnection, proxyOptions);

    const wrappedMetadata = wrapMetadata(metadata);
    const channelOptions = getChannelOptions(url, options);
    const credentials = await generateCredentials(certs, auth, wrappedMetadata, workingDir || this.defaultWorkingDir, options);
    const client = new grpcReflection.Client(host, credentials, channelOptions, wrappedMetadata);
    const services = await client.listServices();

    const descriptors = await Promise.all(
      services
        .filter((service) => service && service !== 'grpc.reflection.v1alpha.ServerReflection')
        .map((service) =>
          client
            .fileContainingSymbol(service)

            // Comments will not be fetched via server reflection
            // Refer: https://github.com/grpc/grpc/issues/22680
            .then((root) => root && root.toJSON(TO_JSON_OPTIONS))
        )
      );

    const descriptor = descriptors.reduce((acc, descriptor) => {
      if (!descriptor) return acc;

      lodash.merge(acc.nested, descriptor.nested);

      return acc;
    }, { nested: {} });

    return { files: [], descriptor };
  }

  // Generates a Protobuf JSON descriptor from the response of a GET request.
  // TODO: this should also support COMMON_PROTO_FILES, just like loadProtoFromFilename().
  async loadProtoFromURL (rootUrl) {
    const root = new Protobuf.Root();
    const imports = new Map();
    const files = [];

    // Overwrite the default "resolvePath" function to understand URLs.
    const originalResolvePath = root.resolvePath;
    const resolvePath = (relativeTo, filename) => {
      if ((/^https?:\/\//i).test(filename)) return filename;
      const parsedUrl = new URL(relativeTo);
      parsedUrl.pathname = originalResolvePath(parsedUrl.pathname, filename);
      return parsedUrl.toString();
    };
    root.resolvePath = (relativeTo, filename) => {
      const resolved = resolvePath(relativeTo, filename);

      // Capture the resolved imports, so we can rewrite them later.
      if (relativeTo) {
        let importsForFile = imports.get(relativeTo);
        if (!importsForFile) imports.set(relativeTo, importsForFile = new Map());
        importsForFile.set(filename, resolved);
      }
      return resolved;
    };

    // Overwrite the default "fetch" function to make HTTP requests.
    root.fetch = (url, callback) => {
      request(url, { timeout: 5000 }, (err, response, body) => {
        if (err) {
          callback(err);
        } else if (response.statusCode >= 300) {
          callback(new Error(`GET failed with ${response.statusCode} ${response.statusMessage} (${url})`));
        } else {
          const content = String(body);
          files.push({ filename: url, content, isRoot: !files.length });
          callback(null, content);
        }
      });
    };

    await root.load(rootUrl, PROTOBUF_OPTIONS);
    root.resolveAll();

    return {
      files: rewriteURLImports(files, imports),
      descriptor: root.toJSON(TO_JSON_OPTIONS)
    };
  }

  // Generates a Protobuf JSON descriptor from in-memory proto files.
  async loadProtoFromMemory (files) {
    if (files.length === 0) {
      throw new Error('Definition is empty');
    }
    if (files.length === 1 && files[0].filename === null) {
      files = [{ ...files[0], filename: 'Protobuf' }];
    }

    // Get the root files.
    const rootFiles = files.filter((x) => x.isRoot);
    if (!rootFiles.length) {
      throw new Error('no root files');
    }

    const root = new Protobuf.Root();
    const filesByPath = new Map(files.map((file) => [file.filename, file.content]));

    // Overwrite the default "resolvePath" function to read from memory.
    const originalResolvePath = root.resolvePath;
    root.resolvePath = (relativeTo, filename) => {
      if (path.posix.isAbsolute(filename)) {
        if (filesByPath.has(filename.slice(1))) return filename.slice(1);
      } else {
        const defaultLocation = originalResolvePath(relativeTo, filename);
        if (filesByPath.has(defaultLocation)) return defaultLocation;
        const commonLocation = pathJoinSafe(COMMON_PROTO_FILES, filename);
        if (commonLocation && isFileReadable(commonLocation)) return commonLocation;
      }
      const err = new Error(`unresolved import: ${filename}`);
      err.code = 'UNRESOLVED_IMPORT';
      err.filename = filename;
      throw err;
    };

    // Overwrite the default "fetch" function to read from memory.
    root.fetch = (filename, callback) => {
      if (filesByPath.has(filename)) {
        setImmediate(() => {
          callback(null, filesByPath.get(filename));
        });
      } else {
        fs.readFile(filename, (err, buffer) => {
          if (err) {
            callback(err);
          } else {
            callback(null, decodeProtobuf(buffer));
          }
        });
      }
    };

    await root.load(rootFiles.map((x) => x.filename), PROTOBUF_OPTIONS);
    root.resolveAll();

    return {
      files,
      descriptor: root.toJSON(TO_JSON_OPTIONS)
    };
  }

  // Generates a Protobuf JSON descriptor from an in-memory (string) proto file.
  async loadProtoFromString (str) {
    const root = new Protobuf.Root();
    const fakeFilename = uuid.v4();

    // Overwrite the default "fetch" function to only return our string.
    root.fetch = (filename, callback) => {
      setImmediate(() => {
        if (filename === fakeFilename) callback(null, str);
        else callback(new Error(`unresolved import: ${filename}`));
      });
    };

    try {
      await root.load(fakeFilename, PROTOBUF_OPTIONS);
      root.resolveAll();
    } catch (err) {
      // Remove mentions of the fake filename in any error messages.
      err.message = err.message.replace(new RegExp(`\\b${fakeFilename}\\b(, *)?`, 'g'), '');
      throw err;
    }

    return {
      files: [{ filename: null, content: str, isRoot: true }],
      descriptor: root.toJSON(TO_JSON_OPTIONS)
    };
  }

  // Invokes an RPC on a remote gRPC server.
  async request ({ location, message, metadata = [], options, proxyOptions, certs, auth, workingDir }) {
    const packageDefinition = ProtoLoader.fromJSON(location.descriptor, {
      ...PROTOBUF_OPTIONS,
      defaults: Boolean(options?.includeDefaultFields)
    });
    const hierarchy = grpc.loadPackageDefinition(packageDefinition);
    const Service = lodash.get(hierarchy, location.service);
    if (!Service) {
      throw new Error(`No gRPC service: ${location.service}`);
    }

    const url = urlParse(location.url);
    const { host } = url;
    setupProxy(host, options?.secureConnection, proxyOptions);

    const wrappedMetadata = wrapMetadata(metadata);
    const channelOptions = getChannelOptions(url, options);
    const callOptions = getCallOptions(options);
    const credentials = await generateCredentials(certs, auth, wrappedMetadata, workingDir || this.defaultWorkingDir, options);
    const client = new Service(host, credentials, channelOptions);
    const method = client[location.method];

    if (typeof method !== 'function') {
      throw new Error(`No gRPC method: ${location.method}`);
    }

    const args = [wrappedMetadata, callOptions];
    const channel = new EventChannel();

    if (!method.requestStream) {
      message && Object.setPrototypeOf(message, null);
      args.unshift(message);
    }

    if (!method.responseStream) {
      args.push((err, data) => {
        if (err) {
          logUnexpectedError(err);
        } else {
          channel.emit('responseData', { data });
        }
      });
    }

    // Invoke the RPC, and output events to the channel.
    const call = method.apply(client, args)
      .on('metadata', (metadata) => {
        metadata = unwrapMetadata(metadata);
        channel.emit('responseStarted', { metadata, host });
      })
      .on('status', ({ code, details: message, metadata }) => {
        const statusDetails = unwrapStatusDetails(metadata.get('grpc-status-details-bin')[0]);

        metadata = unwrapMetadata(metadata);
        channel.emit('status', {
          code,
          codeName: grpc.status[code],
          metadata,
          message,
          details: statusDetails?.details
        });
        channel.destroy();
      })
      .on('data', (data) => {
        channel.emit('responseData', { data });
      })
      .on('error', logUnexpectedError);

    // Accept events received from the channel.
    channel
      .addCleanup(() => {
        call.cancel();
      })
      .on('cancel', () => {
        call.cancel();
      })
      .on('write', (data) => {
        if (call.writable) {
          data && Object.setPrototypeOf(data, null);
          call.write(data);
          channel.emit('requestData', { data });
        }
      })
      .on('end', () => {
        if (call.writable) {
          call.end();
        }
      });

    // Emit these events asynchronously.
    setImmediate(() => {
      const normalizedMetadata = unwrapMetadata(wrapMetadata(metadata));
      channel.emit('requestStarted', { metadata: normalizedMetadata, host });

      if (!method.requestStream) {
        channel.emit('requestData', { data: message });
      }
    });

    return channel;
  }
}

/**
 * @param {Object} url
 * @param {String} url.host
 * @param {String} url.pathname
 * @param {String} url.protocol
 * @param {Object} options
 * @returns {Object} grpc.ClientOptions
 */
function getChannelOptions (url, options = {}) {
  const { host, pathname, protocol } = url;

  return {
    'grpc.max_send_message_length': -1,
    'grpc.max_receive_message_length': options.maxResponseMessageSize,
    'grpc.ssl_target_name_override': options.serverNameOverride,

    channelFactoryOverride: (address, credentials, options) => {
      if (protocol === 'grpc:' && pathname) {
        return new PathAwareChannel(host, credentials, options, pathname);
      }

      return new grpc.Channel(address, credentials, options);
    }
  };
}

/**
 * Generates call options for a gRPC call
 * @param {Object} options
 * @param {number} options.timeout - The timeout value in milliseconds.
 * @returns {grpc.CallOptions}
 */
function getCallOptions (options) {
  const { connectionTimeout } = options;

  return connectionTimeout ? { deadline: new Date(Date.now() + connectionTimeout) } : {};
}

/**
 * Create channel credentials based on User configuration
 * @param {Object} certs
 * @param {String} certs.ca The file path for CA certificates
 * @param {String} certs.client The file path for the client's certificate chain
 * @param {String} certs.key The file path for the client's private key
 * @param {String} certs.pfx The file path for the client's PFX certificate
 * @param {String} certs.passphrase Shared passphrase used for a private key and/or a PFX
 * @param {Object} auth The JSON representation of collectionSDK.RequestAuth
 * @param {Object} metadata grpc.Metadata instance
 * @param {String} workingDir The path from which certs is relative to
 * @param {Object} options Request configurations
 *
 * @returns {Promise<grpc.credentials~ChannelCredentials>}
*/
async function generateCredentials (certs = {}, auth, metadata, workingDir, options = {}) {
  if (options.secureConnection !== true) {
    if (auth && metadata) {
      metadata.merge(wrapAuthMetadata(auth));
    }

    return grpc.credentials.createInsecure();
  }

  if (!workingDir) {
    throw new TypeError('Missing path to working directory');
  }

  const postmanFs = new PostmanFs(workingDir);
  const readFile = util.promisify(postmanFs.readFile.bind(postmanFs));
  const [rootCerts, privateKey, certChain, pfxCert] = await Promise.all([
    certs.ca && readFile(certs.ca),
    certs.key && readFile(certs.key),
    certs.client && readFile(certs.client),
    certs.pfx && readFile(certs.pfx)
  ]);

  const secureContext = tls.createSecureContext({
    key: privateKey || undefined,
    cert: certChain || undefined,
    pfx: pfxCert || undefined,
    passphrase: certs.passphrase || undefined
  });

  // Extend the well known "root" CAs
  rootCerts && secureContext.context.addCACert(rootCerts);

  const channelCredentials = grpc.credentials.createFromSecureContext(secureContext);
  if (options.strictSSL !== true) {
    // Disable verification of the server's certificate
    channelCredentials.connectionOptions.rejectUnauthorized = false;
  }

  const authMetadata = auth && wrapAuthMetadata(auth);
  const callCredentials = authMetadata && grpc.credentials.createFromMetadataGenerator((_, callback) => {
    callback(null, authMetadata);
  });

  return grpc.credentials.combineChannelCredentials(channelCredentials, callCredentials);
}

/**
 * Create call credentials based on the auth provided by the user.
 * Supported types: 'basic' | 'bearer' | 'apikey'.
 *
 * @param {Object} auth - JSON representation of collectionSDK.RequestAuth
 * @returns {grpc.Metadata}
 */
function wrapAuthMetadata (auth = {}) {
  if (!auth.type || !auth[auth.type]) {
    throw new Error('Invalid auth format');
  }

  const authMetadata = new grpc.Metadata();
  const sdkAuth = new collectionSDK.RequestAuth(auth).parameters();

  let key = '';
  let value = '';

  switch (auth.type) {
    case 'basic':
      key = 'Authorization';
      value = 'Basic ' +
        Buffer
          .from(`${sdkAuth.get('username') || ''}:${sdkAuth.get('password') || ''}`, 'utf8')
          .toString('base64');
      break;

    case 'bearer':
      key = 'Authorization';
      value = `Bearer ${sdkAuth.get('token') || ''}`;
      break;

    case 'apikey':
      key = sdkAuth.get('key') || '';
      value = sdkAuth.get('value') || '';
      if (!key.trim()) {
        throw new Error('Invalid metadata with empty key in "API Key" auth');
      }
      break;

    default:
      throw new Error(`Unsupported authorization type: ${auth.type}`);
  }

  authMetadata.add(key, value);

  return authMetadata;
}

/**
 * Converts an array of metadata into a format usable by the grpc-js library.
 *
 * @param {Object[]} metadata
 * @returns {grpc.Metadata}
 */
function wrapMetadata (metadata) {
  const grpcMetadata = new grpc.Metadata();

  for (const { key, value } of metadata) {
    let processedValue = String(value || '');

    if (key.toLowerCase().endsWith('-bin')) {
      // TODO: provide some hint to the user that metadata ending in "-bin" should be base64
      processedValue = Buffer.from(processedValue, 'base64');
    }

    grpcMetadata.add(key, processedValue);
  }

  return grpcMetadata;
}

/**
 * Converts metadata from the grpc-js library to an array of key-value pairs.
 *
 * @param {grpc.Metadata} grpcMetadata
 * @returns {Object[]}
 */
function unwrapMetadata (grpcMetadata) {
  const metadata = [];

  for (const [key, values] of Object.entries(grpcMetadata.toJSON())) {
    for (let value of values) {
      if (Buffer.isBuffer(value)) {
        value = value.toString('base64');
      }

      metadata.push({ key, value });
    }
  }

  return metadata;
}

/**
 * Setup proxy by setting appropriate 'grpc_proxy' environment variable.
 * @todo fork '@grpc/grpc-js' to accept proxy configuration.
 */
function setupProxy (host, isSecure, config = {}) {
  const url = isSecure === true ? `https://${host}` : `http://${host}`;

  // unset all proxy environment variables
  for (const env in PROXY_ENV) {
    if (process.env[env]) {
      delete process.env[env];
    }
  }

  // 1. check for custom proxy
  const configList = new collectionSDK.ProxyConfigList({}, config.proxyConfigList);
  const proxyConfig = configList.resolve(url);
  if (proxyConfig) {
    process.env.grpc_proxy = proxyConfig.getProxyUrl();
    return;
  }

  // 2. fallback to system proxy
  if (config.useSystemProxy) {
    // TODO: add support for system proxy
  }

  // 3. reset proxy environment variables
  if (!config.ignoreProxyEnvironmentVariables) {
    for (const env in PROXY_ENV) {
      if (PROXY_ENV[env]) {
        process.env[env] = PROXY_ENV[env];
      }
    }
  }
}

/**
 * @param {String} urlStr
 * @returns {{host: String, pathname: String, protocol: String}}
 */
function urlParse (urlStr) {
  urlStr = urlStr.replace(/^(grpc:)?\/\//i, '');

  const schemeMatch = urlStr.match(/^([a-z0-9+.-]+):\/\//i);
  const scheme = schemeMatch && schemeMatch[1];
  if (scheme && scheme !== 'unix') {
    throw new Error(`Invalid protocol "${scheme}", try "grpc://" instead`);
  }

  urlStr = urlStr.startsWith('unix:') ? urlStr : `grpc://${urlStr}`;
  let url;

  try {
    url = new URL(urlStr);
  } catch (_) {
    throw new CustomError(`Invalid URL "${urlStr}"`, 'ERR_INVALID_URL');
  }

  return {
    host: url.protocol === 'unix:' ? url.href : url.host,
    pathname: url.pathname,
    protocol: url.protocol
  };
}

/**
 * Check if the given file is readable.
 */
function isFileReadable (filename) {
  try {
    fs.accessSync(filename, fs.constants.R_OK);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Converts a Protobuf file (Buffer) to a string, attempting to guess the text
 * encoding being used.
 */
function decodeProtobuf (buffer) {
  const regex = /\b(proto|package|service|message)\b/i;
  const utf8 = String(buffer);
  if (!regex.test(utf8)) {
    const utf16 = buffer.toString('utf16le');
    if (regex.test(utf16)) return utf16;
  }
  return utf8;
}

/**
 * Returns true if the given root path contains the given child path.
 */
function pathContains (root, child) {
  if (child.endsWith(path.sep)) child = child.slice(0, -1);
  if (!root.endsWith(path.sep)) root += path.sep;
  return child.startsWith(root);
}

/**
 * Joins two filesystem paths, while ensuring that the resulting path still
 * has the original root (e.g., not too many ".." segments were used).
 */
function pathJoinSafe (root, appended) {
  const joined = path.join(root, appended);
  if (pathContains(root, joined)) return joined;
  return null;
}

/**
 * Rewrite URL imports.
 */
function rewriteURLImports (files, imports) {
  // Map each original filename (url) to a simplified filename.
  const rewrites = new Map();
  for (const file of files) {
    const url = new URL(file.filename);
    const simpleFilename = `${url.host}/${url.pathname.slice(1) || '_index'}`;

    // There could be naming collisions, so disambiguate as needed.
    let rewrittenFilename = simpleFilename;
    while (rewrites.has(rewrittenFilename)) {
      rewrittenFilename = `${simpleFilename}-${randomTag()}`;
    }

    rewrites.set(file.filename, rewrittenFilename);
  }

  // Rewrite filenames and import statements.
  for (const file of files) {
    const importRelativeTo = path.posix.dirname(rewrites.get(file.filename));

    for (const [importedPath, resolvedPath] of imports.get(file.filename) || new Map()) {
      // This is a very naive way of rewriting import statements. We literally
      // just guess at what they should look like, and try to find them exactly,
      // rather than properly parsing, mutating an AST, and then de-compiling.
      // This assumes the user doesn't have any escape sequences (other than \\)
      // in the import statement. It also assumes the import statement only uses a
      // a single string literal, rather than multiple adjacent string literals
      // (which would be treated as a single string by the Protobuf parser).
      const rewrittenPath = path.posix.relative(importRelativeTo, rewrites.get(resolvedPath));
      const found
        = replaceInFile(file, toProtoString(importedPath, '"'), toProtoString(rewrittenPath, '"'))
        + replaceInFile(file, toProtoString(importedPath, '\''), toProtoString(rewrittenPath, '\''));
      if (!found) {
        throw new Error('failed to process import statements');
      }
    }

    file.filename = rewrites.get(file.filename);
  }

  return files;
}

/**
 * Rewrite local imports.
 */
function rewriteLocalImports (files, imports) {
  files = files.filter((file) => !pathContains(COMMON_PROTO_FILES, file.filename));

  // Find the common root directory of all files.
  let root = path.dirname(files[0].filename);
  findRoot: for (const file of files) {
    while (!pathContains(root, file.filename)) {
      const newRoot = path.dirname(root);
      if (newRoot !== root) {
        root = newRoot;
      } else {
        // In this case, there's no common root directory. This can only happen
        // if they tried to import from multiple drives on Windows. We have to
        // manually break to avoid an infinite loop.
        root = '';
        break findRoot;
      }
    }
  }

  // Trim the root from all paths.
  const rootLength = root.length + (root && !root.endsWith(path.sep) ? 1 : 0);
  const paths = new Map();
  for (const file of files) {
    paths.set(file, file.filename.slice(rootLength).split(path.sep));
  }

  // Trim paths further until a namespace collision would occur. A namespace
  // collision is when two distinct directories would be merged and treated as
  // the same directory.
  untilCollision: for (;;) {
    const newRoots = new Map();
    for (const segments of paths.values()) {
      if (segments.length < 3) {
        break untilCollision;
      }
      const [oldRoot, newRoot] = segments;
      if (newRoots.has(newRoot) && newRoots.get(newRoot) !== oldRoot) {
        break untilCollision;
      }
      newRoots.set(newRoot, oldRoot);
    }

    // No collision was detected, so trim one segment from each path.
    for (const segments of paths.values()) {
      segments.splice(0, 1);
    }
  }

  // Map each original filename to its rewritten filename.
  const rewrites = new Map(files.map((file) => {
    const segments = paths.get(file);
    const rewrittenFilename = segments.join('/'); // Always use Unix-style paths in the end
    return [file.filename, rewrittenFilename];
  }));

  // Lastly, rewrite filenames and import statements.
  for (const file of files) {
    const importRelativeTo = path.posix.dirname(rewrites.get(file.filename));

    for (const [importedPath, resolvedPath] of imports.get(file.filename) || new Map()) {
      if (pathContains(COMMON_PROTO_FILES, resolvedPath)) {
        continue;
      }

      // This is a very naive way of rewriting import statements. We literally
      // just guess at what they should look like, and try to find them exactly,
      // rather than properly parsing, mutating an AST, and then de-compiling.
      // This assumes the user doesn't have any escape sequences (other than \\)
      // in the import statement. It also assumes the import statement only uses a
      // a single string literal, rather than multiple adjacent string literals
      // (which would be treated as a single string by the Protobuf parser).
      const rewrittenPath = path.posix.relative(importRelativeTo, rewrites.get(resolvedPath));
      const found
        = replaceInFile(file, toProtoString(importedPath, '"'), toProtoString(rewrittenPath, '"'))
        + replaceInFile(file, toProtoString(importedPath, '\''), toProtoString(rewrittenPath, '\''));
      if (!found) {
        throw new Error('failed to process import statements');
      }
    }

    file.filename = rewrites.get(file.filename);
  }

  return files;
}

/**
 * Attempts to replace all instances of a string within a file, and returns how
 * many such instances were found.
 */
function replaceInFile (file, oldString, newString) {
  let position = 0;
  let found = 0;
  do {
    const index = file.content.indexOf(oldString, position);
    if (index === -1) break;
    file.content = file.content.slice(0, index) + newString + file.content.slice(index + oldString.length);
    position = index + newString.length;
    found += 1;
  } while (position < file.content.length);
  return found;
}

/**
 * Formats a string as a Protobuf-syntax string.
 * This assumes there are no tabs, newlines, quotes, or nul-bytes in the string.
 * The official Protobuf library doesn't even support escaping quotes right now:
 * https://github.com/protobufjs/protobuf.js/issues/1432
 */
function toProtoString (str, quote = '"') {
  return quote + str.replace(/\\/g, '\\\\') + quote;
}

/**
 * Generates a random tag that can be used within file paths.
 */
function randomTag (bytes = 6) {
  return crypto.randomBytes(bytes).toString('base64').replace(/\//g, '_');
}

/**
 * The grpc-js library is supposed to propagate any possible error to the
 * "status" event, so we don't need to handle them in other places. However,
 * just in case, we'll log any errors we find that aren't related to gRPC.
*/
function logUnexpectedError (err) {
  if (!err.metadata) {
    pm.logger.error('GRPCClient~unexpectedError: ', err);
  }
}

/**
 * 1. Convert paths inside working directory to corresponding relative paths, and
 * 2. Convert win32 file path to posix like path to support cross os file read
 * Note: Part of it is referenced from src/renderer/runtime-repl/_common/FsHelper.js
 * @param {String} filePath
 * @param {String} workingDir
 *
 * @returns {String} sanitized filePath
 *
 */
function sanitizeFilePath (filePath, workingDir) {
  // Set the relative path of the file from the workingDir as the selected file path
  if (pathIsInside(filePath, workingDir)) {
    filePath = path.relative(workingDir, filePath);
  }

  // Ignore sanitization is os platform is not windows
  if (global.process.platform !== 'win32' || !filePath) {
    return filePath;
  }

  // If path is absolute and it's not already sanitized then prepend path with an extra `\\`
  path.win32.isAbsolute(filePath) && filePath[0] !== '/' && (filePath = `\\${filePath}`);

  // Convert all \\ to /
  /**
   * Benchmark for using split.join vs replace regex
   * The space complexity of split/join is not a big factor
   *
   * Split#test x 18,503 ops/sec ±4.30% (76 runs sampled)
   * Regex#test x 11,308 ops/sec ±7.83% (67 runs sampled)
   * Fastest is Split#test
   */
  return filePath.split(path.win32.sep).join(path.posix.sep);
}

class PathAwareChannel extends grpc.Channel {
  constructor (target, credentials, options, path) {
    super(target, credentials, options);
    this._prefix = path;
  }

  createCall (method, ...args) {
    if (this._prefix && this._prefix !== '/') {
      method = `${this._prefix}${method}`;
    }

    return super.createCall(method, ...args);
  }
}

class CustomError extends Error {
  constructor (message, code) {
    super(message);
    this.code = code;
  }
}

module.exports = GRPCClient;
