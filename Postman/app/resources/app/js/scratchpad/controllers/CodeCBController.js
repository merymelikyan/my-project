"use strict";(self.webpackChunk_postman_app_scratchpad=self.webpackChunk_postman_app_scratchpad||[]).push([[18],{12624:function(e,t,a){a.r(t),a.d(t,{default:function(){return s}});var i,r=a(6604),n=a(2104),o=a(1039);let s=(l=(i=class{get editor(){let e=(0,n.getStore)("ActiveWorkspaceSessionStore").activeEditor,t=(0,n.getStore)("EditorStore").find(e);return t&&t.model}didCreate(){var e=(0,n.getStore)("ActiveWorkspaceSessionStore").activeEditor,t=(0,n.getStore)("EditorStore").find(e).id;this.editorId=t,this.getLanguageList()}getLanguageList(){let e,t,a=[],i={};r.default.getLanguages().then((r=>{e=r,e&&e.length&&(e.forEach((e=>{e.variants&&e.variants.length&&(e.variants.length>1?e.variants.forEach((r=>{t=e.label+" - "+r.key,a.push({id:JSON.stringify({language:e.key,variant:r.key}),name:t}),i[`${e.key}_${r.key}`]={displayName:t,editorMode:e.syntax_mode}})):(t=e.label.toLowerCase()!==e.variants[0].key.toLowerCase()?e.label+" - "+e.variants[0].key:e.label,a.push({id:JSON.stringify({language:e.key,variant:e.variants[0].key}),name:t}),i[`${e.key}_${e.variants[0].key}`]={displayName:t,editorMode:e.syntax_mode}))})),this.languageList=a,this.labelEditorMap=i)}))}}).prototype,d="editor",c=[o.computed],u=Object.getOwnPropertyDescriptor(i.prototype,"editor"),g=i.prototype,p={},Object.keys(u).forEach((function(e){p[e]=u[e]})),p.enumerable=!!p.enumerable,p.configurable=!!p.configurable,("value"in p||p.initializer)&&(p.writable=!0),p=c.slice().reverse().reduce((function(e,t){return t(l,d,e)||e}),p),g&&void 0!==p.initializer&&(p.value=p.initializer?p.initializer.call(g):void 0,p.initializer=void 0),void 0===p.initializer&&(Object.defineProperty(l,d,p),p=null),i);var l,d,c,u,g,p}}]);