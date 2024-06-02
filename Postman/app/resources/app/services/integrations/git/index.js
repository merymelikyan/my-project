const _ = require('lodash'),

  // @todo : Lazy load the files
  GIT_FACTORY = {
    branch () {
      return require('./Branch');
    },
    pull () {
      return require('./Pull');
    },
    push () {
      return require('./Push');
    },
    commit () {
      return require('./Commit');
    },
    config () {
      return require('./Config');
    },
    stage () {
      return require('./Stage');
    },
    reset () {
      return require('./Reset');
    },
    status () {
      return require('./Status');
    },
    show () {
      return require('./Show');
    },
    fetch () {
      return require('./Fetch');
    },
    log () {
      return require('./Log');
    }
  };

/**
 * This function executes the git command and returns the parsed response.
 *
 * @param {Object} param
 * @param {string} param.path The repository file path
 * @param {string} param.command The git command that needs to be executed. eg : branch , push
 * @param {string} param.action The action to be performed. eg : listBranches , pushToRemote
 * @param {Object} [param.value] Additional values required to perform the operation. eg : Commit messages , target branch name etc.
 * @param {string} [param.options] The options to provide to git command to run custom actions.
 * @returns
 */
const gitFactory = async ({ path, command, action, options }) => {
  try {
    const Git = GIT_FACTORY[command](),
      gitInstance = new Git(path),
      result = await gitInstance.executeCommand(action, options);

    return result;
  }
  catch (err) {
    pm.logger.error('apiGitDebugLog - git~gitFactory: Could not execute the required git command ', path, command, action, options, err);
    throw err;
  }
};

module.exports = {
  gitFactory
};
