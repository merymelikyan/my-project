// @ts-check
const { getConfig } = require('../../services/AppConfigService');
const semver = require('semver');
const { STS, SecretsManager, IAM } = require('../../services/AWSService');

const events = require('events');
const _ = require('lodash');
const fs = require('fs').promises;

/**
* Defined here to maintain consistency with the `renderer` version of
* VaultIntegrationService.
* @typedef {import('@azure/msal-node').PublicClientApplication} MsalPublicClient
* @typedef {import('@azure/msal-node').AuthenticationResult} MsalAuthenticationResult
*/
const msal = require('@azure/msal-node');

// This is true when running in jest jsdom test environment
// This happens in `src/renderer/runtime-repl/runner/_tests/PerformanceRunCreate.test.js` test.
// eslint-disable-next-line no-undef
const isJsdomTest = typeof navigator !== 'undefined' && navigator.userAgent.includes('jsdom');

/** @type {import('openid-client')} */
// @ts-ignore
const openid_client = isJsdomTest ? null : require('openid-client');
const op = require('@postman/1psdk');
const mockFetch = require('../../common/utils/mockFetch');

// @ts-ignore
const pr = require('postman-request');
const http = require('http');
const LRUCache = require('lru-cache');
const AWSConfigParser = require('../../services/AWSConfigParserService');

const REDIRECT_URI = isJsdomTest ? '' : getConfig('__WP_VAULT_AUTH_REDIRECT_URL__'),
  AZURE_APP_ID = isJsdomTest ? '' : getConfig('__WP_VAULT_AZURE_APP_ID__'),
  AZURE_SCOPES = isJsdomTest ? [''] : ['https://vault.azure.net/user_impersonation'],

  SECOND__MS = 1000,
  MINUTE__MS = 60 * SECOND__MS,
  DEFAULT_SECRET_CACHE_TTL = 60 * MINUTE__MS,
  SECRET_CACHE_MAX_LIMIT = 500,

  AZURE_PROVIDER_NAME = 'Microsoft Azure',
  AZURE_LOGO_LINK = 'https://postman-static-getpostman-com.s3.amazonaws.com/assets/azure-light.png',
  AZURE_FAVICON_LINK = 'https://postman-static-getpostman-com.s3.amazonaws.com/assets/azure-favicon.ico',
  HASHICORP_LOGO_LINK = 'https://postman-static-getpostman-com.s3.amazonaws.com/assets/HashiCorp_Vault_PrimaryLogo.png',
  HASHICORP_FAVICON_LINK = 'https://postman-static-getpostman-com.s3.amazonaws.com/assets/hashicorp-favicon.ico';


/**
  * @template {any} SecretT
  * @template {any} VaultConfigT
  * @interface
  */
class VaultInterface extends events.EventEmitter {
  /**
  * @typedef {Object} UserInformation
  * @property {String=} userName - some providers do not provide this information
  * @property {number} expiresOn -  Authetication expiration in UTC milliseconds
  *                                 If in past, indicates that re-auth is required.
  */
  /**
   * @template T
   * @typedef {{provider: string, version: string} & T} Secret<T>
  */

  /**
  * @param {VaultConfigT=} _config
  * @abstract
  */
  constructor (_config) { super(); }

  /**
  * Initialize the vault. Should be called right after constructor.
  */
  async init () { }


  /**
   * @abstract
   * @param {(url: String) => void} _urlCallback - Called with the auth URL once the server has been started.
   *                                               The user should be redirected to this URL for flow to complete.
   * @param {Object} [_params] - Parameters used to perform login
   * @returns {Promise<UserInformation>}
   */
  async performLoginFlow (_urlCallback, _params) { throw new Error('Not implemented'); }

  /**
   * Returns information of currently authenticated user. If the user never logged in `null` is returned.
   * @returns {UserInformation | null}
   */
  getUserInformation () { throw new Error('Not implemented'); }

    /**
   * Check if vault is authenticated to fetch the secret
   * @returns {Boolean}
   */
  isAuthenticationActive () {
    let userInfo = this.getUserInformation();
    return userInfo != null && userInfo.expiresOn > Date.now();
  }

  /**
   * Resolves secret and checks if the secret is valid
   * @param {string | HashicorpSecretKey} secretId
   * @returns {Promise<Boolean>}
   */
  async isValidSecret (secretId) {
    try {
      await this._resolveSecretId(secretId, (new AbortController()).signal);
      return true;
    } catch (e) {
      if (e instanceof AbortError) {
        return false;
      }

      // @ts-ignore
      pm.logger.error('VaultIntegrationService~isValidSecret', e);
      return false;
    }
  }

  /**
   * Resolves secret, returns from cache if available otherwise makes the HTTP call.
   * @param {string | HashicorpSecretKey | AWSSecretKey | OnePasswordSecretKey} _secretId
   * @param {AbortSignal} _abortSignal
   * @returns {Promise<string>}
   */
  async _resolveSecretId (_secretId, _abortSignal) { throw new Error('Not implemented'); }

  /**
   * @typedef {{success: boolean, value?: string, error?: Error|null}} SecretFetchResult
   *
   * Resolves the secret from secret meta {}
   * @param {Secret<SecretT>[]} _secrets
   * @param {AbortSignal} _abortSignal
   * @returns {Promise<[Secret<SecretT>, SecretFetchResult][]>} Returns an array with two objects [success, error],
   *              each object maps secretId to its result depending on the resolution. A null error represents a secret
   *              which is not active yet
   */
  async resolveSecrets (_secrets, _abortSignal) { throw new Error('Not implemented'); }

  /**
   * Returns true if the secret provider and version are supported
   * @param {Secret<SecretT>} _secret
   * @returns {boolean}
   */
  isSupportedSecret (_secret) { throw new Error('Not implemented'); }

  async logout () { throw new Error('Not implemented'); }

  /**
   * Clears the cache
   * @returns {void}
   */
  resetCache () { throw new Error('Not implemented'); }

  /**
   * Returns true if the secret provider and version are supported
   * @param {number} updatedTtl
   * @returns {boolean}
   */
  updateCacheTtl (updatedTtl) { throw new Error('Not implemented'); }

  /**
   * This wraps {@link VaultIntegration.performLoginFlow}
   * and emits relevant user-facing events
   *
   * @param {Function} cb
   * @param {Object} [params] Extra parameters required for user login
   * @returns {Promise<void>}
   */
  async handleLogin (cb, params) {
    let user = this.getUserInformation();

    if (user && user.expiresOn > Date.now()) {
      cb({ event: 'error', type: 'user_already_authenticated', user });
      return;
    }

    let server = TemporaryWebServer.global();
    if (server.isRunning()) {
      cb({ event: 'restarting_auth' });
      await server.stop();
    }

    try {
      let user = await this.performLoginFlow((url) => {
        cb({ event: 'start_auth_flow', redirectUrl: url });
      }, params);
      cb({ event: 'login_completed', user: user });
    } catch (e) {

      if (e instanceof VaultAuthTimeoutError) {
        return cb({ event: 'error', type: 'timeout' });
      }
      if (e instanceof AbortError) {
        return cb({ event: 'login_cancelled' });
      }

      // @ts-ignore
      pm.logger.info('VaultIntegrationService~handleLogin', e);
      cb({ event: 'error', type: 'unexpected_error', context: _.get(e, 'message') });
    }
  }

  /**
   * @param {HashicorpConfig | undefined} _config
   */
  isMatchingConfig (_config) {
    return true;
  }
}

/**
* @typedef {{secretId: string}} AzureSecretKey
* @extends {VaultInterface<AzureSecretKey, null>}
*/
class AzureVault extends VaultInterface {
   /**
   * @typedef {Object} AzureSecretAttributes
   * @property {Boolean}  enabled
   * @property {number=}  exp Expiry in UTC
   * @property {number=}  nbf Not before date in UTC
   * @property {number}  updated in UTC
   * @property {number}  created in UTC
   *
   * @typedef {Object} AzureSecretResponse
   * @property {String} value
   * @property {String} id
   * @property {AzureSecretAttributes} attributes
   * @property {String[]} tags
   *
  */

  static AUTHORITY = 'https://login.microsoftonline.com/common'
  static LOGIN_TIMEOUT = 5 * 60 * 1000; // 5 minutes
  static PROVIDER_ID = 'azure-key-vault';
  static SUPPORTED_SECRET_VERSION = '0.x';

  /** @type {MsalPublicClient} */
  #msalInstance;

  /** @type {null | MsalAuthenticationResult} */
  #msalAuthResult = null

  /** @type {LRUCache<String, [null, AzureSecretResponse] | [Error, null]>} */
  #secretCache;

  /** @type {number} */
  #secretCacheTtl = DEFAULT_SECRET_CACHE_TTL;

