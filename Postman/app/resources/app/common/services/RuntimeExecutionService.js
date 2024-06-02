// ###### WARNING: DO NOT REQUIRE NON-ISOMORPHIC LIBRARIES HERE
let _ = require('lodash'),
  async = require('async'),

  EventProcessor = require('./RuntimeEventProcessor'),
  sendAnalyticsEvent = require('../../services/sendAnalytics'),

  { AbortError } = require('./VaultIntegrationService'),

  // ###### WARNING: DO NOT REQUIRE NON-ISOMORPHIC LIBRARIES HERE

  // Character detection to node encoding map
  CHARDET_BUFF_MAP = {
    ASCII: 'ascii',
    'UTF-8': 'utf8',
    'UTF-16LE': 'utf16le',
    'ISO-8859-1': 'latin1'
  },

  detectEncoding = (buff) => CHARDET_BUFF_MAP[chardet.detect(buff)],

  isBrowser = false,


  // TODO: Implement these using a dependency injection model like awilix
  fs,
  os,
  app,
  path,
  dialog,
  chardet,
  session,
  WebSocket,
  PostmanFs,
  packageResolver,
  CookieJar,
  dryRunRequest,
  SocketIOClient,
  getSystemProxy,
  SerializedError,
  collectionRunner,
  sanitizeFilename,
  postmanCollectionSdk,

  defaultWorkingDir,

  activeRuns = {},

  // Object to store the abort controllers for requests in progress
  activeRunPreparations = {},

  openWSConnections = {};

  /**
 * Resolves vault variables and updates environment object IN-PLACE
 * All the secretVaulues will be returned as an Array
 * @param {import('./VaultIntegrationService').VaultManager} vault
 * @param {object} secrets
 * @param {AbortSignal} abortSignal
 * @returns {Promise<boolean>} -- if the request was aborted by user
 */
async function _resolveVaultVariables (vault, secrets, abortSignal) {
  if (isBrowser) {
    return false;
  }

  // If vault is not initialized just remove the vault variables frome environment
  if (!vault) {
    secrets.forEach(
      (secret) => {
        if (_.isPlainObject(secret)) {
          secret.value = '{{' + secret.key + '}}';
        }
      }
    );

    return false;
  }


  // Get all the secretIds to resolve

  let vaultIntegrationSecrets = [];
  let unresolvedVaultIntegrationSecrets = new Set();

    if (!(Array.isArray(secrets) && secrets.length)) {
      return false;
    }

    for (const secret of secrets) {
      let isFromExternalProvider = secret.provider && secret.provider.id;
      if (isFromExternalProvider) {
        if (vault.isSupportedSecret(secret.value, secret.provider.id)) {
          vaultIntegrationSecrets.push(secret);
        } else {
          unresolvedVaultIntegrationSecrets.add(secret);
        }
      }
  }

  // Resolve secrets
  let resolutionResult;

  try {
    resolutionResult = await vault.resolveSecrets(vaultIntegrationSecrets.map((x) => ({
      secretId: x.value,
      ...(x?.metadata?.role ? { assumedRole: x.metadata.role } : {}),
      ...(x?.metadata?.version ? { version: x.metadata.version } : {}),
      vaultId: x.provider.id
    })), abortSignal);

  } catch (e) {
    if (e instanceof AbortError) {
        return true;
    }
    throw e;
  }

  // Replace vault integration secret values with resolved value
  for (const [idx, [secretId, result]] of Object.entries(resolutionResult)) {
    if (result.success) {
      vaultIntegrationSecrets[idx].value = result.value;
    }
    else {
      unresolvedVaultIntegrationSecrets.add(vaultIntegrationSecrets[idx]);

      if (result.error == null) continue;
      pm.logger.warn('RuntimeExecutionService~startRun.resolveVaultVariables', {
        secretId: secretId,
        error: result.error.message
      });
    }
  }
  for (const unresolvedSecret of unresolvedVaultIntegrationSecrets) {
    unresolvedSecret.value = '{{' + unresolvedSecret.key + '}}';
  }

  return false;
}

