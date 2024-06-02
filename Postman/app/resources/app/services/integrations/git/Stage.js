const { GitProcess } = require('@postman/dugite'),
  { populateParams } = require('../utils'),
  { parseError } = require('./customErrorHandler'),
  _ = require('lodash');

/**
 * Class to perform 'git add' command related operation
 */
class Stage {
  constructor (path) {
    this.path = path;
    this.command = {
      stageFiles: ['add', ':files']
    };
  }

  /**
   * Function to perform git operation
   *
   * @param {String} parserType The type of the operation that is requested which will help in parsing the response
   * @param {Object} [options] Additional details required by the git command. Eg : branch name , commit message etc.
   *
   * @returns {Object} The response of the git operation. Eg : { data : { branch : 'master'}} , {error:'fatal:path not found'}
   */
  async executeCommand (parserType, options) {
    if (_.isNil(options)) {
      options = {};
    }

    try {
      // If the file lists are not provided , populate it with empty array
      if (!_.isArray(options.files) || _.size(options.files) < 1) {
        options.files = ['.'];
      }

      const gitOptions = populateParams(_.get(this.command, parserType), options),
        result = await GitProcess.exec(gitOptions, this.path) || {},
        { stdout, stderr, exitCode } = result;

      if (exitCode !== 0)
        return { error: parseError(stderr || stdout) };

      switch (parserType) {
        case 'stageFiles':
          return { data: true };
        default:
          return { data: { stdout, stderr } };
      }
    }
    catch (err) {
      pm.logger.error(`Git.executeCommand ~ Stage - ${parserType} : Failed to execute the command`, err);
      throw err;
    }
  }
}

module.exports = Stage;