  /**
  * @override
  */
  constructor () {
    super();
    this.redirectUri = new URL(REDIRECT_URI);
    this.clientId = AZURE_APP_ID;
    this.scopes = AZURE_SCOPES;

    this.#msalInstance = new msal.PublicClientApplication({
      auth: {
        clientId: AZURE_APP_ID,
        authority: AzureVault.AUTHORITY
      }
    });

    this.#secretCache = new LRUCache({ maxAge: this.#secretCacheTtl, max: SECRET_CACHE_MAX_LIMIT });

    /** @type {null | AbortController}*/
    this.reauthController = null;
  }

  /**
   * @override
   * @param {(url: String) => void} urlCallback - Called with the auth URL once the server has been started.
   *                                               The user should be redirected to this URL for flow to complete.
   * @returns {Promise<UserInformation>}
  */
  async performLoginFlow (urlCallback) {
    let server = TemporaryWebServer.global();

    this.#secretCache.reset();

    let { verifier, challenge } = await (new msal.CryptoProvider()).generatePkceCodes();

    let authUrl = await this.#msalInstance.getAuthCodeUrl({
      redirectUri: this.redirectUri.toString(),

      // ATC
      scopes: this.scopes,
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
    });

    await server.stop();
    await server.start();
    urlCallback(authUrl);
    let [url, req, res] = await server.waitForRequest(AzureVault.LOGIN_TIMEOUT);

    let query = Object.fromEntries(url.searchParams.entries());
    try {

      this.#msalAuthResult = await this.#msalInstance.acquireTokenByCode({
        scopes: this.scopes,
        redirectUri: this.redirectUri.toString(),
        code: query.code,
        codeVerifier: verifier
      });
      this._broadcastUserInfo();
      await server.respond(res, 200, generateHtml(AZURE_PROVIDER_NAME, AZURE_LOGO_LINK, AZURE_FAVICON_LINK));
    } catch (e) {
      this._broadcastUserInfo();
      await server.respond(res, 500, 'Something went wrong while authenticating. Please try again.');
      await server.stop();
      throw e;
    }

    await server.stop();

    this._startReAuthFlow();
    return notNull(this.getUserInformation());
  }

  /**
   * @override
   * @returns {UserInformation | null}
   */
  getUserInformation () {
    if (_.isNil(this.#msalAuthResult)) {
      return null;
    }
    return {
      userName: notNull(this.#msalAuthResult.account).username,
      expiresOn: notNull(this.#msalAuthResult.expiresOn).getTime()
    };
  }


  async logout () {
    if (_.isNil(this.#msalAuthResult)) {
      // if not authenticated just publish the information again to sync any listener      this.broadcastUserInfo();
      this._broadcastUserInfo();
      return;
    }
    await this.#msalInstance.signOut({ account: notNull(this.#msalAuthResult.account) });
    this.#secretCache.reset();
    this.#msalAuthResult = null;
    this._stopReAuthFlow();
    this._broadcastUserInfo();
  }

  /**
   * @override
   * @param {any} secret
   * @returns {boolean}
   */
  isSupportedSecret (secret) {
    return this._isValidSecretId(secret);
  }


  /**
  * @override
  * @param {Secret<AzureSecretKey>[]} secrets
  * @param {AbortSignal} abortSignal
  * @returns {Promise<[Secret<AzureSecretKey>, SecretFetchResult][]>} Returns an array containing secret and result in same order as input array
  */
  async resolveSecrets (secrets, abortSignal) {
    this.emit('event', { event: 'variable_resolution_started' });
    let secretIds = secrets.map((x) => x.secretId);
    let result = await this._resolveSecretIds(_.uniq(secretIds), abortSignal);

    /** @type {[Secret<AzureSecretKey>, SecretFetchResult][]} */
    let rv = [];

    for (const secret of secrets) {
      let res = result[secret.secretId];
      if (res[0] == null) {
        rv.push([secret, { success: true, value: res[1] }]);
      } else {
        rv.push([secret, { success: false, error: res[0] }]);
      }
    }
    this.emit('event', { event: 'variable_resolution_finished' });
    return rv;
  }

  /**
   *
   * @param {string[]} secretIds
   * @param {AbortSignal} abortSignal
   * @returns {Promise<{[key: string]: [Error, null] | [null, string]}>}
   */
  async _resolveSecretIds (secretIds, abortSignal) {
    /** @type {{[key: string]: [Error, null] | [null, string]}} */
    let secretResults = {};
    for (let i = 0; i < secretIds.length; i += 10) {
      await Promise.all(secretIds.slice(i, i + 10).map(async (id) => {
        if (abortSignal.aborted) {
          throw new AbortError();
        }
        try {
          secretResults[id] = [null, await this._resolveSecretId(id, abortSignal)];
        } catch (e) {
          if (e instanceof AbortError) {
            throw e;
          }
          secretResults[id] = [/** @type {Error} */(e), null];
        }
      }));
    }
    return secretResults;
  }

  /**
   * Resolves secret, returns from cache if available otherwise makes the HTTP call.
   * @param {string} secretId
   * @param {AbortSignal} abortSignal
   * @returns {Promise<string>}
   */
  async _resolveSecretId (secretId, abortSignal) {
    if (!this._isValidSecretId(secretId)) {
      throw new VaultInvalidSecretKey(secretId);
    }

    if (!this.#secretCache.has(secretId)) {
      try {
        let secret = await this._fetchSecret(secretId, abortSignal);
        this.#secretCache.set(secretId, [null, secret]);
      } catch (e) {
        // convert from node's abort_err to our type
        if (_.get(e, 'code') == 'ABORT_ERR') {
          throw new AbortError();
        }

        // 401 => no-access/invalid secret
        if (e instanceof VaultInvalidProviderResponse && e.statusCode == 401) {
          this.#secretCache.set(secretId, [e, null], this.#secretCacheTtl);
        } else {
          throw e;
        }
      }
    }

    let value = notNull(this.#secretCache.get(secretId));
    if (value[0] != null) {
      throw value[0];
    } else {
      if (!this._isSecretActive(value[1])) {
        throw new VaultSecretNotActive(secretId);
      }
      return value[1].value;
    }
  }

  /**
   *
   * @param {AzureSecretResponse} secretResponse
   * @return {Boolean}
   */
  _isSecretActive (secretResponse) {
    let attributes = secretResponse.attributes;
    if (!attributes.enabled ||
      (attributes.exp && attributes.exp < Date.now() / 1000) ||
      (attributes.nbf && attributes.nbf > Date.now() / 1000)) {
      return false;
    }
    return true;
  }

  /** @param {string} secretId */
  _isValidSecretId (secretId) {
    // Valid secretIds are like: https://<vault-name>.vault.azure.net/secrets/<secret-id>/<version-id>
    // version-id is optional
    try {
      let url = new URL(secretId);
      let total_slashes_in_path = (url.pathname.match(/\//g) || []).length;
      if (
        url.protocol != 'https:' ||
        !url.hostname.endsWith('.vault.azure.net') ||
        !url.pathname.startsWith('/secrets/') ||
        total_slashes_in_path > 4) {
        return false;
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * NOTE: SecretId should be validated using _isValidSecretId before calling this method
  * @param {string} secretId
  * @param {AbortSignal} abortSignal
  * @returns {Promise<AzureSecretResponse>}
  */
  async _fetchSecret (secretId, abortSignal) {
    let url = new URL(secretId);
    url.searchParams.set('api-version', '7.4');

    let headers = this.#getAuthHeader();

    let { response, body } = await sendRequest(url, { headers, abortSignal, json: true });

    if (response.statusCode != 200) {
      throw new VaultInvalidProviderResponse('Can\'t fetch secret. Invalid status code in azure response.', response.statusCode);
    }

    return body;
  }

  // @ts-ignore - js supports private method, not sure why ts complains
  #getAuthHeader () {
    if (this.isAuthenticationActive()) {
      return { 'Authorization': `Bearer ${notNull(this.#msalAuthResult).accessToken}` };
    } else {
      throw new VaultNotAuthenticatedError();
    }
  }

  _stopReAuthFlow () {
    if (this.reauthController != null) {
      this.reauthController.abort();
      this.reauthController = null;
    }
  }

  _startReAuthFlow () {
    this._stopReAuthFlow();
    let controller = new AbortController();
    this._continuouslyRefreshToken(controller.signal);
    this.reauthController = controller;
  }

  /**
  * @param {AbortSignal} abortSignal
  */
  async _continuouslyRefreshToken (abortSignal) {
    // @ts-ignore
    pm.logger.info('VaultIntegrationService~Azure.continouslyRefreshToken - Starting');
    let errors = 0;

    for (;;) {
      if (abortSignal.aborted) {
        // @ts-ignore
        pm.logger.info('VaultIntegrationService~Azure.continouslyRefreshToken - Aborted');
        return;
      }
      let userInfo = this.getUserInformation();
      if (userInfo == null) {
        // @ts-ignore
        pm.logger.info('VaultIntegrationService~Azure.continouslyRefreshToken - User Logged out');
        return;
      }
      let nextExpiry = userInfo.expiresOn;

      let nextTick = nextExpiry - 5 * MINUTE__MS;
      let waitDuration = Math.max(nextTick - Date.now(), 0);

      // @ts-ignore
      pm.logger.info('VaultIntegrationService~Azure.continouslyRefreshToken - Waiting until next expiry', {
        waitDuration,
        userInfo
      });
      await sleep(waitDuration);

      if (abortSignal.aborted) {
        // @ts-ignore
        pm.logger.info('VaultIntegrationService~Azure.continouslyRefreshToken - Aborted');
        return;
      }

      try {
        this.#msalAuthResult = await this.#msalInstance.acquireTokenSilent({
          account: notNull(this.#msalAuthResult?.account),
          scopes: this.scopes,
        });
        this._broadcastUserInfo();

        // @ts-ignore
        pm.logger.info('VaultIntegrationService~Azure.continouslyRefreshToken - Refreshed token successfully');

        errors = 0;
      } catch (e) {
        // @ts-ignore
        pm.logger.error('VaultIntegrationService~Azure.continuouslyRefreshToken - Failed to refresh token', e);
        if (e instanceof msal.InteractionRequiredAuthError) {
          return;
        }
        errors += 1;
        await sleep(Math.min(Math.pow(2, errors) * SECOND__MS, 10 * MINUTE__MS));
      }
    }

  }

  _broadcastUserInfo () {
    this.emit('event', {
      event: 'auth_update',
      user: this.getUserInformation()
    });
  }

  resetCache () {
    this.#secretCache.reset();
  }

  /**
   * Returns true if the secret provider and version are supported
   * @param {number} updatedTtl
   * @returns {boolean}
   */
  updateCacheTtl (updatedTtl) {
    this.resetCache();
    this.#secretCacheTtl = updatedTtl;
    this.#secretCache = new LRUCache({ maxAge: this.#secretCacheTtl, max: SECRET_CACHE_MAX_LIMIT });

    return true;
  }
}

/**
* @typedef {{secretEngine: string, secretPath: string, secretKey: string}} HashicorpSecretKey
*
* @typedef HashicorpConfig
* @property {string} discoveryUrl
* @property {string} clientId
* @property {string} role
* @property {string} jwtAuthPath
* @property {string=} scopes
* @property {string=} namespace
* @property {string=} caCertPath
*
* @extends {VaultInterface<HashicorpSecretKey, HashicorpConfig>}
*/
class HashicorpVault extends VaultInterface {
  /**
   * @typedef {Object} HashicorpSecretResponse
   * @property {{[key: string]: string}} value
   *
  */

  /**
   * @typedef {Object} JwtToken
   * @property {string} token
   * @property {number} expiresOn
   *
   * @typedef {Object} TokenResult
   * @property {string} token
   * @property {number} expiresOn
   * @property {JwtToken} jwt
  */
  static LOGIN_TIMEOUT = 5 * 60 * 1000; // 5 minutes
  static PROVIDER_ID = 'hashicorp-vault';
  static SUPPORTED_SECRET_VERSION = '0.x';
  static DELIMITER = ':@:@:';

  /** @type {LRUCache<String, [null, HashicorpSecretResponse] | [Error, null]>} */
  #secretCache;

  /** @type {number} */
  #secretCacheTtl = DEFAULT_SECRET_CACHE_TTL;

  /** @type {null | TokenResult} */
  #tokenResult;

  /**
  * @override
  * @param {HashicorpConfig} config
  */
  constructor (config) {
    super(config);
    this.redirectUri = new URL(REDIRECT_URI);

    this.discoveryUrl = config.discoveryUrl;
    this.scopes = (config.scopes || '') + ' openid';
    this.namespace = config.namespace;
    this.clientId = config.clientId;
    this.role = config.role;
    this.jwtAuthPath = config.jwtAuthPath;
    this.vaultEndpoint = (new URL(this.discoveryUrl)).origin;
    this.loginEndpoint = this.vaultEndpoint + `/v1/auth/${config.jwtAuthPath}/login`;
    /** @type {string=} */ this.caPath;

    /** @type {null | {token: string, jwtToken: string, expiresOn: number}} */
    this.#tokenResult = null;

    this.#secretCache = new LRUCache({ maxAge: this.#secretCacheTtl, max: SECRET_CACHE_MAX_LIMIT });

    /** @type {null | AbortController}*/
    this.reauthController = null;
  }

  /**
    * `agent-base < v5` (which is a dependency of `snyk` and `@postman/app-plugins-host`) patches the global https.request
    * Patched version is not compatible with Node16 https.request API
    * This restores the https.request behaviour based on https://github.com/nodejs/node/blob/b53c51995380b1f8d642297d848cab6010d2909c/lib/https.js#L338
    * The fix is _only_ applied to requests sent by openid-client
    * If https is not already patched by agent-base the fix won't be applied
    * TODO: get all the dependencies to upgrade to agent-base >= v5
    */
  fixAgentBasePatch () {

    // from: https://github.com/TooTallNate/node-agent-base/blob/560f111674af84dec46a4c3070ddf3b22edd3e76/patch-core.js#L11
    const agentBasePatchMarker = '__agent_base_https_request_patched__';

    const patchMarker = '__postman_vault_https_request_patch_fix_';
    const https = require('https');
    const _url = require('node:url');

    // @ts-ignore - since this is an ad-hoc patching, we will need a lot of `ts-ignore` to convince ts
    if (https.request[agentBasePatchMarker] && !https.request[patchMarker]) {
      // @ts-ignore
      https.request = (function (request) {
        return function (req, options, cb) {
          let isFirstArgURL = typeof req == 'string' || (req instanceof URL),

             // The options we got in http.request call
             actualOptions = isFirstArgURL ? options : req,

             // The options we're going to send to the patched http.request
             mergedOptions = {};

          if (!_.startsWith(_.get(actualOptions, 'headers.User-Agent'), 'openid-client')) {
            return request.call(https, req, options, cb);
          }

          if (isFirstArgURL) {
            if (typeof req == 'string') {
              req = new URL(req);
            }
            _.assign(mergedOptions, _url.urlToHttpOptions(req));
            _.assign(mergedOptions, options);
          } else {
            mergedOptions = actualOptions;

            // @ts-ignore
            cb = options;
          }

          // @ts-ignore
          return request.call(https, mergedOptions, cb);
        };
      })(https.request);

      // @ts-ignore
      https.request[patchMarker] = true;
    }

  }

  async init (caCertPath) {
    this.fixAgentBasePatch();

    let caPath = caCertPath;

    if (caPath) {
      const platform = require('os').platform();

      this.caPath = caPath;

      if (platform === 'win32') {
        caPath = require('path').normalize(caPath.slice(1));
      }

      // add caPath to HashiCorpVault instance to be used in other flows
      this.caPath = caPath;

      openid_client.custom.setHttpOptionsDefaults({
        ca: require('fs').readFileSync(caPath)
      });
    }

    this.issuer = await openid_client.Issuer.discover(this.discoveryUrl);
    this.client = new this.issuer.Client({
      client_id: this.clientId,
      redirect_uris: [this.redirectUri.toString()],
      response_types: ['code'],
      token_endpoint_auth_method: 'none'
    });
  }

  /**
   * @override
   * @param {(url: String) => void} urlCallback - Called with the auth URL once the server has been started.
   *                                               The user should be redirected to this URL for flow to complete.
   * @returns {Promise<UserInformation>}
  */
  async performLoginFlow (urlCallback) {
    let server = TemporaryWebServer.global();
    const caPath = this.caPath;

    this.#secretCache.reset();
    const codeVerifier = openid_client.generators.codeVerifier();
    const codeChallenge = openid_client.generators.codeChallenge(codeVerifier);

    let client = this._getClient();
    let authUrl = client.authorizationUrl({
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      scope: this.scopes
    });

    await server.stop();
    await server.start();
    urlCallback(authUrl);
    let [url, req, res] = await server.waitForRequest(HashicorpVault.LOGIN_TIMEOUT);

    try {
      let params = client.callbackParams(url.toString());
      let start = Date.now();
      let tokens = await client.callback(this.redirectUri.toString(), params, {
        code_verifier: codeVerifier,
        scope: this.scopes
      });

      let jwt = {
        token: notNull(tokens.id_token),
        expiresOn: start + notNull(tokens.expires_in) * 1000,
      };

      this.#tokenResult = await this.loginUsingJWT(jwt, caPath);
      this._broadcastUserInfo();
      await server.respond(res, 200, generateHtml('', HASHICORP_LOGO_LINK, HASHICORP_FAVICON_LINK));
    } catch (e) {
      this._broadcastUserInfo();

      await server.respond(res, 500, 'Something went wrong while authenticating. Please try again.');
      await server.stop();
      throw e;
    }
    await server.stop();

    this._startReAuthFlow();
    return notNull(this.getUserInformation());
  }

  /**
   * @override
   * @returns {UserInformation | null}
   */
  getUserInformation () {
    if (this.#tokenResult === null) {
      return null;
    }
    return {
      expiresOn: this.#tokenResult.expiresOn
    };
  }


  async logout () {
    if (this.#tokenResult === null) {
      // if not authenticated just publish the information again to sync any listener      this.broadcastUserInfo();
      this._broadcastUserInfo();
      return;
    }
    this.#tokenResult = null;
    this.#secretCache.reset();
    this._broadcastUserInfo();
  }

  /**
   * @override
   * @param {any} secretValue
   * @returns {boolean}
   */
  isSupportedSecret (secretValue) {
    if (!secretValue) {
      return false;
    }

    if (typeof secretValue !== 'string') {
      return false;
    }

    const parts = secretValue.split(HashicorpVault.DELIMITER);

    if (parts.length !== 3) {
      return false;
    }

    return true;
  }


  /**
  * Temporary function until UI supports addition of hashicorp secrets
  * @param {Secret<HashicorpSecretKey> | Secret<AzureSecretKey>} secretId
  * @returns {Secret<HashicorpSecretKey>}
  */
  _parseSecret (secretId) {
    if ('secretId' in secretId) {
      return {
        ...secretId,

        secretEngine: secretId.secretId.split(HashicorpVault.DELIMITER)[0],
        secretPath: secretId.secretId.split(HashicorpVault.DELIMITER)[1],
        secretKey: secretId.secretId.split(HashicorpVault.DELIMITER)[2],
      };
    } else {
      return secretId;
    }
  }

  /**
  * @override
  * @param {Secret<HashicorpSecretKey>[]} secrets
  * @param {AbortSignal} abortSignal
  * @returns {Promise<[Secret<HashicorpSecretKey>, SecretFetchResult][]>} Returns an array containing secret and result in same order as input array
  */
  async resolveSecrets (secrets, abortSignal) {
    if (!secrets.length) {
      return [];
    }

    this.emit('event', { event: 'variable_resolution_started' });
    secrets = secrets.map((secret) => {
      return this._parseSecret({
        // @ts-ignore
        provider: secret.vaultId,
        version: '0.x',

        // @ts-ignore
        secretId: secret.secretId
      });
    });

    let result = await this._resolveSecretIds(
      _.uniqBy(secrets, (x) => x.secretEngine + x.secretPath),
      abortSignal
    );

    /** @type {[Secret<HashicorpSecretKey>, SecretFetchResult][]} */
    let rv = [];

    for (const secret of secrets) {
      let res = notNull(result.get(secret));
      if (res[0] == null) {
        rv.push([secret, { success: true, value: res[1] }]);
      } else {
        rv.push([secret, { success: false, error: res[0] }]);
      }
    }
    this.emit('event', { event: 'variable_resolution_finished' });
    return rv;
  }

  /**
   *
   * @param {HashicorpSecretKey[]} secretIds
   * @param {AbortSignal} abortSignal
   * @returns {Promise<Map<HashicorpSecretKey, [Error, null] | [null, string]>>}
   */
  async _resolveSecretIds (secretIds, abortSignal) {
    /** @type {KeyMap<HashicorpSecretKey, [Error, null] | [null, string], string>} */
    let secretResults = new KeyMap((x) => x.secretEngine + x.secretPath);
    for (let i = 0; i < secretIds.length; i += 10) {
      await Promise.all(secretIds.slice(i, i + 10).map(async (id) => {
        if (abortSignal.aborted) {
          throw new AbortError();
        }
        try {
          secretResults.set(id, [null, await this._resolveSecretId(id, abortSignal)]);
        } catch (e) {
          if (e instanceof AbortError) {
            throw e;
          }
          secretResults.set(id, [/** @type {Error} */(e), null]);
        }
      }));
    }
    return secretResults;
  }

  /**
   * Resolves secret, returns from cache if available otherwise makes the HTTP call.
   * @param {HashicorpSecretKey} secretId
   * @param {AbortSignal} abortSignal
   * @returns {Promise<string>}
   */
  async _resolveSecretId (secretId, abortSignal) {
    if (this._isValidSecretId(secretId)) {
      throw new VaultInvalidSecretKey(secretId);
    }

    let secretKey = this._secretToString(secretId);

    if (!this.#secretCache.has(secretKey)) {
      try {
        let secret = await this._fetchSecret(secretId, abortSignal);
        this.#secretCache.set(secretKey, [null, secret]);
      } catch (e) {
        // convert from node's abort_err to our type
        if (_.get(e, 'code') == 'ABORT_ERR') {
          throw new AbortError();
        }

        // 401 => no-access/invalid secret
        if (e instanceof VaultInvalidProviderResponse && e.statusCode == 401) {
          this.#secretCache.set(secretKey, [e, null], this.#secretCacheTtl);
        } else {
          throw e;
        }
      }
    }

    let value = notNull(this.#secretCache.get(secretKey));
    if (value[0] != null) {
      throw value[0];
    } else {
      if (secretId.secretKey in value[1].value) {
        return value[1].value[secretId.secretKey];
      } else {
        throw new VaultInvalidSecretKey(secretId);
      }
    }
  }


  /** @param {HashicorpSecretKey} secretId */
  _isValidSecretId (secretId) {
    return (
      _.isString(secretId.secretEngine) &&
      _.isString(secretId.secretPath) &&
      secretId.secretEngine == '' &&
      secretId.secretPath == ''
    );
  }

  /**
  * @param {HashicorpSecretKey} x
  */
  _secretToString (x) {
    return x.secretEngine + x.secretPath;
  }

  /**
   * NOTE: SecretId should be validated for schema before calling this method
  * @param {HashicorpSecretKey} secretId
  * @param {AbortSignal} abortSignal
  * @returns {Promise<HashicorpSecretResponse>}
  */
  async _fetchSecret (secretId, abortSignal) {
    let url = new URL(this.vaultEndpoint);

    url.pathname = `/v1/${secretId.secretEngine}/data/${secretId.secretPath}`;

    let headers = {
      ...this.#getAuthHeader(),
      ...this._namespaceHeaders()
    };

    let { response, body } = await sendRequest(url, { headers, abortSignal, json: true, caPath: this.caPath });

    if (response.statusCode != 200) {
      throw new VaultInvalidProviderResponse('Can\'t fetch secret. Invalid status code in hashicorp resopnse.', response.statusCode);
    }
    return {
      value: body.data.data
    };
  }

  // @ts-ignore - js supports private method, not sure why ts complains
  #getAuthHeader () {
    if (this.isAuthenticationActive()) {
      return { 'X-Vault-Token': notNull(this.#tokenResult).token };
    } else {
      throw new VaultNotAuthenticatedError();
    }
  }

  _broadcastUserInfo () {
    this.emit('event', {
      event: 'auth_update',
      user: this.getUserInformation()
    });
  }

  _namespaceHeaders () {
    return this.namespace != null ? { 'X-Vault-Namespace': this.namespace } : {};
  }

  _getClient () {
    if (this.client == null) {
      throw new Error('Vault init() not called before access.');
    }
    return this.client;
  }
  _stopReAuthFlow () {
    if (this.reauthController != null) {
      this.reauthController.abort();
      this.reauthController = null;
    }
  }

  _startReAuthFlow () {
    this._stopReAuthFlow();
    let controller = new AbortController();
    this._continuouslyRefreshToken(controller.signal);
    this.reauthController = controller;
  }

  /**
  * @param {JwtToken} jwt
  * @param {string=} caPath - path of the certificate file
  * @returns {Promise<TokenResult>}
  */
  async loginUsingJWT (jwt, caPath) {
    let requestTime = new Date();
    let { response, body } = await sendRequest(this.loginEndpoint, {
      method: 'POST',
      headers: this._namespaceHeaders(),
      body: {
        jwt: jwt.token,
        role: this.role
      },
      caPath,
      json: true
    });

    if (Math.floor(response.statusCode / 10) != 20) {
      throw new VaultInvalidProviderResponse("Can't exchange jwt for accessToken", response.statusCode);
    }

    return {
      token: body.auth.client_token,
      expiresOn: requestTime.getTime() + body.auth.lease_duration * 1000,
      jwt,
    };
  }

  /**
  * @param {AbortSignal} abortSignal
  */
  async _continuouslyRefreshToken (abortSignal) {
    // @ts-ignore
    pm.logger.info('VaultIntegrationService~Hashicorp.continouslyRefreshToken - Starting');
    let errors = 0;

    for (;;) {
      if (abortSignal.aborted) {
        // @ts-ignore
        pm.logger.info('VaultIntegrationService~Hashicorp.continouslyRefreshToken - Aborted');
        return;
      }
      let userInfo = this.getUserInformation();
      if (userInfo == null) {
        // @ts-ignore
        pm.logger.info('VaultIntegrationService~Hashicorp.continouslyRefreshToken - User Logged out');
        return;
      }
      let nextExpiry = userInfo.expiresOn;

      let nextTick = nextExpiry - 5 * MINUTE__MS;
      let waitDuration = Math.max(nextTick - Date.now(), 0);

      const DAY_IN_MS = 24 * 60 * 60 * 1000;
      if (waitDuration > DAY_IN_MS) {
        waitDuration = DAY_IN_MS;
      }

      await sleep(waitDuration);

      if (abortSignal.aborted) {
        // @ts-ignore
        pm.logger.info('VaultIntegrationService~Hashicorp.continouslyRefreshToken - Aborted');
        return;
      }

      try {
        this.#tokenResult = await this.loginUsingJWT(notNull(this.#tokenResult).jwt);
        this._broadcastUserInfo();

        errors = 0;
      } catch (e) {
        // @ts-ignore
        pm.logger.info('VaultIntegrationService~Hashicorp.continouslyRefreshToken - Error while refreshing token', e);
        errors += 1;
        await sleep(Math.min(Math.pow(2, errors), 120 * MINUTE__MS));
      }
    }
  }

  resetCache () {
    this.#secretCache.reset();
  }

  /**
   * Returns true if the secret provider and version are supported
   * @param {number} updatedTtl
   * @returns {boolean}
   */
  updateCacheTtl (updatedTtl) {
    this.resetCache();
    this.#secretCacheTtl = updatedTtl;
    this.#secretCache = new LRUCache({ maxAge: this.#secretCacheTtl, max: SECRET_CACHE_MAX_LIMIT });

    return true;
  }

  /**
   *
   * @param {HashicorpConfig | undefined} config
   * @returns {boolean}
   */
  isMatchingConfig (config) {
    if (
      config?.discoveryUrl != this.discoveryUrl ||
      config?.jwtAuthPath != this.jwtAuthPath ||
      config?.clientId != this.clientId ||
      config?.role != this.role ||
      config?.namespace != this.namespace
    ) {
      return false;
    }

    return true;
  }
}

/**
* @typedef {{secretId: string, assumedRole: string, version: string }} AWSSecretKey
* @extends {VaultInterface<AWSSecretKey, null>}
*/
class SecretsManagerVault extends VaultInterface {
  /**
  * @typedef {Object} AWSCredentials
  * @property {string} accessKeyId AWS Access Key
  * @property {string}  secretAccessKey AWS Secret Key
  * @property {string}  sessionToken AWS Session Token
  * @property {string}  region AWS Region
  * @property {number}  expiresOn expiry time in UTC
  *
  * @typedef {Object} AWSCredentialsRequestParams
  * @property {string} awsAccessKey AWS Access Key
  * @property {string}  awsSecretKey AWS Secret Key
  * @property {string}  mfaSerialNumber serial number of mfa device
  * @property {string}  mfaTokenCode MFA token code
  * @property {string}  region AWS Region
  * @property {string}  credentialsType type of credentials - root or main
  * @property {string}  sessionToken Session token for temporary credentials
  *
  * @typedef {Object} AWSSecretResponse
  * @property {string} value Secret value
  * @property {string}  id Secret identifier - Can be the name or the arn
  * @property {string}  version Secret version
 */

 static PROVIDER_ID = 'aws-secrets-manager';
 static LOGGED_IN_DURATION = 60 * 60 * 2; // 2 days

 /** @type {LRUCache<String, [null, AWSSecretResponse] | [Error, null]>} */
 #secretCache;

 /** @type {null | AWSCredentials} */
 #credentials;

  /** @type {number} */
  #secretCacheTtl = DEFAULT_SECRET_CACHE_TTL;

 /**
 * @override
 */
 constructor () {
   super();

   this.#secretCache = new LRUCache({ maxAge: this.#secretCacheTtl, max: SECRET_CACHE_MAX_LIMIT });

   /** @type {null | AbortController}*/
   this.reauthController = null;
 }

 /**
  * @param {AWSCredentialsRequestParams} params - config required for logging into AWS
  *
  * @returns {Promise<Object>}
 */
 async validateAndSaveTempCred (params) {
   try {
     if (!params?.awsAccessKey || !params?.awsSecretKey || !params.sessionToken) {
      return { success: false };
     }

     const sts = new STS({
       apiVersion: '2011-06-15',
       accessKeyId: params.awsAccessKey,
       secretAccessKey: params.awsSecretKey,
       sessionToken: params.sessionToken,
     });
     const credentials = await new Promise((resolve, reject) => {
       sts.getCallerIdentity({}, function (err, data) {
         if (err) {
           reject('Unable to validate session token');
         } else {
           resolve(data);
         }
       });
     });
     this.#credentials = {
       accessKeyId: params.awsAccessKey,
       secretAccessKey: params.awsSecretKey,
       sessionToken: params.sessionToken,
       region: params.region,
       expiresOn: Number.MAX_SAFE_INTEGER, // We do not know when this token expires
     };
     this._broadcastUserInfo();

     return { success: true };
   } catch (e) {
     this._broadcastUserInfo();

     throw e;
   }
 }

 /**
  * Log into AWS by generating temporary credentials for the user
  * @param {AWSCredentialsRequestParams} params - config required for logging into AWS
  *
  * @returns {Promise<Object>}
 */
 async fetchAndSaveTempCred (params) {
   try {
     if (!params?.awsAccessKey || !params?.awsSecretKey) {
      return { success: false };
     }

     const sts = new STS({
       apiVersion: '2011-06-15',
       accessKeyId: params.awsAccessKey,
       secretAccessKey: params.awsSecretKey
     });
     const credentials = await new Promise((resolve, reject) => {
       sts.getSessionToken({
         DurationSeconds: SecretsManagerVault.LOGGED_IN_DURATION,
         SerialNumber: params.mfaSerialNumber,
         TokenCode: params.mfaTokenCode
       }, function (err, data) {
         if (err) {
           reject('Unable to get session token');
         } else {
           resolve(data);
         }
       });
     });
     this.#credentials = {
       accessKeyId: credentials.Credentials.AccessKeyId,
       secretAccessKey: credentials.Credentials.SecretAccessKey,
       sessionToken: credentials.Credentials.SessionToken,
       region: params.region,
       expiresOn: new Date(credentials.Credentials.Expiration).getTime()
     };
     this._broadcastUserInfo();

     return { success: true };
   } catch (e) {
     this._broadcastUserInfo();

     throw e;
   }
 }

 /**
  * Log into AWS using user provided temporary credentials
  * @param {(url: String) => void} _ - Called with the auth URL once the server has been started.
  * @param {AWSCredentialsRequestParams} params - Called with the auth URL once the server has been started.
  *
  * @returns {Promise<Object>}
 */
 async performLoginFlow (_, params) {
  if (params.credentialsType === 'root') {
    const res = await this.fetchAndSaveTempCred(params);
    return res;
  } else {
    const res = await this.validateAndSaveTempCred(params);
    return res;
  }
 }

 /**
 * @override
 * @returns {UserInformation | null}
 */
 getUserInformation () {
   if (_.isNil(this.#credentials)) {
     return null;
   }
   return {
     expiresOn: notNull(this.#credentials.expiresOn)
   };
 }

 async fetchAWSConfig () {
   const rawData = await fs.readFile(AWSConfigParser.getAWSCredentialsPath(), 'utf8');
   const credentials = AWSConfigParser.parseCredentailsFile(rawData);

   const keys = credentials?.main || credentials?.default;
   return {
     awsAccessKey: keys.aws_access_key_id,
     awsSecretKey: keys.aws_secret_access_key
   };
 }

 async fetchMFAConfig (params) {
  if (!params || !params.awsAccessKey || !params.awsSecretKey) {
    return { error: 'Missing data' };
  }
  const res = await new Promise((resolve, reject) => {
    const iam = new IAM({
      apiVersion: '2010-05-08',
      accessKeyId: params.awsAccessKey,
      secretAccessKey: params.awsSecretKey
    });

    iam.listMFADevices({}, function (err, data) {
      if (err) {
        return reject('Unable to fetch user mfa details');
      }

      return resolve({ data: data.MFADevices });
    });
  });

  return res;
 }


 async logout () {
   // TODO
   if (_.isNil(this.#credentials)) {
     // if not authenticated just publish the information again to sync any listener      this.broadcastUserInfo();
     this._broadcastUserInfo();
     return;
   }
   this.#credentials = null;
   this.#secretCache.reset();
   this._stopReAuthFlow();
   this._broadcastUserInfo();
 }

 /**
  * @override
  * @param {any} secret
  * @returns {boolean}
  */
 isSupportedSecret (secret) {
  return this._isValidSecretId(secret);
 }

  getUniqueSecretIdentifier (secret) {
    return `${secret.secretId}-${secret.version}`;
  }

 /**
 * @override
 * @param {Secret<AWSSecretKey>[]} secrets
 * @param {AbortSignal} abortSignal
 * @returns {Promise<[Secret<AWSSecretKey>, SecretFetchResult][]>} Returns an array containing secret and result in same order as input array
 */
 async resolveSecrets (secrets, abortSignal) {
   this.emit('event', { event: 'variable_resolution_started' });
   let result = await this._resolveSecretIds(
     _.uniqBy(secrets, this.getUniqueSecretIdentifier),
     abortSignal
   );

   /** @type {[Secret<AWSSecretKey>, SecretFetchResult][]} **/
   let rv = [];

   for (const secret of secrets) {
     let res = result[this.getUniqueSecretIdentifier(secret)];
     if (res[0] == null) {
       rv.push([secret, { success: true, value: res[1] }]);
     } else {
       rv.push([secret, { success: false, error: res[0] }]);
     }
   }
   this.emit('event', { event: 'variable_resolution_finished' });
   return rv;
 }

 /**
  *
  * @param {Secret<AWSSecretKey>[]} secrets
  * @param {AbortSignal} abortSignal
  * @returns {Promise<{[key: string]: [Error, null] | [null, string]}>}
  */
 async _resolveSecretIds (secrets, abortSignal) {
   /** @type {{[key: string]: [Error, null] | [null, string]}} */
   let secretResults = {};
   for (let i = 0; i < secrets.length; i += 10) {
     await Promise.all(secrets.slice(i, i + 10).map(async (secret) => {
       const id = this.getUniqueSecretIdentifier(secret);
       if (abortSignal.aborted) {
         throw new AbortError();
       }
       try {
         secretResults[id] = [null, await this._resolveSecretId(secret, abortSignal)];
       } catch (e) {
         if (e instanceof AbortError) {
           throw e;
         }
         secretResults[id] = [/** @type {Error} */(e), null];
       }
     }));
   }
   return secretResults;
 }

 /**
  * Resolves secret, returns from cache if available otherwise makes the HTTP call.
  * @param {Secret<AWSSecretKey>} secret
  * @param {AbortSignal} abortSignal
  * @returns {Promise<string>}
  */
 async _resolveSecretId (secret, abortSignal) {
   if (!this._isValidSecretId(secret.secretId)) {
     throw new VaultInvalidSecretKey(secret.secretId);
   }

   if (!this._isValidRole(secret.assumedRole)) {
    throw new VaultInvalidRole(secret.assumedRole);
   }

   const cacheKey = this.getUniqueSecretIdentifier(secret);
   if (!this.#secretCache.has(cacheKey)) {
     try {
       let secretResponse = await this._fetchSecret(secret, abortSignal);
       this.#secretCache.set(cacheKey, [null, secretResponse]);
     } catch (e) {
       // convert from node's abort_err to our type
       if (_.get(e, 'code') == 'ABORT_ERR') {
         throw new AbortError();
       }

       // 401 => no-access/invalid secret
       if (e instanceof VaultInvalidProviderResponse && e.statusCode == 401) {
         this.#secretCache.set(cacheKey, [e, null], this.#secretCacheTtl);
       } else {
          throw e;
       }
     }
   }

   let value = notNull(this.#secretCache.get(cacheKey));
   if (value[0] != null) {
     throw value[0];
   } else {
     if (!this._isSecretActive(value[1])) {
       throw new VaultSecretNotActive(secret.secretId);
     }
     return value[1].value;
   }
 }

 /**
  *
  * @param {AWSSecretResponse} secretResponse
  * @return {Boolean}
  */
 _isSecretActive (secretResponse) {
  return true;
 }

 /** @param {string} secret */
 _isValidSecretId (secret) {
    if (typeof secret != 'string') {
      return false;
    }
    if (!secret) {
      return false;
    }

    return true;
 }

 _isValidRole (role) {
  // Since role is optional, we don't validate it if its falsy
  if (!role) {
    return true;
  }

  if (typeof role != 'string') {
    return false;
  }

  if (!role.startsWith('arn:')) {
    return false;
  }

  return true;
 }

 /**
  * NOTE: SecretId should be validated using _isValidSecretId before calling this method
 * @param {Secret<AWSSecretKey>} secret
 * @param {AbortSignal} abortSignal
 * @returns {Promise<AWSSecretResponse>}
 */
 async _fetchSecret (secret, abortSignal) {
   if (!this.#credentials) {
     throw new Error('Not logged into vault');
   }

   const credentials = {
     accessKeyId: this.#credentials.accessKeyId,
     secretAccessKey: this.#credentials.secretAccessKey,
     sessionToken: this.#credentials.sessionToken
   };

   // Get credentials for assumed role
   if (secret.assumedRole && secret.assumedRole != '') {
     const sts = new STS({
       apiVersion: '2011-06-15',
       accessKeyId: credentials.accessKeyId,
       secretAccessKey: credentials.secretAccessKey,
       sessionToken: credentials.sessionToken,
     });
     const assumedCredentials = await new Promise((resolve, reject) => {
       sts.assumeRole({
         DurationSeconds: 3600,
         RoleArn: secret.assumedRole,
         RoleSessionName: 'postman-vault'
       }, function (err, data) {
         if (err) {
           reject(err);
         } else {
           resolve(data);
         }
       });
     });

     credentials.accessKeyId = assumedCredentials.Credentials.AccessKeyId;
     credentials.secretAccessKey = assumedCredentials.Credentials.SecretAccessKey;
     credentials.sessionToken = assumedCredentials.Credentials.SessionToken;
   }

   const secretsmanager = new SecretsManager({
     apiVersion: '2017-10-17',
     region: this.#credentials.region,
     accessKeyId: credentials.accessKeyId,
     secretAccessKey: credentials.secretAccessKey,
     sessionToken: credentials.sessionToken
   });

   const secretData = await new Promise((resolve, reject) => {
     secretsmanager.getSecretValue({
       SecretId: secret.secretId,
       ...(secret.version ? {
        VersionId: secret.version
       } : {})
     }, function (err, data) {
       if (err) {
         reject(err);
       } else {
         resolve(data);
       }
     });
   });

   return {
     value: secretData.SecretString,
     id: secret.secretId,
     version: secret.version,
   };
 }

 _stopReAuthFlow () {
  // TODO
 }

 _startReAuthFlow () {
  // TODO
 }

 /**
 * @param {AbortSignal} abortSignal
 */
 async _continuouslyRefreshToken (abortSignal) {
  console.log('NOT IMPLEMENTED');
 }

 _broadcastUserInfo () {
   this.emit('event', {
     event: 'auth_update',
     user: this.getUserInformation()
   });
 }

  resetCache () {
    this.#secretCache.reset();
  }

  /**
   * Returns true if the secret provider and version are supported
   * @param {number} updatedTtl
   * @returns {boolean}
   */
  updateCacheTtl (updatedTtl) {
    this.resetCache();
    this.#secretCacheTtl = updatedTtl;
    this.#secretCache = new LRUCache({ maxAge: this.#secretCacheTtl, max: SECRET_CACHE_MAX_LIMIT });

    return true;
  }
}

class OnePasswordVault extends VaultInterface {
  /**
  * @typedef {Object} OnePasswordCredentials
  * @property {string}  serviceToken Service Token
  * @property {Object}  client 1Password client
  *
  * @typedef {Object} OnePasswordCredentialsRequestParams
  * @property {string}  serviceToken Service Token
  *
  * @typedef {Object} OnePasswordSecretResponse
  * @property {string} value Secret value
  * @property {string}  id Secret identifier - Can be the name
  *
  * @typedef {Object} OnePasswordSecretKey
  * @property {string} secretId Secret identifier
 */

 static PROVIDER_ID = 'one-password';

 /** @type {LRUCache<String, [null, OnePasswordSecretResponse] | [Error, null]>} */
 #secretCache;

 /** @type {null | OnePasswordCredentials} */
 #credentials;

  /** @type {number} */
  #secretCacheTtl = DEFAULT_SECRET_CACHE_TTL;

 /**
 * @override
 */
 constructor () {
   super();

   this.#secretCache = new LRUCache({ maxAge: this.#secretCacheTtl, max: SECRET_CACHE_MAX_LIMIT });

   /** @type {null | AbortController}*/
   this.reauthController = null;
 }

 /**
  * @override
  * @param {(url: String) => void} _ - Called with the auth URL once the server has been started.
  * @param {OnePasswordCredentialsRequestParams} params - credentials needed to log into 1Password.
  *
  * @returns {Promise<Object>}
 */
 async performLoginFlow (_, params) {
   try {
     if (!params?.serviceToken || !params.serviceToken.startsWith('ops_')) {
      return { success: false };
     }

     const disposer = mockFetch();
     const client = await op.createClient({
      auth: params.serviceToken,
      integrationName: 'Postman',
      integrationVersion: 'beta'
     });
     disposer();

     this.#credentials = {
      serviceToken: params.serviceToken,
      client,
     };

     this._broadcastUserInfo();
     return { success: true };
   } catch (e) {
      console.log(e);
     this._broadcastUserInfo();
     throw e;
   }
 }

 /**
 * @override
 * @returns {UserInformation | null}
 */
 getUserInformation () {
   if (_.isNil(this.#credentials)) {
     return null;
   }
   return {
     expiresOn: Number.MAX_SAFE_INTEGER, // We assume 1Password Service Tokens never expire
   };
 }

 async logout () {
   if (_.isNil(this.#credentials)) {
     // if not authenticated just publish the information again to sync any listener      this.broadcastUserInfo();
     this._broadcastUserInfo();
     return;
   }
   this.#credentials = null;
   this.#secretCache.reset();
   this._broadcastUserInfo();
 }

 /**
  * @override
  * @param {any} secret
  * @returns {boolean}
  */
 isSupportedSecret (secret) {
  return this._isValidSecretId(secret);
 }

  getUniqueSecretIdentifier (secret) {
    return secret.secretId;
  }

 /**
 * @override
 * @param {Secret<OnePasswordSecretKey>[]} secrets
 * @param {AbortSignal} abortSignal
 * @returns {Promise<[Secret<OnePasswordSecretKey>, SecretFetchResult][]>} Returns an array containing secret and result in same order as input array
 */
 async resolveSecrets (secrets, abortSignal) {
   this.emit('event', { event: 'variable_resolution_started' });
   let result = await this._resolveSecretIds(
     _.uniqBy(secrets, this.getUniqueSecretIdentifier),
     abortSignal
   );

   /** @type {[Secret<OnePasswordSecretKey>, SecretFetchResult][]} **/
   let rv = [];

   for (const secret of secrets) {
     let res = result[this.getUniqueSecretIdentifier(secret)];
     if (res[0] == null) {
       rv.push([secret, { success: true, value: res[1] }]);
     } else {
       rv.push([secret, { success: false, error: res[0] }]);
     }
   }
   this.emit('event', { event: 'variable_resolution_finished' });
   return rv;
 }

 /**
  *
  * @param {Secret<OnePasswordSecretKey>[]} secrets
  * @param {AbortSignal} abortSignal
  * @returns {Promise<{[key: string]: [Error, null] | [null, string]}>}
  */
 async _resolveSecretIds (secrets, abortSignal) {
   /** @type {{[key: string]: [Error, null] | [null, string]}} */
   let secretResults = {};
   for (let i = 0; i < secrets.length; i += 10) {
     await Promise.all(secrets.slice(i, i + 10).map(async (secret) => {
       const id = this.getUniqueSecretIdentifier(secret);
       if (abortSignal.aborted) {
         throw new AbortError();
       }
       try {
         secretResults[id] = [null, await this._resolveSecretId(secret, abortSignal)];
       } catch (e) {
         if (e instanceof AbortError) {
           throw e;
         }
         secretResults[id] = [/** @type {Error} */(e), null];
       }
     }));
   }
   return secretResults;
 }

 /**
  * Resolves secret, returns from cache if available otherwise makes the HTTP call.
  * @param {Secret<OnePasswordSecretKey>} secret
  * @param {AbortSignal} abortSignal
  * @returns {Promise<string>}
  */
 async _resolveSecretId (secret, abortSignal) {
   if (!this._isValidSecretId(secret.secretId)) {
     throw new VaultInvalidSecretKey(secret.secretId);
   }

   const cacheKey = this.getUniqueSecretIdentifier(secret);
   if (!this.#secretCache.has(cacheKey)) {
     try {
       let secretResponse = await this._fetchSecret(secret, abortSignal);
       this.#secretCache.set(cacheKey, [null, secretResponse]);
     } catch (e) {
       // convert from node's abort_err to our type
       if (_.get(e, 'code') == 'ABORT_ERR') {
         throw new AbortError();
       }

       // 401 => no-access/invalid secret
       if (e instanceof VaultInvalidProviderResponse && e.statusCode == 401) {
         this.#secretCache.set(cacheKey, [e, null], this.#secretCacheTtl);
       } else {
          throw e;
       }
     }
   }

   let value = notNull(this.#secretCache.get(cacheKey));
   if (value[0] != null) {
     throw value[0];
   } else {
     if (!this._isSecretActive(value[1])) {
       throw new VaultSecretNotActive(secret.secretId);
     }
     return value[1].value;
   }
 }

 /**
  *
  * @param {OnePasswordSecretResponse} secretResponse
  * @return {Boolean}
  */
 _isSecretActive (secretResponse) {
  return true;
 }

 /** @param {string} secret */
 _isValidSecretId (secret) {
    try {
      if (typeof secret != 'string') {
        return false;
      }
      if (!secret) {
        return false;
      }
      const [protocol, body] = secret.split('://');

      if (protocol != 'op') {
        return false;
      }

      const parts = body.split('/');

      // the reference uri should contain 3 or 4 parts
      if (![3, 4].includes(parts.length)) {
        return false;
      }

      /*
      This check should work, but 1password does not have
      official documentation on the characters supported. We
      have received feedback where some special characters were
      expected. So we are disabling the check for now and we will
      re-enable it once we have confirmation from the 1password team
      and are more confident about this validation
      if (parts.some((part) => {
        return (/^[a-z0-9\-\s]+$/i).test(part) === false;
      })) {
        return false;
      }
      */

      return true;
    } catch (err) {
      console.log(err);
      return false;
    }
 }

 /**
  * NOTE: SecretId should be validated using _isValidSecretId before calling this method
 * @param {Secret<OnePasswordSecretKey>} secret
 * @param {AbortSignal} abortSignal
 * @returns {Promise<OnePasswordSecretResponse>}
 */
 async _fetchSecret (secret, abortSignal) {
   if (!this.#credentials) {
     throw new Error('Not logged into vault');
   }

   const client = this.#credentials.client;

   const disposer = mockFetch();
   const value = await client.secrets.resolve(secret.secretId);
   disposer();

   return {
     value: value,
     id: secret.secretId,
   };
 }

 _stopReAuthFlow () {
  throw new Error('1Password does not need re-auth');
 }

 _startReAuthFlow () {
  throw new Error('1Password does not need re-auth');
 }

 /**
 * @param {AbortSignal} abortSignal
 */
 async _continuouslyRefreshToken (abortSignal) {
  throw new Error('1Password does not need refreshing tokens');
 }

 _broadcastUserInfo () {
   this.emit('event', {
     event: 'auth_update',
     user: this.getUserInformation()
   });
 }

  resetCache () {
    this.#secretCache.reset();
  }

  /**
   * Returns true if the secret provider and version are supported
   * @param {number} updatedTtl
   * @returns {boolean}
   */
  updateCacheTtl (updatedTtl) {
    this.resetCache();
    this.#secretCacheTtl = updatedTtl;
    this.#secretCache = new LRUCache({ maxAge: this.#secretCacheTtl, max: SECRET_CACHE_MAX_LIMIT });

    return true;
  }
}


class VaultManager {
  static types = [AzureVault, HashicorpVault, SecretsManagerVault, OnePasswordVault];

  constructor () {
    /**
    * @type {{[key: string]: InstanceType<typeof VaultManager.types[number]>}}
    */
    this.initialized = {};
  }

  /**
  * @param {String} vaultId
  * @returns {InstanceType<typeof VaultManager.types[number]> | null}
  */
  getVault (vaultId) {
    if (this.initialized[vaultId]) {
      return this.initialized[vaultId];
    }
    return null;
  }

  /**
   * @param {Secret<any>} secretId
   * @param {string} provider
   */
  isSupportedSecret (secretId, provider) {
    const vault = this.getVault(provider);
    if (vault?.isSupportedSecret(secretId)) {
      return true;
    }

    return false;
  }

  /**
   *
   * Resolves the secret from various vaults
   * @typedef {any} T
   * @param {Secret<T>[]} secrets
   * @param {AbortSignal} abortSignal
   * @returns {Promise<[Secret<T>, SecretFetchResult][]>} Returns an array with two objects [secret, result],
   *              each object maps secretId to its result depending on the resolution. A null error represents a secret
   *              which is not active yet
   */
  async resolveSecrets (secrets, abortSignal) {
    /** @type {{[key: string]: Secret<T>[]}} */
    let secrets_by_vault = {};

    /** @type {{[key: string]: number[]}} */
    let secret_index_by_vault = {};

    Object.keys(this.initialized).forEach((key) => {
      secrets_by_vault[key] = [];
      secret_index_by_vault[key] = [];
    });

    let rv = [];

    secrets.forEach((secret, idx) => {
      rv.push(null); // fill dummy value, it'll be replaced by exact value later
      for (const [vaultId, vault] of Object.entries(this.initialized)) {
        if (vaultId === secret.vaultId && vault.isSupportedSecret(secret.secretId)) {
          secrets_by_vault[secret.vaultId].push(secret);
          secret_index_by_vault[secret.vaultId].push(idx);
          break;
        }
      }
    });

    for (const [vaultId, vault] of Object.entries(this.initialized)) {
      if (!secrets_by_vault[vaultId]) {
        continue;
      }
      let res = await vault.resolveSecrets(secrets_by_vault[vaultId], abortSignal);

      // @ts-ignore - this seems like a ts bug. Can't allow forEach on `TypeA[] | TypeB[]`
      res.forEach((/** @type {typeof res[number]} */ result, /** @type {number} */ idx) => {
        rv[secret_index_by_vault[vaultId][idx]] = result;
      });
    }
    return rv;
  }

  /**
  * @param {String} vaultId
  * @param {HashicorpConfig=} config
  */
  async createVault (vaultId, config) {
    if (this.initialized[vaultId] && this.initialized[vaultId]?.isMatchingConfig(config)) {
      return this.initialized[vaultId];
    }

    let caCertPath = null;

    if (config && config.caCertPath) {
      caCertPath = config.caCertPath;

      delete config.caCertPath;
    }


    for (const type of VaultManager.types) {
      if (type.PROVIDER_ID == vaultId) {
        // @ts-ignore
        let vault = new type(config);
        await vault.init(caCertPath);
        this.initialized[vaultId] = vault;
        return vault;
      }
    }

    throw new Error('Unknown vault type');
  }

  /**
  * @param {String} vaultId
  */
  destroyVault (vaultId) {
    delete this.initialized[vaultId];
  }
}


class VaultError extends Error {}
class AbortError extends Error {}
class VaultSecretNotActive extends VaultError {
  /** @param {any} secretKey */
  constructor (secretKey) {
    super(`Secret is not active: ${secretKey}`);
  }
}

class VaultAuthTimeoutError extends VaultError {
  constructor () {
    super('Authentication timed out');
  }
}

class VaultNotAuthenticatedError extends VaultError {
  constructor () {
    super('Vault is not authenticated');
  }
}


class VaultInvalidSecretKey extends VaultError {
  /** @param {any} secretKey */
  constructor (secretKey) {
    super(`Invalid secret key: ${secretKey}`);
  }
}

class VaultInvalidRole extends VaultError {
  /** @param {any} role */
  constructor (role) {
    super(`Invalid role: ${role}`);
  }
}

class VaultInvalidProviderResponse extends VaultError {
  /**
  * @param {string} message
  * @param {number} statusCode
  */
  constructor (message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

/**
 * Adds support for abortSignal to postman-request
 * @typedef {{[key: string]: string | undefined}} Headers
 * @typedef {Object} RequestOption
 * @property {('GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH')=} method
 * @property {Headers=} headers
 * @property {boolean=} json
 * @property {Object=} body
 * @property {String=} caPath
 * @property {Buffer=} ca
 * @property {AbortSignal=} abortSignal
 *
 * @param {string | URL} url
 * @param {RequestOption} options
 * @returns {Promise<{response: {statusCode: number, [key: string]: any}, body: any}>}
 */
async function sendRequest (url, options) {
  if (options.abortSignal && options.abortSignal.aborted) {
    throw new AbortError();
  }
  let [promise, resolve, reject] = createPromise();
  let returned = false;

  if (options.caPath) {
    options.ca = require('fs').readFileSync(options.caPath);
  }

  let request = pr(url, options, (/** @type {Error|undefined} */ error, /** @type {any} */ response, /** @type {any} */body) => {
    if (returned) {
      return;
    }
    returned = true;
    if (error) return reject(error);
    resolve({ response, body });
  });

  options.abortSignal && options.abortSignal.addEventListener('abort', (event) => {
    if (returned) {
      return;
    }
    returned = true;
    request.abort();
    reject(event);
  });
  return await promise;
}

/** @param {number} duration__ms */
async function sleep (duration__ms) {
  await new Promise((r) => setTimeout(r, duration__ms));
}

/**
* @template T
* @returns {[Promise<T>, ((value?: T) => void), ((reason?: any) => void)]}
*/
function createPromise () {
  let resolve, reject;
  let promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  // @ts-ignore
  return [promise, resolve, reject];
}

/**
* @template T
* @param {T| null | undefined} value
* @returns {T}
*/
function notNull (value) {
  if (value === null || value === undefined) {
    throw new Error('Unexpected null value');
  }
  return value;
}

class TemporaryWebServer {
  /** @type {TemporaryWebServer | null} */
  static _globalServer = null;

  /**
   * @param {number} port
   * @param {string} host
  */
  constructor (port, host) {
    this.port = port;
    this.host = host;
    this.handler = null;

    this.server = http.createServer((req, res) => {
      if (this.handler) {
        this.handler(req, res);
      }
    });
  }


  isRunning () {
    return this.server.listening;
  }

  async stop () {
    if (!this.server.listening) {
      return;
    }
    let [promise, resolve, _reject] = createPromise();


    this.server.on('close', () => {
      resolve();
    });
    this.server.close();
    await new Promise((r) => setTimeout(r, 500));
    await promise;
    this.server.removeAllListeners('error');
  }

  async start () {
    let [promise, resolve, reject] = createPromise();
    this.server.on('error', (err) => {
      this.server.removeAllListeners();
      reject(err);
    });

    // Currently this part will throw an error if the server is already running
    // TODO: support having multiple listeners at the same time
    this.server.listen(this.port, this.host, () => {
      resolve();
    });
    await promise;
  }

  /**
  * @param {number} timeout - Milliseconds to wait before throwing timeout
  * @returns {Promise<[URL, http.IncomingMessage, http.ServerResponse]>}
  */
  async waitForRequest (timeout) {
    if (this.handler !== null) {
      throw new Error('Handler is already attached');
    }
    let [promise, resolve, reject] = createPromise();
    let returned = false;

    let closeListener = () => {
      if (returned) {
        return;
      }
      this.handler = null;
      reject(new AbortError());
      returned = true;
    };


    let handler = (/** @type {http.IncomingMessage} */req, /** @type {http.ServerResponse} */res) => {
      if (returned) {
        return;
      }
      this.server.removeListener('close', closeListener);
      this.handler = null;
      let url = new URL(/** @type {string | URL} */(req.url), `http://${this.host}:${this.port}`);
      resolve([url, req, res]);
      returned = true;
    };

    this.server.on('close', closeListener);
    this.handler = handler;
    setTimeout(() => {
      if (returned) {
        return;
      }
      returned = true;
      reject(new VaultAuthTimeoutError());
    }, timeout);
    return await promise;
  }

  /**
  * @param {http.ServerResponse} res
  * @param {number} statusCode
  * @param {string=} body
  * @param {Headers=} headers
  */
  async respond (res, statusCode, body, headers) {
    const [promise, resolve, reject] = createPromise();
    res.on('error', reject);
    res.on('finish', resolve);
    if (headers) {
      for (let entry in Object.entries(headers)) {
          res.setHeader(entry[0], entry[1]);
      }
    }

    const [writePromise, writeResolve, writeReject] = createPromise();
    res.write(body, (err) => {
      if (err) { return writeReject(err); }
      writeResolve();
    });

    await writePromise;
    res.statusCode = statusCode;
    res.end();
    await promise;
  }

  /** @returns {TemporaryWebServer} */
  static global () {
    if (TemporaryWebServer._globalServer == null) {
      let redirectUri = new URL(REDIRECT_URI);
      TemporaryWebServer._globalServer = new TemporaryWebServer(Number(redirectUri.port), redirectUri.hostname);
    }
    return TemporaryWebServer._globalServer;
  }

}

/*
let a = new TemporaryWebServer()

if a.running() {
  await a.stop();
}

await a.start
let request = a.waitForRequest();
request.respond()
url = request.url
a.stop()


*/


/**
* @template K
* @template V
* @template KM - Key mapping
*/
class KeyMap extends Map {
  /**
  * @param {(val: K) => KM} key -- This should *uniquely* map each key
  */
  constructor (key) {
    super();
    this.transform = key;
  }

  /**
  * @param {K} key
  * @param {V} value
  */
  set (key, value) {
    super.set(this.transform(key), value);
    return this;
  }

  /**
  * @param {K} key
  * @returns {V | undefined}
  */
  get (key) {
    return super.get(this.transform(key));
  }

  /**
  * @param {K} key
  */
  delete (key) {
    return super.delete(this.transform(key));
  }

  /**
  * @param {K} key
  */
  hash (key) {
    return super.has(this.transform(key));
  }
}


/**
 * @param {string} providerName
 * @param {string} logoLink
 * @param {string} faviconLink
 * @return {string}
 */
function generateHtml (providerName, logoLink, faviconLink) {
  return `
  <!DOCTYPE html>
  <html>
    <head>
      <meta charset="utf-8">
      <meta http-equiv="X-UA-Compatible" content="IE=edge">
      <link rel="shortcut icon" href="${faviconLink}">
      <link href="https://fonts.googleapis.com/css?family=Inter:400italic,600italic,700italic,400,600,700" rel="stylesheet" type="text/css">
      <meta name="viewport" content="width=320, initial-scale=1, maximum-scale=1, user-scalable=no">
      <title>Authorize application</title>
      <style>
      .authorization-container {
        text-align: center;
        margin-top: 100px;
      }

      .authorization-header--logo {
        width: 200px;
      }

      .authorization-header--title {
        font-family: Inter;
        font-style: normal;
        font-weight: bold;
        font-size: 18px;
        line-height: 32px;
        margin: 0px;
      }

      .authorization-content--success-icon {
        display: inline;
        margin: 0 auto;
      }

      .authorization-content--title {
        color: #007F31;
        display: inline;
        font-family: Inter;
        font-style: normal;
        font-weight: bold;
        font-size: 16px;
        line-height: 28px;
      }

      .authorization-content--message {
        font-family: Inter;
        font-style: normal;
        font-weight: normal;
        font-size: 14px;
        line-height: 24px;
      }

      .authorization-content--success-icon--svg {
        position: relative;
        top: 1px;
      }

      .authorization-content--error-icon {
        display: inline;
      }

      .authorization-content--error-title {
        color: #B70700;
        display: inline;
        font-family: Inter;
        font-style: normal;
        font-weight: bold;
        font-size: 16px;
        line-height: 28px;
      }

      .authorization-content--error-message {
        font-family: Inter;
        font-style: normal;
        font-weight: normal;
        font-size: 14px;
        line-height: 24px;
      }

      .authorizarion-content--contact {
        display: block;
        color: #D23F0E;
        margin-top: 16px;
        font-family: Inter;
        font-style: normal;
        font-weight: 600;
        font-size: 12px;
        line-height: 16px;
        text-decoration: none;
      }

      .authorization-content--error-icon--svg {
        position: relative;
        top: 1px;
      }


      .pm-container {
        text-align: center;
        margin-top: 100px;
      }

      .pm-header--logo {
        width: 48px;
        height: 48px;
      }

      .pm-header--title {
        margin-top: 16px;
        font-family: Inter;
        font-weight: 600;
        font-size: 16px;
        line-height: 20px;
        color: #212121;
      }

      .pm-content {
        margin-top: 16px;
      }

      .pm-content--redirect-info {
        font-family: Inter;
        font-weight: normal;
        font-size: 14px;
        line-height: 22px;
        color: #212121;
      }

      .pm-content--user-info {
        margin-top: 12px;
        font-family: Inter;
        font-weight: normal;
        font-size: 14px;
        line-height: 22px;
        color: #6B6B6B;
      }

      .pm-footer {
        margin-top: 16px;
      }

      .pm-footer--continue-button{
        color: #FFFFFF;
        background-color: #FF6C37;
        border-radius: 3px;
        padding: 8px 12px;
        border: none;
        outline: none;
        cursor: pointer;
        font-family: Inter;
        font-size: 12px;
        font-style: normal;
        font-weight: 600;
        line-height: 16px;
        letter-spacing: 0px;
        text-align: left;
      }
      </style>
    </head>
    <body style="text-align: 'center'">
      <div class="authorization-container">
        <div class='authorization-header'>
          <div class="authorization-header">
            <img src="${logoLink}" class="authorization-header--logo">
          </div>
          <h2 class='authorization-header--title'>
            ${providerName}
          </h2>
        </div>
        <div class="authorization-content">
          <div class="authorization-content--success-icon">
            <svg class="authorization-content--success-icon--svg" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M11.6465 5.14642L7.00004 9.79287L4.35359 7.14642L3.64648 7.85353L7.00004 11.2071L12.3536 5.85353L11.6465 5.14642Z" fill="#007F31"/>
              <path fill-rule="evenodd" clip-rule="evenodd" d="M16 8C16 12.4183 12.4183 16 8 16C3.58172 16 0 12.4183 0 8C0 3.58172 3.58172 0 8 0C12.4183 0 16 3.58172 16 8ZM15 8C15 11.866 11.866 15 8 15C4.13401 15 1 11.866 1 8C1 4.13401 4.13401 1 8 1C11.866 1 15 4.13401 15 8Z" fill="#007F31"/>
            </svg>
          </div>
          <h3 class="authorization-content--title">You&#39;re authorized</h3>
          <div class="authorization-content--message">You can close this tab and continue in Postman</div>
        </div>
      </div>
    </body>
  </html>
  `;
  }

module.exports = {
  VaultManager,
  VaultAuthTimeoutError,
  VaultInvalidSecretKey,
  VaultInvalidRole,
  VaultNotAuthenticatedError,
  VaultInvalidProviderResponse,
  AbortError,


  // for tests
  TemporaryWebServer
};

