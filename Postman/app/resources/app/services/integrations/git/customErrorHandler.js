const _ = require('lodash'),

  /**
   * Consists of mapping between the raw error and the parsed error.
   * This provides users with actionable items
   * @todo Review the copies from design
   */
  GitError = {
    httpsAuthenticationFailure: {
      name: 'httpsAuthenticationFailure',
      title: 'Authentication failure',
      message: 'HTTPS authentication failed'
    },
    sshAuthFailure: {
      name: 'sshAuthFailure',
      title: 'Authentication failure',
      message: 'SSH authentication failed'
    },
    noChangeToCommit: {
      name: 'noChangeToCommit',
      title: 'No changes',
      message: 'No change to commit to the git repository'
    },
    branchExists: {
      name: 'branchExists',
      title: 'Incorrect branch',
      message: 'The branch already exists or is incorrect'
    },
    pushNotFastForward: {
      name: 'pushNotFastForward',
      title: 'Remote is ahead of local',
      message: 'Please pull the changes before initiating a push'
    },
    notAGitRepository: {
      name: 'notAGitRepository',
      title: 'Incorrect path',
      message: 'Please select a git repository'
    },
    lockFileAlreadyExists: {
      name: 'lockFileAlreadyExists',
      title: 'Lock file exists',
      message: 'Another git process seems to be running in this repository.'
    },
    mergeConflicts: {
      name: 'mergeConflicts',
      title: 'Conflict detected',
      message: 'Please resolve the conflicts outside Postman'
    },
    stash: {
      name: 'stash',
      title: 'Error switching branch',
      message: 'Some of your local changes would be overwritten by checkout. Check the source control section to commit your changes, or use your Git client to stash them before trying again.'
    },
    incorrectPath: {
      name: 'incorrectPath',
      title: 'Incorrect path',
      message: 'Please provide the correct file path'
    },
    unknownRevision: {
      name: 'unknownRevision',
      title: 'Incorrect revision',
      message: 'Please provide a valid revision'
    },
    noUpstream: {
      name: 'noUpstream',
      title: 'No upstream',
      message: 'The current branch to be pushed has no upstream '
    },
    noChangeToPush: {
      name: 'noChangeToPush',
      title: 'No changes',
      message: 'There are no changes to push'
    }
  },

  /**
   * Houses the regexes to match the errors
   */
  GitRegex = {
    'ERROR: ([\\s\\S]+?)\\n+\\[EPOLICYKEYAGE\\]\\n+fatal: Could not read from remote repository.': GitError.sshAuthFailure,
    'nothing to commit': GitError.noChangeToCommit,
    'fatal: Authentication failed for \'https://': GitError.httpsAuthenticationFailure,
    'fatal: [Aa] branch named \'(.+)\' already exists.?': GitError.branchExists,
    'fatal: [Nn]ot a git repository \\(or any of the parent directories\\): (.*)': GitError.notAGitRepository,
    'Another git process seems to be running in this repository, e.g.': GitError.lockFileAlreadyExists,
    '(Merge conflict|Automatic merge failed; fix conflicts and then commit the result)': GitError.MergeConflicts,
    '\\((non-fast-forward|fetch first)\\)\nerror: failed to push some refs to \'.*\'': GitError.pushNotFastForward,
    'fatal: pathspec \'(.+)\' did not match any files': GitError.incorrectPath,
    'unknown revision or path not in the working tree': GitError.unknownRevision,
    'invalid object name': GitError.unknownRevision,
    'fatal: path \'(.+)\' does not exist .+': GitError.incorrectPath,
    'error: Your local changes to the following files would be overwritten by (checkout|merge)': GitError.stash,
    '.* has no upstream branch': GitError.noUpstream,
    'Everything up-to-date': GitError.noChangeToPush,
    'error: pathspec \'(.+)\' did not match any file\\(s\\) known to git': GitError.unknownRevision
  };


/**
 * Utility method to parse the error returned by the git command and map them to a more readable format.
 *
 * @param {String} rawError The raw output returned by the git command.
 * @returns {Object} The parsed error. Contains the properties -  { name , title, message, details }
 */
const parseError = (rawError) => {
  let parsedError = {
    name: 'GitError',
    title: 'Git error',
    message: 'Could not execute your command , please check the logs',
    details: rawError
  };

  _.forEach(GitRegex, (errorDetails, errorRegex) => {
    if (rawError.match(errorRegex)) {
      _.assign(parsedError, errorDetails);
      return false;
    }
  });

  return parsedError;
};


module.exports = { parseError };
