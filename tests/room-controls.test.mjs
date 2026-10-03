import test from 'node:test';
import assert from 'node:assert/strict';
import {Euler,Quaternion,Vector3,Object3D,PerspectiveCamera,Raycaster} from 'three';
import {TransformControls} from 'three/addons/controls/TransformControls.js';
import {ModelViewport} from '../app/ui/viewport.mjs';
import {WorldReferenceView} from '../app/ui/world-reference-view.mjs';
import {CollisionSelection} from '../app/ui/collision-selection.mjs';
import {MapDrafts,mapEditDefaults} from '../app/ui/map-drafts.mjs';
import {hasFixedDirection,cameraEditorRotation,orientCamera} from '../core/camera-orientation.mjs';
import {cameraStudy} from '../core/camera-study.mjs';
import {recordCenter,transformWorldRecord} from '../core/world-shapes.mjs';
import {cameraFixture} from './helpers/camera-fixture.mjs';
import {parseCameras} from '../core/world-formats.mjs';
import {editCameras} from '../core/camera-edit.mjs';

const polygon=(group,index,vertices)=>({group,index,vertices});
const a=polygon(0,0,[[0,0,0],[2,0,0],[2,0,2],[0,0,2]]);
const b=polygon(0,1,[[2,0,0],[4,0,0],[4,0,2],[2,0,2]]);
const c=polygon(0,2,[[4,0,2],[6,0,2],[6,0,4],[4,0,4]]);
const wall=polygon(1,0,[[0,0,0],[2,0,0],[2,-2,0],[0,-2,0]]);
test('collision surface selection follows complete edges in its native group, not shared corners',()=>{
 const select=new CollisionSelection([a,b,c,wall,{group:4,index:0,position:[1,0,1],radius:1,topY:-2}]);
 assert.deepEqual(select.connected(0),[0,1]);assert.deepEqual(select.connected(2),[2]);assert.deepEqual(select.connected(3),[3]);assert.deepEqual(select.connected(4),[4]);
 assert.deepEqual(select.group(0),[0,1,2]);assert.deepEqual(select.pick([],0),[0,1]);
 assert.deepEqual(select.pick([0,1],2,{extend:true}),[0,1,2]);assert.deepEqual(select.pick([0,1,2],0,{toggle:true}),[2]);
 assert.deepEqual(select.pick([0],1,{unit:'face',extend:true}),[0,1]);assert.deepEqual(select.pick([],1,{unit:'group'}),[0,1,2]);
 const repeated=new CollisionSelection([polygon(0,0,[[0,0,0],[1,0,0],[0,0,1],[0,0,0]]),polygon(0,1,[[0,0,0],[-1,0,0],[0,0,-1],[0,0,0]])]);assert.deepEqual(repeated.connected(0),[0]);
});

test('moving a collision selection translates every record and undoes the whole gesture once',()=>{
 const originals=[a,b],world={key:'cld',hash:'native'},drafts=new MapDrafts();
 const edit=mapEditDefaults('mesh');edit.rotation[1]=15;drafts.set('map','hash',edit);drafts.begin('map');
 for(const distance of [1,2,3]){
  const records=originals.map(r=>transformWorldRecord(r,null,{position:recordCenter(r).map((v,i)=>v+(i===0?distance:0)),rotation:[0,0,0],scale:[1,1,1]}));
  drafts.setReferences('map','hash',world,'cld',records,originals);
 }
 drafts.end();const changed=drafts.reference('map','cld').records;
 assert.equal(changed[0].vertices[0][0],-3);assert.equal(changed[1].vertices[0][0],-1);assert.equal(drafts.count,3);
 assert.throws(()=>drafts.setReferences('map','hash',world,'cld',[{...a,index:99}],originals),/existing reference/);assert.equal(drafts.count,3);
 assert.ok(drafts.undo('map'));assert.equal(drafts.count,1);assert.equal(drafts.get('map','mesh').rotation[1],15);
});

test('failed Apply retains the exact map and reason until edited, discarded or applied',()=>{
 const drafts=new MapDrafts(),edit=mapEditDefaults('mesh');edit.rotation[1]=35;drafts.set('roomA','hash',edit);drafts.set('roomB','hash',edit);
 drafts.failure('roomA','Mesh is outside its native bounds.');
 assert.deepEqual(drafts.pending([{key:'roomA',name:'tpf1.map'}]),[{key:'roomA',name:'tpf1.map',error:'Mesh is outside its native bounds.'},{key:'roomB',name:'roomB',error:null}]);
 drafts.set('roomA','hash',edit);assert.ok(drafts.failures.has('roomA'));
 edit.rotation[1]=25;drafts.set('roomA','hash',edit);assert.equal(drafts.failures.has('roomA'),false);
 drafts.failure('roomA','Another error');drafts.clear('roomA');assert.equal(drafts.count,1);assert.equal(drafts.failures.size,0);
});

