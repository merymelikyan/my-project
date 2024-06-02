const { GitProcess } = require('@postman/dugite'),
  _ = require('lodash'),
  path = require('path'),
  { splitOutput, regexValidator } = require('../utils'),
  { parseError } = require('./customErrorHandler'),
  { RENAME_REGEX, STATUS_STATE, NULL_DELIMITER, RENAME_DELIMITER } = require('./constants');

class Status {
  constructor (path) {
    this.path = path;
    this.command = {
      /**
       * Gets the state of the working tree and the staging area.
       * --porcelain helps in obtaining the result in human readable format.
       * --untracked-files shows the status of untracked files and directories.
       * --null dictates the git to terminate the entries with null instead of newline.
       * Without the option, file names that contain unusual characters would be quoted
       */
      status: ['status', '--porcelain', '--untracked-files', '--null']
    };
  }

  /**
   * Function to parse the result obtained from the git status operation
   * Ref : https://git-scm.com/docs/git-status
   *
   * @param {String} stdout The raw output of the git operation
   *
   * @returns {Object} The parsed response in a readable object
   */
  _parseStatus (stdout) {
    const outputLines = splitOutput(stdout, NULL_DELIMITER),
      renameRegex = new RegExp(RENAME_REGEX),
      status = {
        staged: [],
        unstaged: [],
        untracked: [],
        unmerged: []
      };
    let gitStatus, gitStatusStaged, gitStatusUnstaged, type;

      // If no files changed, then outputLines has empty strings in it.
      // So we ignore them
      const filteredLines = outputLines.filter((line) => line.length > 0);

    _.forEach(filteredLines, (line, index) => {
      let x, y, file;

      // Order is maintained to detect right file name
      if (line.charAt(2) === ' ') {
        // This handles the cases when x and y flags are present in the short status "M  test.js"
        x = line.charAt(0);
        y = line.charAt(1);
        file = line.substr(3);
      }
      else if (line.charAt(1) === ' ') {
        // This handles the cases when only y flags is present in the short status "M test.js"
        x = ' ';
        y = line.charAt(0);
        file = line.substr(2);
      }
      const state = STATUS_STATE[`${x}${y}`],
        fileName = file && path.parse(file).base;

      switch (state) {
        case 'staged-renamed': {
          /**
           * The --null separates the old and new file name with a \0 (null) delimiter.
           * Hence , we construct the rename state in the format `old_file_name -> new_file_name`
           * The file_name or element at (index+1) location need not be removed,
           * because the iteration would enter the default switch case.
           */
          const renameState = `${_.get(filteredLines, index + 1, '')}${RENAME_DELIMITER}${file}`,
            [from, to] = regexValidator(renameRegex, renameState),
            name = to && path.parse(to).base;

          if (from && to)
            status.staged.push({ type: 'renamed', from, to, name });
          break;
        }
        case 'untracked':
          status.untracked.push({ type: 'untracked', path: file, name: fileName });
          break;
        case 'unstaged-modified':
        case 'staged-modified':
        case 'staged-deleted':
        case 'unstaged-deleted':
        case 'staged-added':
          [gitStatus, type] = state.split('-');
          status[gitStatus].push({ type, path: file, name: fileName });
          break;
        case 'staged-unstaged-modified':
          [gitStatusStaged, gitStatusUnstaged, type] = state.split('-');

          status[gitStatusStaged].push({ type, path: file, name: fileName });
          status[gitStatusUnstaged].push({ type, path: file, name: fileName });
          break;
        case 'unmerged-added-added':
        case 'unmerged-modified-modified':
        case 'unmerged-deleted-modified':
        case 'unmerged-modified-deleted': {
          // unmerged-[local_action]-[remote_action]
          const [gitStatus, localAction] = state.split('-');
          status[gitStatus].push({ type: localAction, path: file, name: fileName });
          break;
        }
        case 'staged-renamed-unstaged-deleted':
        case 'staged-renamed-unstaged-modified': {
          const [_staged, stagedAction, _unstaged, unstagedAction] = state.split('-');
          status.staged.push({ type: stagedAction, path: file, name: fileName });
          status.unstaged.push({ type: unstagedAction, path: file, name: fileName });
          break;
        }
        default:
      }
    });
    return status;
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
        { exitCode, stderr, stdout } = result;

      if (exitCode !== 0)
        return { error: parseError(stderr || stdout) };

      switch (parserType) {
        case 'status':
          return {
            data: this._parseStatus(stdout)
          };
        default:
          return { data: { stdout, stderr } };
      }
    }
    catch (err) {
      pm.logger.error(`Git.executeCommand ~ Status - ${parserType} : Failed to execute the command`, err);
      throw err;
    }
  }
}

module.exports = Status;
