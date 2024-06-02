const STORE_KEYS = {
  REMOTE_INIT_PATH: 'remoteInitPath',
  BASE_SCRATCHPAD_URL_PATHS: 'baseScratchpadUrlPaths',
  SCRATCHPAD_THEME: 'scratchpadTheme',
};

/**
 * @type {Map<string, any>}
 */
const store = new Map([
  [STORE_KEYS.REMOTE_INIT_PATH, ''],
  [STORE_KEYS.SCRATCHPAD_THEME, ''],

  /**
   * Since we can have multiple windows, we can have multiple
   * sets of launchParams, and thus multiple sets of Scratchpad URLs
   */
  [STORE_KEYS.BASE_SCRATCHPAD_URL_PATHS, new Map()]
]);

const clearStatesPerWindow = (window) => {
  if (!window) { return; }

  store.get(STORE_KEYS.BASE_SCRATCHPAD_URL_PATHS)?.delete(window.id);
};

module.exports = {
  STORE_KEYS,
  store,
  clearStatesPerWindow
};
