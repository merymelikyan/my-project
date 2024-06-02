const { GitProcess } = require('@postman/dugite'),
  _ = require('lodash'),
  { parseError } = require('./customErrorHandler'),
  { populateParams } = require('../utils');

/**
 * Class to get file contents
 */
class Show {
  constructor (path) {
    this.path = path;
    this.command = {

      /**
       * Used to get file contents given a revision ID (e.g. commit ID) and file path
       * Returns file contents
       * e.g. git show 70efea802e0a2191a:f1/schema.yaml
       */
      getFileContent: ['show', ':revisionIdWithFilePath']
    };
  }

  /**
   * Executes the git fetch command to fetch remote data
   *
   * @param {String} parserType - the action type to identify which command to execute
   * @param {Object} options - the object containing values to replace in command
   * @param {String} options.revisionIdWithFilePath - the string containing revision ID and file path separated by ..
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
        case 'getFileContent':
          return { data: stdout };
        default:
          return { data: { stdout, stderr } };
      }
    }
    catch (err) {
      pm.logger.error(`Git.executeCommand ~ Show - ${parserType} : Failed to execute the command`, err);
      throw err;
    }
  }
}

module.exports = Show;
