import {MapNavigation} from '../app/ui/map-navigation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {Vector3,Matrix4,PerspectiveCamera} from 'three';
import {collisionSelectionCenter,collisionRotationAxes,transformCollisionSelection} from '../core/collision-transform.mjs';
import {worldToolMode} from '../app/ui/editor-shortcuts.mjs';
const wall=(index,x)=>({group:1,index,material:7,vertices:[[x,0,0],[x+10,0,0],[x+10,-20,0],[x,-20,0]]});

test('several collision walls rotate and scale about one common pivot, preserving native rectangles',()=>{
 const records=[wall(0,0),wall(1,30)],center=collisionSelectionCenter(records),matrix=new Matrix4().makeTranslation(...center).multiply(new Matrix4().makeRotationY(Math.PI/2)).multiply(new Matrix4().makeScale(2,3,2)).multiply(new Matrix4().makeTranslation(...center.map(v=>-v)));
 const output=transformCollisionSelection(records,{position:center,rotation:[0,Math.PI/2,0],scale:[2,3,2]});
 for(let r=0;r<records.length;r++)for(let i=0;i<4;i++){const p=records[r].vertices[i],v=new Vector3(-p[0],-p[1],p[2]).applyMatrix4(matrix),actual=output[r].vertices[i];assert.ok(new Vector3(...actual).distanceTo(new Vector3(-v.x,-v.y,v.z))<1e-5);}
 assert.equal(output[0].material,7);assert.equal(output[1].index,1);assert.equal(output[0].vertices[0][1],output[0].vertices[1][1]);assert.equal(output[0].vertices[0][0],output[0].vertices[3][0]);
 assert.equal(collisionRotationAxes(records),'Y');assert.throws(()=>transformCollisionSelection(records,{position:center,rotation:[.1,0,0],scale:[1,1,1]}),/upright/);
});
test('floor polygons support all axes, cylinders keep circular radius and absolute top height in group transforms',()=>{
 const floor={group:0,index:0,vertices:[[0,0,0],[10,0,0],[0,0,10]]};assert.equal(collisionRotationAxes([floor]),'XYZ');
 const tilted=transformCollisionSelection([floor],{position:collisionSelectionCenter([floor]),rotation:[Math.PI/4,0,0],scale:[1,1,1]});assert.notEqual(tilted[0].vertices[0][1],tilted[0].vertices[2][1]);
 const cylinders=[{group:4,index:0,position:[-20,0,0],topY:-10,radius:3},{group:4,index:1,position:[20,0,0],topY:-10,radius:3}];
 const out=transformCollisionSelection(cylinders,{position:collisionSelectionCenter(cylinders),rotation:[0,Math.PI/2,0],scale:[1,2,3]});
 assert.equal(out[0].radius,9);assert.equal(out[1].radius,9);assert.equal(out[0].position[1]-out[0].topY,20);assert.ok(Math.abs(Math.abs(out[0].position[2]-out[1].position[2])-120)<1e-5);
 assert.throws(()=>transformCollisionSelection([floor],{position:[0,0,0],rotation:[0,0,0],scale:[0,1,1]}),/positive/);
});
test('world tools use physical E/R/T, respect editing focus and never steal modifier shortcuts',()=>{
 const previous=globalThis.document;globalThis.document={querySelector:()=>null};
 try{const state={page:'library',busy:false,preview:{world:{editable:true}}},event={code:'KeyR',key:'к',target:{closest:()=>null}};assert.equal(worldToolMode(event,state),'rotate');assert.equal(worldToolMode(event,{...state,page:'world'}),'rotate');assert.equal(worldToolMode({...event,code:'KeyE'},state),'translate');assert.equal(worldToolMode({...event,code:'KeyT'},state),'scale');assert.equal(worldToolMode({...event,ctrlKey:true},state),null);assert.equal(worldToolMode({...event,target:{closest:()=>({})}},state),null);assert.equal(worldToolMode(event,{...state,busy:true}),null);}finally{globalThis.document=previous;}
});
test('application prompts accept only their own sender and active response, with explicit cancellation',async()=>{
 const require=createRequire(import.meta.url),factory=require('../app/app-prompts.cjs'),handlers=new Map(),sent=[];
 const prompts=factory({handle:(name,fn)=>handlers.set(name,fn)},()=>({webContents:{send:(channel,value)=>sent.push(value)}}),event=>{if(event!=='trusted')throw new Error('Untrusted');});
 const result=prompts.ask({message:'Build?',buttons:['Build','Cancel'],cancelId:1});assert.equal(prompts.active,true);assert.throws(()=>prompts.ask({}),/open dialog/);
 const reply=handlers.get('studio:prompt-answer');assert.throws(()=>reply('wrong',{id:1,response:0}),/Untrusted/);assert.throws(()=>reply('trusted',{id:1,response:4}),/no longer/);assert.equal(prompts.active,true);
 reply('trusted',{id:sent[0].id,response:0,checkboxChecked:true});assert.deepEqual(await result,{response:0,checkboxChecked:true});assert.equal(prompts.active,false);
 assert.throws(()=>reply('trusted',{id:1,response:0}),/no longer/);const cancel=prompts.ask({buttons:['Keep','Discard'],cancelId:0});prompts.cancel();assert.deepEqual(await cancel,{response:0,checkboxChecked:false});
});

test('X/C move the focused camera up/down and E remains available to the transform tool',()=>{
 const oldWindow=globalThis.window,oldDocument=globalThis.document;
 globalThis.window=new EventTarget();globalThis.document=new EventTarget();
 const canvas=Object.assign(new EventTarget(),{setAttribute(){},offsetParent:{}}),camera=new PerspectiveCamera(),orbit={target:new Vector3(),enabled:true};
 const navigation=new MapNavigation(canvas,camera,orbit);navigation.enabled=true;
 const key=code=>canvas.dispatchEvent(Object.assign(new Event('keydown',{cancelable:true}),{code}));
 try{key('KeyX');navigation.update(1);assert.equal(camera.position.y,100);navigation.reset();key('KeyC');navigation.update(1);assert.equal(camera.position.y,0);navigation.reset();key('KeyE');navigation.update(1);assert.equal(camera.position.y,0);assert.equal(navigation.keys.size,0);}finally{navigation.dispose();globalThis.window=oldWindow;globalThis.document=oldDocument;}
});