const { EventSanitizer } = require('../utils/eventSanitizer'),
SECRET_TYPE = 'secret',
VAULT_SCOPE = 'vault';

/**
 * Helper function to get the file extension given a mime-type
 * @param {String} mimeType
 */
function __getProbableExtension (mimeType) {
  var mimeExtensions = [
    {
      typeSubstring: 'text',
      extension: '.txt'
    },
    {
      typeSubstring: 'json',
      extension: '.json'
    },
    {
      typeSubstring: 'javascript',
      extension: '.js'
    },
    {
      typeSubstring: 'pdf',
      extension: '.pdf'
    },
    {
      typeSubstring: 'png',
      extension: '.png'
    },
    {
      typeSubstring: 'jpg',
      extension: '.jpg'
    },
    {
      typeSubstring: 'jpeg',
      extension: '.jpg'
    },
    {
      typeSubstring: 'gif',
      extension: '.gif'
    },
    {
      typeSubstring: 'excel',
      extension: '.xls'
    },
    {
      typeSubstring: 'zip',
      extension: '.zip'
    },
    {
      typeSubstring: 'compressed',
      extension: '.zip'
    },
    {
      typeSubstring: 'audio/wav',
      extension: '.wav'
    },
    {
      typeSubstring: 'tiff',
      extension: '.tiff'
    },
    {
      typeSubstring: 'shockwave',
      extension: '.swf'
    },
    {
      typeSubstring: 'powerpoint',
      extension: '.ppt'
    },
    {
      typeSubstring: 'mpeg',
      extension: '.mpg'
    },
    {
      typeSubstring: 'quicktime',
      extension: '.mov'
    },
    {
      typeSubstring: 'html',
      extension: '.html'
    },
    {
      typeSubstring: 'css',
      extension: '.css'
    }
  ];

  for (var i = 0; i < mimeExtensions.length; i++) {
    if (mimeType.indexOf(mimeExtensions[i].typeSubstring) > -1) {
      return mimeExtensions[i].extension;
    }
  }

  return '';
}


// #region API Functions

/**
 * @private
 */
function trackRun (executionId, run, processor) {
  // Set the processor as the runs processor
  run.processor = processor;

  activeRuns[executionId] = run;
}

/**
 * @private
 */
function addAborter (executionId, aborter) {
  activeRuns[executionId] && (activeRuns[executionId].aborter = aborter);
}

/**
 * @private
 */
function removeAborter (executionId) {
  activeRuns[executionId] && (delete activeRuns[executionId].aborter);
}

/**
 * @private
 * Sanitizes options to be sent to runtime. Mostly converting objects into SDK instances.
 *
 * @param {Object} rawOptions
 */
function sanitizeRunOptions (rawOptions) {
  if (!rawOptions) {
    return;
  }

  if (!rawOptions.requester) {
    rawOptions.requester = {};
  }

  if (!rawOptions.requester.authorizer) {
    rawOptions.requester.authorizer = {};
  }

  // Add the refresh token helper - Interface to refresh access tokens in app
  rawOptions.requester.authorizer.refreshOAuth2Token = pm.refreshTokenManager &&
    pm.refreshTokenManager.refreshToken;

  if (rawOptions.useSystemProxy && !!getSystemProxy) {
    rawOptions.systemProxy = getSystemProxy;
  }

  if (rawOptions.proxies) {
    rawOptions.proxies = new postmanCollectionSdk.ProxyConfigList({}, rawOptions.proxies);
  }

  rawOptions.certificates = new postmanCollectionSdk.CertificateList({}, rawOptions.certificates);
}

/**
 * @private
 * Save the given stream to a file the user chooses
 *
 * @param {Object} contentInfo
 * @param {Buffer} stream
 */
