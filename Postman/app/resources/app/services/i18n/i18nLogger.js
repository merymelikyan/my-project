/**
 * Logs an error message with context for New Relic
 * @param {string} errorMessage - The error message to log
 * @param {Error} error - The error object
 * @param {JSON} extraErroInfo - Any other arguments relevant to the log
 */
function error (errorMessage, error = null, extraErroInfo = {}) {
  // We need to pass the context to the logger, so that it can be used in New Relic
  extraErroInfo.context = pm.logger.getContext('i18n', 'ux-foundation');

  // The error object might not be truthy, so we create an error object if it is not
  const errorParam = !error ? new Error() : error;

  pm.logger.error(errorMessage, errorParam, extraErroInfo);
}

exports.i18nLogger = {
  error
};
