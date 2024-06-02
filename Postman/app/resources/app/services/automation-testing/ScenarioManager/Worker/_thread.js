/* eslint-disable no-console */
// console.log and console.error of this file are piped to pm.logger.info and pm.logger.error of the execution process
// This is because, we were missing logs from this thread as pm object is not available within this scope.

const os = require('os');
const path = require('path');
const _ = require('lodash');
const uuid = require('uuid');

const { parentPort } = require('worker_threads');
const postmanRuntime = require('postman-runtime');
const postmanCollectionSdk = require('postman-collection');
const { THREAD_REQUESTS } = require('../constants');
const PostmanFs = require('../../../../common/utils/postmanFs');
const ResponseBodyMap = require('../../ResponseBodyMap');
const DataFileContentStore = require('./DataFileContentStore');
const RunStore = require('./RunStore');

// TODO: Use constants from someplace else
const NOT_LOGGED_RESPONSE_BODY = 'not-logged-response-body';
const LARGE_RESPONSE_BODY = 'large-response';
const refreshCallbackMap = new Map();
const responseBodyMap = new ResponseBodyMap();
const proxyFetchCallbackMap = new Map();
const runStore = new RunStore();

// TODO: Clear this map if the thread is persisted
const dataFileDistributionState = new Map();

/**
 * Removes references of all functions nested inside an Object to return a plain javasxcript object.
 *
 * @param {Object} obj - Object to be iterated
 */
const removeFunctionalReferences = (obj) => {
  if (!obj || typeof obj !== 'object') {
    return;
  }

  Object.keys(obj).forEach((k) => {
    if (typeof obj?.[k] === 'function')
      delete obj[k];
    else if (typeof obj?.[k] === 'object')
      removeFunctionalReferences(obj?.[k]);
  });
};

/**
 * Setting up a request timeout of 55 seconds which is large enough to handle the largest possible response time while
 * still being small enough to timeout in case of smallest performance test duration.
 */
const REQUEST_TIMEOUT = 55 * 1000;
const pick = (obj, ...keys) =>
  (obj ? Object.fromEntries(keys.filter((key) => key in obj).map((key) => [key, obj?.[key]])) : {});

const MIN_ITERATION = 20,
  ITERATION_MULTIPLIER = 10,
  MIN_SLEEP_TIMEOUT = 500,
  SLEEP_TIMEOUT_MULTIPLIER = 1000;

/**
 * Send an event to the execution process.
 *
 * @param {Number} executorReferenceId - Process reference number
 * @param {object} executionContext- execution context
 * @param {string} event - Event name
 * @param {object} [data] - Data to send to the execution process
 *
 * @returns {void}
 */
function _sendToParent (executorReferenceId, executionContext, event, data) {
  removeFunctionalReferences(data);

  parentPort.postMessage({
    type: 'data',
    data: {
      executorReferenceId,
      event,
      data,
      executionContext,
      timestamp: new Date().toISOString()
    }
  });
}

/**
 * Refresh token handler for OAuth2 authorization
 *
 * @param {string} sequenceId - Sequence ID
 * @param {string} authSessionId - Auth session ID, format: modelType/modelId/workspaceId, sample: collection/123/456
 * @param {function} callback - Callback function to be called when the token is refreshed
 */
function refreshOAuth2Token (sequenceId, authSessionId, callback) {
  const refreshId = uuid.v4();

  // Set callback into a set which we will call once we receive the token from execution process. This will hold the
  // execution of the request until we receive the token.
  refreshCallbackMap.set(refreshId, callback);

  parentPort.postMessage({
    type: 'request',
    data: {
      requestType: THREAD_REQUESTS.OAUTH2_TOKEN_REFRESH,
      sequenceId,
      data: { authSessionId, refreshId },
      timestamp: new Date().toISOString()
    }
  });
}

/**
 * Gets the system proxy configuration for the given url and calls the given
 * callback with it or calls it with an error
 *
 * @param {*} sequenceId - Sequence ID
 * @param {*} url - The url to resolve proxy configuration for
 * @param {*} callback - The callback to call after the resolution
 */
