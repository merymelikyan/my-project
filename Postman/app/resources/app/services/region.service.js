// @ts-check
const { getConfig, configService } = require('./AppConfigService');
const request = require('postman-request');
const { promisify } = require('util');
const CrashReporter = require('./CrashReporter');

/**
 * @typedef {typeof request} RequestFn
 * @type {(
 *  uri: Parameters<RequestFn>[0],
 *  options?: Parameters<RequestFn>[1]
 * ) => Promise<{ body: string; statusCode: number; }>}
 */
const asyncRequest = promisify(request);

class RegionService {
  DEFAULT_REGION = 'us';
  region = this.DEFAULT_REGION;

  /** @type {Record<string, string>} */
  #runtimeConfigs = {};

  /**
   * Set region of the user and persist it in the localstorage as user preference for later use.
   * @param {string=} region
   */
  async fetchRegionConfigAndOverride (region) {
    this.region = region || this.DEFAULT_REGION;
    const BASE_URL = getConfig('__WP_DESKTOP_UI_UPDATE_URL__');
    const ENV = getConfig('__WP_ENV__');

    let response = null;
    try {
      if (this.region !== this.DEFAULT_REGION) {
        response = await asyncRequest(`${BASE_URL}/v1/app-config/desktop/platform/${this.region}.${ENV}.json`)
        .then((response) => {
          if (response.statusCode >= 400) {
            throw new Error(`Getting region config failed with status code: ${response.statusCode}`);
          }
          return response;
        }).catch((err) => {
          pm.logger.error(
            'RegionService~updateAndPersistRegionPreference: failed to fetch the Region specific config',
            err
          );
          return null;
        });
      }

      this.#runtimeConfigs = JSON.parse(response?.body ?? '{}');
      configService.overrideConfig(this.#runtimeConfigs);

      // Reset CrashReporter instances to use newly overridden ENV variables.
      CrashReporter.init();
    } catch (error) {
      pm.logger.error(
        'RegionService~updateAndPersistRegionPreference: error',
        error
      );
    }
  }

  /**
   * This API is kept to work in sync, and not async for now.
   * The API can be (in future modified) to work in async, but it's not reasonable to do
   * it right now.
   *
   * The API is responsible to forward any existing cache of Runtime Configs fetched
   * from Artemis on app launch to other windows.
   * This helps us not to make the call again to Artemis servers, till the app relaunches
   *
   * In future a better solution would be to merge `fetchRegionConfigAndOverride` & `getRuntimeConfig`
   * APIs into a single function.
   *
   * @returns {Record<string, string>}
   */
  getRuntimeConfig () {
    return this.#runtimeConfigs;
  }
}

module.exports = new RegionService();