function saveStreamToFile (contentInfo, stream, cb) {
  let name;

  // sdkResponse override
  if (contentInfo && contentInfo.fileName) {
    name = contentInfo.fileName || '';
  }

  if (_.isEmpty(name)) {
    name = 'response';
    name = (contentInfo && contentInfo.mimeType) ? `${name}${__getProbableExtension(contentInfo.mimeType)}` : name;
  }

  if (isBrowser) {
    // eslint-disable-next-line no-undef
    let blob = new Blob([stream]),
      url = URL.createObjectURL(blob),

      // eslint-disable-next-line no-undef
      element = document.createElement('a');

    element.setAttribute('href', url);
    element.setAttribute('download', name);
    element.style.display = 'none';

    // eslint-disable-next-line no-undef
    document.body.appendChild(element);

    // simulate click to start downloading
    element.click();

    // cleanup
    // eslint-disable-next-line no-undef
    document.body.removeChild(element);
    URL.revokeObjectURL(url);
    blob = null;

    // Known Issue: Firefox shows a default “save dialog” when downloading
    // response via browser or cloud agent. Due to this our success toasts
    // gets triggered irrespective of the option user selects in the dialog
    // See: https://postmanlabs.atlassian.net/browse/RUNTIME-2823

    return cb(null, true);
  }

  // WARNING: All usages below require native dependencies hence be careful in browser environment

  name = sanitizeFilename(name, { replacement: '-' });

  // Steal focus for agent application on macOS.
  // This is done to handle the case where the
  // save dialog was hiding behind the browser window on macOS.
  // Refer: https://github.com/electron/electron/blob/v9.4.3/docs/api/app.md#appfocusoptions
  if (process.platform === 'darwin') {
    app.focus({ steal: true });
  }

  dialog.showSaveDialog({
    title: 'Select path to save file',
    defaultPath: name, // Default filename to be used
    properties: ['treatPackageAsDirectory']
  }).then((result) => {
    if (result.canceled) {
      // If the request was cancelled then don't do anything, not even call the callback;
      return cb(null, false);
    }

    fs.writeFile(result.filePath, stream, (err) => {
      return cb(err, true);
    });
  })
  .catch(cb);
}

/**
 * Abort and cleanup an existing collection run
 *
 * @param {String} executionId - The execution id to terminate or dispose
 * @param {Function} emit - emitter to call to denote the execution has terminated/disposed
 */
function disposeRun (executionId, emit = _.noop) {
  if (!executionId || !activeRuns[executionId]) {
    return;
  }

  const run = activeRuns[executionId];

  run.host && run.host.dispose && run.host.dispose();

  // dispose the reference
  activeRuns[executionId] = null;

  emit({ id: executionId, event: '__dispose__' });
}

/**
 * @public
 * Stops and disposes an existing collection run
 *
 * @param {String} executionId - The execution id to terminate or dispose
 * @param {Function} emit - emitter to call to denote the execution has terminated/disposed
 */
function stopRun (executionId, emit) {
  // if an abort controller exists for this request
  // use it to stop all ongoing tasks
  if (activeRunPreparations[executionId]) {
    activeRunPreparations[executionId].abort();
    delete activeRunPreparations[executionId];
    emit({ id: executionId, event: '__dispose__' });
    return;
  }

  if (!executionId || !activeRuns[executionId]) {
    return;
  }

  const run = activeRuns[executionId];

  run.aborter && run.aborter.abort();
  run.abort();

  // Force call the stop event as postman-runtime will no longer call any event
  run.processor.call('abort', [null]);

  disposeRun(executionId, emit);
}

/**
 * @public
 * Pause the current collection run
 *
 * @param {String} executionId
 */
function pauseRun (executionId) {
  if (!executionId || !activeRuns[executionId]) {
    return;
  }

  activeRuns[executionId].pause();
}

/**
 * @public
 * Resume the paused current collection run
 *
 * @param {String} executionId
 */
function resumeRun (executionId) {
  if (!executionId || !activeRuns[executionId]) {
    return;
  }

  activeRuns[executionId].resume();
}

/**
 * @public
 * Start a collection run with the given collection and variables
 *
 * @param {Object} info
 * @param {Object} collection
 * @param {Object} variables
 * @param {Object} options
 */