test('fixed camera editor orientation matches native sight direction for both fixed modes',()=>{
 for(const mode of [2,7])for(const pitch of [-.5,0,.7])for(const yaw of [-3.5,0,4.5]){
  const record={...parseCameras(cameraFixture()).records[0],cameraMovementType:mode,movementParameters:[pitch,yaw,.15,1200]};
  const quaternion=new Quaternion().setFromEuler(new Euler(...cameraEditorRotation(record),'YXZ'));
  const forward=new Vector3(0,0,1).applyQuaternion(quaternion);
  const native=new Vector3(-Math.cos(pitch)*Math.sin(yaw),Math.sin(pitch),Math.cos(pitch)*Math.cos(yaw));
  assert.ok(forward.distanceTo(native)<1e-12);
  const result=cameraStudy(record,[0,0,0],0,835),direction=new Vector3(...result.target).sub(new Vector3(...result.position)).normalize();
  const displayed=new Vector3(-direction.x,-direction.y,direction.z);assert.ok(displayed.distanceTo(forward)<1e-6);
  const roundTrip=orientCamera(record,quaternion.toArray());assert.ok(Math.abs(roundTrip.movementParameters[0]-pitch)<1e-6);assert.ok(Math.abs(roundTrip.movementParameters[1]-yaw)<1e-6);
 }
});

test('camera rotation writes pitch/yaw while preserving camera volumes, offsets and native roll',()=>{
 const data=cameraFixture(),record=parseCameras(data).records[0];record.cameraMovementType=7;record.movementParameters=[0,0,.3,456];
 const q=new Quaternion().setFromEuler(new Euler(-.4,-.6,0,'YXZ')),changed=orientCamera(record,q.toArray());
 const expected=structuredClone(record);expected.movementParameters=[Math.fround(.4),Math.fround(.6),.3,456];assert.deepEqual(changed,expected);
 const result=parseCameras(editCameras(data,[changed])).records[0];assert.deepEqual(result.activeGroundPoints,record.activeGroundPoints);assert.deepEqual(result.constraintGroundPoints,record.constraintGroundPoints);
 assert.equal(result.movementParameters[0],Math.fround(.4));assert.equal(result.movementParameters[2],Math.fround(.3));
 assert.equal(hasFixedDirection({...record,cameraMovementType:6}),false);assert.throws(()=>orientCamera({...record,cameraMovementType:6},q.toArray()),/follows its subject/);
});

test('camera gizmo uses local pitch/yaw and restores world XYZ for map editing',()=>{
 const viewport=Object.create(ModelViewport.prototype);viewport.pivot=new Object3D();viewport.gizmo=new TransformControls(new PerspectiveCamera(),Object.assign(new EventTarget(),{style:{}}));
 viewport.setToolTarget({position:[1,2,3],mode:'rotate',rotation:[.1,.2,0],rotationOrder:'YXZ',space:'local',axes:'XY'});
 assert.equal(viewport.pivot.rotation.order,'YXZ');assert.equal(viewport.gizmo.space,'local');assert.equal(viewport.gizmo.showZ,false);
 viewport.setToolTarget({position:null});viewport.syncGizmo();assert.equal(viewport.gizmo.object,undefined);
 viewport.clearToolTarget();assert.equal(viewport.pivot.rotation.order,'XYZ');assert.equal(viewport.gizmo.space,'world');assert.equal(viewport.gizmo.showZ,true);viewport.gizmo.dispose();
});

test('collision picking forwards Shift/Ctrl state to its selection owner',()=>{
 const view=Object.create(WorldReferenceView.prototype),record={group:0,index:1};let received;
 view.settings={pickMode:'cld'};view.viewport={navigation:{speed:100}};const group={visible:true,children:[]};group.children.push({visible:true,userData:record,parent:group});view.layers=new Map([['cld',group]]);view.pickers=new Map([['cld',(record,event)=>received={record,event}]]);
 const ray=new Raycaster();ray.intersectObjects=meshes=>[{object:meshes[0]}];const event={shiftKey:true,ctrlKey:false};assert.ok(view.pick(ray,event));assert.equal(received.record,record);assert.equal(received.event,event);assert.equal(view.editKind,undefined);

});
