let _ = require('lodash'),
  uuid = require('uuid');

/**
 * Manager for handling refresh token requests through IPC Agent
 *
 * @class RefreshTokenManager
 */
class RefreshTokenManager {
  refreshCallbackMap = new Map();
  timeout = 30000; // Refresh Token Timeout in MS

  constructor () {
    this.refreshToken = this.refreshToken.bind(this);

    pm.eventBus.channel('oauth2-ipc-event').subscribe(({ name, namespace, data }) => {
      if (!(namespace === 'oauth2-refresh-token' && name === 'oauth2-token-refreshed')) {
        return;
      }

      const { refreshId } = data,
        refreshCallback = this.refreshCallbackMap.get(refreshId);

      // Bailout if no callback is found
      if (!refreshCallback) {
        pm.logger.warn('main~RefreshTokenManager~refreshToken: No callback found for refreshId', refreshId);

        return;
      }

      // clean up the map as this callback is no longer needed
      this.refreshCallbackMap.delete(refreshId);

      // if we have an error, call the callback with error
      if (data.error) {
        return refreshCallback(new Error(data.error));
      }

      if (data.accessToken) {
        return refreshCallback(null, data.accessToken);
      }

      pm.logger.error('main~RefreshTokenManager~refreshToken: No Access Token Received');

      return refreshCallback(new Error('No Access Token Received'));
    });
  }

  cancelRefresh (error) {
    pm.eventBus.channel('oauth2-ipc-event').publish({
      name: 'oauth2-cancel-refresh-token',
      namespace: 'oauth2-refresh-token',
      data: {
        error
      }
    });
  }

  async refreshToken (authSessionId, callback) {
    const refreshId = uuid.v4();

    this.refreshCallbackMap.set(refreshId, callback);

    pm.eventBus.channel('oauth2-ipc-event').publish({
      name: 'oauth2-refresh-token',
      namespace: 'oauth2-refresh-token',
      data: {
        authSessionId,
        refreshId
      }
    });

    const timeoutPromise = new Promise((resolve, reject) => {
      // We add a timeout to the refresh token promise to ensure that the request is not
      // hung up on the refresh token call. If the refresh token call takes more than
      // timeout, we abandon the refresh token request.
      setTimeout(() => reject(), this.timeout);
    });

    await timeoutPromise.catch(() => {
      const refreshCallback = this.refreshCallbackMap.get(refreshId);

      // Bailout if no callback is found -> this means that the refresh token call was successful
      // and the callback was already called
      if (!refreshCallback) {
        return;
      }

      // clean up the map as this callback is no longer needed
      this.refreshCallbackMap.delete(refreshId);

      this.cancelRefresh(new Error('Timeout while refreshing token'));

      return refreshCallback(new Error('Timeout while refreshing token'));
    });
  }
}

module.exports = {
  initialize: function () {
    pm.refreshTokenManager = new RefreshTokenManager();
  }
};
