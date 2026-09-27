import {parentPort, workerData} from 'node:worker_threads';
import {Workbench} from '../core/workbench.mjs';
const workbench = new Workbench(progress => parentPort.postMessage({progress}), workerData?.cacheFolder);
const allowed = new Set(['open', 'preview', 'importModel', 'exportAnimation', 'importAnimation', 'exportMorphWorkspace', 'prepareMorphWorkspace', 'modelTemplates', 'rebuildModel', 'editMap', 'replaceMapTexture', 'exportMapPart', 'importMapPart', 'undoMap', 'motionList', 'motionClip', 'openMotion', 'snapshot', 'replace', 'undo', 'bakeMorph', 'exportAsset', 'exportArchive', 'exportAllArchives', 'extract', 'saveProject', 'loadProject', 'buildRequirements', 'build']);
parentPort.on('message', async ({id, method, args}) => {
  try {
    if (!allowed.has(method)) throw new Error('Unknown operation.');
    parentPort.postMessage({id, result: await workbench[method](...args)});
  } catch (error) { parentPort.postMessage({id, error: error.message}); }
});
