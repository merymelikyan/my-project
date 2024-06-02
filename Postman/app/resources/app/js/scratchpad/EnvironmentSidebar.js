"use strict";(self.webpackChunk_postman_app_scratchpad=self.webpackChunk_postman_app_scratchpad||[]).push([[10],{7278:function(e,t,i){i.r(t),i.d(t,{default:function(){return r}});var n=i(1),s=i(3565);function r(){return n.createElement(s.default,{name:"illustration-no-environment"})}},7271:function(e,t,i){i.r(t),i.d(t,{default:function(){return m}});var n,s=i(1),r=i(2394),o=i.n(r),a=i(2399),l=i(2829),c=i(7272),d=i(7273),h=i(7277);let m=(0,a.observer)(n=class extends s.Component{render(){return s.createElement("div",{className:"env-sidebar-container"},s.createElement(c.default,{model:this.props.model}),s.createElement(l.default,{identifier:"environment"},s.createElement(d.default,{model:this.props.model})))}})||n;m.propTypes={model:o().instanceOf(h.default).isRequired}},7279:function(e,t,i){i.r(t),i.d(t,{default:function(){return d}});var n=i(1916),s=i(2104),r=i(2225),o=i(4207),a=i(7277),l=i(6559),c=i(40);class d{constructor(){this.model=null,this.adapter=null}async didCreate(){this.model=new a.default,this.model.setLoading&&this.model.setLoading(!0),this.adapter=new l.default(this.model),await this.adapter.hydrate(),this.model.setLoading&&this.model.setLoading(!1)}async fetchEnvironments(){await(0,s.getStore)("SyncStatusStore").onSyncAvailable();const e=(0,s.getStore)("ActiveWorkspaceStore").id,t=await n.default.request(o.ENVIRONMENT_LIST_AND_SUBSCRIBE`${e}`,{method:"POST"}),i=c.forEach(c.get(t,"body.data",[]),(e=>{const t={model:"environment",modelId:e.id,action:"UPDATE_ENVIRONMENT"},i=r.default.getCompositeKey(t);!(0,s.getStore)("PermissionStore").members.has(i)&&c.set(e,"attributes.permissions.userCanUpdate",!0)}));return this.model.hydrate&&this.model.hydrate(i),this.model.setLoading&&this.model.setLoading(!1),t}beforeDestroy(){this.model.dispose(),this.model=null,this.adapter&&this.adapter.dispose(),this.adapter=null}}},7273:function(e,t,i){i.r(t),i.d(t,{default:function(){return _}});var n,s=i(1),r=i(2394),o=i.n(r),a=i(1039),l=i(2399),c=i(2786),d=i.n(c),h=i(5130),m=i(3271),p=i(7278),u=i(3184),v=i(2104),f=i(2829),E=i(7274),b=i(7276),S=i(7277),g=i(4625),y=i(3561),I=i(4626),A=i(4196),C=i(7243),O=i(7244),T=i(6247),w=i(40);let _=d()(n=(0,l.observer)(n=class extends s.Component{constructor(e){super(e),this.editCache=null,this.listItemRefs={},this.getItemSize=this.getItemSize.bind(this),this.scrollToItem=this.scrollToItem.bind(this),this.setEditCache=this.setEditCache.bind(this),this.saveCachedValue=this.saveCachedValue.bind(this),this.handleClickOutside=this.handleClickOutside.bind(this),this.focusNext=this.focusNext.bind(this),this.focusPrev=this.focusPrev.bind(this),this.deleteItem=this.deleteItem.bind(this),this.renameItem=this.renameItem.bind(this),this.duplicateItem=this.duplicateItem.bind(this)}componentDidMount(){this.scrollToViewReactionDisposer=(0,a.reaction)((()=>w.get(this.props,"model.activeItemIndex")),(e=>this.scrollToItem(e))),this.resetHeightReactionDisposer=(0,a.reaction)((()=>w.get(this.props,"model.items")),(()=>{this.listRef&&this.listRef.resetAfterIndex(0)}))}componentWillUnmount(){this.scrollToViewReactionDisposer&&this.scrollToViewReactionDisposer(),this.resetHeightReactionDisposer&&this.resetHeightReactionDisposer(),clearTimeout(this.clearCollectionLoadingTimer)}getSidebarEmptyState(){const e=(0,v.getStore)("PermissionStore").can("addEnvironment","workspace",(0,v.getStore)("ActiveWorkspaceStore").id);return s.createElement(C.default,{illustration:s.createElement(p.default,null),title:"You don’t have any environments.",message:"An environment is a set of variables that allows you to switch the context of your requests.",action:e&&{label:"Create Environment",handler:g.createEnvironment}})}getGlobalsListItem(){return s.createElement(f.default,{identifier:"globals"},s.createElement(b.default,{model:this.props.model.globals}))}getItemSize(){return 28}getListItem({style:e,index:t}){const{model:i}=this.props,n=w.get(i,["items",t]);if(!n)return null;const{id:r}=n;return s.createElement(f.default,{identifier:r},s.createElement("div",{style:e},s.createElement(E.default,{ref:e=>{this.listItemRefs[r]=e},key:r,index:t,item:n,model:i,setEditCache:this.setEditCache,editCache:w.get(this.editCache,"index")===t?this.editCache:null})))}getKeyMapHandlers(){return{quit:pm.shortcuts.handle("quit",this.setEditCache.bind(this,null)),select:pm.shortcuts.handle("select",this.saveCachedValue),nextItem:pm.shortcuts.handle("nextItem",this.focusNext),prevItem:pm.shortcuts.handle("prevItem",this.focusPrev),delete:pm.shortcuts.handle("delete",this.deleteItem),rename:pm.shortcuts.handle("rename",this.renameItem),duplicate:pm.shortcuts.handle("duplicate",this.duplicateItem)}}setEditCache(e){this.editCache=e}saveCachedValue(){if(!this.editCache)return;const{index:e,inlineInput:t}=this.editCache,i=w.get(this.props.model,["items",e]),n=(s=t,w.get(s,"inlineInput.value"));var s;i&&!w.isNil(n)&&this.props.model.handleAction(i.id,I.ACTION_TYPE_RENAME,{name:n})}focusNext(e){e&&e.preventDefault(),this.props.model.focusNext()}focusPrev(e){e&&e.preventDefault(),this.props.model.focusPrev()}deleteItem(){this.props.model.handleAction(w.get(this.props.model,"activeItem"),I.ACTION_TYPE_DELETE)}renameItem(){if(!(0,v.getStore)("OnlineStatusStore").userCanSave)return(0,y.showOfflineActionDisabledToast)();w.invoke(this.listItemRefs,[w.get(this.props.model,"activeItem"),"handleEditName"])}duplicateItem(){this.props.model.handleAction(w.get(this.props.model,"activeItem"),I.ACTION_TYPE_DUPLICATE)}handleClickOutside(e){const t="input input-box inline-input"===(e&&e.target&&e.target.className);this.editCache&&!t&&this.saveCachedValue()}scrollToItem(e){!w.isEmpty(this.listRef)&&!w.isNil(e)&&this.listRef.scrollToItem(e)}render(){const{model:e}=this.props,t=w.size(e.items);if(e.isLoading)return s.createElement("div",{className:"env-sidebar-list-container"},this.getGlobalsListItem(),s.createElement(T.default,null));if(w.isEmpty(e.items)){if(w.isEmpty(e.searchQuery))return s.createElement("div",{className:"env-sidebar-list-container"},this.getGlobalsListItem(),this.getSidebarEmptyState());if(!A.GLOBALS.includes(e.searchQuery))return s.createElement(O.default,{searchQuery:e.searchQuery,illustration:s.createElement(p.default,null)})}const i=e=>s.createElement(l.Observer,null,this.getListItem.bind(this,e));return s.createElement(u.default,{keyMap:pm.shortcuts.getShortcuts(),handlers:this.getKeyMapHandlers()},s.createElement("div",{className:"env-sidebar-list-container",onClick:this.handleClickOutside},this.getGlobalsListItem(),s.createElement("div",{className:"env-sidebar-list"},s.createElement(h.default,null,(({height:e,width:n})=>s.createElement(m.VariableSizeList,{height:e,width:n,itemCount:t,itemSize:this.getItemSize,overscanCount:10,ref:e=>{this.listRef=e}},i))))))}})||n)||n;_.propTypes={model:o().instanceOf(S.default).isRequired}},7274:function(e,t,i){i.r(t),i.d(t,{default:function(){return I}});var n,s=i(1),r=i(2399),o=i(2403),a=i.n(o),l=i(2394),c=i.n(l),d=i(2406),h=i(7275),m=i(2104),p=i(4367),u=i(2784),v=i(2829),f=i(4825),E=i(4626),b=i(2833),S=i(4482),g=i(3561),y=i(40);let I=(0,r.observer)(n=class extends s.Component{constructor(e){super(e),this.handleEditName=this.handleEditName.bind(this),this.handleItemSelect=this.handleItemSelect.bind(this),this.handleRenameSubmit=this.handleRenameSubmit.bind(this),this.handleSetActiveEnvironment=this.handleSetActiveEnvironment.bind(this),this.handleRemoveActiveEnvironment=this.handleRemoveActiveEnvironment.bind(this),this.handleDropdownActionSelect=this.handleDropdownActionSelect.bind(this),this.containerRef=this.containerRef.bind(this),this.getStatusIndicators=this.getStatusIndicators.bind(this)}componentDidMount(){this.props.editCache&&this.listItemRef&&(this.handleEditName(),this.listItemRef.setEditState(this.props.editCache.inlineInput))}componentWillUnmount(){const{listItemRef:e}=this;e&&e.isEditing()&&this.props.setEditCache({index:this.props.index,inlineInput:e.getEditState()})}getStatusIndicators(){return s.createElement(f.default,{environment:this.props.item,showForkLabel:!0})}getRightAlignedContainer(e,t){const i=a()({"env-actions-icon-container":!0,isHovered:e||t,isActive:this.props.item.isActive});return s.createElement(s.Fragment,null,s.createElement("div",{className:i},s.createElement(u.Button,{type:"icon",tooltip:"Set inactive",onClick:this.handleRemoveActiveEnvironment,className:"sidebar-action-btn active-env-icon"},s.createElement(d.default,{name:"icon-state-success-fill-small",size:"large",color:"content-color-primary"})),s.createElement(u.Button,{type:"icon",tooltip:"Set active",onClick:this.handleSetActiveEnvironment,className:"sidebar-action-btn inactive-env-icon"},s.createElement(d.default,{name:"icon-state-success-stroke",size:"large",color:"content-color-primary"}))),!e&&!t&&this.props.item.isActive&&s.createElement("div",{className:"env-actions__more-actions-placeholder"}))}getMenuItemIconClasses(e){return a()({"dropdown-menu-item-icon":!0},{"pm-icon":!0},{"pm-icon-normal":!0},`menu-icon--${e}`)}getMenuItems(){const{model:e,item:t}=this.props;return y.map(e.getActions(t.id),(e=>{const t=s.createElement("span",{className:"env-action-item"},s.createElement("div",{className:"dropdown-menu-item-label"},e.label),e.shortcut&&s.createElement("div",{className:"dropdown-menu-item-shortcut"},(0,p.getShortcutByName)(e.shortcut)));return!e.hide&&s.createElement(b.MenuItem,{key:e.type,refKey:e.type,disabled:!e.isEnabled,disabledText:S.DISABLED_IN_SCRATCHPAD_TOOLTIP},e.xpathLabel?s.createElement(v.default,{identifier:e.xpathLabel},t):t)}))}getActionsMenuItems(){return s.createElement(b.DropdownMenu,{className:"env-dropdown-menu","align-right":!0},this.getMenuItems())}containerRef(e){this.listItemRef=e}handleSetActiveEnvironment(){this.props.model.handleAction(this.props.item.id,E.ACTION_TYPE_SET_ACTIVE)}handleRemoveActiveEnvironment(){this.props.model.handleAction(this.props.item.id,E.ACTION_TYPE_SET_ACTIVE,{noEnvironment:!0})}handleEditName(){y.invoke(this.listItemRef,"editText")}async handleRenameSubmit(e){await this.props.model.handleAction(this.props.item.id,E.ACTION_TYPE_RENAME,{name:e}),this.props.setEditCache(null)}async handleDropdownActionSelect(e){if(e===E.ACTION_TYPE_RENAME_TOGGLE)return(0,m.getStore)("OnlineStatusStore").userCanSave?this.handleEditName():(0,g.showOfflineActionDisabledToast)();await this.props.model.handleAction(this.props.item.id,e)}handleItemSelect(){this.props.model.openInTab(this.props.item.id)}render(){const{item:e,model:t}=this.props;return s.createElement(h.default,{ref:this.containerRef,text:e.name,isForked:!(!y.get(e,"attributes.fork.forkId")&&!y.get(e,"attributes.fork.id")),isSelected:t.activeItem===e.id,onClick:this.handleItemSelect,onRename:this.handleRenameSubmit,statusIndicators:this.getStatusIndicators,rightMetaComponent:(...e)=>s.createElement(r.Observer,null,this.getRightAlignedContainer.bind(this,...e)),moreActions:this.getActionsMenuItems(),onActionsDropdownSelect:this.handleDropdownActionSelect})}})||n;I.propTypes={index:c().number.isRequired,item:c().object.isRequired,model:c().object.isRequired,editCache:c().object.isRequired,setEditCache:c().func.isRequired}},7272:function(e,t,i){i.r(t),i.d(t,{default:function(){return d}});var n,s=i(1),r=i(2399),o=i(2104),a=i(7256),l=i(4625),c=i(3562);let d=(0,r.observer)(n=class extends s.Component{constructor(e){super(e),this.state={isEnvCreateEnabled:!0},this.handleCreate=this.handleCreate.bind(this),this.handleSearchChange=this.handleSearchChange.bind(this)}handleCreate(){this.setState({isEnvCreateEnabled:!1}),this.timeoutId&&clearTimeout(this.timeoutId),this.timeoutId=setTimeout((()=>{this.setState({isEnvCreateEnabled:!0})}),1e3),(0,l.createEnvironment)({openInTab:!0})}handleSearchChange(e){this.props.model&&this.props.model.setSearchQuery(e)}render(){const{userCanSave:e}=(0,o.getStore)("OnlineStatusStore"),t=(0,o.getStore)("PermissionStore").can("addEnvironment","workspace",(0,o.getStore)("ActiveWorkspaceStore").id),i=e&&t&&this.state.isEnvCreateEnabled;return s.createElement(a.default,{createNewConfig:{tooltip:e?t?"Create new environment":c.DISABLED_TOOLTIP_NO_PERMISSION:c.DISABLED_TOOLTIP_IS_OFFLINE,disabled:!i,onCreate:this.handleCreate,xPathIdentifier:"addEnvironment"},onSearch:this.handleSearchChange,searchQuery:this.props.model.searchQuery})}})||n},7277:function(e,t,i){i.r(t),i.d(t,{EnvironmentModel:function(){return N},GlobalsModel:function(){return _},default:function(){return R}});var n,s,r,o,a,l,c,d,h,m,p=i(1039),u=i(2104),v=i(2109),f=i(4212),E=i(4213),b=i(1900),S=i(4196),g=i(4625),y=i(6560),I=i(3561),A=i(4626),C=i(40);function O(e,t,i,n){i&&Object.defineProperty(e,t,{enumerable:i.enumerable,configurable:i.configurable,writable:i.writable,value:i.initializer?i.initializer.call(n):void 0})}function T(e,t,i,n,s){var r={};return Object.keys(n).forEach((function(e){r[e]=n[e]})),r.enumerable=!!r.enumerable,r.configurable=!!r.configurable,("value"in r||r.initializer)&&(r.writable=!0),r=i.slice().reverse().reduce((function(i,n){return n(e,t,i)||i}),r),s&&void 0!==r.initializer&&(r.value=r.initializer?r.initializer.call(s):void 0,r.initializer=void 0),void 0===r.initializer&&(Object.defineProperty(e,t,r),r=null),r}const w=["name","createdAt"];let _=(s=T((n=class{constructor(){O(this,"isActive",s,this),this._disposer=(0,p.autorun)((()=>{const e=(0,u.getStore)("EditorStore").find((0,u.getStore)("ActiveWorkspaceSessionStore").activeEditor);e&&e.resource&&e.resource.includes(S.GLOBALS)?this.setFocus(!0):this.setFocus(!1)}))}dispose(){this._disposer()}setFocus(e){this.isActive=e}openInTab(){(0,g.openGlobalsInTab)()}}).prototype,"isActive",[p.observable],{configurable:!0,enumerable:!0,writable:!0,initializer:function(){return!1}}),T(n.prototype,"setFocus",[p.action],Object.getOwnPropertyDescriptor(n.prototype,"setFocus"),n.prototype),n),N=(T((r=class extends y.default{updateName(e){this.update({name:e})}get isActive(){return(0,u.getStore)("ActiveEnvironmentStore").id===(0,b.decomposeUID)(this.id).modelId}}).prototype,"updateName",[p.action],Object.getOwnPropertyDescriptor(r.prototype,"updateName"),r.prototype),T(r.prototype,"isActive",[p.computed],Object.getOwnPropertyDescriptor(r.prototype,"isActive"),r.prototype),r),R=(a=T((o=class{constructor(){O(this,"activeItem",a,this),O(this,"sortBy",l,this),O(this,"searchQuery",c,this),O(this,"$items",d,this),O(this,"isLoading",h,this),O(this,"sharedEnvironments",m,this),this.globals=new _,this._dispose=(0,p.autorun)((()=>{const e=(0,u.getStore)("EditorStore").find((0,u.getStore)("ActiveWorkspaceSessionStore").activeEditor);if(e)if(e.resource.includes(S.ENVIRONMENT)){const t=e.resource.split("/").pop();this.focusItem(t)}else this.resetFocus();else this.resetFocus()})),this.openEntityInTabDebounced=C.debounce((e=>{v.default.transitionTo("build.environment",{eid:e})}),300)}dispose(){this.globals.dispose(),this._dispose()}get filtered(){if(!this.searchQuery.trim())return[...this.$items.values()];const e=C.toLower(this.searchQuery);return C.filter([...this.$items.values()],(t=>C.includes(C.toLower(t.name),e)))}isInActiveWorkspace(e){return C.get((0,u.getStore)("ActiveWorkspaceStore"),"dependencies.environments",[]).includes(e)}get items(){const e=C.filter(this.filtered,(e=>this.isInActiveWorkspace(e.id)));return C.sortBy(e,(e=>e&&[C.toLower(e[this.sortBy]),C.toLower(e.name)]))}get activeItemIndex(){return C.findIndex(this.items,(e=>e.id===this.activeItem))}setSearchQuery(e){this.searchQuery=e}setSortingKey(e){C.includes(w,e)&&(this.sortBy=e)}focusItem(e){e&&(this.activeItem=e)}resetFocus(){this.activeItem=null}setLoading(e){this.isLoading=e}setSharedEnvironments(e){this.sharedEnvironments=new Set(e)}focusNext(){if(!this.activeItem)return;if(C.isEmpty(this.items))return void this.resetFocus();const e=this.items[(this.activeItemIndex+1)%this.items.length].id;this.focusItem(e),this.openEntityInTabDebounced(e)}focusPrev(){if(!this.activeItem||1===C.size(this.items))return;if(C.isEmpty(this.items))return void this.resetFocus();const e=this.activeItemIndex<=0?C.last(this.items).id:this.items[this.activeItemIndex-1].id;this.focusItem(e),this.openEntityInTabDebounced(e)}openInTab(e){this.openEntityInTabDebounced(e)}getActions(e){const t=this.$items.get(e),i=(0,u.getStore)("ActiveWorkspaceStore").id,n=(0,u.getStore)("PermissionStore"),s=(0,u.getStore)("CurrentUserStore"),{userCanSave:r,userCanSaveAndSync:o}=(0,u.getStore)("OnlineStatusStore");return[{type:A.ACTION_TYPE_SHARE,label:"Share environment",isEnabled:o&&t.userCanShare},{type:A.ACTION_TYPE_RENAME_TOGGLE,label:"Rename",shortcut:"rename",isEnabled:r&&t.userCanUpdate},{type:A.ACTION_TYPE_DUPLICATE,label:"Duplicate",shortcut:"duplicate",isEnabled:r&&n.can("addEnvironment","workspace",i)},{type:A.ACTION_TYPE_FORK,label:"Create a Fork",shortcut:"fork",isEnabled:o},{type:A.ACTION_TYPE_PULL_REQUEST,label:"Create Pull Request",isEnabled:!1},{type:A.ACTION_TYPE_MERGE,label:"Merge changes",isEnabled:!1},{type:A.ACTION_MANAGE_ROLES,label:"Manage Roles",isEnabled:o&&!!s.team},{type:A.ACTION_REMOVE_FROM_WORKSPACE,label:"Remove from workspace",isEnabled:o&&n.can("removeEnvironment","workspace",i)},{type:A.ACTION_TYPE_DELETE,label:"Delete",shortcut:"delete",isEnabled:r&&t.userCanDelete}]}async handleAction(e,t,i={}){const n=this.$items.get(e),s=(0,u.getStore)("PermissionStore"),r=(0,u.getStore)("ActiveWorkspaceStore").id,o=(0,u.getStore)("CurrentUserStore");if(t!==A.ACTION_TYPE_SET_ACTIVE){if(t===A.ACTION_TYPE_SHARE)return(0,u.getStore)("OnlineStatusStore").userCanSaveAndSync?n.userCanShare?void(0,f.shareEnvironment)(e,{origin:"sidebar"}):void pm.toasts.error("You do not have permissions to perform this action"):(0,I.showOfflineActionDisabledToast)();if(t===A.ACTION_TYPE_FORK)return(0,u.getStore)("OnlineStatusStore").userCanSaveAndSync?void(0,g.forkEnvironment)(e,{origin:"sidebar"}):(0,I.showOfflineActionDisabledToast)();if(t!==A.ACTION_TYPE_DUPLICATE){if(t===A.ACTION_TYPE_RENAME)return(0,u.getStore)("OnlineStatusStore").userCanSave?(await(0,g.renameEnvironment)(e,i.name),n.updateName(i.name),pm.mediator.trigger("focusSidebar"),void await(0,g.__forceUpdateNameOnDb)(e,i.name)):(0,I.showOfflineActionDisabledToast)();if(t!==A.ACTION_MANAGE_ROLES){if(t===A.ACTION_REMOVE_FROM_WORKSPACE)return(0,u.getStore)("OnlineStatusStore").userCanSaveAndSync?s.can("removeEnvironment","workspace",r)?void pm.mediator.trigger("showRemoveFromWorkspaceModal",e,{type:"environment",origin:"sidebar",disableDelete:!n.userCanDelete,disableShare:!n.userCanShare},(()=>{e===this.activeItem&&this.focusPrev({openEditor:!1}),this.remove(e),(0,g.closeAllEnvironmentTabs)(e)})):void pm.toasts.error("You do not have permissions to perform this action"):(0,I.showOfflineActionDisabledToast)();if(t!==A.ACTION_TYPE_DELETE)pm.logger.warn("EnvironmentSidebarModel~handleAction",`Unhandled action ${t} triggered`);else{if(!(0,u.getStore)("OnlineStatusStore").userCanSave)return(0,I.showOfflineActionDisabledToast)();if(!n.userCanDelete)return void pm.toasts.error("You do not have permissions to perform this action");await(0,g.deleteEnvironment)(e,{name:this.$items.get(e).name})&&(e===this.activeItem&&this.focusPrev({openEditor:!1}),this.remove(e))}}else{if(!(0,u.getStore)("OnlineStatusStore").userCanSaveAndSync)return(0,I.showOfflineActionDisabledToast)();if(!o.team)return;(0,E.manageRolesOnEnvironment)(e,{origin:"sidebar"})}}else{if(!(0,u.getStore)("OnlineStatusStore").userCanSave)return(0,I.showOfflineActionDisabledToast)();const{id:t,name:i}=await(0,g.duplicateEnvironment)(e);this.add({id:t,name:i,attributes:n.attributes})}}else try{n.isActive?await(0,g.setNoActiveEnvironment)():await(0,g.setActiveEnvironment)(e)}catch(e){pm.logger.error("EnvironmentSidebarModel~handleAction",e),pm.toasts.error("There was a error while setting the active environment")}}hydrate(e){e&&e.forEach((e=>{this.$items.set(e.id,new N(e))}))}add(e){Array.isArray(e)||(e=[e]),e.forEach((e=>{e&&e.id&&this.$items.set(e.id,new N(e))}))}update(e){if(!e||!e.id)return;const t=this.$items.get(e.id);t&&t.update(e)}remove(e){Array.isArray(e)||(e=[e]),e.forEach((e=>this.$items.delete(e)))}clear(){this.$items.clear()}}).prototype,"activeItem",[p.observable],{configurable:!0,enumerable:!0,writable:!0,initializer:function(){return null}}),l=T(o.prototype,"sortBy",[p.observable],{configurable:!0,enumerable:!0,writable:!0,initializer:function(){return"name"}}),c=T(o.prototype,"searchQuery",[p.observable],{configurable:!0,enumerable:!0,writable:!0,initializer:function(){return""}}),d=T(o.prototype,"$items",[p.observable],{configurable:!0,enumerable:!0,writable:!0,initializer:function(){return new Map}}),h=T(o.prototype,"isLoading",[p.observable],{configurable:!0,enumerable:!0,writable:!0,initializer:function(){return!0}}),m=T(o.prototype,"sharedEnvironments",[p.observable],{configurable:!0,enumerable:!0,writable:!0,initializer:function(){return new Set}}),T(o.prototype,"filtered",[p.computed],Object.getOwnPropertyDescriptor(o.prototype,"filtered"),o.prototype),T(o.prototype,"items",[p.computed],Object.getOwnPropertyDescriptor(o.prototype,"items"),o.prototype),T(o.prototype,"activeItemIndex",[p.computed],Object.getOwnPropertyDescriptor(o.prototype,"activeItemIndex"),o.prototype),T(o.prototype,"setSearchQuery",[p.action],Object.getOwnPropertyDescriptor(o.prototype,"setSearchQuery"),o.prototype),T(o.prototype,"setSortingKey",[p.action],Object.getOwnPropertyDescriptor(o.prototype,"setSortingKey"),o.prototype),T(o.prototype,"focusItem",[p.action],Object.getOwnPropertyDescriptor(o.prototype,"focusItem"),o.prototype),T(o.prototype,"resetFocus",[p.action],Object.getOwnPropertyDescriptor(o.prototype,"resetFocus"),o.prototype),T(o.prototype,"setLoading",[p.action],Object.getOwnPropertyDescriptor(o.prototype,"setLoading"),o.prototype),T(o.prototype,"setSharedEnvironments",[p.action],Object.getOwnPropertyDescriptor(o.prototype,"setSharedEnvironments"),o.prototype),T(o.prototype,"handleAction",[p.action],Object.getOwnPropertyDescriptor(o.prototype,"handleAction"),o.prototype),T(o.prototype,"hydrate",[p.action],Object.getOwnPropertyDescriptor(o.prototype,"hydrate"),o.prototype),T(o.prototype,"add",[p.action],Object.getOwnPropertyDescriptor(o.prototype,"add"),o.prototype),T(o.prototype,"update",[p.action],Object.getOwnPropertyDescriptor(o.prototype,"update"),o.prototype),T(o.prototype,"remove",[p.action],Object.getOwnPropertyDescriptor(o.prototype,"remove"),o.prototype),T(o.prototype,"clear",[p.action],Object.getOwnPropertyDescriptor(o.prototype,"clear"),o.prototype),o)},7270:function(e,t,i){i.r(t),i.d(t,{default:function(){return d}});var n,s=i(1),r=i(2394),o=i.n(r),a=i(2399),l=i(7271),c=i(7277);let d=(0,a.observer)(n=class extends s.Component{render(){const{controller:e}=this.props;return s.createElement(l.default,{model:e.model})}})||n;d.propTypes={controller:o().shape({model:o().instanceOf(c.default)}).isRequired}},7276:function(e,t,i){i.r(t),i.d(t,{default:function(){return m}});var n,s=i(1),r=i(2399),o=i(2403),a=i.n(o),l=i(2394),c=i.n(l),d=i(7275),h=i(7277);let m=(0,r.observer)(n=class extends s.Component{constructor(e){super(e),this.handleSelect=this.handleSelect.bind(this)}getItemClasses(){return a()({"globals-sidebar-list-item":!0,selected:this.props.model.isActive})}handleSelect(){this.props.model.openInTab()}render(){return s.createElement(s.Fragment,null,s.createElement(d.default,{text:"Globals",isSelected:this.props.model.isActive,onClick:this.handleSelect}),s.createElement("div",{className:"globals-separator"}))}})||n;m.propTypes={model:c().instanceOf(h.GlobalsModel).isRequired}}}]);