const i18n = require('i18next');
const _ = require('lodash').noConflict();
const storage = require('electron-json-storage');

const PREFERENCE_USE_US_REGION = 'useUSRegion';
const PREFERENCE_USE_EU_REGION = 'useEURegion';
const PREFERENCE_ALWAYS_PROMPT = 'alwaysPrompt';

const REGION_US = 'us';
const REGION_EU = 'eu';

const PREFERENCE_TO_REGION_MAP = {
  [PREFERENCE_USE_US_REGION]: REGION_US,
  [PREFERENCE_USE_EU_REGION]: REGION_EU
};

const SETTING_NAME = 'preference',
  DB_KEY = 'newAccountRegionSettings',
  DEFAULT_PREFERENCE = PREFERENCE_USE_US_REGION,
  PREFERENCES = [
    {
      i18nKey: 'new_account_region_preference.preferences_label.use_us_region',
      value: PREFERENCE_USE_US_REGION
    },
    {
      i18nKey: 'new_account_region_preference.preferences_label.use_eu_region',
      value: PREFERENCE_USE_EU_REGION
    },
    {
      i18nKey: 'new_account_region_preference.preferences_label.always_prompt',
      value: PREFERENCE_ALWAYS_PROMPT
    }
  ],
  storageInterface = {
    get (key, cb) {
      storage.get(DB_KEY, (error, data) => {
        if (error) { pm.logger.error('newAccountRegionPreferenceService~storageInterface~get - Failed to get data from storage', key, error); }

        return cb && cb(error, _.get(data, key));
      });
    },

    getAll (cb) {
      storage.get(DB_KEY, (error, data) => {
        if (error) { pm.logger.error('newAccountRegionPreferenceService~storageInterface~getAll - Failed to get data from storage', error); }

        return cb && cb(error, data);
      });
    },

    set (key, value, cb) {
      // Gets the latest settings from the storage
      this.getAll((err, data) => {
        if (!err) {

          // change the value for the specific key
          data[key] = value;

          // Sets up the data for you in the settings json
          storage.set(DB_KEY, data, (error) => {
            if (error) { pm.logger.error('newAccountRegionPreferenceService~storageInterface~set - Failed to store data on storage', error); }

            return cb && cb(error, data);
          });
        }
        else {
          if (err) { pm.logger.error('newAccountRegionPreferenceService~storageInterface~set - Failed to get data from storage', err); }

          return cb && cb(err, data);
        }
      });
    }
  };

const _updatePreference = async (value) => {
  return new Promise((resolve, reject) => {
    storageInterface.set(SETTING_NAME, value, (error) => {
      if (error) { return reject(error); }

      resolve();
    });
  });
};

const _getPreference = async () => {
  return new Promise((resolve, reject) => {
    storageInterface.get(SETTING_NAME, (error, value) => {
      if (error) { return reject(error); }

      resolve(value);
    });
  });
};

/**
 * This function is wrapper around _getPreference that returns default preference
 * if _getPreference throws error or preference is not found in storage.
 */
const getPreferenceWithFallback = async () => {
  let preference;

  try {
    preference = await _getPreference();

    if (!preference) {
      pm.logger.info('newAccountRegionPreferenceService~getPreferenceWithFallback - Preference not found in storage.');
    }
  }
  catch (e) {
    pm.logger.error('newAccountRegionPreferenceService~getPreferenceWithFallback - Failed to get preference.', e);
  }

  // Falling back to default preference
  preference = preference || DEFAULT_PREFERENCE;

  return preference;
};

exports.DEFAULT_REGION = PREFERENCE_TO_REGION_MAP[DEFAULT_PREFERENCE];

exports.getRegionPreference = async () => {
  let preference = await getPreferenceWithFallback();

  pm.logger.info('newAccountRegionPreferenceService~getRegionPreference - Using preference:', preference);

  return PREFERENCE_TO_REGION_MAP[preference];
};

exports.getToggleMenuTemplate = async () => {
  let preference = await getPreferenceWithFallback();

  pm.logger.info('newAccountRegionPreferenceService~getToggleMenuTemplate - Using preference:', preference);

  return {
    label: i18n.t('new_account_region_preference.top_label'),
    submenu: _.map(PREFERENCES, ({ value, i18nKey }) => {
      return {
        label: i18n.t(i18nKey),
        type: 'radio',
        checked: value === preference,
        click: () => {
          pm.logger.info('newAccountRegionPreferenceService~getToggleMenuTemplate~click - updating preference to:', value);

          _updatePreference(value)
            .then(() => {
              pm.logger.info('newAccountRegionPreferenceService~getToggleMenuTemplate~click - updated preference to:', value);
            })
            .catch((e) => {
              pm.logger.error('newAccountRegionPreferenceService~getToggleMenuTemplate~click - Unable to update preference.', e);
            });

          return;
        }
      };
    })
  };
};