function getSystemProxy (sequenceId, url, callback) {
  const proxyFetchId = uuid.v4();

  // Set callback into a set which we will call once we receive the token from execution process. This will hold the
  // execution of the request until we receive the token.
  proxyFetchCallbackMap.set(proxyFetchId, callback);

  parentPort.postMessage({
    type: 'request',
    data: {
      requestType: THREAD_REQUESTS.GET_SYSTEM_PROXY,
      sequenceId,
      data: { url, proxyFetchId },
      timestamp: new Date().toISOString()
    }
  });
}

/**
 * Sanitizes options to be sent to runtime. Mostly converting objects into SDK instances.
 *
 * @param {Object} options - Options to be sanitized
 * @param {string} sequenceId - Sequence ID
 *
 * @returns {Object} - Sanitized options
 */
function sanitizeRunOptions (options, sequenceId) {
  const rawOptions = _.cloneDeep(options);

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
  rawOptions.requester.authorizer.refreshOAuth2Token = refreshOAuth2Token.bind(null, sequenceId);

  if (rawOptions.useSystemProxy) {
    rawOptions.systemProxy = getSystemProxy.bind(null, sequenceId);
  }

  if (rawOptions.proxies) {
    rawOptions.proxies = new postmanCollectionSdk.ProxyConfigList({}, rawOptions.proxies);
  }

  rawOptions.certificates = new postmanCollectionSdk.CertificateList({}, rawOptions.certificates);

  return rawOptions;
}

/**
 * Spawns up runtime instances and runs the collection. This function is called by the execution process to start or add
 * scenarios for execution. It returns a promise that resolves when all the runners have finished.
 * The promise will reject if any of the runners fail to start.
 * The results are the same as the ones returned by the `postman-runtime` module's summary parameter of the done callback.
 * Each event emitted by the runners is sent to the execution process.
 *
 * @param {string} collection - Collection object to run
 * @param {string} environment - Environment object to run
 * @param {object} globals - Global variables to run
 * @param {string[]} requestSelection - Array of runnable item selection to run
 * @param {Number} count - Number of scenarios to execute the collection with
 * @param {object} executionContext - execution context
 * @param {Number} executorReferenceId - Process reference number
 * @param {object} rawRunOptions - Options to be passed to the runtime
 * @param {object} VUData - Data variables to be used
 *
 * @returns {Promise<unknown[]>}
 */
