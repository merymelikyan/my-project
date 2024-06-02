"use strict";(self.webpackChunk_postman_app_renderer=self.webpackChunk_postman_app_renderer||[]).push([[6],{"./js/themes/theme-definitions/monokai/alias.js":function(e,o,r){r.r(o);var t=r("./js/themes/theme-definitions/monokai/global.js");const n={"base-color-brand":t.default["teal-50"],"base-color-info":t.default["blue-50"],"base-color-warning":t.default["yellow-50"],"base-color-error":t.default["red-50"],"base-color-success":t.default["green-50"],"content-color-primary":t.default["grey-00"],"content-color-secondary":t.default["grey-30"],"content-color-tertiary":t.default["grey-50"],"content-color-brand":t.default["teal-40"],"content-color-info":t.default["blue-30"],"content-color-error":t.default["red-30"],"content-color-warning":t.default["yellow-30"],"content-color-success":t.default["green-30"],"content-color-constant":t.default["grey-00"],"content-color-link":t.default["teal-40"],"illustration-stroke-color":"#8B8B8B","background-color-primary":t.default["grey-90"],"background-color-secondary":t.default["grey-85"],"background-color-tertiary":t.default["grey-80"],"background-color-brand":t.default["teal-90"],"background-color-info":t.default["blue-90"],"background-color-error":t.default["red-90"],"background-color-warning":t.default["yellow-90"],"background-color-success":t.default["green-90"],"background-modal-backdrop":"rgba(26, 26, 26, 0.6)","border-color-subdued":t.default["grey-80"],"border-color-default":t.default["grey-80"],"border-color-strong":t.default["grey-70"],"border-color-active":"rgba(26, 26, 26, 0.3)","header-background-color-primary":t.default["grey-90"],"header-background-color-secondary":t.default["grey-85"],"header-color-content":t.default["grey-40"],"header-background-highlight-color-primary":t.default["grey-70"],"header-background-highlight-color-secondary":t.default["grey-90"],"controls-size-default":"32px","controls-size-small":"24px","highlight-background-color-primary":t.default["grey-70"],"highlight-background-color-secondary":t.default["grey-70"],"highlight-background-color-tertiary":t.default["grey-60"],"highlight-background-color-selected":t.default["blue-95"],"highlight-background-color-brand":t.default["teal-60"],"highlight-background-color-info":t.default["blue-60"],"highlight-background-color-warning":t.default["yellow-60"],"highlight-background-color-error":t.default["red-60"],"highlight-background-color-success":t.default["green-60"],"highlight-background-color-transparent":"rgba(255, 255, 255, 0.1)","shadow-default":"0px 2px 8px 0px rgba(0, 0, 0, 0.65)","shadow-strong":"0 16px 24px -8px rgba(0, 0, 0, 0.32)","shadow-focus":`0 0 0 1px ${t.default["grey-90"]}, 0 0 0 3px ${t.default["blue-30"]}`};o.default=n},"./js/themes/theme-definitions/monokai/component.js":function(e,o,r){r.r(o);var t=r("./js/themes/theme-definitions/monokai/global.js"),n=r("./js/themes/theme-definitions/monokai/alias.js");const a={"aether-icon-default-color":n.default["content-color-secondary"],"button-focus-border-color":n.default["shadow-focus"],"button-primary-background-color":n.default["base-color-brand"],"button-primary-hover-background-color":n.default["highlight-background-color-brand"],"button-primary-active-background-color":t.default["teal-70"],"button-primary-disabled-background-color":t.default["teal-90"],"button-primary-content-color":n.default["content-color-constant"],"button-primary-disabled-content-color":t.default["grey-50"],"button-primary-outline-color":"transparent","button-primary-disabled-outline-color":"transparent","button-tertiary-outline-color":"transparent","button-tertiary-disabled-outline-color":"transparent","button-outline-disabled-background-color":"transparent","button-destructive-outline-color":"transparent","button-destructive-disabled-outline-color":"transparent","button-secondary-background-color":t.default["grey-60"],"button-secondary-hover-background-color":t.default["grey-50"],"button-secondary-active-background-color":t.default["grey-70"],"button-secondary-disabled-background-color":t.default["grey-70"],"button-secondary-content-color":n.default["content-color-primary"],"button-secondary-disabled-content-color":t.default["grey-50"],"button-secondary-outline-color":"transparent","button-secondary-disabled-outline-color":"transparent","button-tertiary-background-color":"transparent","button-tertiary-hover-background-color":n.default["highlight-background-color-primary"],"button-tertiary-active-background-color":n.default["highlight-background-color-tertiary"],"button-tertiary-disabled-background-color":"transparent","button-tertiary-content-color":n.default["content-color-secondary"],"button-tertiary-hover-content-color":n.default["content-color-primary"],"button-tertiary-active-content-color":n.default["content-color-primary"],"button-tertiary-disabled-content-color":n.default["content-color-tertiary"],"button-outline-border":"1px solid","button-outline-background-color":"transparent","button-outline-border-color":"rgba(255, 255, 255, .24)","button-outline-hover-border-color":"rgba(255, 255, 255, .48)","button-outline-active-border-color":"rgba(255, 255, 255, .64)","button-outline-disabled-border-color":"rgba(255, 255, 255, .16)","button-outline-content-color":n.default["content-color-primary"],"button-outline-disabled-content-color":n.default["content-color-tertiary"],"button-destructive-background-color":t.default["red-70"],"button-destructive-hover-background-color":t.default["red-60"],"button-destructive-active-background-color":t.default["red-50"],"button-destructive-disabled-background-color":t.default["red-90"],"button-destructive-content-color":n.default["content-color-constant"],"button-destructive-disabled-content-color":t.default["grey-50"],"button-plain-content-color":n.default["content-color-link"],"button-plain-disabled-content-color":t.default["blue-70"],"button-monochrome-plain-content-color":"inherit","button-monochrome-plain-hover-content-color":n.default["content-color-link"],"button-monochrome-plain-disabled-content-color":t.default["blue-70"],"button-muted-plain-content-color":n.default["content-color-secondary"],"button-muted-plain-disabled-content-color":n.default["content-color-tertiary"],"splitbutton-primary-splitter-color":t.default["teal-70"],"splitbutton-secondary-splitter-color":t.default["grey-50"],"splitbutton-tertiary-splitter-color":t.default["grey-50"],"counterbutton-tertiary-splitter-color":t.default["grey-50"],"checkbox-checked-background-color":t.default["teal-50"],"checkbox-checked-disabled-background-color":t.default["teal-80"],"checkbox-border-color":t.default["grey-50"],"checkbox-disabled-border-color":t.default["grey-60"],"checkbox-checked-border-color":"transparent","checkbox-checked-disabled-border-color":"transparent","checkbox-marker-color":t.default["grey-00"],"checkbox-disabled-marker-color":t.default["grey-50"],"checkbox-outline-color":t.default["teal-20"],"switch-track-checked-background-color":t.default["teal-50"],"switch-track-unchecked-background-color":t.default["grey-60"],"switch-track-checked-disabled-background-color":t.default["teal-80"],"switch-track-unchecked-disabled-background-color":t.default["grey-60"],"switch-track-checked-border-color":"transparent","switch-track-checked-disabled-border-color":"transparent","switch-track-unchecked-border-color":"transparent","switch-track-unchecked-disabled-border-color":"transparent","switch-thumb-background-color":t.default["grey-00"],"switch-thumb-disabled-background-color":t.default["grey-50"],"switch-thumb-checked-border-color":"transparent","switch-thumb-checked-disabled-border-color":"transparent","switch-thumb-unchecked-border-color":"transparent","switch-thumb-unchecked-disabled-border-color":"transparent","radio-checked-background-color":t.default["teal-50"],"radio-checked-disabled-background-color":t.default["teal-80"],"radio-border-color":t.default["grey-50"],"radio-checked-border-color":"transparent","radio-disabled-border-color":t.default["grey-60"],"radio-checked-disabled-border-color":"transparent","radio-checked-marker-color":t.default["grey-00"],"radio-checked-disabled-marker-color":t.default["grey-50"],"stepper-progress-line-background-color":t.default["grey-40"],"avatar-type-count-background-color":t.default["grey-70"],"avatar-type-count-hovered-background-color":t.default["grey-60"],"badge-success-background-color":n.default["background-color-success"],"badge-success-content-color":n.default["content-color-success"],"badge-info-background-color":n.default["background-color-info"],"badge-info-content-color":n.default["content-color-info"],"badge-warning-background-color":n.default["background-color-warning"],"badge-warning-content-color":n.default["content-color-warning"],"badge-critical-background-color":n.default["background-color-error"],"badge-critical-content-color":n.default["content-color-error"],"badge-neutral-background-color":n.default["background-color-tertiary"],"badge-neutral-content-color":n.default["content-color-secondary"],"badge-status-count-background-color":t.default["teal-50"],"badge-status-count-content-color":t.default["grey-90"],"badge-status-new-background-color":t.default["purple-70"],"badge-status-new-content-color":t.default["purple-30"],"badge-border-radius":"9999px","banner-close-button-hover-color":"rgba(255, 255, 255, .08)","input-border-color-default":t.default["grey-50"],"input-border-color-success":t.default["green-40"],"input-border-color-warning":t.default["yellow-40"],"input-border-color-error":t.default["red-40"],"input-border-color-focus":t.default["blue-50"],"input-color-default":t.default["grey-10"],"input-background-color-disabled":t.default["grey-80"],"input-shadow-focus":t.default["blue-50"],"toast-container-width":"320px","toast-container-shadow":"0px 0px 8px rgba(0, 0, 0, 0.08)","tab-content-indicator-width":"6px","tab-content-indicator-height":"6px","tab-selected-border":`inset 0px -1px 0px ${t.default["teal-50"]}`,"tab-secondary-selected-border-color":n.default["border-color-default"],"tab-secondary-border-color":"transparent","table-scrollbar-thumb-background-color":t.default["grey-60"],"table-scrollbar-track-background-color":t.default["grey-80"],"table-row-selected-background-color":n.default["highlight-background-color-selected"],"modal-box-shadow":n.default["shadow-strong"],"modal-border-color":"transparent","tooltip-box-shadow":"0 2px 8px rgba(0, 0, 0, 0.32)","tooltip-border-color":"rgba(255, 255, 255, 0.08)","tooltip-background-color":n.default["background-color-primary"],"breadcrumb-shadow-focus":t.default["blue-50"],"popover-background-color":t.default["grey-90"],"popover-box-shadow":`0 0 1px rgba(255, 255, 255, 0.72), ${n.default["shadow-strong"]}`,"popover-pointer-filter":"drop-shadow(0px -1px 0px rgba(255, 255, 255, 0.23))","popover-outline-color":"transparent","progressbar-background-color":t.default["grey-50"],"progressbar-highlight-background-color":t.default["grey-60"],"tag-blue-content-color":t.default["blue-50"],"tag-purple-content-color":t.default["purple-50"],"tag-yellow-content-color":t.default["yellow-50"],"tag-green-content-color":t.default["green-50"],"tag-pink-content-color":t.default["pink-50"],"tag-teal-content-color":t.default["teal-50"],"tag-orange-content-color":t.default["orange-50"],"tag-default-content-color":n.default["content-color-secondary"],"tag-blue-border-color":t.default["blue-70"],"tag-purple-border-color":t.default["purple-70"],"tag-yellow-border-color":t.default["yellow-70"],"tag-green-border-color":t.default["green-70"],"tag-pink-border-color":t.default["pink-70"],"tag-teal-border-color":t.default["teal-70"],"tag-orange-border-color":t.default["orange-70"],"tag-default-border-color":t.default["grey-70"],"menuitem-destructive-hover-background-color":t.default["red-70"],"container-width-large":"1224px","container-width-medium":"984px","global-navigation-background-color":n.default["background-color-secondary"]};o.default=a},"./js/themes/theme-definitions/monokai/global.js":function(e,o,r){r.r(o);o.default={"shade-white-rgb":"255,255,255","shade-black-rgb":"0,0,0","grey-00":"#FFFFFF","grey-05":"#F6F7F5","grey-10":"#E9EAE6","grey-20":"#CACBC3","grey-30":"#B4B6AA","grey-40":"#A0A494","grey-45":"#949494","grey-50":"#8A8E7B","grey-60":"#6B6E5E","grey-70":"#484A3F","grey-80":"#383A31","grey-85":"#30322A","grey-90":"#282923","orange-10":"#FFF1E1","orange-20":"#FEDEB8","orange-30":"#FEC98B","orange-40":"#FEB762","orange-50":"#FDA43A","orange-60":"#E97F02","orange-70":"#AC5E02","orange-80":"#794201","orange-90":"#472701","blue-05":"#F3F8FF","teal-10":"#D5F1F6","teal-20":"#95DCE9","teal-30":"#67CCDF","teal-40":"#34BBD5","teal-50":"#2497AD","teal-60":"#1D7A8B","teal-70":"#155965","teal-80":"#0E3B44","teal-90":"#0C343B","blue-95":"#112749","red-10":"#FEE1EC","red-20":"#FDC3D8","red-30":"#FC9CBF","red-40":"#FC83AF","red-50":"#FB6098","red-60":"#FA387F","red-70":"#DA0653","red-80":"#8B0435","red-90":"#45021A","green-10":"#ECF9D2","green-20":"#D5F19D","green-30":"#BDE963","green-40":"#9AD61F","green-50":"#83B71A","green-60":"#6A9315","green-70":"#4A670F","green-80":"#33470A","green-90":"#263608","yellow-10":"#FFF7E0","yellow-20":"#FFE8A8","yellow-30":"#FFDC7A","yellow-40":"#FFCB3D","yellow-50":"#FFBE0A","yellow-60":"#CC9600","yellow-70":"#8F6900","yellow-80":"#664B00","yellow-90":"#3D2D00","pink-10":"#F9E7F8","pink-20":"#F0C7EF","pink-30":"#E6A2E4","pink-40":"#DE82DB","pink-50":"#D562D2","pink-60":"#BD32B9","pink-70":"#8D258A","pink-80":"#611A5F","pink-90":"#380737","purple-10":"#EDE5FB","purple-20":"#D4C2F5","purple-30":"#BFA3EF","purple-40":"#AF8EEC","purple-50":"#A078E8","purple-60":"#814CE1","purple-70":"#6625DA","purple-80":"#451994","purple-90":"#2D1060","blue-10":"#E0F2FF","blue-20":"#B8E2FF","blue-30":"#8ACFFF","blue-40":"#61BEFF","blue-50":"#38ADFF","blue-60":"#0084E0","blue-70":"#0069B2","blue-80":"#004270","blue-90":"#002742"}},"./js/themes/theme-definitions/monokai/index.js":function(e,o,r){r.r(o),r.d(o,{customDesignTokens:function(){return c},themeConfig:function(){return d.themeConfig}});var t=r("./js/themes/theme-definitions/monokai/global.js"),n=r("./js/themes/theme-definitions/monokai/alias.js"),a=r("./js/themes/theme-definitions/monokai/component.js"),l=r("./js/themes/base-global-tokens.js"),d=r("./js/themes/theme-definitions/monokai/themeConfig.js");const c={"button-main-background-color":t.default["teal-50"],"button-main-hover-background-color":t.default["teal-60"],"button-main-active-background-color":t.default["teal-60"],"button-main-disabled-background-color":t.default["teal-60"],"button-main-content-color":t.default["grey-00"],"button-main-disabled-content-color":t.default["grey-00"],"button-main-outline-color":"transparent","button-main-disabled-outline-color":"transparent","button-group-separator":"1px solid rgba(0, 0, 0, 0.24)","scrollbar-thumb-background-color":t.default["grey-60"],"scrollbar-track-background-color":t.default["grey-80"],"runner-summary-vertical-bar-hover-background-color":t.default["grey-00"],"selected-checkbox-background-color":t.default["grey-00"],"radio-button-background-color":"#686868","progressbar-background-color":t.default["grey-50"],"progressbar-highlight-background-color":t.default["grey-60"],"modal-sidebar-border-color":"transparent","sidebar-button-tertiary-hover-background-color":"rgba(255, 255, 255, 0.12)","sidebar-button-tertiary-active-background-color":"rgba(255, 255, 255, 0.16)","flow-input-border-color":t.default["grey-50"],"flow-input-focus-color":t.default["blue-50"],"flow-block-shadow-inactive":"0px 1px 3px rgba(0, 0, 0, 0.80), 0px 1px 2px rgba(0, 0, 0, 0.65)","flow-block-shadow-hover":"0px 3px 6px rgba(0, 0, 0, 0.80), 0px 3px 6px rgba(0, 0, 0, 0.65)","flow-node-background":"rgba(33, 33, 33, .85)","flow-canvas-background":t.default["grey-90"],"background-color-primary-rgb":"40,41,35","background-color-secondary-rgb":"48,50,42","environment-input-focus-color":t.default["blue-50"],"environment-divider-border-color":t.default["grey-50"],"response-meta-time-graph-system-bar-background-color":t.default["grey-60"],"aether-popover-shadow":"0 0 1px rgba(255, 255, 255, 0.72), var(--shadow-strong, 0 16px 24px -8px rgba(0, 0, 0, 0.32))","color-whitespace-char":"rgba(255, 255, 255, .24)","request-url-highlight-border-color":t.default["blue-50"],"cnx-card-border-color":t.default["blue-60"],"content-color-patch-method":t.default["purple-30"],"content-color-options-method":t.default["pink-40"],"http-icon-color":"#3FD6E6","graphql-icon-color":"#F15EB0","grpc-icon-color":"#74AEF6","websocket-icon-color":"#FF8E64","socketio-icon-color":"#FF8E64","mqtt-icon-color":"#926CC2","windows-controls-close-background-color":t.default["red-50"],"sidebar-item-shadow-focus":`0px 0px 0px 2px ${t.default["blue-30"]} inset`,"activation-onboarding-popover-background-color":t.default["blue-20"],"activation-onboarding-color":t.default["grey-90"],"template-with-ai-background-color":t.default["purple-90"],"template-with-ai-color":t.default["purple-20"],"quick-start-action-box-shadow":"0px 2px 8px 0px rgba(71, 71, 71, 0.2)","quick-start-action-hover-box-shadow":"0px 3px 6px 0px rgba(69, 69, 69, 0.5)","universe-banner-background-color":t.default["grey-85"],"universe-banner-explore-button-background-color":t.default["grey-85"],"universe-banner-explore-button-font-color":t.default["grey-30"],"universe-banner-explore-button-border-color":t.default["grey-30"],"universe-banner-explore-button-hover-background-color":t.default["grey-90"],"universe-banner-explore-button-hover-font-color":t.default["grey-00"],"universe-banner-explore-button-hover-border-color":t.default["grey-00"],"monitoring-progress-bar-fill":t.default["blue-70"],"learning-center-highlight-background-color":t.default["yellow-90"],"workbench-drawer-overlay-shadow":"0px 0px 1px rgba(255, 255, 255, 0.72), 0px 16px 24px -8px rgba(0, 0, 0, 0.2)","secret-scanner-header-box-shadow":"0px 2px 3px -2px rgba(255, 255, 255, 0.2)","secret-scanner-button-background-color":t.default["green-70"],"secret-scanner-button-hover-background-color":t.default["green-80"],"secret-scanner-deleted-tag-border-color":t.default["orange-80"],"diff-addition-primary":t.default["green-20"],"diff-subtraction-primary":t.default["red-20"],"diff-source-primary":t.default["purple-20"],"diff-destination-primary":t.default["teal-20"],"diff-addition-secondary":t.default["green-30"],"diff-subtraction-secondary":t.default["red-30"],"diff-source-secondary":t.default["purple-30"],"diff-destination-secondary":t.default["teal-30"],"diff-source-button":t.default["purple-40"],"diff-destination-button":t.default["teal-40"],"diff-source-background":t.default["purple-90"],"diff-destination-background":t.default["teal-90"],"postbot-content":t.default["purple-30"],"postbot-background":t.default["purple-90"],"postbot-button-primary":t.default["purple-60"],"postbot-button-primary-label":t.default["purple-30"],"pane-chevron-color":t.default["grey-50"],"requester-tab-icon-opacity":"0.6","invite-modal-copy-link-button-hover-color":t.default["blue-60"],"documentation-editor-linear-gradient-first-color":n.default["highlight-background-color-tertiary"],"documentation-editor-linear-gradient-second-color":n.default["highlight-background-color-primary"],"documentation-editor-border-color":n.default["border-color-strong"],"documentation-content-color":n.default["content-color-primary"],"documentation-editor-expand-button-background-color":n.default["background-color-tertiary"],"documentation-editor-expand-button-border-color":n.default["border-color-default"],"documentation-request-url-background-color":n.default["background-color-secondary"],"documentation-editor-background-color":n.default["background-color-primary"],"documentation-editor-language-label-background-color":n.default["background-color-tertiary"],"documentation-editor-language-label-content-color":n.default["content-color-secondary"],"kv-editor-internal-border-color":n.default["border-color-default"]},u={...l.nonThemeGlobalTokens,...t.default,...n.default,...a.default,...c,...d.themeConfig.meta};o.default=u},"./js/themes/theme-definitions/monokai/themeConfig.js":function(e,o,r){r.r(o),r.d(o,{themeConfig:function(){return a}});var t=r("../../node_modules/styled-components/dist/styled-components.browser.esm.js"),n=r("./js/themes/theme-definitions/monokai/alias.js");const a={meta:{name:"monokai",colorScheme:"dark"},overrides:{cssRules:(0,t.css)(["img.aether-illustration,img.themed-illustration,.themed-illustration > img{filter:hue-rotate(140deg);mix-blend-mode:screen;}"]),prismTheme:'\n      code[class*="language-"],\n      pre[class*="language-"] {\n        color: #f8f8f2 !important;\n      }\n\n      :not(pre) > code[class*="language-"],\n      pre[class*="language-"] {\n        background: #272822;\n      }\n\n      .token.comment,\n      .token.prolog,\n      .token.doctype,\n      .token.cdata {\n        color: #778090;\n      }\n\n      .token.punctuation {\n        color: #F8F8F2;\n      }\n\n      .token.property {\n        color: #66d9ef;\n      }\n\n      .token.tag,\n      .token.constant,\n      .token.symbol,\n      .token.deleted {\n        color: #F92672;\n      }\n\n      .token.boolean,\n      .token.number {\n        color: #AE81FF;\n      }\n\n      .token.selector,\n      .token.attr-name,\n      .token.string,\n      .token.char,\n      .token.builtin,\n      .token.inserted {\n        color: #e6db74;\n      }\n\n      .token.operator,\n      .token.entity,\n      .token.url,\n      .language-css .token.string,\n      .style .token.string,\n      .token.variable {\n        color: #F8F8F2;\n      }\n\n      .token.atrule,\n      .token.attr-value,\n      .token.function {\n        color: #E6DB74;\n      }\n\n      .token.keyword {\n        color: #F92672;\n      }\n\n      .token.regex,\n      .token.important {\n        color: #FD971F;\n      }\n\n      .token.important,\n      .token.bold {\n        font-weight: bold;\n      }\n      .token.italic {\n        font-style: italic;\n      }\n    ',monacoTheme:{id:"postmanThemeMonokai",props:{base:"vs-dark",inherit:!0,colors:{"activityBar.background":"#272822","activityBar.foreground":"#f8f8f2","badge.background":"#75715e","badge.foreground":"#f8f8f2","button.background":"#75715e","debugToolBar.background":"#1e1f1c","diffEditor.insertedTextBackground":"#4b661680","diffEditor.removedTextBackground":"#90274a70","dropdown.background":"#414339","dropdown.listBackground":"#1e1f1c","editor.background":n.default["background-color-primary"],"editor.foreground":"#f8f8f2","editor.lineHighlightBackground":"#3e3d32","editor.selectionBackground":"#878b9180","editor.selectionHighlightBackground":"#575b6180","editor.wordHighlightBackground":"#4a4a7680","editor.wordHighlightStrongBackground":"#6a6a9680","editorCursor.foreground":"#f8f8f0","editorGroup.border":"#34352f","editorGroup.dropBackground":"#41433980","editorGroupHeader.tabsBackground":"#1e1f1c","editorHoverWidget.background":"#414339","editorHoverWidget.border":"#75715e","editorIndentGuide.activeBackground":"#767771","editorIndentGuide.background":"#464741","editorLineNumber.activeForeground":"#c2c2bf","editorLineNumber.foreground":"#90908a","editorSuggestWidget.background":"#272822","editorSuggestWidget.selectedBackground":"#3e3d32","editorSuggestWidget.border":"#75715e","editorWhitespace.foreground":"#464741","editorWidget.background":"#1e1f1c",focusBorder:"#99947c","input.background":"#414339","inputOption.activeBorder":"#75715e","inputValidation.errorBackground":"#90274a","inputValidation.errorBorder":"#f92672","inputValidation.infoBackground":"#546190","inputValidation.infoBorder":"#819aff","inputValidation.warningBackground":"#848528","inputValidation.warningBorder":"#e2e22e","list.activeSelectionBackground":"#75715e","list.dropBackground":"#414339","list.focusBackground":"#282a36","list.highlightForeground":"#f8f8f2","list.hoverBackground":"#3e3d32","list.inactiveSelectionBackground":"#414339","menu.background":"#1e1f1c","menu.foreground":"#cccccc","minimap.selectionHighlight":"#878b9180","panel.border":"#414339","panelTitle.activeBorder":"#75715e","panelTitle.activeForeground":"#f8f8f2","panelTitle.inactiveForeground":"#75715e","peekView.border":"#75715e","peekViewEditor.background":"#272822","peekViewEditor.matchHighlightBackground":"#75715e","peekViewResult.background":"#1e1f1c","peekViewResult.matchHighlightBackground":"#75715e","peekViewResult.selectionBackground":"#414339","peekViewTitle.background":"#1e1f1c","pickerGroup.foreground":"#75715e","progressBar.background":"#75715e","selection.background":"#878b9180","settings.numberInputBackground":"#32342d","settings.textInputBackground":"#32342d","sideBar.background":"#1e1f1c","sideBarSectionHeader.background":"#272822","statusBar.background":"#414339","statusBar.debuggingBackground":"#75715e","statusBar.noFolderBackground":"#414339","statusBarItem.remoteBackground":"#ac6218","tab.border":"#1e1f1c","tab.inactiveBackground":"#34352f","tab.inactiveForeground":"#ccccc7","terminal.ansiBlack":"#333333","terminal.ansiBlue":"#6a7ec8","terminal.ansiBrightBlack":"#666666","terminal.ansiBrightBlue":"#819aff","terminal.ansiBrightCyan":"#66d9ef","terminal.ansiBrightGreen":"#a6e22e","terminal.ansiBrightMagenta":"#ae81ff","terminal.ansiBrightRed":"#f92672","terminal.ansiBrightWhite":"#f8f8f2","terminal.ansiBrightYellow":"#e2e22e","terminal.ansiCyan":"#56adbc","terminal.ansiGreen":"#86b42b","terminal.ansiMagenta":"#8c6bc8","terminal.ansiRed":"#c4265e","terminal.ansiWhite":"#e3e3dd","terminal.ansiYellow":"#b3b42b","titleBar.activeBackground":"#1e1f1c","widget.shadow":"#00000098"},rules:[{token:"meta.embedded",foreground:"#F8F8F2",fontStyle:""},{token:"source.groovy.embedded",foreground:"#F8F8F2",fontStyle:""},{token:"comment",foreground:"#88846F",fontStyle:""},{token:"string",foreground:"#E6DB74",fontStyle:""},{token:"punctuation.definition.template-expression",foreground:"#F92672",fontStyle:""},{token:"punctuation.section.embedded",foreground:"#F92672",fontStyle:""},{token:"meta.template.expression",foreground:"#F8F8F2",fontStyle:""},{token:"constant.numeric",foreground:"#AE81FF",fontStyle:""},{token:"constant.language",foreground:"#AE81FF",fontStyle:""},{token:"constant.character",foreground:"#AE81FF",fontStyle:""},{token:"constant.other",foreground:"#AE81FF",fontStyle:""},{token:"variable",foreground:"#F8F8F2",fontStyle:""},{token:"keyword.operator",foreground:"#f92672"},{token:"variable.other.object",foreground:"#f8f8f2"},{token:"variable.other.object.property",foreground:"#f8f8f2"},{token:"keyword",foreground:"#F92672",fontStyle:""},{token:"storage",foreground:"#F92672",fontStyle:""},{token:"storage.type",foreground:"#66D9EF",fontStyle:"italic"},{token:"entity.name.type",foreground:"#A6E22E",fontStyle:"underline"},{token:"entity.name.class",foreground:"#A6E22E",fontStyle:"underline"},{token:"entity.name.namespace",foreground:"#A6E22E",fontStyle:"underline"},{token:"entity.name.scope-resolution",foreground:"#A6E22E",fontStyle:"underline"},{token:"entity.other.inherited-class",foreground:"#A6E22E",fontStyle:"italic underline"},{token:"entity.name.function",foreground:"#A6E22E",fontStyle:""},{token:"variable.parameter",foreground:"#FD971F",fontStyle:"italic"},{token:"entity.name.tag",foreground:"#F92672",fontStyle:""},{token:"entity.other.attribute-name",foreground:"#A6E22E",fontStyle:""},{token:"support.function",foreground:"#a6e22e",fontStyle:""},{token:"support.constant",foreground:"#66D9EF",fontStyle:""},{token:"support.type",foreground:"#66D9EF",fontStyle:"italic"},{token:"support.class",foreground:"#f8f8f2",fontStyle:""},{token:"support.other.variable",fontStyle:""},{token:"invalid",foreground:"#F44747",fontStyle:""},{token:"invalid.deprecated",foreground:"#F44747",fontStyle:""},{token:"support.variable",foreground:"#f8f8f2"},{token:"meta.structure.dictionary.json string.quoted.double.json",foreground:"#CFCFC2",fontStyle:""},{token:"meta.diff",foreground:"#75715E",fontStyle:""},{token:"meta.diff.header",foreground:"#75715E",fontStyle:""},{token:"markup.deleted",foreground:"#F92672",fontStyle:""},{token:"markup.inserted",foreground:"#A6E22E",fontStyle:""},{token:"markup.changed",foreground:"#E6DB74",fontStyle:""},{token:"constant.numeric.line-number.find-in-files - match",foreground:"#AE81FFA0",fontStyle:""},{token:"entity.name.filename.find-in-files",foreground:"#E6DB74",fontStyle:""},{token:"markup.quote",foreground:"#F92672",fontStyle:""},{token:"markup.list",foreground:"#E6DB74",fontStyle:""},{token:"markup.bold",foreground:"#66D9EF",fontStyle:""},{token:"markup.italic",foreground:"#66D9EF",fontStyle:""},{token:"markup.inline.raw",foreground:"#FD971F",fontStyle:""},{token:"markup.heading",foreground:"#A6E22E",fontStyle:""},{token:"markup.heading.setext",foreground:"#A6E22E",fontStyle:"bold"},{token:"markup.heading.markdown",fontStyle:"bold"},{token:"markup.quote.markdown",foreground:"#75715E",fontStyle:"italic"},{token:"markup.bold.markdown",fontStyle:"bold"},{token:"string.other.link.title.markdown",foreground:"#AE81FF",fontStyle:""},{token:"string.other.link.description.markdown",foreground:"#AE81FF",fontStyle:""},{token:"markup.underline.link.markdown",foreground:"#E6DB74",fontStyle:""},{token:"markup.underline.link.image.markdown",foreground:"#E6DB74",fontStyle:""},{token:"markup.italic.markdown",fontStyle:"italic"},{token:"markup.list.unnumbered.markdown",foreground:"#F8F8F2",fontStyle:""},{token:"markup.list.numbered.markdown",foreground:"#F8F8F2",fontStyle:""},{token:"punctuation.definition.list.begin.markdown",foreground:"#A6E22E",fontStyle:""},{token:"token.info-token",foreground:"#6796E6",fontStyle:""},{token:"token.warn-token",foreground:"#CD9731",fontStyle:""},{token:"token.error-token",foreground:"#F44747",fontStyle:""},{token:"token.debug-token",foreground:"#B267E6",fontStyle:""},{token:"variable.language",foreground:"#FD971F",fontStyle:""},{token:"postman.variable.json",foreground:n.default["base-color-brand"],fontStyle:"italic"},{token:"entity.name.tag.mustache",foreground:n.default["base-color-brand"],fontStyle:"italic"},{token:"postman.variable.string.json",foreground:n.default["base-color-brand"],fontStyle:"italic"},{token:"key.identifier",foreground:"#ffe200"},{token:"argument.identifier",foreground:"#fd971f"},{token:"graphql.types",foreground:"#66d9ef"},{token:"delimiter",foreground:"#F8F8F2"},{token:"meta.scss",foreground:"#a6e22e"},{token:"attribute.name",foreground:"#a6e22e"},{token:"attribute.value.html",foreground:"#e6db74"},{token:"attribute.value.number.css",foreground:"#BD93F9"},{token:"attribute.value.unit.css",foreground:"#BD93F9"},{token:"attribute.value.hex.css",foreground:"#F8F8F2"},{token:"delimiter.html",foreground:"#F8F8F2"},{token:"tag",foreground:"#F92672",fontStyle:""},{token:"tag.id.pug",foreground:"#BD93F9"},{token:"tag.class.pug",foreground:"#BD93F9"},{token:"meta.tag",foreground:"#FFB86C"},{token:"metatag",foreground:"#F92672"},{token:"metatag.content.html",foreground:"#a6e22e"},{token:"metatag.html",foreground:"#F92672"},{token:"metatag.xml",foreground:"#F92672"},{token:"string.key.json",foreground:"#66D9EF"},{token:"string.value.json",foreground:"#CFCFC2"},{token:"keyword.json",foreground:"#AE81FF"},{token:"keyword.js",foreground:"#f92672"},{token:"type.identifier",foreground:"#8BE9FD"},{token:"identifier.js",foreground:"#FFB86C"},{token:"number",foreground:"#AE81FFA0",fontStyle:""},{token:"regexp",foreground:"#FF5555"},{token:"variable.predefined",foreground:"#a6e22e"},{token:"constant",foreground:"#AE81FF",fontStyle:""},{token:"type",foreground:"#66D9EF",fontStyle:"italic"},{token:"annotation",foreground:"#f92672"},{token:"operator",foreground:"#f92672"},{token:"string.template",foreground:"#F1FA8C"},{token:"type.yaml",foreground:"#F92672"},{token:"string.yaml",foreground:"#E6DB74"},{token:"keyword.yaml",foreground:"#AE81FF"},{token:"operators.yaml",foreground:"#F8F8F2"}]}}}}}}]);