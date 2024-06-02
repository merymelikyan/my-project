const constants = {};
const TRACE = 'trace';
const DEBUG = 'debug';
const INFO = 'info';
const WARN = 'warn';
const ERROR = 'error';
const CRITICAL = 'critical';
const FATAL = 'fatal';

constants.LOG_LEVELS = {
  TRACE,
  DEBUG,
  INFO,
  WARN,
  ERROR,
  CRITICAL,
  FATAL
};
constants.LOG_LEVEL_ORDER = [
  TRACE,
  DEBUG,
  INFO,
  WARN,
  ERROR,
  CRITICAL,
  FATAL
];
constants.LOG_LEVEL_ORDER_MAP = {
  [TRACE]: 0,
  [DEBUG]: 1,
  [INFO]: 2,
  [WARN]: 3,
  [ERROR]: 4,
  [CRITICAL]: 5,
  [FATAL]: 6
};

constants.SYSTEM_ERRORS = {
  INSTANCE_NOT_FOUND: 'INSTANCE_NOT_FOUND',
  SYMBOL_NOT_FOUND: 'SYMBOL_NOT_FOUND'
};

module.exports = constants;