function runRunners ({
                       collection,
                       environment,
                       globals,
                       requestSelection,
                       count,
                       executionContext,
                       executorReferenceId,
                       VUData,
                       runOptions: rawRunOptions
                     }) {
  const sdkCollection = new postmanCollectionSdk.Collection(collection),
    collectionVariables = { values: collection.variable || [] },
    environmentObject = environment,
    globalsObject = globals,
    defaultWorkingDir = path.join(os.homedir(), 'Postman', 'files');

  const runOptions = sanitizeRunOptions(rawRunOptions, executionContext.sequenceId);
  const workloadId = executionContext.executionContextId;

  if (runOptions.fileResolver && !!PostmanFs) {
    let { workingDir, insecureFileRead, fileWhitelist } = runOptions.fileResolver;

    _.set(runOptions, 'fileResolver', new PostmanFs(workingDir || defaultWorkingDir, insecureFileRead, fileWhitelist, false));
  }

  let store;

  if (VUData?.keys) {
     store = dataFileDistributionState.get(executionContext.executionContextId);

    if (store) {
      store.updateVUData(VUData);
    }
    else {
      store = new DataFileContentStore(VUData, parentPort);
      dataFileDistributionState.set(executionContext.executionContextId, store);

      if (VUData.randomize) {
        store.enableRefresh(workloadId);
      }
    }
  }

  // Create a group of runners and run the collection with them in parallel (each runner will run the collection
  // with a single user)
  return Promise.all(
    Array.from({ length: count }, () => {
      let dataFileRowIndex, isRowOutOfBound;

      // Create a clone of sendToMainProcess function that is bound to the executionContext
      const sendToMainProcess = _sendToParent.bind(
        null,
        executorReferenceId,
        executionContext
      );

      return new Promise(async (resolve, reject) => {
        const runner = new postmanRuntime.Runner(),

          // Random iteration count value (within range(20,30)) to ensure all scenarios does not die at the same time.
          // This is done to avoid a dip in RPS at a certain interval.
          iterationCount = Math.floor(MIN_ITERATION + (ITERATION_MULTIPLIER * Math.random()));

        await runner.run(
          sdkCollection,
          {
            ...runOptions,
            timeout: {
              request: REQUEST_TIMEOUT,

              // Setting explicit timeout for execution of entire run and script to 0 (Infinity) so that
              // runtime doesn't apply default timeout to the run or the script
              script: 0,
              global: 0
            },
            environment: environmentObject,
            globals: globalsObject,
            entrypoint: requestSelection ?? undefined,
            iterationCount
          },
          function (err, run) {
            if (err) {
              sendToMainProcess('errorStartingRun', err);
              return reject(err);
            }

            // Add the run object to the store so that it can be accessed later to abort the run
            // Right now the count is hardcoded to 1 because we are running a single scenario per sequenceId.
            // If this assumption changes in the future, we will have to change this such that we store all the
            // run objects for a sequenceId.
            runStore.add(executionContext.sequenceId, { run });

            let iterationDelayTimer;

            run.start({
              // Called when the run begins
              start: function (err) {
                sendToMainProcess('start', { err });
              },

              // Called once with response for each request in a collection
              response: function (err, cursor, response, request, item) {

                let body;
                let hash;

                const contentInfo = response?.contentInfo?.();

                if (response?.stream) {
                  // RESPONSE_BODY_TYPE_AUDIO exists on renderer side. Similar constants will have to be added for main.
                  const isAllowedMimeType = !['audio', 'video', 'image', 'embed'].includes(contentInfo.mimeType);
                  const didRequestError = response.code < 200 || response.code >= 300 || !response.responseTime;
                  const MAX_RESPONSE_SIZE = 20000;

                  // TODO: This is very specific to our current use-case. We should abstract this out and parameterize it.
                  const shouldForwardResponse = isAllowedMimeType && didRequestError;

                  if (!shouldForwardResponse) {
                    // If save response is disabled them trim the body and headers
                    body = {
                      ___ignored___: NOT_LOGGED_RESPONSE_BODY
                    };
                  }
                  else {
                      // We need to convert the stream into a string to send it to the execution process.
                      // Convert ArrayBuffer into Uint8Array view
                      if (response.stream instanceof ArrayBuffer) {
                        response.stream = new Uint8Array(response.stream);
                      }

                      // The response stream can be an Uint8Array or an object denoting dropping and truncating
                      body = (response.stream instanceof Uint8Array) ?
                        Uint8ArrayToString(response.stream, contentInfo.charset) : response.stream;

                      if (body.length > MAX_RESPONSE_SIZE) {
                        body = {
                          ___ignored___: LARGE_RESPONSE_BODY
                        };
                      }
                  }

                  if (didRequestError && !isAllowedMimeType) {
                    // Send the content mimetype as hash if mimetype is not text/json
                    hash = contentInfo?.mimeType;
                  } else if (body.___ignored___) {
                    // Catch all scenarios were we could not send response
                    hash = 'OTHER_RESPONSE';
                  }
                  else if (shouldForwardResponse) {
                    try {
                      // TODO. Use common util function
                      // eslint-disable-next-line require-jsdoc
                      function getErrorMetricName (response, err) {
                        if (response && response.code) {
                          const status = _.startCase(_.lowerCase(response.status));

                          return [response.code, status].join(' ').trim(' ');
                        }
                        else if (err && err.code) {
                          return err.code;
                        }
                        else if (err && err.message) {
                          return err.message;
                        }
                        else return 'Unknown';
                      }

                      // Calculate the hash of the request body
                      const errorMetricName = getErrorMetricName(response, err);
                      hash = responseBodyMap.addResponse({ request: { id: item.id, ...request }, errorMetricName, response: { body } });
                    }
                    catch (error) {
                      if (Object.keys(ResponseBodyMap.ERROR_TYPES).includes(error.code)) {
                        hash = 'OTHER_RESPONSE';
                      }
                      else {
                        throw error;
                      }
                    }
                  }
                }

                const transformedRequest = request && new postmanCollectionSdk.Request(
                  request.toJSON()
                );

                sendToMainProcess('response', {
                  virtualUser: { dataRowIndex: dataFileRowIndex, isRowOutOfBound, vuId: executionContext.vuId, dataUsed: !!VUData },
                  err: pick(err || {}, 'code', 'message'),
                  response: { body, contentInfo, hash, ...pick(response || {}, 'code', 'headers', 'responseSize', 'status', 'responseTime') },
                  request: transformedRequest && {
                    url: _.invoke(transformedRequest, 'url.toString', ''),
                    method: _.get(transformedRequest, 'method', ''),
                    headers: transformedRequest.getHeaders({ enabled: false }),
                    body: transformedRequest.toJSON().body
                  },
                  item
                });
              },

              beforeIteration: async function () {
                const runData = runStore.get(executionContext.sequenceId);

                if (runData) {
                  const { stopping } = runData;

                  if (stopping) {
                    clearTimeout(iterationDelayTimer);

                    // set this to null, so that we know if there's a timer counting down
                    iterationDelayTimer = null;

                    await run.abort();

                    resolve({ executionContext });

                    return;
                  }
                }

                // Set the dataFileRowIndex and VU variables for the current iteration
                const injectableRunData = store?.getRunData() || {};

                // Reset all the variables to the values they had during the start of the run.
                // Event though we use iterations to improve performance, each scenario is considered independent run.
                // Thus updated variable values should not propagate across iterations.
                // TODO: [APITEST-322] This is not the recommended way to achieve this. Expose an option/interface from postman-runtime
                delete run.state.environment;
                delete run.state.globals;
                delete run.state.collectionVariables;
                delete run.state._variables;

                // Retain reference to the dataFileRowIndex and isRowOutOfBound for the current iteration such that it
                // can be used in the response callback to track the VU data for the current iteration.
                ({ dataFileRowIndex, isRowOutOfBound } = injectableRunData);

                Object.assign(run.state, {
                  environment: new postmanCollectionSdk.VariableScope(environmentObject),
                  globals: new postmanCollectionSdk.VariableScope(globalsObject),
                  collectionVariables: new postmanCollectionSdk.VariableScope(collectionVariables),
                  _variables: new postmanCollectionSdk.VariableScope(injectableRunData.variables || {})
                });
              },

              iteration: async function (err, cursor) {

                // Using random sleep time using pause and resume between iterations to improve CPU performance
                if (cursor.iteration <= iterationCount - 2) {
                  try {
                    await run.pause();
                  }
                  catch (e) {
                    console.error('Error while pausing the run', e);
                  }
                }

                sendToMainProcess('iteration', { err });
              },

              pause: function () {
                iterationDelayTimer = setTimeout(async () => {
                  try {
                    const runData = runStore.get(executionContext.sequenceId);

                    // check if run exists before resuming, it is possible that the run was
                    // aborted before this hook was called
                    if (runData) {
                      await run.resume();
                    }
                  }
                  catch (e) {
                    console.error('Error while resuming the run', e);
                  }
                }, (MIN_SLEEP_TIMEOUT + (Math.random() * SLEEP_TIMEOUT_MULTIPLIER))); // Random sleep time between 500ms to 1500ms.

                runStore.update(executionContext.sequenceId, { iterationDelayTimer });
              },

              // Called at the end of a run
              done: function (err) {
                sendToMainProcess('done', { err });

                if (err) {
                  console.error('Error while running collection', err);

                  run.abort();
                }

                resolve({ executionContext });
              },
            });
          }
        );
      });
    })
  );
}