async function startRun (info, collection, variables, options = {}, cookieStorageRemoteClient, vaultClient, emit) {
  const sdkCollection = new postmanCollectionSdk.Collection(collection);

  let cookieJar,
    eventProcessor;

  // We have the cookieStorageRemoteClient
  if (cookieStorageRemoteClient) {
    cookieJar = new CookieJar(cookieStorageRemoteClient, {
      programmaticAccess: options.cookieConfiguration,
      readFromDB: !_.get(info, 'cookie.runtimeWithEmptyJar', false),
      writeToDB: !_.get(info, 'cookie.disableRealtimeWrite', false),
      onCookieAccessDenied: (domain) => {
        let message = `Unable to access "${domain}" cookie store.` +
          ' Try whitelisting the domain in "Manage Cookies" screen.' +
          ' View more detailed instructions in the Learning Center: https://go.pstmn.io/docs-cookies';

        emit({
          name: 'log',
          namespace: 'console',
          data: {
            id: info.id,
            cursor: {},
            level: 'warn',
            messages: [message]
          }
        });
      }
    });

    _.set(options, ['requester', 'cookieJar'], cookieJar);
  }

  // fileResolver defined and we have PostmanFs
  if (options.fileResolver && !!PostmanFs) {
    let { workingDir, insecureFileRead, fileWhitelist } = options.fileResolver;

    _.set(options, 'fileResolver', new PostmanFs(workingDir || defaultWorkingDir, insecureFileRead, fileWhitelist));
  }

  if (options.script && options.script.isPackageResolverEnabled) {
    const packageResolverInstance = new packageResolver(app.getPath('temp'), collection?.info?._postman_id);

    _.set(options, 'script.packageResolver', packageResolverInstance.resolvePackages);
  }


  // sanitize
  sanitizeRunOptions(options);

  // Prepare run
  // resolve vault secrets from 3rd party vaults if any
  // if there are no secrets from 3rd party vaults, go about the regular flow
  if (variables.secrets?.some((secret) => secret.provider?.id)) {
    let abort = new AbortController();

    // store the abort controller for this request. This is required during
    // stopRun to stop all ongoing tasks
    activeRunPreparations[info.id] = abort;

    let isAborted = await _resolveVaultVariables(vaultClient, variables.secrets, abort.signal);
    if (isAborted) {
      emit({ id: info.id, event: 'abort' });
      return;
    }

    delete activeRunPreparations[info.id];
  }

  // Sanitize runtime events for vault variables to redact their values
  const sensitiveWords = [];
  let secrets = null;

  if (!_.isEmpty(variables.secrets)) {
    secrets = { id: VAULT_SCOPE, values: variables.secrets.map((s) => {
      return {
        enabled: s.enabled,
        type: s.type,
        key: s.key,
        value: s.value,
        _domains: s.domains,
        shouldMaskInConsole: s.shouldMaskInConsole
      };
    }) };
  }

  secrets && secrets.values && secrets.values.forEach((secret) => {
    if (secret.type == SECRET_TYPE && _.isString(secret.value) && secret.shouldMaskInConsole) {
      sensitiveWords.push(secret.value);
    }
  });

  const eventSanitizer = new EventSanitizer(sensitiveWords);

  // Create an event processor instance and handling runtime events
  eventProcessor = new EventProcessor(info.schema, (event, data, refs) => {
    try {
      // Sanitize all the outgoing events against vault variables i.e. redact vault variable value
      data = eventSanitizer.sanitizeRuntimeEvent(event, data);
      emit({ id: info.id, event, data, refs });
    }
    catch (e) {
      pm.logger.error('RuntimeExecutionService~eventSanitizer.sanitizeRuntimeEvent', e);
    }
  });

  // add variables
  variables.environment && (options.environment = new postmanCollectionSdk.VariableScope(variables.environment));
  variables.globals && (options.globals = new postmanCollectionSdk.VariableScope(variables.globals));
  variables.secrets && (options.vaultSecrets = new postmanCollectionSdk.VariableScope(secrets));

  // Heap memory used before start of the run.
  const startMemory = process?.memoryUsage().heapUsed;

  collectionRunner.run(sdkCollection, options, function (err, run) {
    if (err) {
      pm.logger.error('RuntimeExecutionService~startRun - Error in starting the run', err);

      emit({ id: info.id, event: '__dispose__', error: true });
      return;
    }

    trackRun(info.id, run, eventProcessor);

    // Intercept beforeRequest and response and done events
    eventProcessor.intercept('beforeRequest', (_, __, ___, ____, aborter) => {
      addAborter(info.id, aborter);
    });

    eventProcessor.intercept('response', (err, _, response) => {
      removeAborter(info.id);

      // If the response is present, and download is set then
      if (!err && response && info.download) {
        saveStreamToFile(response.contentInfo(), response.stream, (err, success) => {
          // If there is an error success then emit the download event
          (err || success) && eventProcessor.call('download', [err]);
        });
      }
    });

    eventProcessor.intercept('done', () => {

      // Sending the heap memory usage right before the end of the run.
      sendAnalyticsEvent('collectionrun', 'heap_memory_usage', (process.memoryUsage().heapUsed - startMemory));

      if (info.cookie && info.cookie.saveAfterRun && cookieJar && typeof cookieJar.updateStore === 'function') {
        // TODO - DECIDE on what to do with cookies when there was an error in done
        cookieJar.updateStore(() => {
          disposeRun(info.id, emit);
        });

        return;
      }
      disposeRun(info.id, emit);
    });

    // Note: .handlers should be called after all interceptors have been attached
    // else events not part of schema will be ignored
    run.start(eventProcessor.handlers());
  });
}

