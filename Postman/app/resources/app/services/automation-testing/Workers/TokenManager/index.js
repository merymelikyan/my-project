const uuid = require('uuid');
const { log } = require('../../lib/logging');
const { sendEventOnIPC, subscribeOnIPC } = require('../../lib/communication');

/**
 * Token manager to manage the tokens for the authSessionIds. This will be responsible for refreshing the tokens
 * when they are expired and also for providing the access token for the authSessionId when requested.
 *
 * @type {TokenManager}
 */
module.exports = class TokenManager {
  _store = new Map(); // <authSessionId, { accessToken, timestamp, expiresIn, monitor }>
  _authSessionIdToCallbackMap = new Map();
  _refreshAPITokenTimeout = 60000; // 1 minute
  _dynamicTokenRefreshDurationPercentage = 0.9; // 90% of token expiry duration

  /**
   * Lifecycle method called when the execution system is booted up and IPC is established.
   *
   * It subscribes to the `oauth2-token-refreshed` event to refresh the token when it is refreshed.
   *
   * @returns {void}
   */
  onStartup = () => {
    subscribeOnIPC('oauth2-token-refreshed', (data) => {
      if (this._authSessionIdToCallbackMap.has(data.authSessionId)) {
        // refresh after 90% of the lifetime of the token is reached
        const { timestamp, expiresIn } = data,

          // Time elapsed since the token was refreshed last time, this will be difference of current time and the time
          // when the token was refreshed last time. This is to ensure that the token is refreshed after 90% of the
          // lifetime of the token is reached.
          msElapsedSinceRefresh = Math.max((new Date() - new Date(timestamp)), 0),

          // Time left before the token expires
          timeout = Math.max((expiresIn * 1000 * this._dynamicTokenRefreshDurationPercentage) - msElapsedSinceRefresh, 0);

        // Clear the previous monitor if any to avoid multiple monitors for the same authSessionId
        clearTimeout(this._store.get(data.authSessionId)?.monitor);

        this._store.set(data.authSessionId, {
          ...data,
          monitor: setTimeout(() => {
            // generating a random refreshID and not data.refreshId
            this.getOrFetchToken({ authSessionId: data.authSessionId, refreshId: uuid.v4(), forced: true });
          }, timeout)
        });

        // Resolve all the callbacks/promises for the authSessionId
        this._authSessionIdToCallbackMap.get(data.authSessionId).forEach((resolve) => {
          // resolve the promise with the new access token for the authSessionId that was refreshed
          // to continue the execution of the request
          resolve(data.accessToken);

          // remove the resolve from the set of callbacks for the authSessionId
          this._authSessionIdToCallbackMap.get(data.authSessionId).delete(resolve);
        });

        // remove the authSessionId from the map if there are no more callbacks for the authSessionId
        this._authSessionIdToCallbackMap.delete(data.authSessionId);
      }
      else {
        log.debug('[TokenManager] Got an authSession ID we haven\'t seen: ', data.authSessionId);
      }
    });
  }

  /**
   * Refreshes the token for the authSessionId if needed and returns the access token for the given ID.
   * If the token is already present in the store, it will return the token from the store. If the token is not
   * present in the store, it will request for a new token from the renderer process.
   *
   * @param {Object} options
   * @param {String} options.authSessionId - authSessionId for which the token is requested
   * @param {String} options.refreshId - refreshId for the token
   * @param {Boolean} [options.forced=false] - if the token needs to be refreshed forcefully
   *
   * @returns {Promise<String>} - access token for the authSessionId
   */
  getOrFetchToken = ({ authSessionId, refreshId, forced = false }) => new Promise((resolve) => {
    // if the token is already present in the store and the auth sessionId is not being processed, return the token
    if (this._store.has(authSessionId) && !this._authSessionIdToCallbackMap.get(authSessionId) && !forced) {
      const { accessToken } = this._store.get(authSessionId);

      resolve(accessToken);

      return;
    }

    const isAuthSessionIdBeingProcessed = this._authSessionIdToCallbackMap.has(authSessionId);

    if (isAuthSessionIdBeingProcessed) {
      // If the authSessionId is being processed, add the resolve to the set of callbacks for the authSessionId
      // Such that when the token is refreshed, all the callbacks for the authSessionId can be resolved with the
      // new access token and new refresh request is not sent to the renderer process for the same authSessionId.
      this._authSessionIdToCallbackMap.get(authSessionId).add(resolve);
    }
    else {
      // If the authSessionId is not being processed, add the resolve to the set of callbacks for the authSessionId
      // and set the set of callbacks for the authSessionId in the map.
      this._authSessionIdToCallbackMap.set(authSessionId, new Set([resolve]));
    }

    // If the token is not present in the store or the token is being refreshed forcefully, request for a new token
    // from the renderer process.
    if (forced || !isAuthSessionIdBeingProcessed) {
      // sends a message on IPC to renderer to refresh the token if needed
      sendEventOnIPC('refresh-oauth2-token', 'tokenManager', { authSessionId, refreshId });

      log.debug('[TokenManager] Requested for token refresh');
    }
  });

  /**
   * Returns the access token for the authSessionId and refreshId. If the token is not present in the store, it will
   * request for a new token from the renderer process and wait for the token to be refreshed.
   *
   * @param {Object} options
   * @param {String} options.authSessionId - authSessionId for which the token is requested
   * @param {String} options.refreshId - refreshId for the token
   *
   * @returns {Promise<{accessToken:string, refreshId:string}>} - access token and refreshId for the authSessionId
   */
  getToken = async ({ authSessionId, refreshId }) => {
    const accessToken = await this.getOrFetchToken({ authSessionId, refreshId });

    return { accessToken, refreshId };
  }

  /**
   * Resets the token manager by clearing the store and the map.
   *
   * @returns {void}
   */
  reset = () => {
    this._store.forEach((authDetails) => {
      authDetails.monitor !== undefined && clearTimeout(authDetails.monitor);
    });

    this._store.clear();
    this._authSessionIdToCallbackMap = new Map();
  }
};
