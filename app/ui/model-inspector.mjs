import {modelReplacement} from './model-replacement.mjs';

export function modelInspector(root, entry, preview, {state, run, notify, el, button}) {
  const section = (title, hint) => {
    const node = el('section', 'inspector-section'); node.append(el('h3', '', title));
    if (hint) node.append(el('p', 'hint', hint)); root.append(node); return node;
  };
  const output = section('Export model', 'Meshes, skeleton, skin weights, textures and pose morphs.');
  const formats = el('div', 'export-formats');
  for (const [mode, name] of [['glb', 'GLB'], ['fbx', 'FBX']]) {
    const action = button('Export ' + name, () => run('export', {key:entry.key, mode}, mode === 'fbx' ? 'Exporting FBX with Blender…' : 'Exporting model, rig and morphs…'));
    action.id = 'export-model-' + mode; formats.append(action);
  }
  output.append(formats, el('p', 'hint compact-hint', 'FBX uses installed Blender 4.2+.'));
  const input = section('Import model');
  const label = el('label', 'field-label', 'What changed?'), mode = el('select'); mode.id = 'model-import-mode';
  mode.setAttribute('aria-label', 'Model import mode');
  mode.append(new Option('New topology & morphs', 'rebuild'), new Option('Positions, normals & UVs only', 'edits'));
  const hint = el('p', 'hint', 'Import a GLB with the original rig. Match its shape keys to the game’s morph slots.');
  mode.onchange = () => {hint.textContent = mode.value === 'rebuild' ? 'Import a GLB with the original rig. Match its shape keys to the game’s morph slots.' : 'Import a GLB with unchanged topology, rig and shape keys.';};
  label.append(mode);
  const load = button('Import GLB…', () => mode.value === 'rebuild' ? modelReplacement(state, run, notify) : run('replace', {key:entry.key, mode:'glb'}, 'Checking model topology…'), 'primary');
  load.id = 'import-model'; input.append(label, hint, load);
  if (!preview.model.morphNames.length) return;
  const workspace = el('details', 'inspector-section'); workspace.append(el('summary', '', 'Morph workspace'));
  workspace.append(el('p', 'hint', 'Edit separate base and pose meshes in Blender. Subdivision on a base is applied to all its poses when imported.'));
  const actions = el('div', 'action-stack');
  actions.append(button('Export workspace .blend…', () => run('exportMorphWorkspace', {key:entry.key}, 'Arranging base meshes and morph poses in Blender…')),
    button('Import workspace…', async () => {const info = await run('prepareMorphWorkspace', {key:entry.key}, 'Assembling shape keys and checking vertex correspondence…'); if (info) modelReplacement(state, run, notify, info);}),
    button('Compact workspace…', () => run('compactMorphWorkspace', {key:entry.key}, 'Arranging workspace poses…')));
  workspace.append(actions); root.append(workspace);
  const advanced = el('details', 'inspector-section'); advanced.append(el('summary', '', 'Native morph data'));
  const morph = el('div', 'action-stack');
  morph.append(button('Export morph JSON', () => run('export', {key:entry.key, mode:'morph'}, 'Exporting native morphs…')),
    button('Import morph JSON', () => run('replace', {key:entry.key, mode:'morph'}, 'Validating morph mappings…')));
  advanced.append(morph); root.append(advanced);
}
