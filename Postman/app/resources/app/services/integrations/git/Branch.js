const { GitProcess } = require('@postman/dugite'),
  _ = require('lodash'),
  { splitOutput, regexValidator, populateParams } = require('../utils'),
  { parseError } = require('./customErrorHandler'),
  { BRANCH_DETACHED_REGEX, BRANCH_DETAILS_REGEX } = require('./constants');

/**
 * Class to perform git branch command related operation
 */
class Branch {
  constructor (path) {
    this.path = path;
    this.command = {
      listBranches: ['branch', '-vv'],
      getCurrentBranch: ['branch', '-vv', '--contains', 'HEAD'],
      createBranch: ['branch', ':newBranch', ':sourceBranch'],
      switchBranch: ['checkout', ':branch'],
      symbolicRef: ['symbolic-ref', 'HEAD']
    };
  }

  /**
   * Function to parse the result obtained from the git branch list operation
   *
   * @param {String} stdout The raw output of the git operation
   *
   * @returns {Object} The parsed response in a readable object
   */
  async _parseBranchListSummary (stdout) {
    let currentBranch = null,
      detached = false;

    if (!stdout) {
      // If branch list came out as empty, get current branch
      // name using symbolic-ref (usually happens in a bare repo)
      let branchList = [];
      try {
        const defaultHead = await this.executeCommand('symbolicRef');
        currentBranch = defaultHead.data.name;
        branchList = [{ ...defaultHead.data, current: true }];
      } catch (err) {
        // Nothing to log as error is already logged in executeCommand
      }

      return { detached, currentBranch, branchList };
    }

    let current, name, commit, label;

    const outputLines = splitOutput(stdout),
      detachedHeadRegex = new RegExp(BRANCH_DETACHED_REGEX),
      branchDetailsRegex = new RegExp(BRANCH_DETAILS_REGEX, 's'),
      filteredBranchList = _.reduce(outputLines, (branchList, line) => {
        // Regex to check if branch is detached
        const detachedData = regexValidator(detachedHeadRegex, line);
        if (!_.isEmpty(detachedData)) {
          [current, name, commit, label] = detachedData;

          if (current) {
            currentBranch = name;
            detached = true;
          }
          branchList.push({ current: Boolean(current), name, commit, label });
        }
        else {
          // Regex to match branch
          const branchData = regexValidator(branchDetailsRegex, line);
          if (!_.isEmpty(branchData)) {
            [current, name, commit, label] = branchData;
            if (current) {
              currentBranch = name;
              detached = false;
            }
            branchList.push({ current: Boolean(current), name, commit, label });
          }
        }
        return branchList;
      }, []);

    return {
      detached,
      currentBranch,
      branchList: filteredBranchList
    };
  }

  /**
   * Function to trigger git command to get default branch name
   * This is specifically to be used for a bare repo i.e. a repo without any
   * commits
   * @returns {Object} The parsed response in a readable object
   */
  _parseSymbolicRefOutput (stdout) {
    return {
      name: stdout.trim().replace('refs/heads/', ''),
      commit: null,
      label: null
    };
  }

  /**
   * Function to parse the result obtained from the git current branch list operation
   *
   * @param {String} stdout The raw output of the git operation
   * @returns {Object} TThe parsed response in a readable object
   */
  _parseCurrentBranchSummary (stdout, stderr, exitCode) {

    if (!stdout)
      return { name: null, commit: null, label: null };

    const outputLines = splitOutput(stdout),
      branchDetachedRegex = new RegExp(BRANCH_DETACHED_REGEX, 's'),
      branchDetailsRegex = new RegExp(BRANCH_DETAILS_REGEX, 's');

    let current, name, commit, label;

    _.some(outputLines, (line) => {
      // First check if it is in detached mode
      let branchData = regexValidator(branchDetachedRegex, line);
      if (_.isEmpty(branchData)) {
        // If not detached mode, check for normal branch
        branchData = regexValidator(branchDetailsRegex, line);
      }

      [current, name, commit, label] = branchData;
      if (current) {
        return true;
      }
    });

    return { name, commit, label };
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

      if (parserType === 'getCurrentBranch' && stderr === 'error: malformed object name HEAD\n' && exitCode === 129) {
        return this.executeCommand('symbolicRef');
      }

      if (exitCode !== 0)
        return { error: parseError(stderr || stdout) };

      switch (parserType) {
        case 'listBranches':
          return { data: await this._parseBranchListSummary(stdout) };
        case 'getCurrentBranch':
          return { data: this._parseCurrentBranchSummary(stdout, stderr, exitCode) };
        case 'createBranch':
          return { data: stdout };
        case 'switchBranch':
          return { data: stdout };
        case 'symbolicRef':
          return { data: this._parseSymbolicRefOutput(stdout) };

        default:
          return { data: { stdout, stderr } };
      }
    }
    catch (err) {
      pm.logger.error(`Git.executeCommand ~ Branch - ${parserType} : Failed to execute the command`, err);
      throw err;
    }
  }
}

module.exports = Branch;
