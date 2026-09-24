import {selectionOffset} from './map-selection.mjs';
const node = (tag, text) => {const el = document.createElement(tag); if (text !== undefined) el.textContent = text; return el;};

/** Bind selected map parts to preview drafts and explicit native commits. */
export function mapEditor(host, state, run, notify) {
  const preview = state.preview, model = preview?.model, key = state.selected, drafts = state.mapDrafts;
  if (!preview?.world?.editable || !model?.meshes.length) return;
  host.append(node('h3', 'Map editor'));
  const panel = node('div'); panel.className = 'map-editor'; host.append(panel);
  const select = node('select'); select.setAttribute('aria-label', 'Map part'); select.multiple = true; select.size = 5;
  for (const mesh of model.meshes) select.add(new Option(`${mesh.name} · ${mesh.vertexCount} vertices`, mesh.name));
  state.mapSelections ||= new Map();
  const known = (state.mapSelections.get(key) || [model.meshes[0].name]).filter(name=>model.meshes.some(mesh=>mesh.name===name));
  for(const option of select.options) option.selected=known.includes(option.value);
  const selected = () => [...select.selectedOptions].map(option=>option.value);
  const multi = () => selected().length>1;
  panel.append(Object.assign(node('p','Ctrl / Shift-click to select several parts in the list or viewport. Group selection supports translation.'),{className:'hint'}));
  const status = node('p'); status.className = 'hint'; panel.append(select, status);
  const modes = node('div'); modes.className = 'map-gizmo-modes'; panel.append(modes);
  for (const [label, mode] of [['Move','translate'],['Rotate','rotate'],['Scale','scale']]) {
    const button = node('button', label); button.type = 'button'; button.dataset.mode = mode; button.setAttribute('aria-label', `Gizmo ${label}`);
    button.onclick = () => {state.mapMode = mode; state.viewport?.gizmoMode(mode); [...modes.children].forEach(b=>b.classList.toggle('active',b===button));};
    button.classList.toggle('active', (state.mapMode || 'translate') === mode); modes.append(button);
  }
  const rows = new Map();
  for (const [field,label,count] of [['translation','Move',3],['rotation','Rotate °',3],['scale','Scale',3],['uvOffset','UV offset',2],['uvScale','UV scale',2]]) {
    const row = node('label', label); row.className = 'map-fields'; const inputs = [];
    for(let i=0;i<count;i++) {const input = node('input'); input.type = 'number'; input.step = 'any'; input.setAttribute('aria-label', `${label} ${['X','Y','Z'][i]}`); row.append(input); inputs.push(input); input.onfocus = () => drafts.begin(key); input.onblur = () => {drafts.end(); updateUndo();}; input.oninput = () => {if(!drafts.transaction)drafts.begin(key);readFields();};}
    panel.append(row); rows.set(field, inputs);
  }
  const material = node('select'); material.setAttribute('aria-label', 'Map material'); material.onchange = () => {
    if(state.busy) return;
    drafts.begin(key);
    const source = model.meshes.find(m=>m.name===select.value);
    for(const edit of drafts.edits(key)) if(edit.part!==source.name && model.meshes.find(m=>m.name===edit.part)?.group===source.group) {edit.materialGroup=null;drafts.set(key,preview.hash,edit);}
    readFields(); drafts.end(); refresh();
  }; panel.append(material);
  const draftStatus = node('p'); draftStatus.className = 'map-draft-status'; draftStatus.setAttribute('role','status'); panel.append(draftStatus);
  const actions = node('div'); actions.className = 'action-stack'; panel.append(actions);
  const action = (label, callback, parent = actions) => {const button = node('button', label); button.type = 'button'; button.onclick = callback; parent.append(button); return button;};
  action('Frame selected part', () => state.viewport?.frameParts(selected()));
  action('Apply & stage map edits', () => {if(!readFields()) {notify('Enter finite transform values and a positive scale before applying.');return;} drafts.end(); return run('editMap', {key, hash: preview.hash, edits: drafts.edits(key)}, 'Writing and validating native MAP…');}).className = 'primary';
  action('Discard preview edits', () => {drafts.discard(key); refresh();});
  const undo = action('Undo map action · Ctrl+Z', () => state.mapUndo());
  function updateUndo() {undo.dataset.unavailable=String(!drafts.canUndo(key) && !preview.mapUndo);undo.disabled=state.busy || undo.dataset.unavailable==='true';}
  state.mapUndo = () => {if(state.busy)return;if(drafts.undo(key))refresh();else if(preview.mapUndo)run('undoMap',{key},'Undoing map edit…');};
  const exchange = node('div'); exchange.className = 'action-stack'; panel.append(node('h4','Selected part'),exchange);
  action('Export selected part GLB…', () => run('exportMapPart', {key, part: select.value}, 'Exporting selected mesh…'), exchange);
  action('Replace selected part GLB…', () => run('importMapPart', {key, hash: preview.hash, part: select.value}, 'Rebuilding selected MAP part…'), exchange);
  const topology = node('p'); topology.className = 'hint'; panel.append(topology);
  const texturePreview = node('img'); texturePreview.className = 'map-texture-thumb'; texturePreview.alt = 'Selected part texture';
  const textureStatus = node('p'); textureStatus.className = 'hint'; panel.append(node('h4','Selected material texture'),texturePreview,textureStatus);
  const textureActions = node('div'); textureActions.className = 'action-stack'; panel.append(textureActions);
  const textureForPart = () => {
    const mesh = model.meshes.find(m=>m.name===select.value);
    let group = mesh.group;
    for(const edit of drafts.edits(key)) if (model.meshes.find(m=>m.name===edit.part)?.group===mesh.group && edit.materialGroup!==null) group=edit.materialGroup;
    return model.meshes.find(m=>m.group===group)?.texture ?? -1;
  };
  const pngExport = action('Export selected texture PNG…',()=>run('export',{key,mode:'worldTexture',textureIndex:textureForPart()},'Exporting texture…'),textureActions);
  const pngReplace = action('Replace selected texture PNG…',()=>run('replaceMapTexture',{key,hash:preview.hash,textureIndex:textureForPart()},'Encoding map texture…'),textureActions);
  panel.append(Object.assign(node('p','PNG is fitted to the native dimensions and palette. Shared TEX images update every map using that image. GLB replacement keeps the selected material; use the PNG action to change its image.'),{className:'hint'}));
  action('Import whole map GLB…', () => run('replace', {key, mode:'mapGlb'}, 'Validating MAP geometry…'), panel);
  panel.append(Object.assign(node('p','Preview edits are applied only with Apply. Movement preserves native visibility bounds. Collision, events and cameras are separate assets.'),{className:'hint'}));
  function renderDraft() {
    const edits = drafts.edits(key);
    draftStatus.textContent = edits.length ? `${edits.length} part(s) with preview edits · not yet staged` : 'No unapplied preview edits';
    state.viewport?.previewMapEdits(edits); updateUndo();
  }
  function refresh() {
    const mesh = model.meshes.find(m=>m.name===select.value), edit = drafts.get(key,mesh.name);
    state.mapPart = mesh.name; state.mapSelections.set(key,selected()); state.viewport?.selectParts(selected());
    if(multi()) edit.translation=selectionOffset(model,drafts.edits(key),selected());
    for(const [field,inputs] of rows) for(const input of inputs) {input.dataset.unavailable=String(multi() && field!=='translation');input.disabled=state.busy || input.dataset.unavailable==='true';}
    material.dataset.unavailable=String(multi()); material.disabled=state.busy || multi();
    for(const button of modes.children) {button.dataset.unavailable=String(multi() && button.dataset.mode!=='translate');button.disabled=state.busy || button.dataset.unavailable==='true';button.classList.toggle('active',button.dataset.mode===(multi()?'translate':state.mapMode||'translate'));}
    for(const button of exchange.children) {button.dataset.unavailable=String(multi());button.disabled=state.busy || multi();}
    for (const [field,inputs] of rows) inputs.forEach((input,i)=>input.value = Number(edit[field][i].toFixed(6)));
    material.replaceChildren(new Option('Keep current material',''));
    for (const group of preview.world.groups.filter(g=>g.textureSource===mesh.textureSource)) material.add(new Option(`Group ${group.index} · texture ${group.textureIndex}`,group.index));
    material.value = edit.materialGroup ?? '';
    status.textContent = `${selected().length} selected · Material group ${mesh.group} · object type ${mesh.objectType}. Assignment changes all ${model.meshes.filter(m=>m.group===mesh.group).length} part(s) in this group.`;
    topology.textContent = mesh.replacementIssue || 'New topology supported. Export one mesh with UVs, normals and vertex colors; keep its world placement.';
    const index=textureForPart(), image=preview.textures[index];
    texturePreview.hidden = !image; if(image) texturePreview.src = image.url;
    textureStatus.textContent = image ? `${image.sourceName} · image ${image.sourceIndex} · ${image.width} × ${image.height}` : 'No resolved texture for this material.';
    for(const b of [pngExport,pngReplace]) {b.disabled=!image || multi();b.dataset.unavailable=String(!image || multi());}
    renderDraft(); state.viewport?.gizmoMode(state.mapMode || 'translate');
  }
  function readFields() {
    if(state.busy) return false;
    if(multi()) {
      const inputs=rows.get('translation');if(inputs.some(input=>input.value===''||!input.validity.valid))return false;
      const previous=selectionOffset(model,drafts.edits(key),selected()),delta=inputs.map((input,i)=>Number(input.value)-previous[i]);
      const edits=selected().map(part=>{const edit=drafts.get(key,part);edit.translation=edit.translation.map((v,i)=>v+delta[i]);return edit;});
      try {drafts.setMany(key,preview.hash,edits);renderDraft();return true;}catch(error){notify(error.message);return false;}
    }
    const edit=drafts.get(key,select.value);
    for(const [field,inputs] of rows) {if(inputs.some(input=>input.value===''||!input.validity.valid)) return false; edit[field]=inputs.map(input=>Number(input.value));}
    edit.materialGroup=material.value===''?null:Number(material.value);
    try {drafts.set(key,preview.hash,edit); renderDraft(); return true;} catch(error) {notify(error.message); return false;}
  }
  state.mapGesture = active => {if(active) drafts.begin(key);else {drafts.end();updateUndo();}};
  state.mapTransform = transform => {
    if(state.busy)return;
    try {drafts.setMany(key,preview.hash,transform.edits.map(edit=>({...drafts.get(key,edit.part),...edit})));refresh();}catch(error){notify(error.message);}
  };
  state.mapSelect = (name,toggle=false) => {
    drafts.end();
    if(model.meshes.some(mesh=>mesh.name===name)) {
      const names=new Set(toggle?selected():[]);if(toggle && names.has(name) && names.size>1)names.delete(name);else names.add(name);
      for(const option of select.options)option.selected=names.has(option.value);refresh();
    }
  };
  state.mapRefresh = refresh;
  select.onchange = () => {drafts.end();if(!selected().length)select.options[0].selected=true;refresh();};refresh();
}
