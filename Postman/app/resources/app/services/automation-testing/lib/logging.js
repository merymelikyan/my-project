const _ = require('lodash');
const { LOG_LEVELS, LOG_LEVEL_ORDER, LOG_LEVEL_ORDER_MAP } = require('./system/constants');

const logLevelPath = ['SUBSYSTEM_REGISTER', 'logLevel'];
const defaultLogLevelIndex = LOG_LEVEL_ORDER_MAP[LOG_LEVELS.DEBUG];
const BASE_LOG_LEVELS = new Set([LOG_LEVELS.INFO, LOG_LEVELS.WARN, LOG_LEVELS.ERROR]);
const CUSTOM_DEBUG_LOG_LEVELS = new Set([LOG_LEVELS.DEBUG, LOG_LEVELS.TRACE]);
const CUSTOM_ERROR_LOG_LEVELS = new Set([LOG_LEVELS.CRITICAL, LOG_LEVELS.FATAL]);

/**
 * Get the log level of the system.
 * @returns {[number,string]}
 */
function getLogLevel () {
  return _.get(global, logLevelPath, [defaultLogLevelIndex, LOG_LEVEL_ORDER[defaultLogLevelIndex]]);
}

/**
 * Set the log level of the system.
 * @param level
 */
function setLogLevel (level) {
  let levelIndex = LOG_LEVEL_ORDER_MAP[level];

  if (!levelIndex) {
    pm.logger.warn('Invalid log level, setting default level logging.', defaultLogLevelIndex);

    level = LOG_LEVEL_ORDER[defaultLogLevelIndex];
    levelIndex = defaultLogLevelIndex;
  }

  _.set(global, logLevelPath, [levelIndex, level]);
}

/**
 * Log a message at a particular level
 * @param {String} level - The level at which the message should be logged
 * @param {Any} data - The data to be logged
 * @private
 */
function _saveLog (level, data) {
  const [configuredIndex] = getLogLevel();
  const incomingLogLevelIndex = LOG_LEVEL_ORDER_MAP[level];
  const logger = pm?.logger || console;

  if (incomingLogLevelIndex >= configuredIndex) {
    if (BASE_LOG_LEVELS.has(level)) {
      logger[level](data);
    }

    // Synthetic debug levels which are not supported by the logger
    else if (CUSTOM_DEBUG_LOG_LEVELS.has(level)) {
      logger.info(`s[${level}]`, data);
    }

    // Synthetic error levels which are not supported by the logger
    else if (CUSTOM_ERROR_LOG_LEVELS.has(level)) {
      logger.error(`s[${level}]`, data);
    }
    else {
      logger.warn(`[InvalidLogConfiguration][${level}]`, data);
    }
  }
}

module.exports = {
  log: {
    trace: (...data) => _saveLog(LOG_LEVELS.TRACE, data),
    debug: (...data) => _saveLog(LOG_LEVELS.DEBUG, data),
    info: (...data) => _saveLog(LOG_LEVELS.INFO, data),
    warn: (...data) => _saveLog(LOG_LEVELS.WARN, data),
    error: (...data) => _saveLog(LOG_LEVELS.ERROR, data),
    critical: (...data) => _saveLog(LOG_LEVELS.CRITICAL, data),
    fatal: (...data) => _saveLog(LOG_LEVELS.FATAL, data)
  },
  getLogLevel,
  setLogLevel,
  logLevelPath
};
