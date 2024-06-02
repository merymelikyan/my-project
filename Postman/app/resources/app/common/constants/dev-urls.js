// node.js dependencies
const { URL } = require('url');

// constants
const ARTEMIS_PRIVATE_HOST = new URL('https://matrix.postman-beta.co:8777');
const AUTH_URL = new URL('/build/html/auth/auth.html', ARTEMIS_PRIVATE_HOST);
const PROXY_AUTH_URL = new URL('/build/html/proxyAuth.html', ARTEMIS_PRIVATE_HOST);
const ERROR_URL = new URL('/build/html/auth/error.html', ARTEMIS_PRIVATE_HOST);
const SHELL_URL = new URL('/build/html/shell-migrator.html', ARTEMIS_PRIVATE_HOST);
const WEB_PROXY_URL = new URL('/build/html/webProxy.html', ARTEMIS_PRIVATE_HOST);

module.exports = {
  AUTH: AUTH_URL.href,
  PROXY_AUTH: PROXY_AUTH_URL.href,
  ERROR: ERROR_URL.href,
  SHELL: SHELL_URL.href,
  WEB_PROXY: WEB_PROXY_URL.href
};