/**
 * @public
 * LivePreview: Calling runtime's `dryRunRequest` to get previewed request
 *
 * @param {Request} request
 * @param {Object} info
 * @param {Object} options
 * @param {Function} cb
 */
function previewRequest (request, options = {}, cookieStorageRemoteClient, cb) {
  let requestToPreview = new postmanCollectionSdk.Request(request),
    dryRunOptions = _.pick(options, ['implicitCacheControl', 'implicitTraceHeader', 'protocolProfileBehavior']),
    disableCookies = dryRunOptions.protocolProfileBehavior && dryRunOptions.protocolProfileBehavior.disableCookies;

  !disableCookies && CookieJar &&
    (dryRunOptions.cookieJar = new CookieJar(cookieStorageRemoteClient, { readFromDB: true, writeToDB: false }));

  try {
    dryRunRequest(requestToPreview, dryRunOptions, (err, previewedRequest) => {
      cb(err, previewedRequest && previewedRequest.toJSON());
    });
  }
  catch (e) {
    pm.logger.error('RuntimeExecutionService~previewRequest.dryRunRequest', e);
  }
}

/**
 * Checks if the given path is within the working directory
 */
function isInWorkingDir (workingDir, path) {
  return Boolean((new PostmanFs(workingDir))._resolve(path, false));
}

/**
 * Create Temporary File
 * @param name
 * @param content
 */
function createTemporaryFile (name, content, cb) {
  const basePath = app.getPath('temp'),
    tempFilePath = path.join(basePath, name);

  async.waterfall([
    // Attempt to clear the file if it already exists.
    // Note: We ignore the error here
    (next) => fs.unlink(tempFilePath, () => next()),

    // Write the contents of the temp directory
    (next) => fs.writeFile(tempFilePath, content, next)
  ], (err) => {
    cb(err && new SerializedError(err), tempFilePath);
  });
}

/**
 * Read file from filesystem
 * @param {String} id
 * @param {String} path
 */
function readFile (path, cb) {
  fs.readFile(path, (err, content) => {
    if (!err) {
      try {
        // From here on we will try detect the encoding and convert the buffer accordingly
        content = content.toString(detectEncoding(content));
      } catch (e) {
        err = new Error('Failed to detect encoding of the file content');
      }
    }

    return cb(err && new SerializedError(err), content);
  });
}

/**
 * Check if the given path has the required file-system access
 * @param {String} id
 * @param {String} path
 * @param {Boolean} writable
 */
function accessFile (path, writeable, cb) {
  // If no path is given then there is nothing to check
  if (!path) {
    return cb();
  }

  const perm = writeable ? (fs.constants.R_OK | fs.constants.W_OK) : (fs.constants.R_OK);

  fs.access(path, perm, (err) => {
    cb(err && new SerializedError(err));
  });
}

/**
 * Clear all cookies for the given partition id
 *
 * @param {String} partitionId Cookie partition id
 * @param {Function} cb
 */
