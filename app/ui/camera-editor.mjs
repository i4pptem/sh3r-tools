const node = (tag, text) => {const element = document.createElement(tag); if (text !== undefined) element.textContent = text; return element;};

/** Edit native camera zones; record order and mode-specific parameters remain explicit. */
export function cameraEditor(host, state, run, notify) {
  const {world, hash} = state.preview, key = state.selected;
  if (!world.cameraEditable) return;
  const panel = node('div'); panel.className = 'camera-editor'; host.append(node('h3', 'Camera zones'), panel);
  panel.append(Object.assign(node('p', 'Activation determines where a zone is selected. Constraint fields define a camera region or an anchored camera point, depending on movement mode. Coordinates below use the native game axes. Apply stages the CAM file for Build mod.'), {className: 'hint'}));
  const select = node('select'); select.setAttribute('aria-label', 'Camera zone'); panel.append(select);
  for (const record of world.records) select.add(new Option(`Zone ${record.index} · movement ${record.cameraMovementType}`, record.index));
  const visibility=node('label','Show other zones');const showOthers=node('input');showOthers.type='checkbox';visibility.prepend(showOthers);panel.append(visibility);showOthers.onchange=()=>refresh();
  panel.append(Object.assign(node('p','Amber: activation · Blue: camera constraint'),{className:'hint'}));
  const rows = new Map();
  function fields(parent, field, title, axes, integer = false) {
    const row = node('label', title); row.className = 'map-fields'; const inputs = [];
    for (const axis of axes) {
      const input = node('input'); input.type = 'number'; input.step = integer ? '1' : 'any'; input.setAttribute('aria-label', `${title} ${axis}`);
      row.append(input); inputs.push(input);
    }
    parent.append(row); rows.set(field, inputs);
  }
  const zoneFields = node('div'); panel.append(zoneFields);
  for (const [prefix, title] of [['active', 'Activation'], ['constraint', 'Constraint']]) {
    zoneFields.append(node('h4', title));
    for (let point = 0; point < 3; point++) fields(zoneFields, `${prefix}GroundPoints.${point}`, `${title} point ${point + 1}`, ['X', 'Z']);
    fields(zoneFields, `${prefix}Heights`, `${title} height`, ['min Y', 'max Y']);
  }
  const advanced = node('details'); advanced.className = 'inspector-section'; advanced.append(node('summary', 'Camera behavior')); panel.append(advanced);
  for (const [field, title] of [['kindId', 'Kind ID'], ['flags', 'Flags'], ['areaSizeType', 'Area size type'], ['roadType', 'Road type'], ['verticalMovementType', 'Vertical movement'], ['roadDirectionType', 'Road direction'], ['cameraMovementType', 'Movement mode']]) fields(advanced, field, title, ['ID'], true);
  fields(advanced, 'watchHeightOffset', 'Watch height offset', ['Y']); fields(advanced, 'traceBottomHeight', 'Trace bottom height', ['Y']);
  fields(advanced, 'projection', 'Projection', ['1', '2', '3']);
  fields(advanced, 'movementParameters', 'Movement parameters', ['1', '2', '3', '4']);
  advanced.append(Object.assign(node('p', 'Movement modes: 0 chase, 1 settle, 2 fixed angle, 3 self view, 4 circle, 6 anchored tracking, 7 anchored fixed angle. Other PC modes depend on additional controller or stage logic. Angular parameters use radians. Movement parameters depend on this mode. Keep unknown flags and enum values unless you know their purpose.'), {className: 'hint'}));
  const actions = node('div'); actions.className = 'action-stack'; panel.append(actions);
  const button = (label, callback) => {const element = node('button', label); element.type = 'button'; element.onclick = callback; actions.append(element); return element;};
  function refresh() {
    const record = world.records[Number(select.value)]; if (!record) return;
    for (const [field, inputs] of rows) {
      const [name, index] = field.split('.'); let value = record[name]; if (index !== undefined) value = value[Number(index)];
      const values = Array.isArray(value) ? value : [value]; inputs.forEach((input, i) => input.value = values[i]);
    }
    for(const mesh of state.preview.model?.meshes || [])state.viewport?.visible(mesh.name,showOthers.checked || mesh.name.startsWith(`Zone_${record.index}_`));
    state.viewport?.selectParts([`Zone_${record.index}_Activation`, `Zone_${record.index}_Constraint`]);
  }
  button('Frame camera zone', () => state.viewport?.frameParts([`Zone_${select.value}_Activation`, `Zone_${select.value}_Constraint`]));
  const apply = button('Apply & stage camera zone', () => {
    const record = structuredClone(world.records[Number(select.value)]); if (!record) return;
    for (const [field, inputs] of rows) {
      if (inputs.some(input => input.value === '' || !input.validity.valid || !Number.isFinite(Number(input.value)))) {notify('Enter valid numbers for all camera zone fields.'); return;}
      const [name, index] = field.split('.'), values = inputs.map(input => Number(input.value));
      if (index !== undefined) record[name][Number(index)] = values;
      else record[name] = Array.isArray(record[name]) ? values : values[0];
    }
    return run('editCameras', {key, hash, edits: [record]}, 'Rebuilding native CAM…');
  }); apply.className = 'primary';
  const undo = button('Undo camera action · Ctrl+Z', () => state.mapUndo());
  undo.dataset.unavailable = String(!state.preview.mapUndo); undo.disabled = !state.preview.mapUndo;
  state.mapUndo = () => {if (!state.busy && state.preview.mapUndo) return run('undoMap', {key}, 'Undoing camera edit…');};
  button('Import camera structure JSON…', () => run('replace', {key, mode: 'cameraJson'}, 'Validating camera zones…'));
  state.mapSelect = name => {const match = /^Zone_(\d+)_/.exec(name); if (match) {select.value = match[1]; refresh();}};
  state.mapRefresh = refresh; select.onchange = refresh;
  if (!world.records.length) {zoneFields.hidden = true; advanced.hidden = true; apply.disabled = true; apply.dataset.unavailable = 'true';}
  refresh();
}
