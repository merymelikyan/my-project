const { Worker } = require('worker_threads');
const EventEmitter = require('events');
const path = require('path');
const scenarioTestingProcessPath = path.join(__dirname, '_thread.js');
const { log } = require('../../lib/logging');
const { THREAD_REQUESTS } = require('../constants');

/**
 * Thin wrapper around the worker thread. This will be responsible for spawning the worker thread and handling the
 * events from the worker thread. It will also be responsible for sending the data to the main process.
 * @class WorkerThread
 * @extends EventEmitter
 *
 * @private
 *
 * @param {Number} id - ID of the worker thread
 * @param {Object} workerData - Data to be passed to the worker thread
 * @param {Function} callback - Callback function to be called when the worker thread sends data
 * @param {Function} workerRequestCallback - Callback function to be called when the worker thread sends a request for additional data
 */
class WorkerThread extends EventEmitter {

  // Set of sequences to be aborted. This will be used to ignore any requests from the worker thread for sequences
  // that are to be aborted.
  sequencesToBeAborted = new Set();

  /**
   * @constructor
   * @param {object} workerData - Data to be passed to the worker thread
   * @param {string} workerData.id - ID of the worker thread
   * @param {function} callback - Callback to be called for run events from the worker thread
   * @param {function} workerRequestCallback - Callback to be called for worker requests
   */
  constructor (workerData, callback, workerRequestCallback) {
    super();
    this.id = workerData.id;
    this.worker = new Worker(scenarioTestingProcessPath, {
      workerData: {},
      stdout: true,
      stderr: true
    });
    this.handleMessage = this.handleMessage.bind(this);
    this.handleError = this.handleError.bind(this);
    this.handleExit = this.handleExit.bind(this);

    this.worker.on('message', this.handleMessage);
    this.worker.on('error', this.handleError);
    this.worker.on('exit', this.handleExit);

    // pm.logger is intentionally used here instead of log because log is not yet designed to be used in the worker
    this.worker.stdout.on('data', (data) => pm.logger.info([`Worker ${this.id}`, data.toString()]));
    this.worker.stderr.on('data', (data) => pm.logger.error([`Worker ${this.id}`, data.toString()]));
    this.callback = callback;
    this.workerRequestCallback = workerRequestCallback;
  }

  handleMessage = (message) => {
    log.debug('WorkerThread: handleMessage');

    switch (message.type) {
      case 'data':
        const event = message.data.event,
          executionContext = message.data.executionContext;

        if (event === 'aborted' && executionContext?.sequenceId) {
          log.info('WorkerThread: Removing sequence from set of sequences to be aborted');

          // Remove the sequence ID from the set of sequences to be aborted.
          this.sequencesToBeAborted.delete(executionContext.sequenceId);
        }

        this.callback(message.data);
        break;

      case 'request':
        if (this.sequencesToBeAborted.has(message.data.sequenceId)) {
          log.info('WorkerThread: Ignoring runtime request for aborted sequence');
          break;
        }

        this.workerRequestCallback(message.data);
        break;

      default:
        log.debug('WorkerThread: Received unknown message type: ', message.type);
    }
  }

  handleError (error) {
    log.error('Worker error:', error.toString());
  }

  handleExit (code) {
    if (code !== 0) {
      log.error(`Worker stopped with exit code ${code}`);
    }
  }

  async assignRun (args) {
    log.debug('WorkerThread: assignRun');
    this.worker.postMessage({ type: 'assign', payload: args });
  }

  /**
   * Sends a message to the worker thread
   *
   * @param {Object} payload - The payload to be relayed to the worker
   */
  relayMessageToWorkerThread = (payload) => {
    log.debug('WorkerThread: Relaying runtime callback response');

    // Ignore any requests from the worker thread for sequences that are to be aborted.
    if (this.sequencesToBeAborted.has(payload.sequenceId) && payload.requestType !== THREAD_REQUESTS.VU_DATA) {
      log.info('WorkerThread: Ignoring runtime callback response for aborted sequence');
      return;
    }

    this.worker.postMessage({ type: 'response', payload });
  }

  handleRuntimeRequestResponse = (payload) => {
    const { requestType, ...data } = payload;

    if ([THREAD_REQUESTS.OAUTH2_TOKEN_REFRESH,
        THREAD_REQUESTS.GET_SYSTEM_PROXY, THREAD_REQUESTS.VU_DATA].includes(requestType)) {
      this.relayMessageToWorkerThread(payload);
    }
    else {
      log.warn('WorkerThread ~ Unknown runtime request type', requestType);
    }
  }

  async stop () {
    log.debug('WorkerThread: stop');

    this.worker.off('message', this.handleMessage);

    log.info(`Worker ${this.id} stopping`);

    return this.worker.terminate().then(() => {
      log.info(`Worker ${this.id} stopped`);
    });
  }

  /**
   * Sends a message to the worker thread to stop the run.
   *
   * @param {Object} executionContext - The execution context of the run to be aborted
   */
  stopRun = (executionContext) => {
    log.info('WorkerThread: stopRun');

    this.worker.postMessage({ type: 'stop', payload: executionContext });
  }

  /**
   * Sends a message to the worker thread to abort the run.
   *
   * @param {Object} executionContext - The execution context of the run to be aborted
   */
  abortRun = (executionContext) => {
    log.info('WorkerThread: abortRun');

    // Add the sequence ID to the set of sequences to be aborted. This will be used to ignore any requests from the
    // worker thread for this sequence.
    this.sequencesToBeAborted.add(executionContext.sequenceId);

    this.worker.postMessage({ type: 'abort', payload: executionContext });
  }
}

module.exports = WorkerThread;
