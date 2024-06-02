const fs = require('fs'),
  path = require('path'),
  FileSystemService = require('../file-system/FileSystemService'),
  git = require('../git'),
  { GitProcess } = require('@postman/dugite');

export const mockedGitExec = (expectedGitOutput) => {
  return jest.mock('@postman/dugite', () => {
    return {
      GitProcess: {
        exec: async () => {
          return new Promise((resolve, _reject) => {
            return resolve(expectedGitOutput);
          });
        }
      }
    };
  });
};

export const setupRepoWithInitialCommit = async (rootFolder, files) => {
  await GitProcess.exec(['init'], rootFolder);
  await GitProcess.exec(['config', 'user.name', 'test-postman'], rootFolder);
  await GitProcess.exec(['config', 'user.email', 'random.test@postman.com'], rootFolder);

  await Promise.all(files.map(async (fileData) => {
    return FileSystemService.createFile({
      path: fileData.path,
      content: fileData.content
    });
  }));

  await git.gitFactory({
    path: rootFolder, command: 'stage', action: 'stageFiles', options: {
      files: files.map((fileData) => fileData.path)
    }
  });

 return git.gitFactory({
    path: rootFolder, command: 'commit', action: 'commitWithMessage', options: {
      message: 'First Commit'
    }
  });
};

export const createCommit = async (rootFolder, commitMessage) => {
  await fs.writeFileSync(path.join(rootFolder, `File ${commitMessage}`), '');
  await git.gitFactory({
    path: rootFolder, command: 'stage', action: 'stageFiles', options: null
  });

 return git.gitFactory({
    path: rootFolder, command: 'commit', action: 'commitWithMessage', options: {
      message: commitMessage
    }
  });
};

export const createAndSwitchBranch = async (rootFolder, sourceBranch, destBranch) => {
  await git.gitFactory({
    path: rootFolder, command: 'branch', action: 'createBranch', options: {
      newBranch: destBranch,
      sourceBranch: sourceBranch
    }
  });

  await git.gitFactory({
    path: rootFolder, command: 'branch', action: 'switchBranch', options: {
      branch: destBranch
    }
  });
};
