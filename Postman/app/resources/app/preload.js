/**
 * IMPORTANT: This file needs to be loaded as early as possible when the app starts
 */

global.pm = global.pm || {};

pm.logger = console; // Default it to console.

// Add a helper to create a context object
// This is a fallback for generating context object when pm.logger hasn't been initialized with app-logger
pm.logger.getContext = function getContext (api, domain) {
  return {
      api,
      domain
  };
};

pm.sdk = require('./sdk/index');
