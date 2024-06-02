export const mergeConflictDeletedScenario1 = {
  gitResponse: { stdout: 'DU README.md\0', stderr: '', exitCode: 0 },
  parsedResponse: { 'data': { 'staged': [], 'unstaged': [], 'untracked': [], 'unmerged': [{ 'type': 'deleted', 'name': 'README.md', 'path': 'README.md' }] } }
};

export const mergeConflictDeletedScenario2 = {
  gitResponse: { stdout: 'UD README.md\0', stderr: '', exitCode: 0 },
  parsedResponse: { 'data': { 'staged': [], 'unstaged': [], 'untracked': [], 'unmerged': [{ 'type': 'modified', 'name': 'README.md', 'path': 'README.md' }] } }
};

export const mergeConflictModifiedScenario1 = {
  gitResponse: { stdout: 'UU README.md\0', stderr: '', exitCode: 0 },
  parsedResponse: { 'data': { 'staged': [], 'unstaged': [], 'untracked': [], 'unmerged': [{ 'type': 'modified', 'name': 'README.md', 'path': 'README.md' }] } }
};

export const mergeConflictAddedScenario1 = {
  gitResponse: { stdout: 'AA README.md\0', stderr: '', exitCode: 0 },
  parsedResponse: { 'data': { 'staged': [], 'unstaged': [], 'untracked': [], 'unmerged': [{ 'type': 'added', 'name': 'README.md', 'path': 'README.md' }] } }
};
