const i18n = require('i18next'),
  { getConfig } = require('../AppConfigService'),
  RELEASE_CHANNEL = getConfig('__WP_RELEASE_CHANNEL__'),
  menuManager = require('../menuManager').menuManager,
  appSettings = require('../appSettings').appSettings,
  i18nLogger = require('./i18nLogger'),
  enUS = require('./en-US.json'),
  ja = require('./ja.json');

const ALLOWED_LOCALES = [{
    locale: 'en-US',
    resource: enUS
  }, {
    locale: 'ja',
    resource: ja
  }],
  DEFAULT_LOCALE = 'en-US',
  STORAGE_KEY = 'localeUserPreference',
  i18n_EVENT_BUS = 'i18n-events',
  LOCALE_CHANGED_EVENT = 'localeChanged',
  i18n_EVENT_NAMESPACE = 'i18n-requester-signed-in',
  i18n_MAIN_EVENT_NAMESPACE = 'i18n-electron-main-locales';

/**
 * Refresh OS Menu
 */
function _refreshMenu () {
  try {
    // Retrieve if shortcut is disabled
    appSettings.get('shortcutsDisabled', (error, isShortcutsDisabled) => {
      if (error) {
        i18nLogger.error('i18nService~_refreshMenu : Error while retrieving shortcutsDisabled flag', error);
        return;
      }

      // Only way to change language of the menu is to recreate it
      menuManager.createMenu(isShortcutsDisabled);
    });
  } catch (error) {
    i18nLogger.error('i18nService~_refreshMenu : Error while refreshing OS menu', error);
  }
}

class i18nService {
  locale = DEFAULT_LOCALE;

  /**
   * Set locale in the locale storage to cache the user preference locally
   * @param {string} locale
   */
  _setLocaleCache (locale) {
    if (!locale) {
      return;
    }
    this.locale = locale;

    // Persist the user preference locally
    // so that we don't need to rely on async API calls to determine user preferred language
    // for subsequent launches
    appSettings.set(STORAGE_KEY, locale, (error) => {
      error && i18nLogger.error('i18nService~_setLocaleCache : Error while setting the user preferred locale', error);
    });
  }

  /**
   * Change locale used in app - primarily OS menus
   * @param {string} locale
   * @returns {Promise} A promise to change locale
   */
  changeLocale (locale) {
    if (this.locale === locale) {
      return;
    }

    return i18n.changeLanguage(locale).then(() => {
      // Refresh OS menus
      _refreshMenu();

      // Persist the data locally
      this._setLocaleCache(locale);
    });
  }

  /**
   * Initialize i18n in main process
   */
  init = () => {
    // Retrieve user preferred locale so that all system messages appear in proper language from the beginning
    appSettings.get(STORAGE_KEY, (error, locale) => {
      let appliedLocale = this.locale;
      if (error) {
        // For error case, log the error and continue with default locale
        i18nLogger.error('i18nService~init : Error while retrieving stored locale preference', error);
      } else {
        appliedLocale = locale || this.locale;
      }
      try {
        const resources = {};

        ALLOWED_LOCALES.forEach(({ locale, resource }) => {
          resources[locale] = {
            translation: resource
          };
        });

        i18n
          .init({
            lng: appliedLocale,
            fallbackLng: DEFAULT_LOCALE,
            load: 'currentOnly',
            debug: ['dev', 'beta'].includes(RELEASE_CHANNEL),
            resources,
            saveMissing: true,
            missingKeyHandler: (lngs, ns, key) => {
              i18nLogger.error('i18n ~ missingKeyHandler', null, { lngs, ns, key });
            }
          });

        // Listen to language change in requester and change language locally
        pm.eventBus.channel(i18n_EVENT_BUS).subscribe((event = {}) => {
          const { name, namespace, data } = event;
          if (name === LOCALE_CHANGED_EVENT && [i18n_EVENT_NAMESPACE, i18n_MAIN_EVENT_NAMESPACE].includes(namespace)) {
            if (!data || !data.locale) {
              i18nLogger.error('i18nService~localeChanged event bus - locale is not supplied');
              return;
            }

            // Apply the change
            this.changeLocale(data.locale);
          }
        });
      } catch (error) {
        i18nLogger.error('i18nService~init : Failed to initialize i18n', error);
      }
    });
  }
}

module.exports = new i18nService();
