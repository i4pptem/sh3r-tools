import {cameraStudy, cameraZoneCenter, cameraZoneContains, CAMERA_MODES} from '../../core/camera-study.mjs';

const node = (tag, text) => {const el = document.createElement(tag); if (text !== undefined) el.textContent = text; return el;};

export function cameraReferenceControls(host, world, settings, getView, configure) {
  const view = getView(); view?.study.update(null, [0, 0, 0], 0, false); view?.cancelPlace();
  if (!world?.records.length) return {dispose() {}};
  const panel = node('details'); panel.className = 'camera-reference-controls'; panel.open = !!settings.cameraPanelOpen; host.append(panel);
  panel.append(node('summary', 'Camera study')); panel.ontoggle = () => {settings.cameraPanelOpen = panel.open;};
  const select = node('select'); select.setAttribute('aria-label', 'Reference camera zone');
  for (const record of world.records) select.add(new Option(`Zone ${record.index} · ${CAMERA_MODES[record.cameraMovementType] || 'Unknown mode'}`, record.index));
  settings.zone = Math.min(settings.zone, world.records.length - 1); select.value = settings.zone; panel.append(select);
  settings.point ||= cameraZoneCenter(world.records[settings.zone]); settings.yaw ??= 0; settings.height ??= 835;
  const toggles = [['Activation volumes', 'activation'], ['Camera constraint volumes', 'constraint'], ['Only selected camera zone', 'selectedZoneOnly'], ['Show camera view', 'cameraView']];
  for (const [label, field] of toggles) {
    const row = node('label', label), input = node('input'); row.className = 'reference-toggle'; input.type = 'checkbox'; input.checked = settings[field];
    input.onchange = () => {settings[field] = input.checked; update();}; row.prepend(input); panel.append(row);
  }
  const row = node('label', 'Reference position'); row.className = 'map-fields'; const inputs = [];
  for (let i = 0; i < 3; i++) {
    const input = node('input'); input.type = 'number'; input.step = 'any'; input.value = settings.point[i]; input.setAttribute('aria-label', `Camera reference ${['X', 'Y', 'Z'][i]}`);
    input.oninput = () => {if (inputs.some(el => el.value === '' || !el.validity.valid || !Number.isFinite(Number(el.value)))) return; settings.point = inputs.map(el => Number(el.value)); update();};
    row.append(input); inputs.push(input);
  }
  panel.append(row);
  const heading = node('label', 'Facing °'), yaw = node('input'); heading.className = 'map-fields'; yaw.type = 'number'; yaw.step = '1'; yaw.value = settings.yaw * 180 / Math.PI;
  yaw.setAttribute('aria-label', 'Camera reference facing'); yaw.oninput = () => {if (yaw.value !== '' && yaw.validity.valid && Number.isFinite(Number(yaw.value))) {settings.yaw = Number(yaw.value) * Math.PI / 180; update();}};
  heading.append(yaw); panel.append(heading);
  const heightRow = node('label', 'Reference height'), height = node('input'); heightRow.className = 'map-fields'; height.type = 'number'; height.min = '1'; height.step = 'any'; height.value = settings.height;
  height.setAttribute('aria-label', 'Camera reference height'); height.oninput = () => {if (height.value !== '' && height.validity.valid && Number.isFinite(Number(height.value))) {settings.height = Number(height.value); update();}};
  heightRow.append(height); panel.append(heightRow);
  const actions = node('div'); actions.className = 'action-stack'; panel.append(actions);
  function action(label, callback) {const button = node('button', label); button.type = 'button'; button.onclick = callback; actions.append(button); return button;}
  const place = action('Place reference on map', () => {
    if (getView()?.placing) {getView().cancelPlace(); place.textContent = 'Place reference on map'; return;}
    getView()?.place(point => {settings.point = point; inputs.forEach((input, i) => input.value = Number(point[i].toFixed(3))); place.textContent = 'Place reference on map'; update();});
    place.textContent = 'Click a map surface · click here to cancel';
  });
  action('Move reference with gizmo',()=>{getView()?.cancelPlace();getView()?.moveReference(settings.point,point=>{settings.point=point;inputs.forEach((input,i)=>input.value=Number(point[i].toFixed(3)));update();});});
  action('Center reference in zone', () => {settings.point = cameraZoneCenter(world.records[settings.zone]); inputs.forEach((input, i) => input.value = settings.point[i]); update();});
  action('Frame selected zone', () => getView()?.frame('cam', settings.zone));
  const status = node('p'); status.className = 'hint camera-study-status'; status.setAttribute('role', 'status'); panel.append(status);
  panel.append(Object.assign(node('p', 'Approximate composition from CAM rules and this reference point. Native coordinates; facing 0 = +Z. No player animation, camera collision, transitions or runtime smoothing. Zone selection is manual; overlap is reported below.'), {className: 'hint'}));
  function update() {
    configure();
    const currentView=getView();if(currentView?.editKind==='reference'&&!currentView.viewport.gizmo.dragging)currentView.viewport.setToolTarget({...currentView.viewport.toolTarget,position:[-settings.point[0],-settings.point[1],settings.point[2]]});
    try {
      const result = cameraStudy(world.records[settings.zone], settings.point, settings.yaw, settings.height);
      getView()?.study.update(result.supported ? result : null, settings.point, settings.yaw, settings.cameraView, settings.height);
      const containing = world.records.filter(record => cameraZoneContains(record, settings.point)).map(record => record.index);
      status.textContent = `${result.note} Activation at reference: ${containing.length ? containing.map(index => `zone ${index}`).join(', ') : 'outside all zones'}.`;
    } catch (error) {getView()?.study.update(null, settings.point, settings.yaw, false); status.textContent = error.message;}
  }
  select.onchange = () => {settings.zone = Number(select.value); update();}; update();
  return {updateWorld(value){world=value;select.value=settings.zone;update();},dispose() {getView()?.cancelPlace();if(getView()?.editKind==='reference')getView()?.endEdit();}};
}
