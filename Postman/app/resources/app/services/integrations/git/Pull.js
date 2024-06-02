const { GitProcess } = require('@postman/dugite'),
  { parseError } = require('./customErrorHandler'),
  _ = require('lodash');

class Pull {
  constructor (path) {
    this.path = path;
    this.command = {
      pull: ['pull']
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
    try {
      const gitOptions = _.get(this.command, parserType),
        result = await GitProcess.exec(gitOptions, this.path) || {},
        { exitCode, stderr, stdout } = result;

      if (exitCode !== 0)
        return { error: parseError(stderr || stdout) };

      switch (parserType) {
        case 'pull':
          return { data: stdout };
        default:
          return { data: { stdout, stderr } };
      }
    }
    catch (err) {
      pm.logger.error(`Git.executeCommand ~ Pull - ${parserType} : Failed to execute the command`, err);
      throw err;
    }
  }
}

module.exports = Pull;
