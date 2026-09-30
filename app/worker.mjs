import {parentPort, workerData} from 'node:worker_threads';
import {Workbench} from '../core/workbench.mjs';
const workbench = new Workbench(progress => parentPort.postMessage({progress}), workerData?.cacheFolder);
const allowed = new Set(['sourceChanges', 'prepareSourceReload', 'reloadSources', 'textureCatalog', 'textureThumbnails', 'texturePreview', 'replaceLibraryTexture', 'exportLibraryTexture', 'open', 'preview', 'importModel', 'exportAnimation', 'prepareAnimationImport', 'applyAnimationImport', 'exportMorphWorkspace', 'prepareMorphWorkspace', 'modelTemplates', 'rebuildModel', 'editMap', 'replaceMapTexture', 'exportMapPart', 'importMapPart', 'undoMap', 'motionList', 'motionClip', 'openMotion', 'snapshot', 'replace', 'undo', 'bakeMorph', 'exportAsset', 'exportArchive', 'exportAllArchives', 'extract', 'saveProject', 'loadProject', 'buildRequirements', 'build']);
let queue = Promise.resolve();
parentPort.on('message', ({id, method, args}) => {
  queue = queue.then(async () => {
  try {
    if (!allowed.has(method)) throw new Error('Unknown operation.');
    if (!['sourceChanges', 'prepareSourceReload', 'reloadSources', 'open', 'loadProject', 'snapshot'].includes(method)) workbench.assertSources();
    parentPort.postMessage({id, result: await workbench[method](...args)});
  } catch (error) { parentPort.postMessage({id, error: {message: error.message, code: error.code}}); }
  });
});
