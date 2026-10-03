const {contextBridge, ipcRenderer, webUtils} = require('electron');
const workspaceListeners = new Set(); let lastRefresh;
const actions = new Set(['buildReview','animationChannels','reviewModel','applyModelReview','shadowPreview','exportShadowProxy','importShadowProxy','prepareModMerge','applyModMerge','cancelModMerge','exportModPackage','rebuildModelShadow','exportMorphAddon','exportCutscene','prepareCutsceneImport','applyCutsceneImport','cancelCutsceneImport','cutsceneCatalog', 'cutscenePreview', 'reloadSources', 'checkSources', 'textureCatalog', 'textureThumbnails', 'texturePreview', 'replaceLibraryTexture', 'exportLibraryTexture', 'open', 'importModel', 'exportAnimation', 'prepareAnimationImport', 'applyAnimationImport', 'exportMorphWorkspace', 'prepareMorphWorkspace', 'modelTemplates', 'bindMapCollision', 'previewMapCollision', 'collisionInfo', 'worldReference', 'editMap', 'editRoom', 'editCameras', 'mapDraftCount', 'replaceMapTexture', 'exportMapPart', 'importMapPart', 'undoMap', 'openGame', 'openProject', 'saveProject', 'preview', 'motionList', 'motionClip', 'openMotion', 'export', 'replace', 'undo', 'morph', 'extract', 'exportArchive', 'exportAllArchives', 'build', 'snapshot', 'bootstrap']);
contextBridge.exposeInMainWorld('studio', Object.freeze({
  async request(action, args = {}) {
    if (!actions.has(action)) throw new Error('Unknown action');
    const result = await ipcRenderer.invoke('studio:action', action, args);
    if (result?.workspaceRefresh) {
      const refresh = result.workspaceRefresh;
      if (!refresh.id || refresh.id !== lastRefresh) {lastRefresh = refresh.id; for (const callback of workspaceListeners) callback(refresh);}
      return null;
    }
    return result;
  },
  onPrompt(callback) {const handler=(_,value)=>callback(value);ipcRenderer.on('studio:prompt',handler);return ()=>ipcRenderer.removeListener('studio:prompt',handler);},
  answerPrompt(answer) {return ipcRenderer.invoke('studio:prompt-answer',answer);},
  onWorkspace(callback) {workspaceListeners.add(callback); return () => workspaceListeners.delete(callback);},
  droppedFile(file) { return ipcRenderer.invoke('studio:drop', webUtils.getPathForFile(file)); },
  onProgress(callback) { const handler = (_, value) => callback(value); ipcRenderer.on('studio:progress', handler); return () => ipcRenderer.removeListener('studio:progress', handler); },
  onCommand(callback) { const handler = (_, value) => callback(value); ipcRenderer.on('studio:command', handler); return () => ipcRenderer.removeListener('studio:command', handler); }
}));
