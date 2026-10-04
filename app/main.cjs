const {app, BrowserWindow, dialog, ipcMain, Menu, protocol, net, session, shell} = require('electron');
const {Worker} = require('node:worker_threads');
const createFileDialogs = require('./file-dialogs.cjs');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

protocol.registerSchemesAsPrivileged([{scheme: 'sh3tools', privileges: {standard: true, secure: true, supportFetchAPI: true, stream: true}}]);
if (process.env.SH3TOOLS_USER_DATA) app.setPath('userData', path.resolve(process.env.SH3TOOLS_USER_DATA));
let mapDraftCount = 0, saveBeforeClose = false, closeApproved = false;
let window, worker, nextId = 1, changed = 0, opening, busy = false, fileDialogs;
const mediaFiles = new Map(); let mediaId = 0;
const pending = new Map(), root = path.join(__dirname, '..');
function call(method, ...args) {
  return new Promise((resolve, reject) => {const id = nextId++; pending.set(id, {resolve, reject}); worker.postMessage({id, method, args});});
}
function validateSender(event) {
  if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !event.senderFrame.url.startsWith('sh3tools://app/')) throw new Error('Untrusted request.');
}
const prompts=require('./app-prompts.cjs')(ipcMain,()=>window,validateSender);
async function confirmDiscard() {
  if (!changed && !mapDraftCount) return true;
  const {response} = await prompts.ask( {type: 'question', title: 'Unsaved replacements', message: 'Discard staged replacements?', detail: mapDraftCount ? 'There are unapplied map preview edits. Apply them before saving a project.' : 'Save a project first to continue editing later.', buttons: ['Keep editing', 'Discard'], defaultId: 0, cancelId: 0});
  return response === 1;
}
function remember(snapshot) {
  if (snapshot?.entries) {changed = snapshot.changes.length; opening = snapshot.input;}
  return snapshot;
}
async function pickFile(group, filters, properties = ['openFile'], options = {}) {
  const result = await fileDialogs.open(group, {...options, properties, filters});
  return result.canceled ? null : result.filePaths[0];
}
async function chooseNewFile(group, defaultPath, extensions, filters) {
  const result = await fileDialogs.save(group, {defaultPath, filters: filters || [{name: 'Output file', extensions}], properties: ['createDirectory', 'showOverwriteConfirmation']});
  if (result.canceled) return null;
  if (fs.existsSync(result.filePath)) throw new Error('Choose a new filename. Existing exports are preserved.');
  return result.filePath;
}
function assetDialogGroup(mode) {
  return {cameraJson:'maps', world:'maps', mapGlb:'maps', messages:'messages', font:'textures', fontHires:'textures',
    worldTexture:'textures', texture:'textures', textureExperimental:'textures', glb:'models', fbx:'models', blend:'models',
    morph:'models', movie:'movies', webm:'movies', audio:'audio'}[mode] || 'assets';
}
let reloadDialog = null, declinedSources = '';
async function offerSourceReload(quiet = false) {
  if (reloadDialog) return reloadDialog;
  reloadDialog = (async () => {
    const files = await call('sourceChanges'), signature = JSON.stringify(files);
    if (quiet && (!files.length || signature === declinedSources)) return null;
    let plan;
    try {plan = await call('prepareSourceReload');}
    catch (error) {
      await prompts.ask( {type: 'warning', title: 'Sources cannot be reloaded yet', message: 'The updated sources could not be opened.', detail: `${error.message}\n\nYour current workspace and staged replacements have been kept. Finish copying the files, then use Reload sources again.`, buttons: ['Keep current workspace']});
      return {workspaceRefresh: {reloaded: false}};
    }
    const list = files.slice(0, 8).map(file => file.name).join('\n');
    const conflicts = plan.conflicts.slice(0, 8).map(item => `${item.name}: ${item.reason}`).join('\n');
    const destructive = plan.conflicts.length || mapDraftCount;
    const detail = [list, files.length > 8 ? `… and ${files.length - 8} more sources.` : '',
      `${plan.kept} staged replacement(s) will be kept. ${plan.installed.length} already installed replacement(s) will be marked as saved.`,
      conflicts ? `${plan.conflicts.length} conflicting replacement(s) will be discarded:\n${conflicts}` : '',
      mapDraftCount ? `${mapDraftCount} unapplied map preview edit(s) will be discarded.` : '',
      'The source files will not be modified. After reloading, repeat the operation you were performing.'].filter(Boolean).join('\n\n');
    const {response} = await prompts.ask( {type: destructive ? 'warning' : 'question', title: 'Sources changed',
      message: files.length ? 'The game archives or files changed. Reload them?' : 'Reload the current archives and files?', detail,
      buttons: ['Keep current workspace', destructive ? 'Reload and discard conflicts' : 'Reload sources'], defaultId: destructive ? 0 : 1, cancelId: 0, noLink: true});
    if (response !== 1) {declinedSources = signature; return {workspaceRefresh: {reloaded: false}};}
    const snapshot = remember(await call('reloadSources', plan.token, !!plan.conflicts.length));
    declinedSources = ''; mapDraftCount = 0; mediaFiles.clear();
    return {workspaceRefresh: {id: plan.token, reloaded: true, snapshot}};
  })();
  try {return await reloadDialog;} finally {reloadDialog = null;}
}
async function operation(action, args) {
  if (action === 'checkSources' || action === 'reloadSources') return offerSourceReload(action === 'checkSources');
  if (action === 'mapDraftCount') {if(!Number.isSafeInteger(args.count) || args.count<0) throw new Error('Invalid draft count.'); mapDraftCount=args.count; return null;}
  if (action === 'bootstrap') return {version: app.getVersion(), source: opening};
  if (action === 'snapshot') return call('snapshot');
  if (action === 'prepareBatchReplace') {
    const folder = await pickFile(args.kind === 'audio' ? 'audio' : 'textures', [], ['openDirectory'], {title: 'Choose replacement folder'});
    return folder ? call('prepareBatchReplace', folder, {kind: args.kind, archive: args.archive, mode: args.mode}) : null;
  }
  if (action === 'applyBatchReplace') return remember(await call('applyBatchReplace', args.token, args.ids));
  if (action === 'cancelBatchReplace') return call('cancelBatchReplace', args.token);
  if(action==='prepareModMerge') {
    const {response}=await prompts.ask({title:'Merge mods',message:'Choose mods to compare with the open original files.',detail:'Merge replacement assets from mod packages, saved projects or existing builds. Open a clean game as the base. Conflicts are reviewed before staging. Executables and loader DLLs are regenerated by Build mod when required.',buttons:['Mod files…','Mod folder…','Cancel'],cancelId:2});
    if(response===2)return null;
    const result=await fileDialogs.open('mods',{properties:response===1?['openDirectory']:['openFile','multiSelections'],filters:response===1?[]:[{name:'SH3 mods, projects, archives or build manifest',extensions:['sh3mod','sh3project','arc','afs','json']}]});
    if(result.canceled)return null;return call('prepareModMerge',result.filePaths);
  }
  if(action==='applyModMerge')return remember(await call('applyModMerge',args.token,args.choices));
  if(action==='cancelModMerge')return call('cancelModMerge',args.token);
  if(action==='exportModPackage'){const file=await chooseNewFile('mods', 'Mod.sh3mod',['sh3mod']);return file?call('exportModPackage',file):null;}
  if(action==='rebuildModelShadow')return remember(await call('rebuildModelShadow',args.key));
  if(action==='exportMorphAddon'){const file=await chooseNewFile('blender-addon', 'sh3_morph_transfer.py',['py']);if(!file)return null;fs.copyFileSync(path.join(root,'tools/blender/sh3_morph_transfer.py'),file,fs.constants.COPYFILE_EXCL);return {file};}
  if(action==='prepareCutsceneImport'){const file=await pickFile('cutscenes', [{name:'Exported SH3 cutscene',extensions:['blend']}]);return file?call('prepareCutsceneImport',args.id,file):null;}
  if(action==='cancelCutsceneImport')return call('cancelCutsceneImport',args.token);
  if(action==='applyCutsceneImport')return remember(await call('applyCutsceneImport',args.id,args.token,args.options));
  if(action==='exportCutscene'){const file=await chooseNewFile('cutscenes', 'Cutscene.blend',['blend']);return file?call('exportCutscene',args.id,args.options,file):null;}
  if (action === 'cutsceneCatalog') return call('cutsceneCatalog',!!args.force);
  if (action === 'cutscenePreview') {
    const scene=await call('cutscenePreview',args.id,args.options);
    if(scene.audioFile){const id=String(++mediaId);mediaFiles.set(id,scene.audioFile);scene.audio='sh3tools://app/media/'+id;delete scene.audioFile;}
    return scene;
  }
  if (action === 'preview') {
    const preview = await call('preview', args.key, args.audioIndex || 0);
    if (preview.videoFile) {const id = String(++mediaId); mediaFiles.set(id, preview.videoFile); preview.video = 'sh3tools://app/media/' + id; delete preview.videoFile;}
    return preview;
  }
  if (action === 'exportAnimation') {
    const file=await chooseNewFile('animations', 'Animation_'+args.start+'-'+args.end+'.blend',['blend','fbx'],[{name:'Blender animation (recommended)',extensions:['blend']},{name:'FBX animation',extensions:['fbx']}]);
    return file?call('exportAnimation',args.key,args.id,args.start,args.end,args.fps,file):null;
  }
  if (action === 'prepareAnimationImport') {
    const file=await pickFile('animations', [{name:'SH3 animation or Blender scene',extensions:['fbx','blend']}]);
    return file?call('prepareAnimationImport',args.key,args.id,file):null;
  }
  if (action === 'applyAnimationImport') return remember(await call('applyAnimationImport',args.key,args.id,args.token,args.options));
  if (action === 'exportMorphWorkspace') {
    const file=await chooseNewFile('models', 'Morph workspace.blend',['blend']);return file?call('exportMorphWorkspace',args.key,file):null;
  }
  if (action === 'prepareMorphWorkspace') {
    const file=await pickFile('models', [{name:'SH3 morph workspace',extensions:['blend']}]);return file?call('prepareMorphWorkspace',args.key,file):null;
  }
  if (action === 'importModel') {
    const file = await pickFile('models', [{name: 'Model with rig, shape keys and textures (GLB / GLTF / FBX / Blender)', extensions: ['glb', 'gltf', 'fbx', 'blend']}]);
    return file ? remember(await call('importModel', args.key, file)) : null;
  }
  if (action === 'modelTemplates') {
    const file=await pickFile('models', [{name:'Original model templates',extensions:['mdl','mdl_']}]);
    return file ? call('modelTemplates',args.key,args.token,file) : null;
  }
  if (action === 'editCameras') return remember(await call('editCameras', args.key, args.hash, args.edits));
  if (action === 'worldReference') return call('worldReference',args.key,args.target);
  if (action === 'collisionInfo') return call('collisionInfo',args.key,args.target);
  if (action === 'previewMapCollision') return call('previewMapCollision',args.key,args.hash,args.options);
  if (action === 'bindMapCollision') return remember(await call('bindMapCollision',args.key,args.hash,args.options));
  if (action === 'editRoom') return remember(await call('editRoom',args.key,args.hash,args.edits,args.references));
  if (action === 'editMap') return remember(await call('editMap', args.key, args.hash, args.edits));
  if (action === 'textureCatalog') return call('textureCatalog', !!args.force);
  if (action === 'textureThumbnails') return call('textureThumbnails', args.ids);
  if (action === 'texturePreview') return call('texturePreview', args.id);
  if (action === 'replaceLibraryTexture') {
    const file = await pickFile('textures', [{name: 'Replacement texture', extensions: ['png']}]);
    return file ? remember(await call('replaceLibraryTexture', args.id, args.hash, file, args.mode)) : null;
  }
  if (action === 'exportLibraryTexture') {
    const file = await chooseNewFile('textures', path.basename(args.name || 'Texture') + '.png', ['png']);
    return file ? call('exportLibraryTexture', args.id, args.hash, file) : null;
  }
  if (action === 'replaceMapTexture') {
    const file = await pickFile('textures', [{name:'Map material image',extensions:['png']}]);
    return file ? remember(await call('replaceMapTexture',args.key,args.hash,args.textureIndex,file,args.mode)) : null;
  }
  if (action === 'exportMapPart') {
    const file = await chooseNewFile('maps', (args.part || 'Map_part')+'.glb',['glb']);
    return file ? call('exportMapPart',args.key,args.part,file) : null;
  }
  if (action === 'importMapPart') {
    const file = await pickFile('maps', [{name:'Replacement map part',extensions:['glb']}]);
    return file ? remember(await call('importMapPart',args.key,args.hash,args.part,file)) : null;
  }
  if (action === 'undoMap') return remember(await call('undoMap', args.key));
  if (action === 'buildReview') return call('buildReview');
  if(action==='animationChannels')return call('animationChannels',args.key,args.id);
  if(action==='reviewModel')return call('reviewModel',args.key,args.token,args.selection);
  if(action==='applyModelReview')return remember(await call('applyModelReview',args.key,args.token,args.reviewHash));

  if(action==='shadowPreview')return call('shadowPreview',args.key);
  if(action==='exportShadowProxy'){const file=await chooseNewFile('shadows', 'Shadow-proxy.glb',['glb']);return file?call('exportShadowProxy',args.key,file):null;}
  if(action==='importShadowProxy'){const file=args.pickFile?await pickFile('shadows', [{name:'Edited shadow proxy',extensions:['glb']}]):null;if(args.pickFile&&!file)return null;return remember(await call('importShadowProxy',args.key,args.hash,file,args.decisions));}
  if (action === 'motionList') return call('motionList', args.key);
  if (action === 'motionClip') return call('motionClip', args.key, args.id);
  if (action === 'openMotion') {
    const sourceFolder = opening ? (fs.statSync(opening).isDirectory() ? opening : path.dirname(opening)) : undefined;
    const defaultPath = sourceFolder ? path.join(sourceFolder, 'sound', 'demo_afs') : undefined;
    const result = await fileDialogs.open('animations', {title: 'Open motion for the selected model', defaultPath,
      properties: ['openFile'], filters: [{name: 'Animation or cutscene archive', extensions: ['anm', 'anm_', 'afs', 'pack', 'bin']}]});
    return result.canceled ? null : call('openMotion', args.key, result.filePaths[0]);
  }
  if (action === 'open' || action === 'openGame' || action === 'openProject') {
    if (!(await confirmDiscard())) return null;
    const file = action === 'openGame' ? await pickFile('game-data', [], ['openDirectory']) : await pickFile(action === 'openProject' ? 'projects' : 'archives', [{name: action === 'openProject' ? 'Silent Hill 3 Tools project' : 'Silent Hill archives', extensions: action === 'openProject' ? ['sh3project'] : ['arc', 'afs', '000']}]);
    return file ? remember(await call(action === 'openProject' ? 'loadProject' : 'open', file)) : null;
  }
  if (action === 'saveProject') {
    const closing=saveBeforeClose&&args.closeAfterSave===true;
    try {
      const file=await chooseNewFile('projects', 'My mod.sh3project',['sh3project']);if(!file)return null;
      const result=await call('saveProject',file,args.drafts||[]);
      if(result.snapshot)remember(result.snapshot);
      if(closing){closeApproved=true;setImmediate(()=>window.close());}
      return result;
    } finally {saveBeforeClose=false;}
  }
  if (action === 'undo') return remember(await call('undo', args.key));
  if (action === 'morph') return remember(await call('bakeMorph', args.key, args.target, args.factor));
  if (action === 'replace') {
    const formats = {cameraJson: ['json'], mapGlb: ['glb'], messages: ['json'], font: ['png'], fontHires: ['png'], movie: ['mpg', 'mpeg', 'mp4', 'mkv', 'avi', 'mov', 'webm', '000'], audio: ['wav', 'flac', 'mp3', 'ogg'], morph: ['json'], texture: ['png'], textureExperimental: ['png'], native: ['*']};
    if (!formats[args.mode]) throw new Error('Invalid import mode.');
    const file = await pickFile(assetDialogGroup(args.mode), [{name: 'Replacement asset', extensions: formats[args.mode]}]);
    return file ? remember(await call('replace', args.key, file, args.mode, args.textureIndex || 0)) : null;
  }
  if (action === 'export') {
    const snapshot = await call('snapshot'), entry = snapshot.entries.find(e => e.key === args.key);
    if (!entry) throw new Error('Select an asset.');
    const extensions = {world: 'json', messages: 'json', font: 'png', worldTexture: 'png', movie: 'mpg', webm: 'webm', audio: 'wav', glb: 'glb', fbx: 'fbx', blend: 'blend', morph: 'json', texture: 'png', native: entry.extension || 'bin'}, extension = extensions[args.mode];
    if (!extension) throw new Error('Invalid export mode.');
    const base = path.basename(entry.name, path.extname(entry.name));
    const file = await chooseNewFile(assetDialogGroup(args.mode), `${base}${args.mode === 'texture' ? '_texture_' + (args.textureIndex || 0) : args.mode === 'morph' ? '_morphs' : ''}.${extension}`, [extension]);
    return file ? call('exportAsset', args.key, file, args.mode, args.textureIndex || 0) : null;
  }
  if (['extract', 'exportArchive', 'exportAllArchives', 'build'].includes(action)) {
    if(action==='build'){if(mapDraftCount)throw new Error('Apply or discard pending room edits before building.');await call('validateBuildReview',args.reviewToken);}
    const parent = await pickFile(action === 'build' ? 'builds' : 'exports', [], ['openDirectory', 'createDirectory']); if (!parent) return null;
    const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
    const folder = path.join(parent, `SH3-${action === 'build' ? 'Build' : 'Export'}-${timestamp}`);
    if (action === 'extract') return call('extract', args.keys, folder);
    if (action === 'exportArchive') return call('exportArchive', args.archive, folder, args.mode);
    if (action === 'exportAllArchives') return call('exportAllArchives', folder, args.mode);
    const requirements = await call('buildRequirements'); let executable = requirements.executable;
    const {response, checkboxChecked} = await prompts.ask( {
      type: 'question', title: 'Build mod', message: 'How should this mod be installed?',
      detail: 'ASI overlay (experimental): keep the original sh3.exe and data folder. Only changed archive entries are included; unchanged data is read from your original archives. Files load from plugins/SH3Tools/data through SH3Tools.dll and its small ASI loader. Required patches apply in memory. Requires Ultimate ASI Loader 9.7.0+ (Win32).\n\nReplace game files: create replacement archives and a patched executable when needed, as in previous versions.',
      buttons: ['ASI overlay', 'Replace game files', 'Cancel'], defaultId: 0, cancelId: 2, noLink: true,
      checkboxLabel: 'Include ASI Loader 9.7.0 (download once, then use the cache)', checkboxChecked: true,
    });
    if (response === 2) return null;
    const mode = response === 0 ? 'overlay' : 'replace'; let loader;
    if (mode === 'overlay') {
      const {createHash} = require('node:crypto'), profile = require('../core/morph-runtime-profile.json');
      const supported = file => file && profile.originalHashes.includes(createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
      if (!supported(executable)) {
        const selected = await fileDialogs.open('game-executable', {title: 'Choose the original, unmodified sh3.exe', defaultPath: executable, properties: ['openFile'], filters: [{name: 'Original Silent Hill 3 executable', extensions: ['exe']}]});
        if (selected.canceled) return null;
        executable = selected.filePaths[0];
        if (!supported(executable)) throw new Error('ASI overlay needs a supported original sh3.exe. Select your unmodified backup, and restore that original in the game before using the mod.');
      }
      if (checkboxChecked) {
        window.webContents.send('studio:progress', {message: 'Preparing Ultimate ASI Loader 9.7.0…'});
        const {prepareAsiLoader} = await import('../core/asi-overlay.mjs');
        loader = await prepareAsiLoader(path.join(app.getPath('userData'), 'cache'));
      }
    }
    if (mode === 'replace' && requirements.requiresRuntimePatch && !executable) {
      executable = await pickFile('game-executable', [{name: 'Silent Hill 3 executable', extensions: ['exe']}]); if (!executable) return null;
    }
    await call('validateBuildReview',args.reviewToken);
    const result = await call('build', folder, executable, {mode, loader});
    const folderWarning = await shell.openPath(result.folder);
    return {...result, folderWarning};
  }
  throw new Error('Unknown action.');
}
async function execute(event, action, args) {
  validateSender(event);
  const exclusive = !['preview', 'worldReference', 'snapshot', 'bootstrap', 'motionList', 'motionClip', 'mapDraftCount', 'texturePreview', 'textureThumbnails'].includes(action);
  if (busy && exclusive) throw new Error('Wait for the current operation.');
  if (exclusive) busy = true;
  try { return await operation(action, args); }
  catch (error) {if (error.code === 'SOURCE_CHANGED') return await offerSourceReload(); throw error;}
  finally {if (exclusive) busy = false;}
}
app.whenReady().then(async () => {
  fileDialogs = createFileDialogs({dialog, parent: () => window, userData: app.getPath('userData'), defaultDirectory: app.getPath('documents')});
  protocol.handle('sh3tools', request => {
    const url = new URL(request.url);
    if (url.host === 'app' && url.pathname.startsWith('/media/')) {
      const file = mediaFiles.get(url.pathname.slice(7));
      if (!file) return new Response('Not found', {status: 404});
      return net.fetch(pathToFileURL(file).toString(), {headers: request.headers});
    }
    const file = path.resolve(__dirname, 'ui', '.' + decodeURIComponent(url.pathname));
    if (url.host !== 'app' || !file.startsWith(path.resolve(__dirname, 'ui') + path.sep)) return new Response('Forbidden', {status: 403});
    return net.fetch(pathToFileURL(file).toString());
  });
  session.defaultSession.setPermissionRequestHandler((_, __, callback) => callback(false));
  worker = new Worker(path.join(__dirname, 'worker.mjs'), {workerData: {cacheFolder: path.join(app.getPath('userData'), 'media-cache')}});
  worker.on('message', ({id, result, error, progress}) => {
    if (progress) {if (!window.isDestroyed()) window.webContents.send('studio:progress', progress); return;}
    const request = pending.get(id); if (!request) return; pending.delete(id); error ? request.reject(Object.assign(new Error(error.message), {code: error.code})) : request.resolve(result);
  });
  worker.on('error', error => {for (const request of pending.values()) request.reject(error); pending.clear();});
  window = new BrowserWindow({width: 1560, height: 960, minWidth: 1120, minHeight: 720, show: process.env.SH3TOOLS_TEST !== '1',
    title: 'Silent Hill 3 Tools', icon: path.join(__dirname, 'ui', 'logo.png'), backgroundColor: '#141517', autoHideMenuBar: true,
    webPreferences: {preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true}});
  window.on('closed',()=>prompts.cancel());
  window.webContents.on('render-process-gone',()=>prompts.cancel());
  window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.on('close', event => {
    if (closeApproved || process.env.SH3TOOLS_TEST === '1') return;
    if (changed || mapDraftCount || busy) {
      event.preventDefault();
      if (prompts.active || saveBeforeClose) return;
      if (busy) {prompts.ask( {message: 'Wait for the current operation to finish.', buttons: ['OK']}); return;}
      prompts.ask({title:'Save project before closing?',message:'Would you like to save your project?',
        detail:mapDraftCount?'Pending room edits will be validated and applied before saving. If any edit cannot be applied, the window will stay open with your work intact.':'Save a project to keep your staged replacements and continue editing later.',
        buttons:['Save', 'Don’t save', 'Cancel'],defaultId:0,cancelId:2}).then(({response})=>{
          if(response===0){saveBeforeClose=true;window.webContents.send('studio:command','saveAndClose');}
          else if(response===1){closeApproved=true;window.close();}
        });
    }
  });
  const command = action => () => window.webContents.send('studio:command', action);
  Menu.setApplicationMenu(Menu.buildFromTemplate([{label: 'File', submenu: [
    {label: 'Open archive…', accelerator: 'CmdOrCtrl+O', click: command('open')},
    {label: 'Open data folder…', click: command('openGame')},
    {label: 'Open project…', click: command('openProject')},
    {label: 'Reload sources…', accelerator: 'CmdOrCtrl+R', click: command('reloadSources')},
    {label: 'Save project as…', accelerator: 'CmdOrCtrl+Shift+S', click: command('saveProject')},
    {type: 'separator'}, {label: 'Build mod…', accelerator: 'CmdOrCtrl+B', click: command('build')}, {role: 'quit'}]},
    {label: 'View', submenu: [{role: 'resetZoom'}, {role: 'zoomIn'}, {role: 'zoomOut'}, {role: 'togglefullscreen'}]}]));
  ipcMain.handle('studio:action', execute);
  ipcMain.handle('studio:drop', async (event, file) => {
    validateSender(event); if (busy) throw new Error('Wait for the current operation.');
    if (!(await confirmDiscard())) return null;
    if (!/\.(arc|afs|000|sh3project)$/i.test(file)) throw new Error('Drop an ARC, AFS, movie .000 or .sh3project file.');
    busy = true; try {return remember(await call(file.endsWith('.sh3project') ? 'loadProject' : 'open', file));} finally {busy = false;}
  });
  const startup = process.argv.find(arg => arg.startsWith('--open='));
  if (startup) remember(await call('open', startup.slice(7)));
  await window.loadURL('sh3tools://app/index.html');
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => worker?.terminate());
