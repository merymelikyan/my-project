const { GitProcess } = require('@postman/dugite'),
  _ = require('lodash'),
  { parseError } = require('./customErrorHandler'),
  { populateParams } = require('../utils');

/**
 * Class to fetch the remote contents for a branch
 */
class Fetch {
  constructor (path) {
    this.path = path;
    this.command = {
      fetchRemoteData: ['fetch', 'origin', ':branch']
    };
  }

  /**
   * Executes the git fetch command to fetch remote data
   *
   * @param {String} parserType - the action type to identify which command to execute
   * @param {Object} options - the object containing values to replace in command
   * @param {String} options.branch - the branch name to fetch
   *
   * @returns {Object} - the object containing data or error depending upon the result of execution
   */
  async executeCommand (parserType, options) {
    if (_.isNil(options)) {
      options = {};
    }

    try {
      const gitOptions = populateParams(_.get(this.command, parserType), options),
        result = await GitProcess.exec(gitOptions, this.path) || {},
        { exitCode, stderr, stdout } = result;

      if (exitCode !== 0) {
        return { error: parseError(stderr || stdout) };
      }

      switch (parserType) {
        case 'fetchRemoteData':
          return { data: stdout };
        default:
          return { data: { stdout, stderr } };
      }
    }
    catch (err) {
      pm.logger.error(`Git.executeCommand ~ Fetch - ${parserType} : Failed to execute the command`, err);
      throw err;
    }
  }
}

module.exports = Fetch;
