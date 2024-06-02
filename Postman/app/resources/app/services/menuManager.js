var electron = require('electron'),
    app = electron.app,
    Menu = electron.Menu,
    MenuItem = electron.MenuItem,
    path = require('path'),
    _ = require('lodash').noConflict(),
    gpu = require('./gpu'),
    newAccountRegionPreference = require('./newAccountRegionPreferenceService'),
    menuManager = {},
    os = require('os'),
    BrowserWindow = require('electron').BrowserWindow,
    appName = electron.app.getName(),
    i18n = require('i18next'),
    APP_UPDATE = 'app-update',
    APP_UPDATE_EVENTS = 'app-update-events',
    CHECK_FOR_ELECTRON_UPDATE = 'checkForElectronUpdate',
    { createEvent } = require('../common/model-event'),
    { WORKSPACE_BUILDER, WORKSPACE_BROWSER, MODAL } = require('../common/constants/views'),
    { DEFAULT_HOME_IDENTIFIER, HOME_IDENTIFIER, OPEN_WORKSPACE_IDENTIFIER, SCRATCHPAD } = require('../common/constants/pages'),
    enterpriseUtils = require('../services/enterpriseUtil'),
    SETTINGS_ID = 'settings',

    PROXY_ALLOWED_ENVIRONMENTS = ['PostmanDev', 'PostmanBeta', 'PostmanStage', 'PostmanCanary'],

    // Documentation for registering menu actions can be found in App.js~registerMenuActions
    getOsxTopBarMenuTemplate = async function () {
      return [{
        label: appName,
        submenu: _.compact([
          {
            label: i18n.t('top_menu.osx_app.about', { appName }),
            role: 'about'
          },
          !enterpriseUtils.isEnterpriseApplication() ? {
            label: i18n.t('top_menu.osx_app.check_updates'),
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('checkElectronUpdates', null, options); }
          } : null,
          !enterpriseUtils.isEnterpriseApplication() ? { type: 'separator' } : null,
          await gpu.getToggleMenuItem(),
          { type: 'separator' },
          {
            // Preferences in macOS opens the settings modal so id is kept as settings
            // which is same for windows and linux also
            label: i18n.t('top_menu.osx_app.preferences'),
            id: SETTINGS_ID,
            accelerator: 'CmdOrCtrl+,',
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('openSettings', { type: 'shortcut', allowedViews: [WORKSPACE_BUILDER, WORKSPACE_BROWSER], blockedPages: [SCRATCHPAD] }, options); }
          },
          {
            label: i18n.t('top_menu.osx_app.services'),
            role: 'services',
            submenu: []
          },
          { type: 'separator' },
          {
            label: i18n.t('top_menu.osx_app.hide_app', { appName }),
            role: 'hide'
          },
          {
            label: i18n.t('top_menu.osx_app.hide_others'),
            role: 'hideothers'
          },
          {
            label: i18n.t('top_menu.osx_app.show_all'),
            role: 'unhide'
          },
          { type: 'separator' },
          {
            label: i18n.t('top_menu.osx_app.quit', { appName }),
            role: 'quit'
          }
        ])
      },
      {
        label: i18n.t('top_menu.file.file_label'),
        submenu: [
          {
            label: i18n.t('top_menu.file.new'),
            accelerator: 'CmdOrCtrl+N',
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('openCreateNewModal', { type: 'shortcut', allowedViews: [WORKSPACE_BUILDER], allowedPages: [OPEN_WORKSPACE_IDENTIFIER] }, options); },
            id: 'openCreateNewModal'
          },
          {
            label: i18n.t('top_menu.file.new_tab'),
            accelerator: 'CmdOrCtrl+T',
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('newTab', { type: 'shortcut', allowedViews: [WORKSPACE_BUILDER], allowedPages: [OPEN_WORKSPACE_IDENTIFIER] }, options); },
            id: 'openNewTab'
          },
          {
            label: i18n.t('top_menu.file.new_runner_tab'),
            accelerator: 'CmdOrCtrl+Shift+R',
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('openRunner', { type: 'shortcut', allowedViews: [WORKSPACE_BUILDER], allowedPages: [OPEN_WORKSPACE_IDENTIFIER] }, options); },
            id: 'newRunnerTab'
          },
          {
            label: i18n.t('top_menu.file.new_postman_window'),
            accelerator: 'CmdOrCtrl+Shift+N',
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('newWindow', { type: 'shortcut', isGlobal: true }, options); },
            id: 'newRequesterWindow'
          },
          { type: 'separator' },
          {
            label: i18n.t('top_menu.file.import'),
            accelerator: 'CmdOrCtrl+O',
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('openImport', { type: 'shortcut', allowedViews: [WORKSPACE_BUILDER], allowedPages: [OPEN_WORKSPACE_IDENTIFIER, HOME_IDENTIFIER, DEFAULT_HOME_IDENTIFIER] }, options); },
            id: 'import'
          },
          { type: 'separator' },
          {
            label: i18n.t('top_menu.file.close_window'),
            accelerator: 'CmdOrCtrl+Shift+W',
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('closeWindow', { type: 'shortcut', isGlobal: true }, options); }
          },
          {
            label: i18n.t('top_menu.file.close_tab'),
            accelerator: 'CmdOrCtrl+W',
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('closeTab', { type: 'shortcut', allowedViews: [WORKSPACE_BUILDER], allowedPages: [OPEN_WORKSPACE_IDENTIFIER] }, options); },
            id: 'closeCurrentTab'
          },
          {
            label: i18n.t('top_menu.file.force_close_tab'),
            accelerator: 'CmdOrCtrl+Alt+W',
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('forceCloseTab', { type: 'shortcut', allowedViews: [WORKSPACE_BUILDER], allowedPages: [OPEN_WORKSPACE_IDENTIFIER] }, options); },
            id: 'forceCloseCurrentTab'
          }
        ]
      },
      {
        label: i18n.t('top_menu.edit.edit_label'),
        submenu: [
          {
            label: i18n.t('top_menu.edit.undo'),
            accelerator: 'CmdOrCtrl+Z',
            click: function (menuItem, browserWindow, options) {
              // this is only for MacOS as undo didnt work implicilty for this platform
              // we are relying on electron for the case of windows and linux
              menuManager.handleMenuAction('undo', { type: 'shortcut', isGlobal: true }, options);
             }
          },
          {
            label: i18n.t('top_menu.edit.redo'),
            accelerator: 'Shift+CmdOrCtrl+Z',
            click: function (menuItem, browserWindow, options) {
              // this is only for MacOS as redo didnt work implicilty for this platform
              // we are relying on electron for the case of windows and linux
              menuManager.handleMenuAction('redo', { type: 'shortcut', isGlobal: true }, options);
             }
          },
          { type: 'separator' },
          {
            label: i18n.t('top_menu.edit.cut'),
            role: 'cut'
          },
          {
            label: i18n.t('top_menu.edit.copy'),
            role: 'copy'
          },
          {
            label: i18n.t('top_menu.edit.paste'),
            role: 'paste'
          },
          {
            label: i18n.t('top_menu.edit.paste_match_style'),
            accelerator: 'CmdOrCtrl+Shift+V',
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('pasteAndMatch', { type: 'shortcut', isGlobal: true }, options); }
          },
          {
            label: i18n.t('top_menu.edit.delete'),
            click: function (menuItem, browserWindow, options) {
              // This is only for MacOS platform as "delete" didnt work implicilty for this platform
              // We are relying on electron for the windows and linux platform
              menuManager.handleMenuAction('delete', { type: 'shortcut', isGlobal: true }, options);
             }
          },
          {
            label: i18n.t('top_menu.edit.select_all'),
            role: 'selectall'
          }
        ]
      },
      {
        label: i18n.t('top_menu.view.view_label'),
        submenu: [
          {
            label: i18n.t('top_menu.view.toggle_full_screen'),
            role: 'togglefullscreen'
          },
          {
            label: i18n.t('top_menu.view.zoom_in'),
            accelerator: 'CmdOrCtrl+numadd',
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('increaseZoom', { type: 'shortcut', isGlobal: true }, options); },
            id: 'increaseUIZoom'
          },
          {
            label: i18n.t('top_menu.view.zoom_out'),
            accelerator: 'CmdOrCtrl+numsub',
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('decreaseZoom', { type: 'shortcut', isGlobal: true }, options); },
            id: 'decreaseUIZoom'
          },
          {
            label: i18n.t('top_menu.view.reset_zoom'),
            accelerator: 'CmdOrCtrl+0',
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('resetZoom', { type: 'shortcut', isGlobal: true }, options); }
          },
          {
            label: i18n.t('top_menu.view.toggle_sidebar'),
            accelerator: 'CmdOrCtrl+\\',
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('toggleSidebar', { type: 'shortcut', allowedViews: [WORKSPACE_BUILDER], allowedPages: [OPEN_WORKSPACE_IDENTIFIER] }, options); },
            id: 'toggleSidebar'
          },
          {
            label: i18n.t('top_menu.view.toggle_two_pane'),
            accelerator: 'CmdOrCtrl+Alt+V',
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('toggleLayout', { type: 'shortcut', allowedViews: [WORKSPACE_BUILDER], allowedPages: [OPEN_WORKSPACE_IDENTIFIER] }, options); },
            id: 'toggleLayout'
          },
          { type: 'separator' },
          {
            label: i18n.t('top_menu.view.show_console'),
            accelerator: 'CmdOrCtrl+Alt+C',
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('openConsole', { type: 'shortcut', isGlobal: true }, options); },
            id: 'newConsoleWindow'
          },
          {
            label: i18n.t('top_menu.view.developer.label'),
            submenu: [
              {
                label: i18n.t('top_menu.view.developer.show_devtools'),
                accelerator: (function () {
                  if (process.platform == 'darwin') {
                    return 'Alt+Command+I';
                  }
                  else {
                    return 'Ctrl+Shift+I';
                  }
                }()),
                click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('toggleDevTools', { type: 'shortcut', isGlobal: true }, options); }
              },
              { type: 'separator' },
              {
                label: i18n.t('top_menu.view.developer.view_logs'),
                click: function () { menuManager.handleMenuAction('openLogsFolder'); }
              }
            ]
          }
        ]
      },
      {
        label: i18n.t('top_menu.window.window_label'),
        role: 'window',
        submenu: [
          {
            label: i18n.t('top_menu.window.minimize'),
            role: 'minimize'
          },
          {
            label: i18n.t('top_menu.window.zoom'),
            role: 'zoom'
          },
          {
            label: i18n.t('top_menu.window.close_window'),
            role: 'close'
          },
          { type: 'separator' },
          {
            label: i18n.t('top_menu.window.go_back'),
            accelerator: 'CmdOrCtrl+[',
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('navigateToPreviousPage', { type: 'shortcut', blockedPages: [SCRATCHPAD] }, options); }
          },
          {
            label: i18n.t('top_menu.window.go_forward'),
            accelerator: 'CmdOrCtrl+]',
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('navigateToNextPage', { type: 'shortcut', blockedPages: [SCRATCHPAD] }, options); }
          },
          {
            label: i18n.t('top_menu.window.next_tab'),
            accelerator: 'CmdOrCtrl+Shift+]',
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('nextTab', { type: 'shortcut', allowedViews: [WORKSPACE_BUILDER], allowedPages: [OPEN_WORKSPACE_IDENTIFIER] }, options); },
            id: 'switchToNextTab'
          },
          {
            label: i18n.t('top_menu.window.prev_tab'),
            accelerator: 'CmdOrCtrl+Shift+[',
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('previousTab', { type: 'shortcut', allowedViews: [WORKSPACE_BUILDER], allowedPages: [OPEN_WORKSPACE_IDENTIFIER] }, options); },
            id: 'switchToPreviousTab'
          },
          { type: 'separator' },
          {
            label: i18n.t('top_menu.window.bring_to_front'),
            role: 'front'
          }
        ]
      },
      {
        label: i18n.t('top_menu.help.help_label'),
        role: 'help',
        submenu: _.compact([
          PROXY_ALLOWED_ENVIRONMENTS.includes(appName) ? {
            label: i18n.t('top_menu.help.setup_web_gateway'),
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('openWebGatewayProxyWindow', { type: 'shortcut', isGlobal: true }, options); }
          } : null,
          PROXY_ALLOWED_ENVIRONMENTS.includes(appName) ?
          { type: 'separator' } : null,
          {
            label: i18n.t('top_menu.help.clear_cache_reload'),
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('clearCacheAndReload'); }
          },
          { type: 'separator' },
          await newAccountRegionPreference.getToggleMenuTemplate(),
          { type: 'separator' },
          {
            label: i18n.t('top_menu.help.documentation'),
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('openCustomUrl', 'https://go.pstmn.io/docs', options); }
          },
          {
            label: i18n.t('top_menu.help.github'),
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('openCustomUrl', 'https://go.pstmn.io/github', options); }
          },
          {
            label: i18n.t('top_menu.help.twitter'),
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('openCustomUrl', 'https://go.pstmn.io/twitter', options); }
          },
          {
            label: i18n.t('top_menu.help.support'),
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('openCustomUrl', 'https://go.pstmn.io/support', options); }
          }
        ])
      }];
    },
    getTopBarMenuTemplate = async function () {
      return [{
        label: i18n.t('top_menu.file.file_label'),
        submenu: [
          {
            label: i18n.t('top_menu.file.new'),
            accelerator: 'CmdOrCtrl+N',
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('openCreateNewModal', { type: 'shortcut', allowedViews: [WORKSPACE_BUILDER], allowedPages: [OPEN_WORKSPACE_IDENTIFIER] }, options); },
            id: 'openCreateNewModal'
          },
          {
            label: i18n.t('top_menu.file.new_tab'),
            accelerator: 'CmdOrCtrl+T',
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('newTab', { type: 'shortcut', allowedViews: [WORKSPACE_BUILDER], allowedPages: [OPEN_WORKSPACE_IDENTIFIER] }, options); },
            id: 'openNewTab'
          },
          {
            label: i18n.t('top_menu.file.new_runner_tab'),
            accelerator: 'CmdOrCtrl+Shift+R',
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('openRunner', { type: 'shortcut', allowedViews: [WORKSPACE_BUILDER], allowedPages: [OPEN_WORKSPACE_IDENTIFIER] }, options); },
            id: 'newRunnerTab'
          },
          {
            label: i18n.t('top_menu.file.new_postman_window'),
            accelerator: 'CmdOrCtrl+Shift+N',
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('newWindow', { type: 'shortcut', isGlobal: true }, options); },
            id: 'newRequesterWindow'
          },
          { type: 'separator' },
          {
            label: i18n.t('top_menu.file.import'),
            accelerator: 'CmdOrCtrl+O',
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('openImport', { type: 'shortcut', allowedViews: [WORKSPACE_BUILDER], allowedPages: [OPEN_WORKSPACE_IDENTIFIER, HOME_IDENTIFIER, DEFAULT_HOME_IDENTIFIER] }, options); },
            id: 'import'
          },
          {
            label: i18n.t('top_menu.file.settings'),
            id: SETTINGS_ID,
            accelerator: 'CmdOrCtrl+,',
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('openSettings', { type: 'shortcut', allowedViews: [WORKSPACE_BUILDER, WORKSPACE_BROWSER], blockedPages: [SCRATCHPAD] }, options); }
          },
          { type: 'separator' },
          {
            label: i18n.t('top_menu.file.close_window'),
            accelerator: 'CmdOrCtrl+Shift+W',
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('closeWindow', { type: 'shortcut', isGlobal: true }, options); }
          },
          {
            label: i18n.t('top_menu.file.close_tab'),
            accelerator: 'CmdOrCtrl+W',
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('closeTab', { type: 'shortcut', allowedViews: [WORKSPACE_BUILDER], allowedPages: [OPEN_WORKSPACE_IDENTIFIER] }, options); },
            id: 'closeCurrentTab'
          },
          {
            label: i18n.t('top_menu.file.force_close_tab'),
            accelerator: 'CmdOrCtrl+Alt+W',
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('forceCloseTab', { type: 'shortcut', allowedViews: [WORKSPACE_BUILDER], allowedPages: [OPEN_WORKSPACE_IDENTIFIER] }, options); },
            id: 'forceCloseCurrentTab'
          },
          {
            label: process.platform === 'win32' ? i18n.t('top_menu.file.quit_win') : i18n.t('top_menu.file.quit_linux'),
            role: 'quit'
          }
        ]
      },
      {
        label: i18n.t('top_menu.edit.edit_label'),
        submenu: [
          {
            label: i18n.t('top_menu.edit.undo'),
            role: 'undo'
          },
          {
            label: i18n.t('top_menu.edit.redo'),
            role: 'redo'
          },
          { type: 'separator' },
          {
            label: i18n.t('top_menu.edit.cut'),
            role: 'cut'
          },
          {
            label: i18n.t('top_menu.edit.copy'),
            role: 'copy'
          },
          {
            label: i18n.t('top_menu.edit.paste'),
            role: 'paste'
          },
          {
            label: i18n.t('top_menu.edit.paste_match_style'),
            role: 'pasteandmatchstyle'
          },
          {
            label: i18n.t('top_menu.edit.delete'),
            role: 'delete'
          },
          {
            label: i18n.t('top_menu.edit.select_all'),
            role: 'selectall'
          }
        ]
      },
      {
        label: i18n.t('top_menu.view.view_label'),
        submenu: [
          {
            label: i18n.t('top_menu.view.toggle_full_screen'),
            role: 'togglefullscreen'
          },
          {
            label: i18n.t('top_menu.view.zoom_in'),
            accelerator: 'CmdOrCtrl+=',
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('increaseZoom', { type: 'shortcut', isGlobal: true }, options); },
            id: 'increaseUIZoom'
          },
          {
            label: i18n.t('top_menu.view.zoom_out'),
            accelerator: 'CmdOrCtrl+-',
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('decreaseZoom', { type: 'shortcut', isGlobal: true }, options); },
            id: 'decreaseUIZoom'
          },
          {
            label: i18n.t('top_menu.view.reset_zoom'),
            accelerator: 'CmdOrCtrl+0',
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('resetZoom', { type: 'shortcut', isGlobal: true }, options); }
          },
          {
            label: i18n.t('top_menu.view.toggle_sidebar'),
            accelerator: 'CmdOrCtrl+\\',
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('toggleSidebar', { type: 'shortcut', allowedViews: [WORKSPACE_BUILDER], allowedPages: [OPEN_WORKSPACE_IDENTIFIER] }, options); },
            id: 'toggleSidebar'
          },
          {
            label: i18n.t('top_menu.view.toggle_two_pane'),
            accelerator: 'CmdOrCtrl+Alt+V',
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('toggleLayout', { type: 'shortcut', allowedViews: [WORKSPACE_BUILDER], allowedPages: [OPEN_WORKSPACE_IDENTIFIER] }, options); },
            id: 'toggleLayout'
          },
          { type: 'separator' },
          {
            label: i18n.t('top_menu.window.go_back'),
            accelerator: 'Alt+Left',
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('navigateToPreviousPage', { type: 'shortcut', blockedPages: [SCRATCHPAD] }, options); }
          },
          {
            label: i18n.t('top_menu.window.go_forward'),
            accelerator: 'Alt+Right',
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('navigateToNextPage', { type: 'shortcut', blockedPages: [SCRATCHPAD] }, options); }
          },
          {
            label: i18n.t('top_menu.window.next_tab'),
            accelerator: 'CmdOrCtrl+Tab',
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('nextTab', { type: 'shortcut', allowedViews: [WORKSPACE_BUILDER], allowedPages: [OPEN_WORKSPACE_IDENTIFIER] }, options); },
            id: 'switchToNextTab'
          },
          {
            label: i18n.t('top_menu.window.prev_tab'),
            accelerator: 'CmdOrCtrl+Shift+Tab',
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('previousTab', { type: 'shortcut', allowedViews: [WORKSPACE_BUILDER], allowedPages: [OPEN_WORKSPACE_IDENTIFIER] }, options); },
            id: 'switchToPreviousTab'
          },
          { type: 'separator' },
          {
            label: i18n.t('top_menu.view.show_console'),
            accelerator: 'CmdOrCtrl+Alt+C',
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('openConsole', { type: 'shortcut', isGlobal: true }, options); },
            id: 'newConsoleWindow'
          },
          {
            label: i18n.t('top_menu.view.developer.label'),
            submenu: [
              {
                label: i18n.t('top_menu.view.developer.show_devtools'),
                accelerator: (function () {
                  if (process.platform == 'darwin') {
                    return 'Alt+Command+I';
                  }
                  else {
                    return 'Ctrl+Shift+I';
                  }
                }()),
                click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('toggleDevTools', { type: 'shortcut', isGlobal: true }, options); }
              },
              { type: 'separator' },
              {
                label: process.platform === 'win32' ? i18n.t('top_menu.view.developer.view_logs_win') : i18n.t('top_menu.view.developer.view_logs_linux'),
                click: function () { menuManager.handleMenuAction('openLogsFolder'); }
              }
            ]
          }
        ]
      },

      /**
       * If current platform is linux and SNAP is running, removing the update flow
       */
      {
        label: i18n.t('top_menu.help.help_label'),
        role: 'help',
        submenu: _.compact([
          app.isUpdateEnabled ? {
            label: i18n.t('top_menu.help.check_updates'),
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('checkElectronUpdates', null, options); }
          } : null,
          app.isUpdateEnabled ?
          { type: 'separator' } : null,
          {
            label: i18n.t('top_menu.help.clear_cache_reload'),
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('clearCacheAndReload'); }
          },
          { type: 'separator' },
          PROXY_ALLOWED_ENVIRONMENTS.includes(appName) ? {
            label: i18n.t('top_menu.help.setup_web_gateway'),
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('openWebGatewayProxyWindow', { type: 'shortcut', isGlobal: true }, options); }
          } : null,
          PROXY_ALLOWED_ENVIRONMENTS.includes(appName) ?
          { type: 'separator' } : null,
          await gpu.getToggleMenuItem(),
          { type: 'separator' },
          await newAccountRegionPreference.getToggleMenuTemplate(),
          { type: 'separator' },
          {
            label: i18n.t('top_menu.help.documentation'),
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('openCustomUrl', 'https://go.pstmn.io/docs', options); }
          },
          {
            label: i18n.t('top_menu.help.github'),
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('openCustomUrl', 'https://go.pstmn.io/github', options); }
          },
          {
            label: i18n.t('top_menu.help.twitter'),
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('openCustomUrl', 'https://go.pstmn.io/twitter', options); }
          },
          {
            label: i18n.t('top_menu.help.support'),
            click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('openCustomUrl', 'https://go.pstmn.io/support', options); }
          }
        ])
      }];
    },
    dockMenuTemplate = [
      {
        label: i18n.t('dock_menu.new_collection'),
        click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('newCollection', null, options); }
      },
      {
        label: i18n.t('dock_menu.new_window'),
        click: function (menuItem, browserWindow, options) { menuManager.handleMenuAction('newWindow', null, options); }
      }
    ];
