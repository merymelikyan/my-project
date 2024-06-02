const { GitProcess } = require('@postman/dugite'),
  _ = require('lodash'),
  { splitOutput, regexValidator, populateParams } = require('../utils'),
  { parseError } = require('./customErrorHandler'),
  { COMMIT_DETAILS_REGEX, FILE_CHANGES_REGEX, FILE_CHANGES_PARTIAL_REGEX } = require('./constants');

/**
 * Class to perform git branch commit related operation
 */
class Commit {
  constructor (path) {
    this.path = path;
    this.command = {
      commitWithMessage: ['commit', '-m', ':message']
    };
  }

  /**
   * Function to parse the result obtained from the git commit operation
   *
   * @param {String} stdout The raw output of the git operation
   *
   * @returns {Object} The parsed response in a readable object
   */
  _parseCommitSummary (stdout) {
    if (!stdout)
      return null;

    const outputLines = splitOutput(stdout),
      branchAndCommitRegex = new RegExp(COMMIT_DETAILS_REGEX),
      fileChangesRegex = new RegExp(FILE_CHANGES_REGEX, 'g'),
      fileChangesPartialRegex = new RegExp(FILE_CHANGES_PARTIAL_REGEX),
      commitSummary = _.reduce(outputLines, (commitDetails, line) => {
        // Regex to extract the branch and commit sha
        const branchAndCommitDetails = regexValidator(branchAndCommitRegex, line);
        if (!_.isEmpty(branchAndCommitDetails)) {
          const [branch, root, commit] = branchAndCommitDetails;

          // The root details are skipped and is used to detect initial repo commits
          _.assign(commitDetails, { branch, commit });
          return commitDetails;
        }

        // Regex to obtain the change summary , insertions and deletions
        const fileChangeSummary = regexValidator(fileChangesRegex, line);
        if (!_.isEmpty(fileChangeSummary)) {
          const [changes, insertions, deletions] = fileChangeSummary,
            changeSummary = {
              changes: parseInt(changes) || 0,
              insertions: parseInt(insertions) || 0,
              deletions: parseInt(deletions) || 0
            };
          _.assign(commitDetails, { changeSummary });
          return commitDetails;
        }

        // Regex to obtain the change summary with missing segments
        const fileChangeSummaryPartial = regexValidator(fileChangesPartialRegex, line);
        if (!_.isEmpty(fileChangeSummaryPartial)) {
          const [changes, lines, type] = fileChangeSummaryPartial;
          let insertions = 0,
            deletions = 0;

          if (type === '-') {
            deletions = parseInt(lines);
          }
          else if (type === '+') {
            insertions = parseInt(lines);
          }

          const changeSummary = {
            changes: parseInt(changes) || 0,
            insertions: parseInt(insertions) || 0,
            deletions: parseInt(deletions) || 0
          };
          _.assign(commitDetails, { changeSummary });
          return commitDetails;
        }
        return commitDetails;
      }, {});
    return _.isEmpty(commitSummary) ? null : commitSummary;
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
      const gitOptions = populateParams(_.get(this.command, parserType), options),
        result = await GitProcess.exec(gitOptions, this.path) || {},
        { stdout, stderr, exitCode } = result;

      if (exitCode !== 0)
        return { error: parseError(stderr || stdout) };

      switch (parserType) {
        case 'commitWithMessage':
          return { data: this._parseCommitSummary(stdout) };
        default:
          return { data: { stdout, stderr } };
      }
    }
    catch (err) {
      pm.logger.error(`Git.executeCommand ~ Commit - ${parserType} : Failed to execute the command`, err);
      throw err;
    }
  }
}

module.exports = Commit;
