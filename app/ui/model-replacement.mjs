import {modelCompatibility} from '../../core/model-compatibility.mjs';
const node = (tag, text) => {const result = document.createElement(tag); if (text !== undefined) result.textContent = text; return result;};

/** Collect explicit mesh templates and semantic morph mappings before staging a rebuild. */
export async function modelReplacement(state, run, notify, preparedInfo) {
  const key = state.selected, info = preparedInfo;
  if (!info || state.selected !== key) return;
  const dialog = node('dialog'), form = node('form'); dialog.className = 'replacement-dialog'; form.method = 'dialog';
  const header = node('div'); header.className = 'replacement-heading';
  header.append(node('h2', 'Replace model & rebuild morphs'));
  const close = node('button', '×'); close.type = 'button'; close.onclick = () => dialog.close(); header.append(close); form.append(header);
  form.append(node('p', 'Use the original rig. Choose an original visibility / render template and a texture slot for each part, then match new shape keys to the game’s existing morph slots. Only checked parts will be included.'));
  const caution = node('p', 'Experimental native rebuild. Inspect the result and test it in the game before distributing a mod.'); caution.className = 'replacement-warning'; form.append(caution);
  const chooseTemplate = node('button', 'Use original MDL templates…'); chooseTemplate.type = 'button';
  chooseTemplate.onclick = async () => {const next = await run('modelTemplates', {key, token: info.token}, 'Reading original mesh templates…'); if (next) {dialog.close(); modelReplacement(state, run, notify, next);}};
  form.append(chooseTemplate, Object.assign(node('p', 'For assets rebuilt by older versions, choose a clean original MDL to restore material and part assignments. New rebuilds retain these templates automatically.'), {className: 'hint'}));
  const textureNote = node('p', (info.importedTextures?.length ? 'Model color images: ' + info.importedTextures.map(image => 'Texture ' + image.slot + ' · ' + image.width + '×' + image.height + (image.added ? ' (new)' : '')).join(', ') + '. Images are imported at their supplied dimensions.' : 'No color images supplied; current MDL textures are retained.') + ' Up to 32 texture slots. Build mod includes the required executable patch when the original texture tables are exceeded.'); textureNote.className = 'hint'; form.append(textureNote);
  const parts = node('details'); parts.className = 'replacement-parts'; parts.open = info.inputs.some(input => input.template < 0); parts.append(node('summary', `Model parts (${info.inputs.length}) · templates and textures`));
  const meshTable = node('div'); meshTable.className = 'replacement-table'; const meshes = [];
  for (const input of info.inputs) {
    const row = node('label'), include = node('input'); include.type = 'checkbox'; include.checked = true;
    const description = node('span', `${input.name} · ${input.vertexCount.toLocaleString('en-US')} vertices${input.material ? ' · Material: ' + input.material : ''}`), select = node('select');
    select.add(new Option('Choose visibility / render template…', ''));
    info.templates.forEach((template, index) => select.add(new Option(`${template.name} · visibility ${template.visibility} · texture ${template.texture}`, index)));
    select.value = input.template >= 0 ? String(input.template) : ''; select.setAttribute('aria-label', `Template for ${input.name}`);
    const texture = node('select'); texture.setAttribute('aria-label', 'Texture slot for ' + input.name);
    texture.add(new Option('Use template texture', ''));
    info.textureSlots.forEach(slot => texture.add(new Option('Texture ' + slot, slot)));
    texture.value = input.texture !== null && input.texture !== info.templates[input.template]?.texture ? String(input.texture) : '';
    const controls = node('div'); controls.append(select, texture);
    row.append(include, description, controls); meshTable.append(row); meshes.push({input: input.index, include, select, texture});
  }
  parts.append(meshTable); form.append(parts);
  const compatibility = node('p'); compatibility.className = 'replacement-warning'; compatibility.style.whiteSpace = 'pre-line'; form.append(compatibility);
  const updateCompatibility = () => {
    const issues = modelCompatibility(info, meshes.filter(m => m.include.checked && m.select.value !== '').map(m => ({input: m.input, template: Number(m.select.value)})));
    compatibility.hidden = !issues.length;
    compatibility.textContent = issues.length ? 'Some weights use bones from different original visibility variants. These bones may not update in gameplay, causing stretched vertices even when the preview looks correct. Keep the required gameplay, cutscene and weapon variants.\n' + issues.map(issue => issue.name + ': bone ' + issue.bones.map(bone => String(bone).padStart(3, '0')).join(', ')).join('\n') : '';
    if (issues.length) parts.open = true;
  };
  meshes.forEach(mesh => {mesh.include.onchange = updateCompatibility; mesh.select.onchange = updateCompatibility;}); updateCompatibility();
  if (info.morphs.length) form.append(node('h3', 'Native morph slot → new shape key'));
  const morphTable = node('div'); morphTable.className = 'replacement-table'; const morphs = [];
  for (const [index, name] of info.morphs.entries()) {
    const row = node('label'), select = node('select'); select.add(new Option('Choose a shape key…', ''));
    select.add(new Option('Neutral — intentionally no deformation', '__neutral'));
    info.targetNames.forEach((target, i) => select.add(new Option(target, String(i))));
    const matching = info.targetNames.indexOf(name); select.value = matching >= 0 ? String(matching) : '';
    select.setAttribute('aria-label', `Shape key for ${name}`); row.append(node('span', `${index} · ${name}`), select); morphTable.append(row); morphs.push(select);
  }
  form.append(morphTable);
  const detail = node('p', `Base-color images are imported with the model, including new consecutive Texture_N slots. Named slots without imported color data keep their existing images. Templates also control visibility in gameplay, cutscenes and equipment states. Parts are split automatically to fit bone palettes and transparent-mesh buffers; each chunk keeps its original material and visibility settings. Use at most 3 influences per vertex and ${info.limits.morphNodes.toLocaleString("en-US")} unique morph nodes per model. Above ${info.stockMorphNodes.toLocaleString("en-US")} morph nodes, 65,536 primary-group vertices, 1,024 transparent-part vertices or 2,048 transparent triangles, Build mod also creates a patched sh3.exe; install it together with the built archives. Build mod also checks the complete character-file memory budget, including embedded textures. The morph count is separate from the total vertex count.`); detail.className = 'hint'; form.append(detail);
  const actions = node('div'); actions.className = 'replacement-actions';
  const cancel = node('button', 'Cancel'); cancel.type = 'button'; cancel.onclick = () => dialog.close();
  const build = node('button', 'Build & stage replacement'); build.type = 'button'; build.className = 'primary';
  build.onclick = async () => {
    const checked = meshes.filter(mesh => mesh.include.checked);
    if (!checked.length || checked.some(mesh => mesh.select.value === '') || morphs.some(select => select.value === '')) {notify('Choose each checked part’s template and map every morph slot. Use Neutral explicitly for unused slots.'); return;}
    const selection = {meshes: checked.map(mesh => ({input: mesh.input, template: Number(mesh.select.value), ...(mesh.texture.value === '' ? {} : {texture: Number(mesh.texture.value)})})),
      morphs: morphs.map(select => select.value === '__neutral' ? null : info.targetNames[Number(select.value)])};
    build.disabled = true;
    const result = await run('rebuildModel', {key, token: info.token, selection}, 'Rebuilding native geometry and morph tables…');
    build.disabled = false;
    if (result) {dialog.close(); const report = result.rebuildReport; notify(`Model rebuilt: ${report.vertices.toLocaleString('en-US')} vertices, ${report.morphTargets} morph slots, ${report.morphNodes} morph nodes. ${(report.requiresModelTexturePatch || report.requiresMorphPatch || report.requiresSecondaryPatch || report.requiresPrimaryIndexPatch) ? "Build mod will include the required patched sh3.exe. " : ""}Inspect it with the original animations before building a game test.`, true);}
  };
  actions.append(cancel, build); form.append(actions); dialog.append(form); document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove(), {once: true}); dialog.showModal();
}
