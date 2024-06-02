const { GitProcess } = require('@postman/dugite'),
  { splitOutput } = require('../utils'),
  { parseError } = require('./customErrorHandler'),
  _ = require('lodash');

/**
 * Class to perform git config command related operation
 */
class Config {
  constructor (path) {
    this.path = path;
    this.command = {
      listConfig: ['config', '--list']
    };
  }

  /**
   * Function to parse the result obtained from the git config list operation
   *
   * @param {String} stdout The raw output of the git operation
   *
   * @returns {Object} The parsed response in a readable object
   */
  _parseConfigList (stdout) {
    const outputLines = splitOutput(stdout),
      configList = _.reduce(outputLines, (config, line) => {
        const [configKey, configValue] = splitOutput(line, '=');
        if (!_.isUndefined(configValue))
          _.assign(config, { [configKey]: configValue });
        return config;
      }, {});
    return configList;
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
      const gitOptions = _.get(this.command, parserType),
        result = await GitProcess.exec(gitOptions, this.path) || {},
        { stdout, stderr, exitCode } = result;

      if (exitCode !== 0)
        return { error: parseError(stderr || stdout) };

      switch (parserType) {
        case 'listConfig':
          return { data: this._parseConfigList(stdout) };
        default:
          return { data: { stdout, stderr } };
      }
    }
    catch (err) {
      pm.logger.error(`Git.executeCommand ~ Config - ${parserType} : Failed to execute the command`, err);
      throw err;
    }
  }
}

module.exports = Config;
