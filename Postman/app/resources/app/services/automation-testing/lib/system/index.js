const _ = require('lodash');
const os = require('os');
const lifecycle = require('./_life-cycle');
const { getResponseChannels } = require('../communication');
const invoke = require('./invoke');
const { SUB_SYSTEM_REQUESTS } = require('../../ScenarioManager/constants');
const { cpu, memory, os: { getOSInformation } } = require('../host');

/**
 * global.SUBSYSTEM_REGISTER is the container for holding the references to the subsystems that make up the execution system.
 *
 * @todo: Use symbol for holding SUBSYSTEM_REGISTER inside global, so that it cannot be accessed outside of this file.
 *
 * The execution system is comprised of three types of subsystems:
 * 1. singletons: These are singleton classes, whose instance will be part of the execution system
 * 2. factories: These are classes which can have multiple instances which will be part of the execution system
 * 3. private: These are classes which are not exposed outside the execution system but needed for internal use
 */
if (!global.SUBSYSTEM_REGISTER) {
  global.SUBSYSTEM_REGISTER = {
    ...lifecycle.global,
    isInitialized: false,
    singletons: {},
    factories: {},
    private: {},
  };
}

const urlProxyConfigMap = new Map();

/**
 * Get the path to the subsystem in the global register
 * @param subsystemIdentifier
 * @returns {(string|*)[]}
 * @private
 */
function _getPublicSubSystemPath (subsystemIdentifier) {
  return ['SUBSYSTEM_REGISTER', 'singletons', subsystemIdentifier];
}

/**
 * Get the path to the private subsystem in the global register
 * @param subsystemIdentifier
 * @returns {(string|*)[]}
 * @private
 */
function _getPrivateSubSystemPath (subsystemIdentifier) {
  return ['SUBSYSTEM_REGISTER', 'private', subsystemIdentifier];
}

/**
 * Get the path to the factory subsystem in the global register
 * @param subsystemIdentifier
 * @returns {(string|*)[]}
 * @private
 */
function _getFactorySubSystemPath (subsystemIdentifier) {
  return ['SUBSYSTEM_REGISTER', 'factories', subsystemIdentifier];
}

/**
 * Set the instance of a factory by registering it in the global register.
 *
 * @param {string} subsystemId - The subsystem id as defined in the register.
 * @param {*} id - Id of the instance.
 * @param {object} instance - The instance to be registered.
 */
function setInstance (subsystemId, id, instance) {
  const factory = _.get(global, _getFactorySubSystemPath(subsystemId));

  if (!factory) {
    throw new Error(`Factory ${subsystemId} is not registered.`);
  }

  factory.instances.set(id, instance);
}

/**
 * Remove the instance of a factory by removing it from the global register.
 *
 * @param {string} subsystemId - The subsystem id as defined in the register.
 * @param {*} id - Id of the instance.
 *
 * @returns {any} - The instance's destroy function invocation, that was removed.
 */
function removeInstance (subsystemId, id) {
  const instance = global.SUBSYSTEM_REGISTER.factories?.[subsystemId]?.instances.get(id);

  global.SUBSYSTEM_REGISTER.factories[subsystemId].instances.delete(id);

  return instance && instance?.destroy?.();
}

/**
 * Get all the instances of a factory.
 * @param {string} subsystemId - The subsystem id as defined in the register.
 * @returns {Map} - The instances of the factory.
 */
function getInstances (subsystemId) {
  const factory = _.get(global, _getFactorySubSystemPath(subsystemId));

  if (!factory) {
    throw new Error(`Factory ${subsystemId} is not registered.`);
  }

  return factory.instances;
}

/**
 * Get an instance of a factory.
 * @param {string} subsystemId - The subsystem id as defined in the register.
 * @param {*} id - Id of the instance.
 * @returns {any} - The instance.
 */
function getInstance (subsystemId, id) {
  const factoryInstances = getInstances(subsystemId);

  return factoryInstances.get(id);
}

/**
 * Register a public subsystem in the global register.
 * @param {string|Symbol} subsystemIdentifier - The subsystem identifier.
 * @param {object} subsystem - The subsystem object.
 */
function publicSubsystem (subsystemIdentifier, subsystem) {
  if (_.get(global, _getPublicSubSystemPath(subsystemIdentifier))) {
    throw new Error(`Subsystem ${subsystemIdentifier} is already registered`);
  }

  _.set(global, _getPublicSubSystemPath(subsystemIdentifier), subsystem);

  lifecycle.registerHooks(subsystem);
}

/**
 * Register a private subsystem in the global register.
 * @param {string|Symbol} subsystemIdentifier - The subsystem identifier.
 * @param {object} subsystem - The subsystem object.
 */
function privateSubsystem (subsystemIdentifier, subsystem) {
  if (_.get(global, _getPrivateSubSystemPath(subsystemIdentifier))) {
    throw new Error(`Subsystem ${subsystemIdentifier} is already registered`);
  }

  _.set(global, _getPrivateSubSystemPath(subsystemIdentifier), subsystem);

  lifecycle.registerHooks(subsystem);
}

/**
 * Register a factory subsystem in the global register.
 * @param {string|Symbol} subsystemIdentifier - The subsystem identifier.
 * @param {string} name - The name of the factory.
 * @param {function} create - The create function.
 * @param {function} destroy - The destroy function.
 */