function clearAllElectronCookies (partitionId, cb) {
  if (!partitionId) {
    return cb();
  }

  const partition = session.fromPartition(partitionId);

  // NOTE: This will clear all the cookies from this partition
  partition.clearStorageData({ storages: ['cookies'] })
    .then(() => cb && cb())
    .catch((err) => cb && cb(new SerializedError(err)));
}

// #endregion

// #region Raw WebSocket Request APIs

/**
 * Establish a websocket connection with given URL and configs
 *
 * @param {String} connectionId Connection id
 * @param {Object} config
 * @param {String} config.url Server URL
 * @param {Array} config.protocols sub-protocols
 * @param {String} config.options options
 * @param {Object} config.certificates TLS client certificates
 * @param {String} config.workingDir Working directory to fetch the certificates from
 *
 */
function wsConnect (connectionId, { url, headers, protocols = [], options = {}, certificates = {}, workingDir }, cb) {
  const cwd = workingDir || defaultWorkingDir;
  const ws = new WebSocket(url, protocols, _.assign(options, { headers, certificates, cwd }));

  openWSConnections[connectionId] = ws;

  ws.onOpen = ({ protocol, extensions }, request, response) => cb({ connectionId, event: 'open', data: { request, response, meta: { protocol, extensions } } });

  ws.onUpgrade = (request, response) => cb({
    connectionId,
    event: 'upgrade',
    data: { request, response }
  });

  ws.onMessage = (message, meta) => cb({ connectionId, event: 'message', data: { message, meta } });

  ws.onError = (error, request, response) => cb({ connectionId, event: 'error', data: { error, request, response } });

  ws.onClose = (code, reason) => cb({ connectionId, event: 'close', data: { code, reason } });

  ws.onReconnect = () => cb({ connectionId, event: 'reconnect' });

  ws.onEnd = (code, reason) => {
    cb({ connectionId, event: 'end', data: { code, reason, aborted: ws.isConnectionAborted } });

    // For cases when connection is closed from server
    delete openWSConnections[connectionId];
  };
 }

/**
 * Send message over the existing websocket connection
 *
 * @param {String} connectionId Connection id
 * @param {Array|Number|Object|String|ArrayBuffer|Buffer|DataView|TypedArray} payload
 * @param {Object} options
 * @param {Function} cb - An optional callback which is invoked when data is written out.
 */
function wsSend (connectionId, payload, options = {}, cb) {
  if (!connectionId) {
    return;
  }

  const ws = openWSConnections[connectionId];

  if (!ws) {
    return;
  }

  ws.send(payload, options, cb);
}

/**
 * Close a websocket connection
 *
 * @param {String} connectionId Connection Id
 */
function wsDisconnect (connectionId) {
  if (!connectionId) {
    return;
  }

  const ws = openWSConnections[connectionId];

  if (!ws) {
    return;
  }

  ws.close(1000);

  delete openWSConnections[connectionId];
}

/**
 * Disposes off all open websocket (raw + socketIO) request connections
 *
 * @param {Array} connectionIds IDs of connection that needs to closed
*/
function wsBulkDisconnect (connectionIds = []) {
  connectionIds.forEach((connectionId) => {
    const connectionInstance = openWSConnections[connectionId];

    if (!connectionInstance) {
      return;
    }

    connectionInstance.close();
  });
}

// #endregion

// #region SocketIO Request APIs

/**
 * Establish a websocket connection with given URL and configs
 *
 * @param {String} connectionId Connection id
 * @param {Object} config
 * @param {String} config.url Server URL
 * @param {Array} config.protocols sub-protocols
 * @param {String} config.options options
 * @param {Object} config.certificates TLS client certificates
 * @param {String} config.workingDir Working directory to fetch the certificates from
 *
 */
