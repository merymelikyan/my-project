const system = require('./lib/system');
const { setLogLevel, getLogLevel, log } = require('./lib/logging');
const ScenarioManager = require('./ScenarioManager');
const WorkloadManager = require('./WorkloadManager');
const MetricsProcessor = require('./MetricsProcessor');
const TokenManager = require('./Workers/TokenManager');
const MAX_WORKLOAD_MANAGER_COUNT = 1;

system.registerSubsystem.private('scenarioManager', new ScenarioManager());
system.registerSubsystem.public('healthChecker', {
  isAlive: () => {
    // TODO: Communicate health of the system by identifying the health of the subsystems
    return true;
  }
});
system.registerSubsystem.public('metricsProcessor', new MetricsProcessor());
system.registerSubsystem.factory('workloadManager', {
  name: 'WorkloadManager',
  create: (constructorArgs = []) => {
    log.info('ExecutionSystem: WorkloadManagerFactory ~ created has been called');

    const instanceCount = system.getInstances('workloadManager').size;

    // @TODO: We need to count the ongoing runs rather than all the instances of workload-manager
    // instances remain after the run is completed, when do we call the below destroy?
    // workloadManager should be destroyed after the run is complete and the data is pushed to
    // the database and also when a run is killed mid way
    if (instanceCount >= MAX_WORKLOAD_MANAGER_COUNT) {
      throw new Error('Another performance test is already in progress. Please wait for the current test to finish before starting a new one.',
        { cause: 'systemLimitation' }
      );
    }

    const instance = new WorkloadManager(constructorArgs);

    system.setInstance('workloadManager', instance.workloadId, instance);

    // To avoid circular references, we need to return a plain object.
    return JSON.parse(JSON.stringify(instance));
  },

  destroy: (id) => {
    log.info('ExecutionSystem: WorkloadManagerFactory ~ destroy ~ id', id);

    system.resetState();
    system.removeInstance('workloadManager', id);
  },

  count: () => {
    return system.getInstances('workloadManager').size;
  }
});

// Token Manager will be responsible for managing the tokens for the performance test run, it will refresh the tokens
// and will also provide the tokens to the workers when they need it.
// Making it private as it is not required to be exposed to the outside ExecutionSystem.
system.registerSubsystem.private('tokenManager', new TokenManager());

/**
 * Setup logging configuration from feature flag during boot.
 * [System.onStartup is called when Main signals ready to exec. process (system module)]
 */
system.onStartup(() => {
  // Set the log level from the configuration
  try {
    const configurationOptions = system.getConfigurationOptions();

    if (configurationOptions.logLevel) {
      log.info('onStartup ~ Setting logging level', configurationOptions.logLevel);
      setLogLevel(configurationOptions.logLevel);
    }
    else {
      log.info('No custom logging level is configured. Setting default logging level.');
    }
  }
  catch (e) {
    log.error(`Error while setting log configuration, logging might not work as expected. Logger is using ${getLogLevel()} as default.`, e);
  }
});

/**
 * Fetches the platform specs and logs them on startup. This will be helpful in debugging the issues
 * related to the performance test runs if the workload is not able to initialize.
 */
system.onStartup(async () => {
  try {
    const platformSpecs = await system.getPlatformSpecs();

    // pm.logger.info is used instead of log.info as we would like to log platform specs even if the
    // logging level is set to higher level.
    pm.logger.info('ExecutionSystem: onStartup ~ platformSpecs', platformSpecs);
  }
  catch (e) {
    log.warn('ExecutionSystem: onStartup ~ error while fetching platform specs', e);
  }
});
