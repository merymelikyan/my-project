const { GitProcess } = require('@postman/dugite'),
  _ = require('lodash'),
  { populateParams, splitOutput } = require('../utils'),
  { parseError } = require('./customErrorHandler'),
  fileStatusMap = {
    A: 'added',
    D: 'deleted',
    M: 'modified',
    R: 'renamed'
  };

/**
 * Class to perform git log related operations
 */
class Log {
  constructor (path) {
    this.path = path;
    this.command = {
      /**
       * Used to get commits that are not present source branch but in destination branch
       * Can be filtered by file or directory paths
       * Returns only commit IDs because of formatting
       * e.g. git log main..origin/main --pretty=format:{"commitId": "%H", "commitMessage":"%s", "timestamp":"%at"}
       */
      compareBranches: ['log', ':sourceWithDestinationBranch', '--pretty=format:{"commitId": "%H", "commitMessage":"%s","timestamp":"%at"}'],

      /**
       * Used to get commits for the current branch, commits can be skipped and limited
       * Returns only commit IDs because of formatting
       * With filter paths:
       * e.g. git log --pretty=format:{"commitId": "%H", "commitMessage":"%s", "timestamp":"%at", "authorName": "%an"} --max-count=100 -- schema.yaml collection.json
       * Without filter paths:
       * e.g. git log --pretty=format:{"commitId": "%H", "commitMessage":"%s", "timestamp":"%at", "authorName": "%an"} --max-count=100
       */
      getCommitsLog: ['log', '--pretty=format:{"commitId": "%H", "commitMessage":"%s", "timestamp":"%at", "authorName": "%an"}', ':limit'],

      /**
       * Used to get files for a single commit
       * Will return the lines in the following format:
       * {"commitId": "9vrdjh0980vcvjhkjkjkh8y98090", "commitMessage": "test commit", "timestamp": "82979873793", "authorName": "User 1"}
       * A schema.yaml
       * D c1.json
       * e.g. git log absjquwjn83u --name-status --pretty=format:{"commitId": "%H", "commitMessage":"%s", "timestamp":"%at", "authorName": "%an"} --max-count=1
       */
      getFilesForCommit: ['log', ':commitId', '--name-status',
        '--pretty=format:{"commitId": "%H", "commitMessage":"%s", "timestamp":"%at", "authorName": "%an"}', '--max-count=1']
    };
  }

  /**
   * Parses the data from git command execution
   * @private
   *
   * @param {String} data - the CLI output
   *
   * @returns - the list of commits along with its meta amd files info
   *
   */
  async _parseCommitsLog (data) {
    let commitsListWithMeta = splitOutput(data),
      result = {};

    // filter any empty commit
    commitsListWithMeta = _.reject(commitsListWithMeta, (commit) => !commit);

    result.totalCount = commitsListWithMeta.length;

    commitsListWithMeta = _.map(commitsListWithMeta, (commitWithMeta) => {
      return JSON.parse(commitWithMeta);
    });

    result.commits = _.orderBy(commitsListWithMeta, ['timestamp'], ['desc']);

    return result;
  }

  /**
   * Parses the commit meta and files associated with a commit
   * @private
   *
   * @param {String} data - the CLI output in the following format
   * {"commitId": "9vrdjh0980vcvjhkjkjkh8y98090", "commitMessage": "test commit", "timestamp": "82979873793", "authorName": "User 1"}
   * A schema.yaml
   * D c1.json
   *
   * @returns {Object} - an object containing commit meta and list of files that changed with the commit
   *
   */
  _parseCommitFiles (data) {
    let outputLines = splitOutput(data),
      commitMeta = _.first(outputLines),
      commitMetaWithFiles;

    commitMetaWithFiles = JSON.parse(commitMeta);

    // remove the first element from array
    outputLines = _.drop(outputLines);

    commitMetaWithFiles.files = _.map(outputLines, (line) => {
      const fileInfo = splitOutput(line, '\t', true),
        [fileStatus, filePath, newFilePath] = fileInfo;

      if (_.startsWith(fileStatus, 'R')) {
        // if it is a rename operation, then send old and new file paths
        return {
          fileStatus: fileStatusMap['R'],
          filePath: newFilePath,
          oldFilePath: filePath
        };
      }

      return {
        fileStatus: fileStatusMap[fileStatus],
        filePath
      };
    });

    return commitMetaWithFiles;
  }

  /**
   * Executes the git log command with different variations
   *
   * @param {String} parserType - the action type to identify which command to execute
   * @param {Object} options - the object containing values to replace in command
   * @param {String[]} [options.filterPaths] - the list of directory or file paths to filter the commits
   * @param {Number} [options.offset] - the number of commits to skip
   * @param {Number} [options.limit] - the maximum number of commits to return
   * @param {String} [options.sourceWithDestinationBranch] - used by compareBranches, the string containing source
   * commit/branch and destination commit/branch separated by '..'
   *
   * @returns {Object} - the object containing data or error depending upon the result of execution
   */
  async executeCommand (parserType, options) {
    if (_.isNil(options)) {
      options = {};
    }

    try {
      let filterPathsList;

      /**
       *  populateParams doesn't support to replace ':filterPaths' in command by an array
       *  so the below logic will iterate over filterPaths array and append gitOptions to the form the below array
       *  ['log', '--pretty=format:%H', '--max-count=10', '--', 'schema.yaml', 'f1/coll.json']
       */
      if (!_.isEmpty(options.filterPaths)) {
        filterPathsList = _.concat(['--'], options.filterPaths);
        delete options.filterPaths;
      }

      let gitOptions = populateParams(_.get(this.command, parserType), options),
        result;

      _.isArray(filterPathsList) && gitOptions.push(...filterPathsList);

      result = await GitProcess.exec(gitOptions, this.path) || {};
      const { exitCode, stderr, stdout } = result;

      if (exitCode !== 0) {
        return { error: parseError(stderr || stdout) };
      }

      switch (parserType) {
        case 'compareBranches':
          return { data: await this._parseCommitsLog(stdout) };
        case 'getCommitsLog':
          return { data: await this._parseCommitsLog(stdout) };
        case 'getFilesForCommit':
          return { data: this._parseCommitFiles(stdout) };
        default:
          return { data: { stdout, stderr } };
      }
    }
    catch (err) {
      pm.logger.error(`Git.executeCommand ~ Log - ${parserType} : Failed to execute the command`, err);
      throw err;
    }
  }
}

module.exports = Log;
