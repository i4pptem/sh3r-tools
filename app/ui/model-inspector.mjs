import {modelReplacement} from './model-replacement.mjs';

export function modelInspector(root, entry, preview, {state, run, notify, el, button}) {
  const section = (title, hint) => {
    const node = el('section', 'inspector-section'); node.append(el('h3', '', title));
    if (hint) node.append(el('p', 'hint', hint)); root.append(node); return node;
  };
  const output = section('Export model', 'Meshes, skeleton, skin weights, textures and pose morphs.');
  const formats = el('div', 'export-formats');
  for (const [mode, name] of [['glb', 'GLB'], ['fbx', 'FBX'], ['blend', 'Blender (.blend)']]) {
    const action = button('Export ' + name, () => run('export', {key:entry.key, mode}, mode !== 'glb' ? 'Preparing scene with Blender…' : 'Exporting model, rig and morphs…'));
    action.id = 'export-model-' + mode; formats.append(action);
  }
  output.append(formats, el('p', 'hint compact-hint', 'Blender and FBX use installed Blender 4.2+. Choose .blend for joint-aligned bones and independent translations.'));
  const input = section('Import model');
  const hint = el('p', 'hint', 'Choose GLB, GLTF, FBX or .blend with the original rig. Color textures import together with the model; new slots are detected automatically. FBX / .blend require Blender 4.2+. Topology and morph changes open the rebuild setup.');
  const load = button('Import model…', async () => {
    const result = await run('importModel', {key: entry.key}, 'Checking model and morphs…');
    if (result?.modelImport === 'rebuild') modelReplacement(state, run, notify, result);
  }, 'primary');
  load.id = 'import-model'; input.append(hint, load);
  if (!preview.model.morphNames.length) return;
  const workspace = el('details', 'inspector-section'); workspace.append(el('summary', '', 'Morph workspace'));
  workspace.append(el('p', 'hint', 'Edit separate base and pose meshes in Blender. Subdivision on a base is applied to all its poses when imported.'));
  const actions = el('div', 'action-stack');
  actions.append(button('Export workspace .blend…', () => run('exportMorphWorkspace', {key:entry.key}, 'Arranging base meshes and morph poses in Blender…')),
    button('Import workspace…', async () => {const info = await run('prepareMorphWorkspace', {key:entry.key}, 'Assembling shape keys and checking vertex correspondence…'); if (info) modelReplacement(state, run, notify, info);}));
  workspace.append(actions); root.append(workspace);
  const advanced = el('details', 'inspector-section'); advanced.append(el('summary', '', 'Native morph data'));
  const morph = el('div', 'action-stack');
  morph.append(button('Export morph JSON', () => run('export', {key:entry.key, mode:'morph'}, 'Exporting native morphs…')),
    button('Import morph JSON', () => run('replace', {key:entry.key, mode:'morph'}, 'Validating morph mappings…')));
  advanced.append(morph); root.append(advanced);
}