/**
 * Handle messages from the execution process. The exec. process sends a message to this thread when it wants to start
 * the execution of a scenario instance for a performance test or add more scenarios to the test.
 */
parentPort.on('message', async (message) => {
  let executionContext, sequenceId;

  switch (message.type) {
    case 'assign':
      try {
        await runRunners(message.payload);

        _sendToParent(
          message.payload.executorReferenceId,
          message.payload.executionContext,
          'allRunFinished'
        );
      }
      catch (err) {
        console.error('Error while running collection', err);

        _sendToParent(
          message.payload.executorReferenceId,
          message.payload.executionContext,
          'error',
          { err }
        );
      }
      finally {
        runStore.remove(message.payload.executionContext.sequenceId);
      }

      break;

    case 'stop':
      executionContext = message.payload;
      ({ sequenceId } = executionContext);

      // Marks the run for stopping after it finishes its current iteration and
      // tries to start the next, see beforeIteration handler in run.start call
      runStore.update(executionContext.sequenceId, { stopping: true });

      break;

    case 'abort':
      executionContext = message.payload;
      ({ sequenceId } = executionContext);

      try {
        const runData = runStore.get(sequenceId);

        if (runData) {
          const { run, iterationDelayTimer } = runData;

          _sendToParent(
            executionContext.executionContextId,
            executionContext,
            'aborting'
          );

          clearTimeout(iterationDelayTimer);
          run.abort();

          _sendToParent(
            executionContext.executionContextId,
            executionContext,
            'aborted'
          );
        }
        else {
          console.warn('No run found for sequenceId', sequenceId);
        }
      }
      catch (err) {
        console.error('Error while aborting collection', err);

        _sendToParent(
          executionContext.executionContextId,
          { },
          'error',
          { err }
        );
      }
      finally {
        runStore.remove(sequenceId);
      }

      break;

    case 'response':
      const { requestType, ...data } = message.payload;

      let callback;

      switch (requestType) {
        case 'oauth2-token-refresh':
          const refreshId = data.refreshId;

          callback = refreshCallbackMap.get(refreshId);

          if (callback) {
            callback(null, data.accessToken);
          }
          else {
            console.error(`No callback found for refreshId ${refreshId}`);
          }

          break;

        case 'get-system-proxy':
          const proxyFetchId = data.proxyFetchId;

          callback = proxyFetchCallbackMap.get(proxyFetchId);

          if (callback) {
            callback(null, data.proxyConfig);
          }
          else {
            console.error(`No callback found for proxyFetchId ${proxyFetchId}`);
          }

          break;

        case 'vu-data':
          const store = dataFileDistributionState.get(data.workloadId);

          if (store) {
            store.updateVUData(data.VUData);
          }
          else {
            console.error(`No store found for executionContextId ${data.executionContextId}`);
          }

          break;

        default:
          console.log('WorkerThreadExec ~ Unknown runtime request type', requestType);
      }

      break;

    default:
      console.log('WorkerThreadExec ~ Unknown message type', message.type);
  }
});