function socketIOConnect (connectionId, { url, headers, listeners = [], options = {}, certificates = {}, workingDir }, cb) {
  const cwd = workingDir || defaultWorkingDir;
  const socket = new SocketIOClient(url, listeners, _.assign(options, { headers, certificates, cwd }));

  openWSConnections[connectionId] = socket;

  socket.onConnect = (request, response) => cb({ connectionId, event: 'connect', data: { request, response } });

  socket.onMessage = (message, meta) => cb({ connectionId, event: 'message', data: { message, meta } });

  socket.onError = (error, request, response) => cb({ connectionId, event: 'error', data: { error, request, response } });

  socket.onReconnect = () => cb({ connectionId, event: 'reconnect' });

  socket.onEnd = (reason) => {
    cb({ connectionId, event: 'end', data: { reason, aborted: socket.isConnectionAborted } });

    // For cases when connection is closed from server
    delete openWSConnections[connectionId];
  };
 }

/**
 * Send message over the existing websocket connection
 *
 * @param {String} connectionId Connection id
 * @param {Array|Number|Object|String|ArrayBuffer|Buffer|DataView|TypedArray} payload
 * @param {Object} options
 * @param {Function} cb - An optional callback which is invoked when data is written out.
 */
function socketIOPublish (connectionId, event, payload, options, cb) {
  if (!connectionId) {
    return;
  }

  const socket = openWSConnections[connectionId];

  if (!socket) {
    return;
  }

  socket.publish(event, payload, options, cb);
}

/** */
function socketIOSubscribe (connectionId, event, cb) {
  if (!connectionId) {
    return;
  }

  const socket = openWSConnections[connectionId];

  if (!socket) {
    return;
  }

  socket.subscribe(event, cb);
}

/** */
function socketIOUnsubscribe (connectionId, event, cb) {
  if (!connectionId) {
    return;
  }

  const socket = openWSConnections[connectionId];

  if (!socket) {
    return;
  }

  socket.unsubscribe(event, cb);
}

/**
 * Close a websocket connection
 *
 * @param {String} connectionId Connection Id
 */
function socketIODisconnect (connectionId) {
  if (!connectionId) {
    return;
  }

  const socket = openWSConnections[connectionId];

  if (!socket) {
    return;
  }

  socket.disconnect();

  delete openWSConnections[connectionId];
}

/**
 * Saves a cloud file locally.
 *
 * @param {string} path - The path to save the file to.
 * @param {string|Buffer} stream - The file contents to save.
 * @param {function} cb - The callback function to execute after saving the file.
 * @returns {void}
 */
function saveCloudFileLocally (path, stream, cb) {

  const directoryPath = path.substring(0, path.lastIndexOf('/'));

  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath, { recursive: true });
  }

  fs.writeFile(path, stream, (err) => {
    return cb(err, true);
  });
}

/**
 * Saves a script file locally.
 *
 * @param {string} filePath - The path to save the file to.
 * @param {string|Buffer} content - The file contents to save.
 * @param {function} cb - The callback function to execute after saving the file.
 * @returns {void}
 */
function saveScriptFileLocally (filePath, content, cb) {
  filePath = path.resolve(app.getPath('temp'), filePath);

  const directoryPath = path.dirname(filePath);

  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath, { recursive: true });
  }

  fs.writeFile(filePath, content, (err) => {
    return cb(err, true);
  });
}

/**
 * Deletes file from local machine
 *
 * @param {String} path - The path of file to be deleted
 * @param {Function} cb - The callback function to execute after successful file delete
 * @returns {void}
 */
function deleteSavedCloudFile (path, cb) {
  const directoryPath = path.substring(0, path.lastIndexOf('/'));

  if (!fs.existsSync(directoryPath)) {
    return cb(null, false);
  }

  fs.unlink(path, (err) => {
    if (err) {
      return cb(err, false);
    }
    return cb(null, true);
  });
}

/**
 * Deletes the cloud files directory from local
 * @param {String} path - The path of directory which is to be deleted
 * @param {Function} cb - The callback function to execute after successful directory delete
 * @returns {void}
 */
function deleteCloudFileDir (path, cb) {
  if (!fs.existsSync(path)) {
    return cb(null, true);
  }

  fs.rmdirSync(path, { recursive: true, force: true }, (err) => {
    if (err) {
      return cb(err, false);
    }
    return cb(err, true);
  });
}

/**
 * Deletes a directory and its contents.
 * @param {string} dirPath - The path of the directory to be deleted.
 * @param {function} cb - The callback function to be called after the directory is deleted.
 * @returns {void}
 */
