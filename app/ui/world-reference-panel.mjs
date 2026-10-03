import {worldRecordEditor} from './world-record-editor.mjs';
import {cameraReferenceControls} from './camera-reference-controls.mjs';
import {collisionEditor} from './collision-editor.mjs';
import {roomWindow} from './room-window.mjs';
const node=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};

/** Coordinate the floating room workspace and its independently editable native layers. */
export function worldReferencePanel(state,run,notify,openAsset,inspector) {
  const key=state.selected,choices=state.preview.world.references;
  state.referenceSettings ||= new Map();
  if(!state.referenceSettings.has(key))state.referenceSettings.set(key,{cld:{target:choices.cld.selected,visible:true},cam:{target:choices.cam.selected,visible:true},opacity:.18,xray:false,activation:true,constraint:true,selectedZoneOnly:false,zone:0,groups:{},cameraView:false,pickMode:'auto'});
  const settings=state.referenceSettings.get(key),data={},requests={cld:0,cam:0},editors={},statuses={},editHosts={};
  let view=null,dead=false,windowUI,layerSection,inspectorTabs,assetPane,cameraControls,autoControls,groupHost,cameraHost;
  const configure=()=>view?.configure(settings);
  function toggle(host,label,value,callback){const row=node('label',label),input=node('input');input.type='checkbox';input.checked=value;input.onchange=()=>callback(input.checked);row.className='reference-toggle';row.prepend(input);host.append(row);}
  function pickMode(value){settings.pickMode=value;view?.endEdit();windowUI.setPick(value);configure();}
  function setMode(mode){
    if(state.busy)return;
    if(view?.editKind==='reference'){if(mode!=='translate')notify('The reference character is a position marker. Use Move (E).');windowUI.tool('translate');return;}
    if(editors[view?.editKind])editors[view.editKind].setMode(mode);else state.mapSetMode?.(mode);
    windowUI.tool(view?.viewport.gizmo?.mode||'translate');
  }
  function makeUI(viewport){
    windowUI=roomWindow(viewport.host.parentElement,{session:settings.panel ||= {tab:'cld',expanded:false},pickMode,selectMode:setMode,apply:()=>state.mapApply?.(),undo:()=>state.mapUndo?.(),discard:()=>state.mapDiscard?.()});
    windowUI.setPick(settings.pickMode);windowUI.tool(state.mapMode||'translate');
    layerSection=node('details');layerSection.className='inspector-section world-layers';layerSection.open=true;layerSection.append(node('summary','Layers'));const layers=node('div');layers.className='world-references';layerSection.append(layers);assetPane=node('div');assetPane.className='map-inspector-assets';for(const child of [...inspector.children])if(!child.classList.contains('eyebrow'))assetPane.append(child);
    inspectorTabs=node('div');inspectorTabs.className='map-inspector-tabs';inspectorTabs.setAttribute('role','tablist');inspectorTabs.setAttribute('aria-label','Map Inspector');
    const entries=[['assets','Assets',assetPane],['layers','Layers',layerSection]],tabButtons=[];
    function showInspector(id){settings.inspectorTab=id;entries.forEach(([name,,pane],i)=>{pane.classList.toggle('hidden',name!==id);tabButtons[i].setAttribute('aria-selected',String(name===id));tabButtons[i].tabIndex=name===id?0:-1;});}
    for(const [id,label]of entries){const button=node('button',label);button.setAttribute('role','tab');button.onclick=()=>showInspector(id);button.onkeydown=event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const next=id==='assets'?'layers':'assets';showInspector(next);tabButtons[next==='assets'?0:1].focus();}};tabButtons.push(button);inspectorTabs.append(button);}
    inspector.append(inspectorTabs,assetPane,layerSection);showInspector(settings.inspectorTab||'assets');
    for(const [kind,title]of [['cld','Collision layer'],['cam','Camera zones layer']]){
      editHosts[kind]=node('div');windowUI.panes[kind].classList.add('world-references');
      toggle(layers,title,settings[kind].visible,value=>{settings[kind].visible=value;configure();});
      const select=node('select');select.setAttribute('aria-label',`${kind.toUpperCase()} reference file`);select.add(new Option('None',''));
      for(const item of choices[kind].candidates)select.add(new Option(`${item.name.split('/').pop()} · ${item.archive}`,item.key));
      if(!settings[kind].manual||(settings[kind].target&&!choices[kind].candidates.some(item=>item.key===settings[kind].target)))settings[kind].target=choices[kind].selected;
      select.value=settings[kind].target||'';select.onchange=()=>{state.mapDrafts.end();view.endEdit();settings[kind].manual=true;settings[kind].target=select.value||null;if(kind==='cam'){delete settings.point;settings.zone=0;}load(kind);};layers.append(select);
      statuses[kind]=node('p');statuses[kind].className='hint';statuses[kind].setAttribute('role','status');windowUI.panes[kind].append(statuses[kind],editHosts[kind]);
    }
    toggle(layers,'See layers through map',settings.xray,value=>{settings.xray=value;configure();});
    const label=node('label','Layer opacity'),opacity=node('input');opacity.type='range';opacity.min='.03';opacity.max='.6';opacity.step='.01';opacity.value=settings.opacity;opacity.setAttribute('aria-label','Reference layer opacity');opacity.oninput=()=>{settings.opacity=Number(opacity.value);configure();};label.append(opacity);layers.append(label);
    layers.append(Object.assign(node('p','Pick visible selects the nearest visible mesh, collision or camera surface. Use a layer filter when surfaces overlap.'),{className:'hint'}));
    groupHost=node('div');layers.append(groupHost);cameraHost=node('div');windowUI.panes.cam.append(cameraHost);
    autoControls=collisionEditor(windowUI.panes.auto,state,()=>state.mapSelection?.()||[],run,notify,openAsset);draftChanged();
  }
  function working(kind){
    if(!data[kind])return null;const world=structuredClone(data[kind]);
    for(const record of state.mapDrafts.reference(key,world.key)?.records||[])if(kind==='cam')world.records[record.index]=record;else world.groups[record.group].records[record.index]=record;
    return world;
  }
  function previewChanged(kind,zone){
    if(zone!==undefined)settings.zone=zone;view?.load(kind,working(kind));configure();
    if(kind==='cam')cameraControls?.updateWorld(working(kind));draftChanged();
  }
  function buildEditor(kind){
    editors[kind]?.dispose();view.pickers.delete(kind);editHosts[kind].replaceChildren();
    editors[kind]=worldRecordEditor(editHosts[kind],data[kind],kind,state,notify,()=>view,zone=>previewChanged(kind,zone));
    if(data[kind])view.pickers.set(kind,(record,event)=>{windowUI.show(kind,true);editors[kind].pick(record,event);windowUI.tool(view.viewport.gizmo.mode);});
  }
  function refreshCameras(){cameraControls?.dispose();cameraHost.replaceChildren();cameraControls=cameraReferenceControls(cameraHost,working('cam'),settings,()=>view,configure);}
  function collisionGroups(){groupHost.replaceChildren();if(!data.cld)return;groupHost.append(node('h4','Visible collision groups'));for(const group of data.cld.groups)toggle(groupHost,`${group.name} · ${group.count}`,settings.groups[group.name]!==false,value=>{settings.groups[group.name]=value;configure();});}
  async function load(kind){
    const request=++requests[kind],target=settings[kind].target;data[kind]=null;view.load(kind,null);buildEditor(kind);
    if(kind==='cam')refreshCameras();else collisionGroups();statuses[kind].textContent=target?'Loading layer…':`Choose a ${kind.toUpperCase()} file in Layers.`;if(!target)return;
    try{
      const result=await window.studio.request('worldReference',{key,target});if(dead||request!==requests[kind])return;
      if(!result){statuses[kind].textContent='Reload sources, then select the layer file again.';return;}
      data[kind]=result;view.load(kind,working(kind));configure();buildEditor(kind);statuses[kind].textContent=result.name+(result.disabled?' · disabled by native CLD header':'');
      if(kind==='cam')refreshCameras();else collisionGroups();
    }catch(error){if(!dead&&request===requests[kind]){statuses[kind].textContent=error.message;notify(error.message);}}
  }
  function draftChanged(){
    if(!windowUI)return;const draft=state.mapDrafts.snapshot(key),count=draft.edits.length+draft.references.reduce((n,r)=>n+r.records.length,0),failure=state.mapDrafts.failures.get(key);
    windowUI.status(failure?`Apply failed: ${failure}`:count?`${count} pending edit(s) · Apply updates this room together.`:'Room is up to date.');autoControls?.refresh();
  }
  return {
    attach(viewport){view=viewport.references;makeUI(viewport);view.onPickMode=pickMode;view.onToolMode=mode=>windowUI.tool(mode);configure();load('cld');load('cam');},
    setMode,draftChanged,
    meshSelection(){if(view){pickMode('map');windowUI.tool(state.mapMode||'translate');}},
    setVisible(value){windowUI?.panel.classList.toggle('hidden',!value);},
    validate(){return Object.values(editors).every(editor=>editor.validate?.()!==false);},
    refresh(){for(const kind of ['cld','cam']){previewChanged(kind);editors[kind]?.refresh();}draftChanged();},
    dispose(){dead=true;cameraControls?.dispose();autoControls?.dispose?.();for(const editor of Object.values(editors))editor.dispose();view?.pickers.clear();windowUI?.dispose();layerSection?.remove();inspectorTabs?.remove();assetPane?.remove();},
  };
}
