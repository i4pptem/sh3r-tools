import {reviewBuild} from './build-review.mjs';
import {exportProgressDialog} from './operation-progress.mjs';
import {batchReplace} from './batch-replace.mjs';
import {mergeMods} from './mod-merge.mjs';
import {cutsceneInspector} from './cutscene-inspector.mjs';
import {appPrompts} from './app-prompts.mjs';
import {worldReferencePanel} from './world-reference-panel.mjs';
import {worldToolMode,isWorldUndo} from './editor-shortcuts.mjs';
import {cameraEditor} from './camera-editor.mjs';
import {textureInspector} from './texture-inspector.mjs';
import {MapDrafts} from './map-drafts.mjs';
import {mapEditor} from './map-editor.mjs';
import {ImageViewport} from './image-viewport.mjs';
import {notifications} from './notifications.mjs';
import {modelInspector} from './model-inspector.mjs';
import {workspaceLayout} from './workspace-layout.mjs';
import {ModelViewport} from './viewport.mjs';
import {motionControls} from './motion-controls.mjs';
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
appPrompts();
const state = {library: null, section: 'assets', archive: null, kind: 'all', query: '', selected: null, preview: null, tab: 'preview', texture: 0, page: 'library', busy: false, viewport: null, previewRequest: 0};
state.mapDrafts = new MapDrafts(count => {window.studio.request('mapDraftCount', {count}).catch(error => notify(error.message));refreshButtons();});
const notify = notifications($('#notification'));
const sectionNames = {assets: 'Asset library', movie: 'Movie folder', pic: 'Pic', sound: 'Sound'};
const sectionTitles = {assets: 'All archives', movie: 'All movies', pic: 'All pictures', sound: 'All sound files'};
const layout = workspaceLayout();
const motion = motionControls(state, notify, run);
const imageViewport = new ImageViewport($('#image-preview'), scale => {$('#image-zoom').textContent = Math.round(scale * 100) + '%';});
const textureBrowser = textureInspector(state, run, notify, key => {page('library'); selectAsset(key);});
const sceneBrowser = cutsceneInspector(state, run, notify, key => {page('library'); selectAsset(key);});
const icons = {world: '▦', video: '▶', model: '◇', texture: '▧', audio: '♫', animation: '⌁', text: '≡', binary: '▤'};
const basename = file => file.replaceAll('\\', '/').split('/').pop();
const pretty = value => value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(2)} GB` : value >= 1024 ** 2 ? `${(value / 1024 ** 2).toFixed(1)} MB` : value >= 1024 ? `${(value / 1024).toFixed(1)} KB` : `${value} B`;
function el(tag, className, text) {const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;}
function button(text, handler, className = '') {const node = el('button', className, text); node.onclick = handler; return node;}
function refreshButtons() {
  textureBrowser.setBusy(state.busy);
  sceneBrowser.setBusy(state.busy);
  $$('[data-action], [data-section], #inspector button, .room-window button, .archive-menu button, .archive-more').forEach(button => {button.disabled = state.busy || button.dataset.unavailable === 'true';});
  $$('#inspector input, #inspector select, .room-window input, .room-window select').forEach(input => {input.disabled = state.busy || input.dataset.unavailable === 'true';});
  $$('.requires-library').forEach(b => {b.disabled = state.busy || !state.library;});
  $$('.requires-changes').forEach(b => {b.disabled = state.busy || (!state.library?.changes.length&&!state.mapDrafts.count);});
}
async function run(action, args = {}, label = 'Working…', onError = null) {
  if (state.busy) return;
  if(action==='build'&&!args.reviewToken){const report=await run('buildReview',{},'Checking staged assets and runtime requirements…');if(report)reviewBuild(report,state.mapDrafts.pending(state.library?.entries),key=>{page('library');selectAsset(key);},reviewToken=>run('build',{reviewToken},'Building mod…'));return;}
  if(action==='editRoom'&&state.worldReferences?.validate()===false){notify('Enter valid numbers in the collision and camera fields before applying.');return;}
  if (state.mapDrafts.count && !['buildReview','editMap', 'editRoom', 'reloadSources', 'checkSources', 'saveProject'].includes(action)) {const message='Unapplied room edits:\n'+state.mapDrafts.pending(state.library?.entries).map(room=>`${basename(room.name)}: ${room.error||'Open this map and Apply or discard its preview edits.'}`).join('\n');onError?.(message);notify(message);return;}
  const mapView = state.preview?.model?.world ? state.viewport?.viewState() : null, mapKey = state.selected;
  state.busy = true; state.viewport?.setEditingEnabled?.(false); $('#status').textContent = label; refreshButtons();
  const exporting=['exportCutscene','exportAnimation','exportMorphWorkspace','exportArchive','exportAllArchives','exportMapPart'].includes(action)||(action==='export'&&['blend','fbx','glb'].includes(args.mode));
  const exportDialog=exporting?exportProgressDialog(label):null;
  try {
    const result = await window.studio.request(action, args);
    if(result?.appliedDrafts){for(const key of result.appliedDrafts)state.mapDrafts.clear(key);if(result.snapshot){state.library=result.snapshot;updateLibrary();if(state.selected)await selectAsset(state.selected,0,{preserveView:true});}}
    if (result?.entries) {
      if(result.shadowReport)notify(`KG1 shadow volumes rebuilt and staged: ${result.shadowReport.blocks.length} blocks, ${result.shadowReport.blocks.reduce((n,b)=>n+b.triangles,0)} triangles. ${result.shadowReport.resource}. ${result.shadowReport.sharedModels.length?"Shared with "+result.shadowReport.sharedModels.map(name=>name.split("/").pop()).join(", ")+". ":""}Test RealTime Shadows in the game.`,true);
      if (['editMap','editRoom'].includes(action)) state.mapDrafts.clear(args.key);
      const previousInput = state.library?.input; state.library = result;
      if (result.input !== previousInput || ['open', 'openGame', 'openProject'].includes(action)) resetWorkspaceView();
      updateLibrary();
      if (state.selected) await selectAsset(state.selected, 0, {preserveView: true});
      if (mapView && state.selected === mapKey) state.viewport?.restoreView(mapView);
    } else if (!result?.rows && (result?.file || result?.folder)) notify(`${action === 'build' ? `Verified ${result.changes} replacement(s) in ${result.archives} source(s).${result.mode === "overlay" ? " ASI overlay created; see INSTALL.txt. Original game files stay unchanged." : result.runtimePatch ? " Patched sh3.exe included; install it with the built data folder." : ""}` : result.converted !== undefined ? `Exported ${result.count} assets: ${result.converted} converted, ${result.native} native, ${result.failed} conversion errors. See export-report.json.` : 'Saved successfully.'}\n${result.file || result.folder}`, !result.failed);
    if (result?.folderWarning) notify('Build saved, but the folder could not be opened: ' + result.folderWarning);
    return result;
  } catch (error) {const message=error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');if(['editMap','editRoom'].includes(action)){state.mapDrafts.failure(args.key,message);state.mapRefresh?.();}onError?.(message);notify(message);}
  finally {exportDialog?.close();state.busy = false; state.viewport?.setEditingEnabled?.(true); $('#status').textContent = 'Ready'; $('#progress').classList.add('hidden'); refreshButtons(); textureBrowser.refreshIfVisible();}
}
function filteredEntries() {
  const q = state.query.toLowerCase();
  if(state.page==='world')return (state.library?.entries||[]).filter(e=>e.extension==='map'&&(!$('#world-area').value||e.friendlyName===$('#world-area').value)&&(!q||`${e.name} ${e.friendlyName} ${e.searchAliases} ${e.archiveName}`.toLowerCase().includes(q)));
  return (state.library?.entries || []).filter(e => e.section === state.section && (state.archive === null || e.archive === state.archive) && (state.kind === 'all' || e.kind === state.kind) && (!q || `${e.name} ${e.friendlyName} ${e.searchAliases} ${e.archiveName} ${e.index}`.toLowerCase().includes(q)));
}
function page(name) {
  state.page = name; $$('.nav').forEach(b => b.classList.toggle('active', b.dataset.section ? name === 'library' && b.dataset.section === state.section : b.dataset.page === name));
  for (const id of ['welcome', 'library', 'textures', 'cutscenes', 'changes', 'support']) $('#' + id).classList.toggle('hidden', id !== (name === 'library' && !state.library ? 'welcome' : name));
  if(name==='world'){const select=$('#world-area'),selected=select.value;select.replaceChildren(new Option('All areas',''));for(const area of [...new Set((state.library?.entries||[]).filter(e=>e.extension==='map').map(e=>e.friendlyName).filter(Boolean))].sort())select.add(new Option(area,area));select.value=selected;$('#library').classList.toggle('hidden',!state.library);$('#welcome').classList.toggle('hidden',!!state.library);}
  document.body.classList.toggle('world-inspector-active',name==='world');$('#world-filters').classList.toggle('hidden',name!=='world');$('#filters').classList.toggle('hidden',name==='world');$('#search').placeholder=name==='world'?'Search areas or map files…':'Search assets…';
  if(name==='world'||name==='library')renderFiles();
  if (name === 'changes') renderChanges();
  if (name === 'textures') textureBrowser.show();
  sceneBrowser.setVisible(name === 'cutscenes');
  if (name === 'cutscenes') sceneBrowser.show();
  state.viewport?.resize();
}
$$('[data-page]').forEach(b => {b.onclick = () => page(b.dataset.page);});
function clearPreview() {
  state.worldReferences?.dispose(); state.worldReferences = null;
  motion.detach(); ++state.previewRequest; state.viewport?.dispose(); state.viewport = null;
  $$('video, audio').forEach(media => media.pause()); $('#other-preview').replaceChildren();
  state.selected = null; state.preview = null;
  $('#asset').classList.add('hidden'); $('#empty-preview').classList.remove('hidden');
}
function resetFilters() {
  state.archive = null; state.query = ''; state.kind = 'all'; $('#search').value = '';
  $$('[data-kind]').forEach(button => button.classList.toggle('active', button.dataset.kind === 'all'));
}
function resetWorkspaceView() {
  textureBrowser.reset(); sceneBrowser.reset();
  state.referenceSettings?.clear(); state.referenceSelections?.clear(); state.mapSelections?.clear(); for(const key of [...state.mapDrafts.maps.keys(),...state.mapDrafts.histories.keys()])state.mapDrafts.clear(key);
  clearPreview(); resetFilters(); state.section = state.library.archives[0]?.section || 'assets'; state.page = 'library';
}
function browseSection(section) {
  if (state.section !== section) {clearPreview(); resetFilters(); state.section = section;}
  layout.showLibrary(); page('library'); renderArchives(); renderFiles();
}
$$('[data-section]').forEach(button => {button.onclick = () => browseSection(button.dataset.section);});
function renderArchives() {
  const root = $('#archives'); root.replaceChildren();
  if (!state.library) return;
  const all = button('', () => {layout.showLibrary(); state.archive = null; renderArchives(); renderFiles();});
  const archives = state.library.archives.filter(a => a.section === state.section);
  all.append(el('span', '', '▦'), el('div', '', sectionTitles[state.section]), el('b', '', archives.reduce((count, a) => count + a.count, 0)));
  all.classList.toggle('active', state.archive === null); root.append(all);
  for (const archive of archives) {
    const item = button('', () => {layout.showLibrary(); state.archive = archive.id; state.page = 'library'; page('library'); renderArchives(); renderFiles();});
    item.append(el('span', '', '▱'), el('div', '', archive.name), el('b', '', archive.count)); item.title = `${archive.format} · ${pretty(archive.size)}`;
    item.classList.toggle('active', state.archive === archive.id); item.classList.add('archive-select');
    const row = el('div', 'archive-row'), more = button('⋯', event => showArchiveMenu(archive, event.currentTarget.getBoundingClientRect()), 'archive-more');
    more.title = 'Export ' + archive.name; more.setAttribute('aria-label', 'Export ' + archive.name); more.disabled = state.busy;
    row.oncontextmenu = event => {event.preventDefault(); showArchiveMenu(archive, {left: event.clientX, bottom: event.clientY});};
    row.append(item, more); root.append(row);
  }
}
$('#export-all').onclick = event => showArchiveMenu(null, event.currentTarget.getBoundingClientRect());
let archiveMenu;
function closeArchiveMenu() {archiveMenu?.remove(); archiveMenu = null;}
function showArchiveMenu(archive, rect) {
  closeArchiveMenu(); if (state.busy) return;
  const menu = el('div', 'archive-menu'); archiveMenu = menu; menu.setAttribute('role', 'menu');
  menu.append(el('strong', '', archive?.name || 'All opened archives and folders'));
  for (const [mode, title] of [['native', 'Export native files…'], ['converted', 'Export converted files…']]) {
    const action = button(title, () => {closeArchiveMenu(); run(archive ? 'exportArchive' : 'exportAllArchives', {archive: archive?.id, mode}, 'Exporting ' + (archive?.name || 'all sources') + '…');});
    action.setAttribute('role', 'menuitem'); menu.append(action);
  }
  for (const [kind, title] of [['textures', 'Replace textures from folder…'], ['audio', 'Replace audio from folder…']]) {
    const action = button(title, () => {closeArchiveMenu(); batchReplace(state.library, run, notify, {kind, ...(archive ? {archive: archive.id} : {})});});
    action.setAttribute('role', 'menuitem'); menu.append(action);
  }
  document.body.append(menu); menu.style.left = Math.max(8, Math.min(rect.left, innerWidth - menu.offsetWidth - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(rect.bottom, innerHeight - menu.offsetHeight - 8)) + 'px'; menu.querySelector('button').focus();
}
document.addEventListener('pointerdown', event => {if (archiveMenu && !archiveMenu.contains(event.target)) closeArchiveMenu();});
document.addEventListener('keydown', event => {if (event.key === 'Escape') closeArchiveMenu();});
$('#world-area').onchange=()=>renderFiles();
function renderFiles() {
  const entries = filteredEntries(), root = $('#files'); root.replaceChildren();
  $('#library-heading').textContent = state.page==='world'?'WORLD INSPECTOR':sectionNames[state.section].toUpperCase();
  $('#archive-title').textContent = state.archive === null ? sectionTitles[state.section] : state.library.archives.find(a => a.id === state.archive).name;
  if(state.page==='world')$('#archive-title').textContent=$('#world-area').value||'Maps by area';
  const fragment = document.createDocumentFragment();
  for (const entry of entries) {
    const row = button('', () => {if (!motion.select(entry)) selectAsset(entry.key);}, `file-row ${entry.changed ? 'changed' : ''} ${entry.key === state.selected ? 'selected' : ''}`);
    row.dataset.key = entry.key; row.setAttribute('role', 'option'); row.setAttribute('aria-selected', entry.key === state.selected ? 'true' : 'false'); row.title = entry.name;
    const name = el('div', 'file-name'); name.append(el('strong', '', basename(entry.name)), el('small', '', `${entry.archiveName} / ${entry.name.split('/').slice(-2, -1).join('') || entry.index}`));
    if(entry.friendlyName)name.querySelector('strong').append(el('span','asset-friendly-name',`(${entry.friendlyName})`));
    row.append(el('span', `file-icon ${entry.kind}`, icons[entry.kind]), name, el('span', 'file-size', pretty(entry.newSize ?? entry.size))); fragment.append(row);
  }
  if (!entries.length) {const empty = el('p', 'muted small', 'No assets match this search.'); empty.style.padding = '24px'; fragment.append(empty);}
  root.append(fragment); $('#results-count').textContent = `${entries.length.toLocaleString('en-US')} assets · ${pretty(entries.reduce((n, e) => n + e.size, 0))}`;
}
function updateLibrary() {
  for (const [section, id] of Object.entries({assets: 'library', movie: 'movie', pic: 'pic', sound: 'sound'})) $('#' + id + '-count').textContent = state.library.entries.filter(e => e.section === section).length.toLocaleString('en-US');
  $('#change-count').textContent = state.library.changes.length;
  $('#source-label').textContent = basename(state.library.dataRoot || state.library.input); $('#source-label').title = state.library.dataRoot || state.library.input;
  $('#footer-detail').textContent = `${state.library.archives.length} sources · ${state.library.changes.length} staged changes · Originals preserved`;
  renderArchives(); renderFiles(); page(state.page); refreshButtons();
  $('#empty-preview').classList.toggle('hidden', !!state.selected); $('#asset').classList.toggle('hidden', !state.selected);
}
function renderChanges() {
  const root = $('#changes-list'); root.replaceChildren();
  const changes = state.library?.changes || [];
  if (!changes.length) {const empty = el('div', 'change-row'); empty.append(el('p', 'muted small', 'No replacements yet. Choose an asset in the library and import a modified file.')); root.append(empty); return;}
  for (const change of changes) {
    const row = el('div', 'change-row'), description = el('div'); description.append(el('strong', '', basename(change.name)), el('p', '', `${change.name} · ${change.label}`));
    row.append(el('span', 'tag changed', 'Modified'), description, el('span', 'change-size', `${pretty(change.originalSize)} → ${pretty(change.size)}`),
      button('Inspect', () => {page('library'); selectAsset(change.key);}), button('Revert', () => run('undo', {key: change.key}, 'Reverting replacement…'))); root.append(row);
  }
}
$('#search').oninput = event => {state.query = event.target.value; renderFiles();};
$$('[data-kind]').forEach(b => {b.onclick = () => {state.kind = b.dataset.kind; $$('[data-kind]').forEach(n => n.classList.toggle('active', n === b)); renderFiles();};});
document.addEventListener('keydown', event => {
  const mode=worldToolMode(event,state);if(mode){event.preventDefault();state.worldReferences?state.worldReferences.setMode(mode):state.mapSetMode?.(mode);return;}
  if(isWorldUndo(event, state)) {
    event.preventDefault(); state.mapUndo?.();
  }
});
document.addEventListener('keydown', event => {if (event.ctrlKey && event.key.toLowerCase() === 'f') {event.preventDefault(); if (state.page === 'cutscenes') {$('#scene-search').focus(); return;} if (state.page === 'textures') {$('#texture-search').focus(); return;} if(state.page!=='world')page('library'); layout.showLibrary(); $('#search').focus();}});

document.addEventListener('keydown', event => {
  if (state.busy || !['library','world'].includes(state.page) || !state.library || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || document.querySelector('dialog[open]') || archiveMenu) return;
  if (event.target.closest('input, textarea, select, [contenteditable="true"], #inspector, #archives, .sidebar, .preview-toolbar, #model-controls, #motion-controls, #morph-controls, .room-window')) return;
  const step = {ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1}[event.key]; if (!step) return;
  const entries = filteredEntries(); if (!entries.length) return;
  const index = entries.findIndex(entry => entry.key === state.selected), next = index < 0 ? 0 : Math.max(0, Math.min(entries.length - 1, index + step));
  event.preventDefault();
  const entry = entries[next], row = $$('.file-row').find(row => row.dataset.key === entry.key);
  row?.focus({preventScroll: true}); row?.scrollIntoView({block: 'nearest'});
  if (entry.key !== state.selected && !motion.select(entry)) selectAsset(entry.key);
});

async function selectAsset(key, audioIndex = 0, {preserveView = false} = {}) {
  const entry = state.library.entries.find(e => e.key === key); if (!entry) return;
  if (entry.section !== state.section) browseSection(entry.section);
  state.worldReferences?.dispose(); state.worldReferences = null;
  motion.detach(); state.mapSelect = null; state.mapTransform = null; state.mapGesture = null; state.mapUndo = null; state.mapRefresh = null;state.mapSetMode=null;state.mapSelection=null;state.mapApply=null;state.mapDiscard=null;
  $$('video, audio').forEach(media => media.pause());
  state.selected = key; state.preview = null; if (!preserveView) {state.texture = 0; state.tab = 'preview';}
  state.viewport?.dispose(); state.viewport = null;
  const id = ++state.previewRequest;
  $$('.file-row').forEach(row => {const active = row.dataset.key === key; row.classList.toggle('selected', active); row.setAttribute('aria-selected', String(active));});
  $('#empty-preview').classList.add('hidden'); $('#asset').classList.remove('hidden');
  $('#asset-kind').textContent = `${entry.kind.toUpperCase()} / ${(entry.detectedFormat || entry.extension).toUpperCase() || 'BINARY'}`; $('#asset-title').textContent = basename(entry.name);
  $('#asset-state').textContent = entry.changed ? 'Modified' : 'Original'; $('#asset-state').classList.toggle('changed', entry.changed);
  $('#preview-warning').classList.add('hidden'); $('#motion-controls').classList.add('hidden'); $('#image-controls').classList.add('hidden'); $('#morph-controls').classList.add('hidden'); $('#model-controls').classList.add('hidden'); $('#preview-stats').replaceChildren();
  $('#other-preview').replaceChildren(el('p', '', 'Reading asset…')); setPreviewVisibility('other'); renderInspector(entry, null);
  try {
    const preview = await window.studio.request('preview', {key, audioIndex}); if (id !== state.previewRequest) return;
    if (!preview) {$('#other-preview').replaceChildren(el('p', '', 'Reload the sources to preview this asset.'), button('Reload sources…', () => run('reloadSources'))); return;}
    state.preview = preview; state.texture = Math.min(state.texture, Math.max(0, preview.textures.length - 1)); renderInspector(entry, preview); await renderPreview();
  } catch (error) {if (id === state.previewRequest) {$('#other-preview').replaceChildren(el('p', '', error.message)); setPreviewVisibility('other');}}
}
function setPreviewVisibility(type) {for (const name of ['viewer', 'image-preview', 'other-preview', 'hex-preview']) $('#' + name).classList.toggle('hidden', name !== ({model: 'viewer', image: 'image-preview', other: 'other-preview', hex: 'hex-preview'}[type]));}
function hexView(hex) {
  const lines = []; for (let offset = 0; offset < hex.length; offset += 32) {
    const chunk = hex.slice(offset, offset + 32).match(/../g) || [];
    lines.push(`${(offset / 2).toString(16).padStart(8, '0')}   ${chunk.join(' ').padEnd(47)}   ${chunk.map(h => {const n = parseInt(h, 16); return n >= 32 && n < 127 ? String.fromCharCode(n) : '.';}).join('')}`);
  } return lines.join('\n');
}
async function renderPreview() {
  const preview = state.preview; if (!preview) return;state.worldReferences?.setVisible(state.tab==='preview');
  $$('[data-preview]').forEach(b => {b.classList.toggle('active', b.dataset.preview === state.tab); if (b.dataset.preview === 'textures') b.disabled = !preview.textures?.length;});
  $('#preview-warning').classList.toggle('hidden', !preview.previewError); $('#preview-warning').textContent = preview.previewError || '';
  $('#model-controls').classList.toggle('hidden', !(preview.model && state.tab === 'preview'));
  $('#vertex-colors').classList.toggle('hidden', !preview.model?.meshes.some(m => m.colors));
  $('#bones').classList.toggle('hidden', !!preview.model?.world); $('#frame-morph').classList.toggle('hidden', !!preview.model?.world);
  $('#motion-controls').classList.toggle('hidden', !(preview.model && !preview.model.world && state.tab === 'preview'));
  $('#morph-controls').classList.toggle('hidden', !(preview.model?.morphNames.length && state.tab === 'preview'));
  $('#no-morphs').classList.toggle('hidden', !!preview.model?.morphNames.length);
  $('#image-controls').classList.toggle('hidden', !(state.tab === 'textures' || (!preview.model && (preview.textures.length || preview.image))) || state.tab === 'hex');
  if (state.tab === 'hex') {$('#hex-preview').textContent = hexView(preview.hex); setPreviewVisibility('hex'); return;}
  if (state.tab === 'textures' || (!preview.model && (preview.textures.length || preview.image))) {
    setPreviewVisibility('image'); imageViewport.show(preview.textures[state.texture]?.url || preview.image); return;
  }
  if (preview.model) {
    setPreviewVisibility('model');
    if (!state.viewport) {
      try {
        const viewport = new ModelViewport($('#viewer'), (name,toggle) => {
          if (preview.world?.editable || preview.world?.cameraEditable) {state.mapSelect?.(name,toggle); return;}
          const mesh = preview.model.meshes.find(part => part.name === name);
          viewport.selectParts([name]);
          if (mesh?.texture >= 0 && mesh.texture < preview.textures.length) {
            state.texture = mesh.texture;
            const select = $('#inspector select[aria-label="Embedded texture"]');
            if (select) {select.value = String(mesh.texture); select.closest('details').open = true;}
          }
        }, edit => state.mapTransform?.(edit), active => state.mapGesture?.(active)); state.viewport = viewport;
        await viewport.load(preview.model, preview.textures);
        if (preview.world?.editable || preview.world?.cameraEditable) state.mapRefresh?.(); if (state.preview !== preview) return;
        state.worldReferences?.attach(viewport);
        $('#wireframe').classList.remove('active'); $('#bones').classList.remove('active'); $('#vertex-colors').classList.add('active');
        if (!preview.model.world) await motion.attach(viewport, state.selected);
      } catch (error) {notify(`3D preview: ${error.message}`);}
      const select = $('#morph-target'); select.replaceChildren();
      preview.model.morphNames.forEach((name, index) => {const option = el('option', '', name); option.value = index; select.append(option);});
      $('#morph-weight').value = 0; $('#morph-value').textContent = '0%';
    }
    state.viewport?.resize();
    $('#preview-stats').replaceChildren(...[`${preview.model.vertexCount.toLocaleString('en-US')} vertices`, `${preview.model.triangleCount.toLocaleString('en-US')} triangles`, `${preview.model.bones.length} bones`, `${preview.model.morphNames.length} morphs`].map(t => el('span', '', t)));
    return;
  }
  const other = $('#other-preview'); other.replaceChildren(); setPreviewVisibility('other');
  if (preview.video) {const video = el('video'); video.controls = true; video.src = preview.video; video.onerror = () => notify('Video preview could not be played: ' + (video.error?.message || 'unknown media error')); video.style.cssText = 'width:100%;max-height:100%'; other.append(video);}
  else if (preview.audio) {other.append(el('span', 'large-file-icon', '♫')); const audio = el('audio'); audio.controls = true; audio.src = preview.audio; audio.onerror = () => notify('This audio codec cannot be played here. Export the native file to inspect it in an audio editor.'); other.append(audio);}
  else if (preview.text !== undefined) {const text = el('pre', '', preview.text); text.style.cssText = 'white-space:pre-wrap;overflow:auto;text-align:left;width:100%'; other.append(text);}
  else {other.append(el('span', 'large-file-icon', icons[preview.kind]), el('h3', '', preview.kind === 'animation' ? 'Native animation asset' : 'Native game asset'), el('p', '', 'Export or replace the original file. A structured preview for this format is not available in this version.'));
    other.append(button('Inspect binary data', () => {state.tab = 'hex'; renderPreview();}));}
  $('#preview-stats').replaceChildren(el('span', '', pretty(preview.size)), el('span', '', 'Native file export available'));
}
$$('[data-preview]').forEach(b => {b.onclick = () => {state.tab = b.dataset.preview; renderPreview();};});
$('#wireframe').onclick = () => {$('#wireframe').classList.toggle('active'); state.viewport?.wire($('#wireframe').classList.contains('active'));};
$('#bones').onclick = () => {$('#bones').classList.toggle('active'); state.viewport?.bones($('#bones').classList.contains('active'));};
$('#image-fit').onclick = () => imageViewport.fit(); $('#image-native').onclick = () => imageViewport.zoom(1); $('#image-double').onclick = () => imageViewport.zoom(2);
$('#image-zoom-in').onclick = () => imageViewport.zoom(imageViewport.scale * 1.25); $('#image-zoom-out').onclick = () => imageViewport.zoom(imageViewport.scale / 1.25);
$('#vertex-colors').onclick = () => {$('#vertex-colors').classList.toggle('active'); state.viewport?.vertexColors($('#vertex-colors').classList.contains('active'));};
$('#frame-morph').onclick = () => state.viewport?.frameMorph();
$('#frame').onclick = () => state.viewport?.frame();
const updateMorph = () => {const weight = Number($('#morph-weight').value); $('#morph-value').textContent = `${Math.round(weight * 100)}%`; state.viewport?.morph(Number($('#morph-target').value), weight); motion.manual();};
$('#morph-target').onchange = updateMorph; $('#morph-weight').oninput = updateMorph;
$('#bake-morph').onclick = () => run('morph', {key: state.selected, target: Number($('#morph-target').value), factor: Number($('#morph-weight').value)}, 'Staging morph intensity…');

function renderInspector(entry, preview) {
  const root = $('#inspector'); root.replaceChildren(el('div', 'eyebrow', 'INSPECTOR'));
  const mapPanel = (preview?.world?.editable || preview?.world?.cameraEditable) ? el('div') : null; if (mapPanel) root.append(mapPanel);
  const details = el('dl');
  for (const [label, value, className] of [['Archive', entry.archiveName], ['Virtual path', entry.name, 'path'], ['Size', pretty(preview?.size || entry.size)], ['Entry / block table', `${entry.index} / ${entry.chunkTableOffset}`]]) {
    details.append(el('dt', '', label), el('dd', className || '', value));
  }
  const assetDetails = el('details', 'inspector-section'); assetDetails.append(el('summary', '', 'Asset information'), details);
  const native = el('div', 'action-stack');
  native.append(button('↓  Export native file', () => run('export', {key: entry.key, mode: 'native'}, 'Exporting asset…')),
    button('↑  Replace native file', () => run('replace', {key: entry.key, mode: 'native'}, 'Validating replacement…')));
  const nativeSection = el('details', 'inspector-section'); nativeSection.append(el('summary', '', 'Native file'), el('p', 'hint', 'Export or replace the original game-format file.'), native);
  if (entry.changed) root.append(button('Revert replacement', () => run('undo', {key:entry.key}, 'Reverting replacement…'), 'revert-action'));
  if (preview?.model && !preview.model.world) modelInspector(root, entry, preview, {state, run, notify, el, button});
  if (preview?.world) {
    root.append(el('hr'), el('h3', '', preview.world.format || 'World data'));
    if (preview.world.note) root.append(el('p', 'hint', preview.world.note));
    if (preview.world.warnings?.length) root.append(el('p', 'hint', preview.world.warnings.join('\n')));
    const actions = el('div', 'action-stack');
    if (preview.model) actions.append(button('Export geometry GLB', () => run('export', {key: entry.key, mode: 'glb'}, 'Exporting scene geometry…')));
    actions.append(button('Export structure JSON', () => run('export', {key: entry.key, mode: 'world'})), button('Inspect structure', () => {const other = $('#other-preview'); other.replaceChildren(el('pre', '', preview.text)); setPreviewVisibility('other');})); root.append(actions);
  }
  if (mapPanel && preview.world.references) state.worldReferences = worldReferencePanel(state, run, notify, selectAsset, root);
  if (mapPanel) {if (preview.world.cameraEditable) cameraEditor(mapPanel, state, run, notify); else mapEditor(mapPanel, state, run, notify);}
  if (preview?.audioItems) {
    root.append(el('hr'), el('h3', '', 'Audio tracks / samples'));
    const select = el('select'); select.setAttribute('aria-label', 'Audio sample');
    preview.audioItems.forEach((item, index) => {const option = el('option', '', (item.name || 'Track ' + index) + ' · ' + item.sampleRate + ' Hz'); option.value = index; select.append(option);});
    select.value = preview.audioIndex; select.onchange = () => selectAsset(entry.key, Number(select.value)); root.append(select);
    const actions = el('div', 'action-stack'); actions.append(button('Export sample WAV', () => run('export', {key: entry.key, mode: 'audio', textureIndex: preview.audioIndex}))); if (preview.audioEditable) actions.append(button('Import sample audio', () => run('replace', {key: entry.key, mode: 'audio', textureIndex: preview.audioIndex}, 'Encoding native audio…'))); root.append(actions);
    root.append(el('p', 'hint', preview.audioEditable ? 'Keep the exact sample count. Other bank samples, AIX layers and native loop flags are preserved. HD imports update the paired BD file.' : 'Decoded from the ADX signature. Native archive filenames and entry IDs are preserved.'));
  }
  if (preview?.audio && entry.detectedFormat === 'wav') root.append(button('Export WAV', () => run('export', {key: entry.key, mode: 'audio'})));
  if (preview?.messages) {
    root.append(el('hr'), el('h3', '', 'Messages (' + preview.messages.count + ')'));
    const actions = el('div', 'action-stack'); actions.append(button('Export message JSON', () => run('export', {key: entry.key, mode: 'messages'})), button('Import message JSON', () => run('replace', {key: entry.key, mode: 'messages'}))); root.append(actions);
    root.append(el('p', 'hint', 'Edit readable text in the JSON segments. Preserve control codes and message order.'));
  }
  if (preview?.mediaInfo) {
    root.append(el('hr'), el('h3', '', 'Movie exchange'));
    const info = preview.mediaInfo; root.append(el('p', 'hint', info.width + ' × ' + info.height + ' · ' + info.fps.toFixed(3) + ' FPS · ' + info.duration.toFixed(2) + ' s'));
    const actions = el('div', 'action-stack'); actions.append(button('Export original MPEG', () => run('export', {key: entry.key, mode: 'movie'}, 'Decrypting movie…')), button('Export WebM', () => run('export', {key: entry.key, mode: 'webm'}, 'Converting movie…')), button('Import edited video', () => run('replace', {key: entry.key, mode: 'movie'}, 'Encoding and verifying movie…'))); root.append(actions);
    root.append(el('p', 'hint', 'Keep the original duration and include audio. Import restores the native resolution, frame rate, codecs and encrypted .000 wrapper.'));
  }
  if (preview?.rebuildReport) {root.append(el('hr'), el('h3', '', 'Rebuilt native model'), el('p', 'hint', ((preview.rebuildReport.requiresModelTexturePatch || preview.rebuildReport.requiresMorphPatch || preview.rebuildReport.requiresSecondaryPatch || preview.rebuildReport.requiresPrimaryIndexPatch) ? 'Requires the runtime patches included by Build mod. ' : '') + preview.rebuildReport.morphNodes + ' morph nodes · ' + preview.rebuildReport.morphTargets + ' target slots. File validation passed; in-game testing is still required.'));}
  if (preview?.textures.length) {
    const textureRoot = el('details', 'inspector-section'); textureRoot.open = !preview.model; textureRoot.append(el('summary', '', `Textures (${preview.textures.length})`)); root.append(textureRoot);
    const select = el('select'); select.setAttribute('aria-label', 'Embedded texture');
    preview.textures.forEach((t, i) => {const option = el('option', '', `${i} · ${t.width} × ${t.height} · ${t.format}`); option.value = i; select.append(option);});
    select.value = String(state.texture); select.onchange = () => {state.texture = Number(select.value); state.tab = 'textures'; renderPreview();}; textureRoot.append(select);
    const group = el('div', 'action-stack'); group.append(button('View texture', () => {state.tab = 'textures'; renderPreview();}),
      button('Export PNG', () => run('export', {key: entry.key, mode: preview.font ? 'font' : preview.world ? 'worldTexture' : 'texture', textureIndex: state.texture}, 'Exporting PNG…')));
    if (!preview.world) group.append(button('Import PNG', () => run('replace', {key: entry.key, mode: preview.font ? 'font' : 'texture', textureIndex: state.texture}, 'Encoding and verifying texture…')));
    if (preview.font) group.append(button('Import high-resolution PNG…', () => run('replace', {key: entry.key, mode: 'fontHires', textureIndex: state.texture}, 'Importing high-resolution font coverage…')));
    if (!preview.world && !preview.font) group.append(button('Import PNG at full size…', () => run('replace', {key: entry.key, mode: 'textureExperimental', textureIndex: state.texture}, 'Rebuilding experimental texture…'))); textureRoot.append(group);
    textureRoot.append(el('p', 'hint', preview.world ? 'Edit the source TEX asset in the library to replace external map textures.' : preview.font ? 'High-resolution import accepts a 2× or 4× atlas in the exported cell order. Grayscale and alpha become 8-bit coverage. The original drawable area stays 20 × 30 (Normal) or 16 × 24 (Small); pixels outside it are cropped. Text size and spacing stay unchanged. Build mod includes the required font patch. Native-resolution PNGs retain the original seven-level palette.' : 'Import PNG fits the original dimensions and palette. Import PNG at full size is experimental: it keeps PNG resolution and writes direct color, with an expanded picture-loader patch included by Build mod when required. Install the complete build using its selected delivery mode. Other texture paths still require in-game testing. Shared palettes cannot be collapsed.'));
  }
  if (preview?.model) {
    const meshes = el('details', 'inspector-section'), summary = el('summary', '', `Meshes (${preview.model.meshes.length})`); meshes.append(summary, el('p', 'hint', preview.model.world ? 'Select map parts to edit them.' : 'Click a mesh in the 3D view to find its native texture slot.'));
    if (preview.model.modelId === 0x100) meshes.append(el('p', 'hint', 'Gameplay face, hair and hand variants are hidden automatically during cutscene preview. Your visibility choices are kept when switching animations.'));
    for (const mesh of preview.model.meshes) {const label = el('label', 'mesh-item'), box = el('input'); box.type = 'checkbox'; box.checked = true; box.onchange = () => state.viewport?.visible(mesh.name, box.checked); label.append(box, document.createTextNode(`${mesh.name} · ${mesh.texture >= 0 ? 'texture ' + mesh.texture : 'no texture'}`)); if (mesh.texture >= 0 && mesh.texture < preview.textures.length) label.append(button('View', event => {event.preventDefault(); state.texture = mesh.texture; state.tab = 'textures'; const selected = $('#inspector select[aria-label="Embedded texture"]'); if (selected) selected.value = String(state.texture); renderPreview();})); meshes.append(label);} root.append(meshes);
  }
  nativeSection.open = !!preview && !(preview.model || preview.textures.length || preview.audio || preview.messages || preview.mediaInfo || preview.world);
  root.append(nativeSection, assetDetails);
  if (preview) {
    const extra = el('details'), summary = el('summary', '', 'Integrity'); extra.append(summary, el('p', 'hint', 'SHA-256'), el('p', 'hint', preview.hash)); root.append(el('hr'), extra);
  }
}

async function handleAction(action) {
  if(action==='batchReplace') {if(state.library)batchReplace(state.library,run,notify,{kind:state.page!=='textures'&&state.section==='sound'?'audio':'textures'});return;}
  if(action==='mergeMods') {const plan=await run('prepareModMerge',{},'Comparing mod assets…');if(plan)mergeMods(plan,run,notify);return;}
  if(action==='saveProject'||action==='saveAndClose'){
    state.mapDrafts.end();
    const drafts=[...state.mapDrafts.maps].map(([key,value])=>({key,...structuredClone(value)}));
    return run('saveProject',{drafts,closeAfterSave:action==='saveAndClose'},'Validating room edits and saving project…');
  }
  if (action === 'extract') return run(action, {keys: filteredEntries().map(e => e.key)}, 'Exporting matching assets…');
  const labels = {open: 'Opening archive…', openGame: 'Reading data folders and archives…', openProject: 'Verifying project sources…', saveProject: 'Saving project and source hashes…', build: 'Building and verifying patched archives…'};
  return run(action, {}, labels[action]);
}
$$('[data-action]').forEach(b => {b.onclick = () => handleAction(b.dataset.action);});
window.studio.onCommand(handleAction);
window.studio.onWorkspace(({reloaded, snapshot}) => {
  if (!reloaded) return;
  const selected = snapshot.keyMap[state.selected];
  state.library = snapshot; resetWorkspaceView(); updateLibrary();
  if (selected) void selectAsset(selected);
  const info = snapshot.reloadSummary;
  notify(`Sources reloaded. ${info.kept} staged replacement(s) kept; ${info.installed} already installed. Repeat the previous operation to continue.`, true);
});
window.addEventListener('focus', () => {if (state.library && !state.busy) void run('checkSources', {}, 'Checking sources…');});
window.studio.onProgress(({message, done, total}) => {$('#status').textContent = total ? `${message} · ${done} / ${total}` : message; $('#progress').classList.remove('hidden'); $('#progress>div').style.width = `${total ? done / total * 100 : 0}%`;});
document.addEventListener('dragover', event => event.preventDefault());
document.addEventListener('drop', async event => {
  if (state.mapDrafts.count) {event.preventDefault(); notify('Apply or discard map preview edits before opening another workspace.'); return;}
  event.preventDefault(); if (state.busy || !event.dataTransfer.files.length) return;
  state.busy = true; refreshButtons(); $('#status').textContent = 'Opening dropped file…';
  try {const result = await window.studio.droppedFile(event.dataTransfer.files[0]); if (result) {state.library = result; resetWorkspaceView(); updateLibrary();}}
  catch (error) {notify(error.message);} finally {state.busy = false; $('#status').textContent = 'Ready'; refreshButtons();}
});
const initial = await window.studio.request('snapshot'); if (initial.input) {state.library = initial; resetWorkspaceView(); updateLibrary();} else {page('library'); refreshButtons();}

const bootstrap = await window.studio.request('bootstrap');
$('.version').textContent = bootstrap.version;
$('#support-version').textContent = 'VERSION ' + bootstrap.version;
