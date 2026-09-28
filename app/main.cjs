const {app, BrowserWindow, dialog, ipcMain, Menu, protocol, net, session, shell} = require('electron');
const {Worker} = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

protocol.registerSchemesAsPrivileged([{scheme: 'sh3tools', privileges: {standard: true, secure: true, supportFetchAPI: true, stream: true}}]);
if (process.env.SH3TOOLS_USER_DATA) app.setPath('userData', path.resolve(process.env.SH3TOOLS_USER_DATA));
let mapDraftCount = 0;
let window, worker, nextId = 1, changed = 0, opening, busy = false, lastDialogDirectory;
const mediaFiles = new Map(); let mediaId = 0;
const pending = new Map(), root = path.join(__dirname, '..');
function call(method, ...args) {
  return new Promise((resolve, reject) => {const id = nextId++; pending.set(id, {resolve, reject}); worker.postMessage({id, method, args});});
}
function validateSender(event) {
  if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !event.senderFrame.url.startsWith('sh3tools://app/')) throw new Error('Untrusted request.');
}
async function confirmDiscard() {
  if (!changed && !mapDraftCount) return true;
  const {response} = await dialog.showMessageBox(window, {type: 'question', title: 'Unsaved replacements', message: 'Discard staged replacements?', detail: mapDraftCount ? 'There are unapplied map preview edits. Apply them before saving a project.' : 'Save a project first to continue editing later.', buttons: ['Keep editing', 'Discard'], defaultId: 0, cancelId: 0});
  return response === 1;
}
function remember(snapshot) {
  if (snapshot?.entries) {changed = snapshot.changes.length; opening = snapshot.input;}
  return snapshot;
}
async function pickFile(filters, properties = ['openFile']) {
  const result = await dialog.showOpenDialog(window, {properties, filters, defaultPath: lastDialogDirectory});
  if (result.canceled) return null;
  lastDialogDirectory = properties.includes('openDirectory') ? result.filePaths[0] : path.dirname(result.filePaths[0]);
  return result.filePaths[0];
}
async function chooseNewFile(defaultPath, extensions) {
  const result = await dialog.showSaveDialog(window, {defaultPath: lastDialogDirectory ? path.join(lastDialogDirectory, defaultPath) : defaultPath, filters: [{name: 'Output file', extensions}], properties: ['createDirectory', 'showOverwriteConfirmation']});
  if (result.canceled) return null;
  if (fs.existsSync(result.filePath)) throw new Error('Choose a new filename. Existing exports are preserved.');
  lastDialogDirectory = path.dirname(result.filePath);
  return result.filePath;
}
async function operation(action, args) {
  if (action === 'mapDraftCount') {if(!Number.isSafeInteger(args.count) || args.count<0) throw new Error('Invalid draft count.'); mapDraftCount=args.count; return null;}
  if (action === 'bootstrap') return {version: app.getVersion(), source: opening};
  if (action === 'snapshot') return call('snapshot');
  if (action === 'preview') {
    const preview = await call('preview', args.key, args.audioIndex || 0);
    if (preview.videoFile) {const id = String(++mediaId); mediaFiles.set(id, preview.videoFile); preview.video = 'sh3tools://app/media/' + id; delete preview.videoFile;}
    return preview;
  }
  if (action === 'exportAnimation') {
    const file=await chooseNewFile('Animation_'+args.start+'-'+args.end+'.fbx',['fbx']);
    return file?call('exportAnimation',args.key,args.id,args.start,args.end,args.fps,file):null;
  }
  if (action === 'importAnimation') {
    const file=await pickFile([{name:'SH3 animation with custom properties',extensions:['fbx']}]);
    return file?remember(await call('importAnimation',args.key,args.id,file)):null;
  }
  if (action === 'exportMorphWorkspace') {
    const file=await chooseNewFile('Morph workspace.blend',['blend']);return file?call('exportMorphWorkspace',args.key,file):null;
  }
  if (action === 'prepareMorphWorkspace') {
    const file=await pickFile([{name:'SH3 morph workspace',extensions:['blend']}]);return file?call('prepareMorphWorkspace',args.key,file):null;
  }
  if (action === 'importModel') {
    const file = await pickFile([{name: 'Model with rig, shape keys and textures (GLB / GLTF / FBX)', extensions: ['glb', 'gltf', 'fbx']}]);
    return file ? remember(await call('importModel', args.key, file)) : null;
  }
  if (action === 'modelTemplates') {
    const file=await pickFile([{name:'Original model templates',extensions:['mdl','mdl_']}]);
    return file ? call('modelTemplates',args.key,args.token,file) : null;
  }
  if (action === 'editMap') return remember(await call('editMap', args.key, args.hash, args.edits));
  if (action === 'textureCatalog') return call('textureCatalog', !!args.force);
  if (action === 'textureThumbnails') return call('textureThumbnails', args.ids);
  if (action === 'texturePreview') return call('texturePreview', args.id);
  if (action === 'replaceLibraryTexture') {
    const file = await pickFile([{name: 'Replacement texture', extensions: ['png']}]);
    return file ? remember(await call('replaceLibraryTexture', args.id, args.hash, file, args.mode)) : null;
  }
  if (action === 'exportLibraryTexture') {
    const file = await chooseNewFile(path.basename(args.name || 'Texture') + '.png', ['png']);
    return file ? call('exportLibraryTexture', args.id, args.hash, file) : null;
  }
  if (action === 'replaceMapTexture') {
    const file = await pickFile([{name:'Map material image',extensions:['png']}]);
    return file ? remember(await call('replaceMapTexture',args.key,args.hash,args.textureIndex,file)) : null;
  }
  if (action === 'exportMapPart') {
    const file = await chooseNewFile((args.part || 'Map_part')+'.glb',['glb']);
    return file ? call('exportMapPart',args.key,args.part,file) : null;
  }
  if (action === 'importMapPart') {
    const file = await pickFile([{name:'Replacement map part',extensions:['glb']}]);
    return file ? remember(await call('importMapPart',args.key,args.hash,args.part,file)) : null;
  }
  if (action === 'undoMap') return remember(await call('undoMap', args.key));
  if (action === 'rebuildModel') return remember(await call('rebuildModel', args.key, args.token, args.selection));
  if (action === 'motionList') return call('motionList', args.key);
  if (action === 'motionClip') return call('motionClip', args.key, args.id);
  if (action === 'openMotion') {
    const defaultPath = opening ? path.join(path.dirname(opening), 'sound', 'demo_afs') : undefined;
    const result = await dialog.showOpenDialog(window, {title: 'Open motion for the selected model', defaultPath,
      properties: ['openFile'], filters: [{name: 'Animation or cutscene archive', extensions: ['anm', 'anm_', 'afs', 'pack', 'bin']}]});
    return result.canceled ? null : call('openMotion', args.key, result.filePaths[0]);
  }
  if (action === 'open' || action === 'openGame' || action === 'openProject') {
    if (!(await confirmDiscard())) return null;
    const file = action === 'openGame' ? await pickFile([], ['openDirectory']) : await pickFile([{name: action === 'openProject' ? 'Silent Hill 3 Tools project' : 'Silent Hill archives', extensions: action === 'openProject' ? ['sh3project'] : ['arc', 'afs', '000']}]);
    return file ? remember(await call(action === 'openProject' ? 'loadProject' : 'open', file)) : null;
  }
  if (action === 'saveProject') {
    const file = await chooseNewFile('My mod.sh3project', ['sh3project']);
    return file ? call('saveProject', file) : null;
  }
  if (action === 'undo') return remember(await call('undo', args.key));
  if (action === 'morph') return remember(await call('bakeMorph', args.key, args.target, args.factor));
  if (action === 'replace') {
    const formats = {mapGlb: ['glb'], messages: ['json'], font: ['png'], fontHires: ['png'], movie: ['mpg', 'mpeg', 'mp4', 'mkv', 'avi', 'mov', 'webm', '000'], audio: ['wav', 'flac', 'mp3', 'ogg'], morph: ['json'], texture: ['png'], textureExperimental: ['png'], native: ['*']};
    if (!formats[args.mode]) throw new Error('Invalid import mode.');
    const file = await pickFile([{name: 'Replacement asset', extensions: formats[args.mode]}]);
    return file ? remember(await call('replace', args.key, file, args.mode, args.textureIndex || 0)) : null;
  }
  if (action === 'export') {
    const snapshot = await call('snapshot'), entry = snapshot.entries.find(e => e.key === args.key);
    if (!entry) throw new Error('Select an asset.');
    const extensions = {world: 'json', messages: 'json', font: 'png', worldTexture: 'png', movie: 'mpg', webm: 'webm', audio: 'wav', glb: 'glb', fbx: 'fbx', morph: 'json', texture: 'png', native: entry.extension || 'bin'}, extension = extensions[args.mode];
    if (!extension) throw new Error('Invalid export mode.');
    const base = path.basename(entry.name, path.extname(entry.name));
    const file = await chooseNewFile(`${base}${args.mode === 'texture' ? '_texture_' + (args.textureIndex || 0) : args.mode === 'morph' ? '_morphs' : ''}.${extension}`, [extension]);
    return file ? call('exportAsset', args.key, file, args.mode, args.textureIndex || 0) : null;
  }
  if (['extract', 'exportArchive', 'exportAllArchives', 'build'].includes(action)) {
    const parent = await pickFile([], ['openDirectory', 'createDirectory']); if (!parent) return null;
    const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
    const folder = path.join(parent, `SH3-${action === 'build' ? 'Build' : 'Export'}-${timestamp}`);
    if (action === 'extract') return call('extract', args.keys, folder);
    if (action === 'exportArchive') return call('exportArchive', args.archive, folder, args.mode);
    if (action === 'exportAllArchives') return call('exportAllArchives', folder, args.mode);
    const requirements = await call('buildRequirements'); let executable = requirements.executable;
    if (requirements.requiresRuntimePatch && !executable) {
      executable = await pickFile([{name: 'Silent Hill 3 executable', extensions: ['exe']}]); if (!executable) return null;
    }
    const result = await call('build', folder, executable);
    const folderWarning = await shell.openPath(result.folder);
    return {...result, folderWarning};
  }
  throw new Error('Unknown action.');
}
async function execute(event, action, args) {
  validateSender(event);
  if (busy && !['preview', 'snapshot', 'bootstrap', 'motionList', 'motionClip', 'mapDraftCount', 'texturePreview', 'textureThumbnails'].includes(action)) throw new Error('Wait for the current operation.');
  const exclusive = !['preview', 'snapshot', 'bootstrap', 'motionList', 'motionClip', 'mapDraftCount', 'texturePreview', 'textureThumbnails'].includes(action);
  if (exclusive) busy = true;
  try { return await operation(action, args); }
  finally {if (exclusive) busy = false;}
}
app.whenReady().then(async () => {
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
    const request = pending.get(id); if (!request) return; pending.delete(id); error ? request.reject(new Error(error)) : request.resolve(result);
  });
  worker.on('error', error => {for (const request of pending.values()) request.reject(error); pending.clear();});
  window = new BrowserWindow({width: 1560, height: 960, minWidth: 1120, minHeight: 720, show: process.env.SH3TOOLS_TEST !== '1',
    title: 'Silent Hill 3 Tools', icon: path.join(__dirname, 'ui', 'logo.png'), backgroundColor: '#141517', autoHideMenuBar: true,
    webPreferences: {preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true}});
  window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.on('close', event => {
    if (process.env.SH3TOOLS_TEST === '1') return;
    if (changed || mapDraftCount || busy) {
      event.preventDefault();
      if (busy) {dialog.showMessageBox(window, {message: 'Wait for the current operation to finish.', buttons: ['OK']}); return;}
      confirmDiscard().then(discard => {if (discard) {changed = 0; mapDraftCount = 0; window.close();}});
    }
  });
  const command = action => () => window.webContents.send('studio:command', action);
  Menu.setApplicationMenu(Menu.buildFromTemplate([{label: 'File', submenu: [
    {label: 'Open archive…', accelerator: 'CmdOrCtrl+O', click: command('open')},
    {label: 'Open data folder…', click: command('openGame')},
    {label: 'Open project…', click: command('openProject')},
    {label: 'Save project as…', accelerator: 'CmdOrCtrl+Shift+S', click: command('saveProject')},
    {type: 'separator'}, {label: 'Build patched copies…', accelerator: 'CmdOrCtrl+B', click: command('build')}, {role: 'quit'}]},
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
