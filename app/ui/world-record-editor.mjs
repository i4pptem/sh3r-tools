import {collisionSelectionCenter,collisionRotationAxes,transformCollisionSelection} from '../../core/collision-transform.mjs';
import {displayPoint,recordCenter,transformWorldRecord} from '../../core/world-shapes.mjs';
import {hasFixedDirection,cameraEditorRotation,orientCamera} from '../../core/camera-orientation.mjs';
import {CollisionSelection} from './collision-selection.mjs';
import {referenceFields} from './reference-fields.mjs';
const node=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};

/** Native record selection and gestures share the room's draft transaction. */
export function worldRecordEditor(host,world,kind,state,notify,getView,previewChanged) {
  if(!world)return {refresh(){},dispose(){}};
  const key=state.selected,drafts=state.mapDrafts,hash=state.preview.hash,isCollision=kind==='cld';
  const records=isCollision?world.groups.flatMap((g,group)=>g.records.map((r,index)=>({...r,group,index}))):world.records.map(r=>({...r}));
  const centerOf=(records,region)=>region?recordCenter(records[0],region):collisionSelectionCenter(records);
  const connections=isCollision?new CollisionSelection(records):null;
  const panel=node('details');panel.className='inspector-section record-editor';panel.open=true;panel.append(node('summary',isCollision?'Edit collision records':'Edit camera zones'));host.append(panel);
  const select=node('select');select.setAttribute('aria-label',`${kind.toUpperCase()} edit record`);select.multiple=isCollision;if(isCollision)select.size=5;panel.append(select);
  for(const [i,r]of records.entries())select.add(new Option(isCollision?`${world.groups[r.group].name} · ${r.index}`:`Zone ${r.index}`,i));
  state.referenceSelections ||= new Map();const selectionKey=`${key}/${world.key}`,saved=state.referenceSelections.get(selectionKey)||[0];
  for(const option of select.options)option.selected=saved.includes(Number(option.value));
  const region=node('select');region.setAttribute('aria-label','Camera edit region');region.add(new Option('Activation volume','active'));region.add(new Option('Camera constraint / sight direction','constraint'));if(!isCollision)panel.append(region);
  const status=node('p');status.className='hint';status.setAttribute('role','status');panel.append(status);
  let active=false,mode='translate',gestureBase=null,dead=false;
  const indices=()=>[...select.selectedOptions].map(o=>Number(o.value)),area=()=>isCollision?null:region.value;
  const current=()=>{const edits=new Map((drafts.reference(key,world.key)?.records||[]).map(r=>[`${r.group??''}:${r.index}`,r]));return indices().map(index=>edits.get(`${records[index].group??''}:${records[index].index}`)||structuredClone(records[index]));};
  const blocked=()=>isCollision&&(world.boundOwner&&world.boundOwner!==key||current().some(r=>world.boundGroups.includes(r.group)));
  function action(parent,label,callback){const b=node('button',label);b.type='button';b.onclick=callback;parent.append(b);return b;}
  const unit=node('select');unit.setAttribute('aria-label','Collision selection unit');for(const [name,value]of [['Connected surface','surface'],['Single face','face'],['Whole native group','group']])unit.add(new Option(name,value));
  function setSelected(values){for(const option of select.options)option.selected=values.includes(Number(option.value));}
  if(isCollision){
    panel.append(unit);const help=node('details');help.append(node('summary','Selection help'),Object.assign(node('p','Shift-click adds a surface; Ctrl-click toggles it. The list supports Shift ranges and Ctrl selection. Connected surfaces share full edges within one native group.'),{className:'hint'}));panel.append(help);
    const scope=node('div');scope.className='map-gizmo-modes';panel.append(scope);
    action(scope,'Select connected',()=>{setSelected([...new Set(indices().flatMap(i=>connections.connected(i)))]);activate();});
    action(scope,'Select group',()=>{setSelected([...new Set(indices().flatMap(i=>connections.group(i)))]);activate();});
    action(scope,'Select all',()=>{setSelected(records.map((_,i)=>i));activate();});
  }
  const actions=node('div');actions.className='map-gizmo-modes';panel.append(actions);const toolButtons=[];
  for(const [label,value]of [['Move','translate'],['Rotate Y','rotate'],['Scale','scale']])toolButtons.push(action(actions,label,()=>{mode=value;activate();}));
  action(panel,'Return to map meshes',()=>{active=false;getView()?.onPickMode?.('map');getView()?.endEdit();refresh();});
  const coordinates=node('label','Position');coordinates.className='map-fields';coordinates.dataset.mapTransform='';panel.append(coordinates);const inputs=[];
  for(let axis=0;axis<3;axis++){
    const input=node('input');input.type='number';input.step='any';input.setAttribute('aria-label',`${kind.toUpperCase()} position ${'XYZ'[axis]}`);inputs.push(input);coordinates.append(input);
    input.onfocus=()=>drafts.begin(key);input.onblur=endGesture;
    input.oninput=()=>{if(!drafts.transaction)drafts.begin(key);if(inputs.some(el=>el.value===''||!el.validity.valid))return;const base=current();if(base.length)moveSelection(base,displayPoint(inputs.map(el=>Number(el.value))));};
  }
  const fields=referenceFields(panel,kind,{begin:()=>drafts.begin(key),end:endGesture,read:()=>current()[0],write:r=>store([r])});
  const footer=node('div');footer.className='action-stack';panel.append(footer);
  action(footer,'Frame selected record',()=>{if(current().length)getView()?.frameRecords(kind,current(),area());});
  function endGesture(){drafts.end();state.mapRefresh?.();}
  function store(changed){
    if(dead||state.busy||blocked())return;
    try{drafts.setReferences(key,hash,world,kind,changed,records);previewChanged(isCollision?undefined:changed[0].index);refresh();state.mapRefresh?.();}catch(error){notify(error.message);}
  }
  function moveSelection(base,position){
    const center=centerOf(base,area()),delta=position.map((v,i)=>v-center[i]);
    store(base.map(r=>transformWorldRecord(r,area(),{position:recordCenter(r,area()).map((v,i)=>v+delta[i]),rotation:[0,0,0],scale:[1,1,1]})));
  }
  function pick(chosen,event){
      const index=records.findIndex(r=>r.index===chosen.index&&(!isCollision||r.group===chosen.group));if(index<0)return;
      setSelected(isCollision?connections.pick(indices(),index,{unit:unit.value,extend:!!event?.shiftKey,toggle:!!(event?.ctrlKey||event?.metaKey)}):[index]);
      if(chosen.region)region.value=chosen.region;drafts.end();gestureBase=null;activate();
  }
  function bindTool(){
    if(!active||!getView())return;
    getView().edit(kind,()=>{active=false;refresh();});
    const selected=current();getView().selectRecords(kind,selected,area());
    if(!selected.length||blocked()){getView().viewport.setToolTarget({position:null});return;}
    const r=selected[0],direction=!isCollision&&area()==='constraint'&&hasFixedDirection(r)&&mode==='rotate';
    getView().viewport.setToolTarget({position:centerOf(selected,area()),mode,rotation:direction?cameraEditorRotation(r):[0,0,0],rotationOrder:isCollision||direction?'YXZ':'XYZ',space:direction?'local':'world',axes:mode==='rotate'?(isCollision?collisionRotationAxes(selected):direction?'XY':'Y'):'XYZ',
      gesture(value){if(value){gestureBase=current();drafts.begin(key);}else{drafts.end();gestureBase=null;refresh();state.mapRefresh?.();}},
      change(transform){try{if(transform.scale.some(v=>v<=0))return;const base=gestureBase||selected;if(direction)store([orientCamera(base[0],transform.quaternion)]);else if(isCollision)store(transformCollisionSelection(base,transform));else store([transformWorldRecord(base[0],area(),transform)]);}catch(error){notify(error.message);}},
    });
  }
  function activate(){if(!records.length)return;const pickMode=getView()?.settings.pickMode;if(pickMode&&pickMode!=='auto'&&pickMode!==kind)getView().onPickMode?.(kind);active=true;panel.open=true;getView()?.cancelPlace();refresh();}
  function refresh(){
    if(dead)return;const selected=current(),r=selected[0],locked=blocked()||!r,multiple=selected.length>1;
    state.referenceSelections.set(selectionKey,indices());const p=r?displayPoint(centerOf(selected,area())):[0,0,0];
    inputs.forEach((input,i)=>{if(document.activeElement!==input)input.value=Number(p[i].toFixed(4));input.disabled=state.busy||locked;input.dataset.unavailable=String(locked);});fields.refresh(r,state.busy||locked||multiple);
    const anchor=!isCollision&&r&&area()==='constraint'&&[6,7].includes(r.cameraMovementType),fixed=!isCollision&&r&&area()==='constraint'&&hasFixedDirection(r);
    if(anchor&&(mode==='scale'||!fixed&&mode==='rotate'))mode='translate';
    toolButtons[1].textContent=fixed?'Rotate view':isCollision&&collisionRotationAxes(selected)==='XYZ'?'Rotate':'Rotate Y';
    toolButtons.forEach((button,i)=>{const unavailable=locked||anchor&&(i===2||i===1&&!fixed);button.disabled=state.busy||unavailable;button.dataset.unavailable=String(unavailable);button.classList.toggle('active',active&&['translate','rotate','scale'][i]===mode);});
    status.textContent=!r?'Select collision records in the list or viewport.':locked?'Auto rebuild owns this collision. Edit its source meshes, or use Auto rebuild → Stop auto rebuild to keep and edit it manually.':`${selected.length} selected · ${fixed?'Rotate view changes camera pitch/yaw; activation and constraint bounds stay unchanged.':isCollision?`${multiple?'Shared selection pivot. ':''}${collisionRotationAxes(selected)==='Y'?'Walls/cylinders rotate around Y; cylinders scale equally in X/Z.':'Rotate and scale with E/R/T tools.'}`:active?'Drag the gizmo or pick in this layer.':'Choose a transform tool to edit this layer.'} Preview changes need Apply.`;
    if(active&&!getView()?.viewport.gizmo.dragging)bindTool();
  }
  select.onchange=()=>{drafts.end();activate();};region.onchange=()=>{drafts.end();activate();};refresh();
  return {refresh,pick,setMode(value){mode=value;activate();},validate(){const invalid=[...panel.querySelectorAll('input')].find(input=>!input.disabled&&!input.parentElement.hidden&&(input.value===''||!input.validity.valid||!Number.isFinite(Number(input.value))));if(invalid){panel.open=true;invalid.closest('details').open=true;invalid.focus();return false;}return true;},dispose(){dead=true;if(active)getView()?.endEdit();}};
}