function deleteScriptFileDir (dirPath, cb) {
  const directoryPath = path.join(app.getPath('temp'), dirPath);

  if (!fs.existsSync(directoryPath)) {
    return cb(null, true);
  }

  fs.rmdirSync(directoryPath, { recursive: true, force: true }, (err) => {
    if (err) {
      return cb(err, false);
    }
    return cb(err, true);
  });
}

// #endregion

// We have two places that this is going to be used main process in electron and the we agent, hence we expose two API's here
module.exports = function () {
  /* native-ignore:start */ // IMPORTANT: Do not remove this comment. Used by webpack to ignore this section

  const postmanRuntime = require('postman-runtime');
  const GRPCClient = require('./GRPCClient');
  const GraphQLClient = require('./GraphQLClient');
  const MQTTClient = require('./MQTTClient');
  const FileSystem = require('./FileSystem');
  const RuntimeClientUtilities = require('./RuntimeClientUtilities');

  fs = require('fs');
  os = require('os');
  path = require('path');
  chardet = require('chardet');
  app = require('electron').app;
  dialog = require('electron').dialog;
  session = require('electron').session;
  sanitizeFilename = require('sanitize-filename');
  postmanCollectionSdk = require('postman-collection');
  SerializedError = require('serialised-error');

  // These are present in the main directory
  WebSocket = require('./WebSocketClient');
  SocketIOClient = require('./SocketIOClient');
  CookieJar = require('./CookieJar');
  getSystemProxy = require('../../utils/getSystemProxy');

  PostmanFs = require('../utils/postmanFs'); // This is within the common folder
  packageResolver = require('../utils/packageResolver');

  collectionRunner = new postmanRuntime.Runner();
  dryRunRequest = postmanRuntime.Requester && postmanRuntime.Requester.dryRun;

  defaultWorkingDir = path.join(os.homedir(), 'Postman', 'files');

  isBrowser = false;


  // WARNING: Be very contingent of what is being exposed here. Some API's need native dependency that may not be available for the web
  // TODO: This needs a better api in-terms of DEPENDENCY INJECTION. Can be worked out alter to prevent bugs
  return {
    startRun,
    stopRun,
    pauseRun,
    resumeRun,
    previewRequest,

    // WebSocket Request
    wsConnect,
    wsSend,
    wsDisconnect,
    wsBulkDisconnect,

    socketIOConnect,
    socketIOPublish,
    socketIOSubscribe,
    socketIOUnsubscribe,
    socketIODisconnect,

    // Multi-protocol clients
    grpc: new GRPCClient(defaultWorkingDir),
    graphql: new GraphQLClient(defaultWorkingDir),
    mqtt: new MQTTClient(defaultWorkingDir),
    fileSystem: new FileSystem(defaultWorkingDir),
    runtimeUtils: new RuntimeClientUtilities(defaultWorkingDir),

    // Only native
    isInWorkingDir,
    createTemporaryFile,
    readFile,
    accessFile,
    defaultWorkingDir,
    saveStreamToFile,
    clearAllElectronCookies,
    saveCloudFileLocally,
    deleteSavedCloudFile,
    deleteCloudFileDir,
    deleteScriptFileDir,
    saveScriptFileLocally
  };

  /* native-ignore:end */ // IMPORTANT: Do not remove this comment. Used by webpack to ignore this section
};


module.exports.Browser = async function () {
  const postmanRuntime = await import(/* webpackChunkName: "postman-runtime" */ 'postman-runtime/dist');

  chardet = require('chardet');
  postmanCollectionSdk = require('postman-collection');
  SerializedError = require('serialised-error');
  CookieJar = require('./CookieJar');

  collectionRunner = new postmanRuntime.Runner();
  dryRunRequest = postmanRuntime.Requester && postmanRuntime.Requester.dryRun;

  isBrowser = true;


  return {
    startRun,
    stopRun,
    pauseRun,
    resumeRun,

    previewRequest,
    saveStreamToFile
  };
};

module.exports.Test = {
  _resolveVaultVariables,
};