function factorySubsystem (subsystemIdentifier, { name, create, destroy, count }) {
  if (_.get(global, _getFactorySubSystemPath(subsystemIdentifier))) {
    throw new Error(`Subsystem ${subsystemIdentifier} is already registered`);
  }

  _.set(global, _getFactorySubSystemPath(subsystemIdentifier), {
    name,
    create,
    destroy,
    count,
    instances: new Map()
  });
}

/**
 * Get all the public subsystems.
 *
 * @returns {string[]}
 */
function getPublicSubsystems () {
  return [
    ...Object.keys(global?.SUBSYSTEM_REGISTER?.singletons || {}),
    ...Object.keys(global?.SUBSYSTEM_REGISTER?.factories || {})
  ];
}

/**
 * Requests system actions from the main process.
 * @param {string} action - The action to be requested.
 * @param {object} [data] - Any additional data to be sent to the main process to handle the action.
 * @returns {*}
 * @private
 */
function _requestAction ({ action, data }) {
  return pm.sdk.ipc.broadcast('system-request', { action, data });
}

/**
 * Allow the system to go to sleep
 * @returns {*}
 */
function releasePowerSaver () {
  return _requestAction({ action: SUB_SYSTEM_REQUESTS.ACTION.ALLOW_SLEEP });
}

/**
 * Prevent the system to go to sleep.
 * @param {Number} maxDuration - The maximum duration in seconds the system can stay awake.
 * @returns {*}
 */
function preventPowerSaver (maxDuration) {
  if (!maxDuration || !Number.isFinite(maxDuration)) {
    throw new Error('preventPowerSaver cannot be called without maxDuration');
  }

  return _requestAction({ action: SUB_SYSTEM_REQUESTS.ACTION.PREVENT_SLEEP, data: { maxDuration } });
}

/**
 * Get the platform specs of the system.
 * @returns {Promise<{memory: *, os: *, cpu: *, logicalCores: number}>}
 */
async function getPlatformSpecs () {
  try {
    const cpuInformation = cpu.getCPUInformation();
    const osInformation = getOSInformation();

    return {
      cpu: cpuInformation,
      memory: await memory.getMemoryInformation(),
      os: osInformation,
      logicalCores: os.cpus().length
    };
  }
  catch (e) {
    pm.logger.error('Failed to get platform specs', e);
  }
}

/**
 * Get CPU and Memory percentage being used by the system currently.
 * Optionally also provides per process CPU and Memory usage breakdown.
 *
 * @returns {Object}
 * @property {Object} cpuUsage - CPU usage information.
 */
async function getUsageStats () {
  const { free: freeMemory, total: totalMemory } = await memory.getMemoryInformation();

  return {
    system: {
      cpu: await cpu.getCPUUsagePromise(50),
      memory: (freeMemory / totalMemory) * 100,
      totalMemoryBytes: totalMemory,
    }
  };
}

/**
 * Returns the proxy-config for a URL if found in the cache, else fetches it
 * from the system configuration, adds to the cache and returns the same
 *
 * @param {string} url - The URL for which to fetch the proxy
 * @returns - The proxy-config for the given URL
 */
async function getOrFetchSystemProxy (url) {
  if (urlProxyConfigMap.has(url)) {
    return urlProxyConfigMap.get(url);
  }
  else {
    const action = 'getSystemProxy',
      channel = 'system-request',
      responseChannels = getResponseChannels(channel),
      data = { url, responseChannels };

    const promise = new Promise((resolve, reject) => {
      pm.sdk.ipc.subscribeOnce(responseChannels.data,
        (event, args) => {
          resolve({ event, args });
        });
    });

    pm.sdk.ipc.broadcast('system-request', { action, data });

    const { event, args } = await promise;
    const proxyConfig = typeof args[0] === 'string' ? JSON.parse(args[0]) : args[0];

    urlProxyConfigMap.set(url, proxyConfig);

    return proxyConfig;
  }
}

/**
 * Returns the proxy config for the given URL
 *
 * @param {string} url - The URL to get the proxy configuration for
 * @returns {ProxyConfig} - The proxy configuration for the given URL
 */
async function getSystemProxy (url) {
  const proxyResponse = await getOrFetchSystemProxy(url);

  return proxyResponse;
}

/**
 * Resets any state that is saved in the system.
 *
 * Since we have one workload at a time right now, we will not store the state per workload
 * When we have multiple concurrent workloads, urlProxyConfigMap[workload-id] will contain
 * the map for that workload if and only that needs to be reset.
 */
function resetState () {
  urlProxyConfigMap.clear();
}

// Initialize lifecycle
lifecycle.init();

module.exports = {
  ...lifecycle.exports,
  registry: global.SUBSYSTEM_REGISTER,
  setInstance,
  removeInstance,
  getInstances,
  getInstance,
  invoke,
  registerSubsystem: {
    public: publicSubsystem,
    private: privateSubsystem,
    factory: factorySubsystem,
  },
  getPublicSubsystems,
  releasePowerSaver,
  preventPowerSaver,
  getPlatformSpecs,
  getUsageStats,
  getSystemProxy,
  resetState
};