menuManager = {
  dockMenuTemplate: dockMenuTemplate,
  windowsApplicationContextMenu: null,

  createMenu: function (shortcutsDisabled = false) {
    return this.getMenuBarTemplate().then((template) => {
      const applicationMenu = Menu.buildFromTemplate(
        shortcutsDisabled ? this.removeShortcuts(template) : template
      );

      if (process.platform == 'win32') {
        this.windowsApplicationContextMenu = applicationMenu;
      }

      Menu.setApplicationMenu(applicationMenu);
    });
  },

  removeShortcuts: function (menu) {
    return _.map(menu, (menuItem) => {
      if (_.has(menuItem, 'submenu')) {
        _.set(menuItem, 'submenu', this.removeShortcuts(menuItem.submenu));
      }
      return _.omit(menuItem, ['accelerator']);
    });
  },

  updateMenuItems: function (windowType) {
    if (windowType === 'requester') {
      this.showMenuItem(SETTINGS_ID);
    }
    else if (windowType === 'console') {
      this.hideMenuItem(SETTINGS_ID);
    }
  },

  showMenuItem: function (menuItemId) {
    let menuItem = Menu.getApplicationMenu().getMenuItemById(menuItemId);

    if (menuItem) {
      menuItem.visible = true;
    }
  },

  hideMenuItem: function (menuItemId) {
    let menuItem = Menu.getApplicationMenu().getMenuItemById(menuItemId);

    if (menuItem) {
      menuItem.visible = false;
    }
  },

  /**
   * Creates a new OS menu from updated menubar template
   * @param {Map} updatedShortcuts shortcut names with user provided shortcut combinations
   */
  updateMenu: function (updatedShortcuts) {
    this.getMenuBarTemplate().then((template) => {
      const updatedMenu = this.updateShortcutInMenu(template, updatedShortcuts);
      const applicationMenu = Menu.buildFromTemplate(updatedMenu);

      if (process.platform == 'win32') {
        this.windowsApplicationContextMenu = applicationMenu;
      }

      Menu.setApplicationMenu(applicationMenu);
    });
  },

  /**
   * creates & returns a new menu template from the default menu template
   * by updating shortcuts with user provided shortcut combinations
   *
   * @param {Array} menu current menu template
   * @param {Map} updatedShortcuts shortcut names with user provided shortcut combinations
   * @returns menu template with updated shortcut values
   */
  updateShortcutInMenu: function (menu, updatedShortcuts) {
    return _.map(menu, (menuItem) => {
      if (updatedShortcuts.has(menuItem.id) && _.has(menuItem, 'accelerator')) {
        const updatedAccelerator = updatedShortcuts.get(menuItem.id);
        _.set(menuItem, 'accelerator', updatedAccelerator);
      }
      if (_.has(menuItem, 'submenu')) {
        _.set(
          menuItem,
          'submenu',
          this.updateShortcutInMenu(menuItem.submenu, updatedShortcuts)
        );
      }
      return menuItem;
    });
  },

  getMenuBarTemplate: function () {
    var platform = os.platform();
    if (platform === 'darwin') {
      return getOsxTopBarMenuTemplate();
    }
    else {
      return getTopBarMenuTemplate();
    }
  },

  handleMenuAction: function (action, meta, options) {
    // This import is moved from the global to here because it is only required here
    // and if kept global produces a cyclic dependency where menuManager imports windowManager
    // and vice versa which causes one of the module to be undefined.
    let windowManager = require('./windowManager').windowManager;

    // If the menu action is a global action and is to be handled in the main process itself,
    // we put it inside this if condition so that it is carried out without checking any further constraints
    if (meta && meta.type === 'shortcut' && meta.isGlobal) {
      if (action === 'toggleDevTools') {
        let win = BrowserWindow.getFocusedWindow();
        if (win && win.webContents) {
          windowManager.toggleDevTools(win);
        }
      }
      else if (action === 'newWindow') {
        windowManager.createOrRestoreRequesterWindow();
      }
      else if (action === 'openConsole') {
        windowManager.sendInternalMessage({
          event: 'showPostmanConsole',
          'object': { triggerSource: 'menuAction' }
        });
      }
      else if (action === 'undo') {
        let win = BrowserWindow.getFocusedWindow();
        if (win && win.webContents) {
          win.webContents.undo();
          win.webContents.send('menu-action-channel', 'undo');
        }
      }
      else if (action === 'redo') {
        let win = BrowserWindow.getFocusedWindow();
        if (win && win.webContents) {
          win.webContents.redo();
          win.webContents.send('menu-action-channel', 'redo');
        }
      }
      else if (action === 'delete') {
        let win = BrowserWindow.getFocusedWindow();
        if (win && win.webContents) {
          win.webContents.delete();
          win.webContents.send('menu-action-channel', 'delete');
        }
      }
      else if (action === 'closeWindow') {
        let win = BrowserWindow.getFocusedWindow();
        win && win.close();
      }
      else if (action === 'pasteAndMatch') {
        let focusedWebContents = electron.webContents && electron.webContents.getFocusedWebContents();
        focusedWebContents && focusedWebContents.pasteAndMatchStyle();
      }
    }

    if (action === 'openCustomUrl') {
      windowManager.openCustomURL(meta);
    }
    else if (action === 'checkElectronUpdates') {
      let updaterEventBus = global.pm.eventBus.channel(APP_UPDATE_EVENTS);
      updaterEventBus.publish({ name: CHECK_FOR_ELECTRON_UPDATE, namespace: APP_UPDATE });
    }
    else if (action === 'openLogsFolder') {
      // shell.openItem is deprecated from electron v9, hence changed to shell.openPath
      // https://github.com/electron/governance/blob/master/wg-api/spec-documents/shell-openitem.md
      electron.shell.openPath(electron.app.logPath).then((errorMessage) => {
        if (errorMessage) {
          pm.logger.error(`MenuManager~handleMenuAction: Failed to open logs folder ${errorMessage}`);
        }
      });
    }
    else if (action === 'clearCacheAndReload') {
      // Clear HTTP Cache
      let win = BrowserWindow.getFocusedWindow();
      win && win.webContents && win.webContents.session && win.webContents.session.clearCache();

      // Send an event to clear Service Workers and custom cache
      // This happens in the renderer process
      pm.eventBus.channel('menuActions').publish(createEvent('clearCacheAndReload', 'menuActions'));
    }
    else if (action === 'openWebGatewayProxyWindow') {
      windowManager.setWindowsDefaultVisibilityState(false);
      windowManager.closeRequesterWindows();
      windowManager.openWebBasedProxyWindow();
    }
    else {
      let win = BrowserWindow.getFocusedWindow();
      pm.eventBus.channel('menuActions').publish(createEvent(action, 'menuActions', { windowId: _.get(win, 'params[0].id') }, [], meta));
    }
  }
};

exports.menuManager = menuManager;
