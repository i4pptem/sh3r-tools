const {contextBridge, ipcRenderer, webUtils} = require('electron');
const actions = new Set(['open', 'prepareModel', 'exportAnimation', 'importAnimation', 'exportMorphWorkspace', 'prepareMorphWorkspace', 'compactMorphWorkspace', 'modelTemplates', 'rebuildModel', 'editMap', 'mapDraftCount', 'replaceMapTexture', 'exportMapPart', 'importMapPart', 'undoMap', 'openGame', 'openProject', 'saveProject', 'preview', 'motionList', 'motionClip', 'openMotion', 'export', 'replace', 'undo', 'morph', 'extract', 'exportArchive', 'exportAllArchives', 'build', 'snapshot', 'bootstrap']);
contextBridge.exposeInMainWorld('studio', Object.freeze({
  request(action, args = {}) { if (!actions.has(action)) return Promise.reject(new Error('Unknown action')); return ipcRenderer.invoke('studio:action', action, args); },
  droppedFile(file) { return ipcRenderer.invoke('studio:drop', webUtils.getPathForFile(file)); },
  onProgress(callback) { const handler = (_, value) => callback(value); ipcRenderer.on('studio:progress', handler); return () => ipcRenderer.removeListener('studio:progress', handler); },
  onCommand(callback) { const handler = (_, value) => callback(value); ipcRenderer.on('studio:command', handler); return () => ipcRenderer.removeListener('studio:command', handler); }
}));
