module.exports = {

  // Regex to parse the branch list details
  BRANCH_DETACHED_REGEX: '^(\\*\\s)?\\((?:HEAD )?detached (?:from|at) (\\S+)\\)\\s+([a-z0-9]+)\\s(.*)$',
  BRANCH_DETAILS_REGEX: '^(\\*\\s)?(\\S+)\\s+([a-z0-9]+)\\s(?:\\[.*:[^\\]]*\\]\\s)?(.*)$',

  // Regex to parse the commit details
  COMMIT_DETAILS_REGEX: '^\\[([^\\s]+)( \\([^)]+\\))? ([^\\]]+)',
  FILE_CHANGES_REGEX: '(\\d+)[^,]*(?:,\\s*(\\d+)[^,]*)(?:,\\s*(\\d+))',
  FILE_CHANGES_PARTIAL_REGEX: '^(\\d+)[^,]*(?:,\\s*(\\d+)[^(]+\\(([+-]))?',

  // Regex to obtain the from and to while file is renamed.
  RENAME_REGEX: '^(.+) -> (.+)$',

  // Delimiter to club the previous and new name of the renamed file
  RENAME_DELIMITER: ' -> ',

  // List of git status being tracked by postman
  STATUS_STATE: {
    'MM': 'staged-unstaged-modified',
    ' M': 'unstaged-modified',
    'M ': 'staged-modified',
    'D ': 'staged-deleted',
    ' D': 'unstaged-deleted',
    'A ': 'staged-added',
    '??': 'untracked',
    'R ': 'staged-renamed',
    'AA': 'unmerged-added-added',
    'UU': 'unmerged-modified-modified',
    'DU': 'unmerged-deleted-modified',
    'UD': 'unmerged-modified-deleted',
    'RD': 'staged-renamed-unstaged-deleted',
    'RM': 'staged-renamed-unstaged-modified'
  },

  // Null character is used by git status to terminate the file list
  NULL_DELIMITER: '\0'
};