/**
 * Helper function to convert a Uint8Array to string with proper charset handling
 *
 * @param {Uint8Array} array - The Uint8Array to convert to string
 * @param {String} charset - The charset to use for conversion
 *
 *  FIXME: UTF-32 is not supported by TextDecoder yet, may fallback to iconv-lite?
 */
function Uint8ArrayToString (array, charset) {
  const UNSUPPORTED_ENCODING = new Set(['iso-2022-cn', 'iso-2022-cn-ext']),
  CHARSET_UTF16 = 'utf-16',
  CHARSET_UTF16BE = 'utf-16be',
  BOM_FE = 0xFE,
  BOM_FF = 0xFF;

  // If it's one of the unsupported encodings then bail out
  if (UNSUPPORTED_ENCODING.has(charset)) {
    return '';
  }

  // If we have charset utf-16, it not certain if it big-endian or little-endian in nature
  // BOM characters if present can be us to detect the endianness
  if (charset === CHARSET_UTF16 && array.length >= 2) {
    // If the bom characters match that of big-endian then change the charset to BE
    // In-case it does not match then we don't need to do anything because utf-16 defaults
    // to being little-endian
    (array[0] === BOM_FE && array[1] === BOM_FF) && (charset = CHARSET_UTF16BE);
  }


  // If charset is not defined then default to utf-8
  // For more information on the valid list of charset check
  // https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder/TextDecoder
  try {
    return new TextDecoder(charset || 'utf-8').decode(array);
  } catch (e) {
    // Handle RangeError thrown by TextDecoder if the defined charset is invalid
    console.error('Invalid encoding label received in the response headers.', e);

    return new TextDecoder('utf-8').decode(array);
  }
}
