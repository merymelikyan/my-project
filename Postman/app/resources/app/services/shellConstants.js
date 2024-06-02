// TODO: Deprecated 18 Aug 2023. I believe this file is not used
const HTML_MAP = {
  requester: 'requester.html',
  scratchpad: 'scratchpad.html',
  runner: 'runner.html',
  console: 'console.html',
  'no-scratchpad': 'no-scratchpad.html'
};

const WINDOW_EVENTS_MAP = {
  requester: 'setWindowIds',
  runner: 'setRunnerWindowId'
};

const DEFAULT_PARTITION = 'default';
const DEFAULT_COOKIE_PARTITION = 'persist:postman_user_cookies';

const PARTITIONS_STORE = {
  COOKIES: 'cookies',
  INDEXEDDB: 'indexdb',
  LOCALSTORAGE: 'localstorage'
};

module.exports = {
  HTML_MAP,
  WINDOW_EVENTS_MAP,
  DEFAULT_PARTITION,
  DEFAULT_COOKIE_PARTITION,
  PARTITIONS_STORE
};
