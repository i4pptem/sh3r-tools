import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Workbench} from '../core/workbench.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMap} from '../core/world-formats.mjs';
import {editMap, importMapGlb} from '../core/map-edit.mjs';
import {exportGlb} from '../core/gltf.mjs';

function fixture(type=1) {
  const data=Buffer.alloc(704),u=(at,values)=>values.forEach((v,i)=>data.writeUInt32LE(v>>>0,at+i*4)),f=(at,values)=>values.forEach((v,i)=>data.writeFloatLE(v,at+i*4));
  u(0,[0xffffffff,0,0,80]);u(24,[80,304,0,0]);u(80,[0,32,224,0,type,7]);
  f(112,[1,0,0,0,0,1,0,0,0,0,1,0,10,20,30,1]);
  for(let i=0;i<8;i++)f(176+i*16,[i&1?30:0,i&2?40:0,i&4?50:0,1]);
  for(const [at,header,length] of [[304,48,368],[352,48,320],[400,48,272],[448,64,224]])u(at,[0,header,length,0]);
  u(320,[1,4]);u(464,[4,type,7]);
  for(const [i,p] of [[0,[0,0,0]],[1,[4,0,0]],[2,[0,4,0]],[3,[0,4,0]]]){f(512+i*36,p);f(524+i*36,[0,0,1]);f(536+i*36,[.2,.3]);data.fill(255,544+i*36,548+i*36);}
  data.fill(0xb7,656);return data;
}
const edit=(part='Map_0_0')=>({part,translation:[0,0,0],rotation:[0,0,0],scale:[1,1,1],uvOffset:[0,0],uvScale:[1,1],materialGroup:null});

test('MAP no-op native and GLB edit preserves every byte including tails',()=>{
 const data=fixture();assert.deepEqual(editMap(data,edit()),data);assert.deepEqual(importMapGlb(data,exportGlb(parseMap(data).model)),data);
});
test('MAP UV editing preserves positions, strip separators and unknown payload',()=>{
 const data=fixture(),modified=editMap(data,{...edit(),uvOffset:[.25,.5]}),a=parseMap(data).model.meshes[0],b=parseMap(modified).model.meshes[0];
 assert.deepEqual(b.positions,a.positions);assert.deepEqual(b.indices,a.indices);assert.deepEqual(modified.subarray(656),data.subarray(656));
 assert.deepEqual(modified.subarray(512+2*36,512+3*36),modified.subarray(512+3*36,512+4*36));assert.ok(Math.abs(b.uv[0]-.45)<1e-7);
 for(let i=0;i<data.length;i++)if(data[i]!==modified[i])assert.ok(Array.from({length:4},(_,v)=>512+v*36+24).some(at=>i>=at&&i<at+8));
});
test('MAP static geometry can shrink but cannot leave its original visibility envelope',()=>{
 const data=fixture(),modified=editMap(data,{...edit(),scale:[.5,.5,.5]});assert.equal(parseMap(modified).model.triangleCount,1);
 assert.throws(()=>editMap(data,{...edit(),translation:[100,0,0]}),/visibility bounds/);assert.throws(()=>editMap(data,{...edit(),scale:[-1,1,1]}),/positive/);
});
test('MAP type3 geometry uses its matching absolute object matrix',()=>{
 const data=fixture(3),model=parseMap(data).model;assert.deepEqual(model.meshes[0].positions.slice(0,3),[-10,-20,30]);
 const modified=editMap(data,{...edit(),translation:[1,0,0]});assert.equal(parseMap(modified).model.meshes[0].positions[0],-9);
});
test('MAP GLB import rejects topology changes and diverging repeated strip vertices',()=>{
 const data=fixture(),world=parseMap(data);world.model.meshes[0].uv[6]=.9;assert.throws(()=>importMapGlb(data,exportGlb(world.model)),/repeated triangle-strip/);
 const other=parseMap(data);other.model.meshes[0].indices=[0,2,1];assert.throws(()=>importMapGlb(data,exportGlb(other.model)),/triangle and vertex order/);
});


test('MAP history belongs to the current staged edit and clears on asset revert',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sh3tools-map-'));t.after(()=>{assert.ok(dir.startsWith(path.join(os.tmpdir(),'sh3tools-map-')));fs.rmSync(dir,{recursive:true,force:true});});
 const data=fixture(),afs=Buffer.alloc(2048+data.length);afs.write('AFS\0');afs.writeUInt32LE(1,4);afs.writeUInt32LE(2048,8);afs.writeUInt32LE(data.length,12);data.copy(afs,2048);const file=path.join(dir,'test.afs');fs.writeFileSync(file,afs);
 const wb=new Workbench();wb.open(file);Object.assign(wb.archives[0].entries[0],{name:'test.map',extension:'map',detectedFormat:'map'});
 const first=editMap(data,{...edit(),uvOffset:[.1,0]});wb.stageMap('0:0',first,'first');const second=editMap(first,{...edit(),uvOffset:[.1,0]},data);wb.stageMap('0:0',second,'second');
 wb.undoMap('0:0');assert.deepEqual(wb.bytes('0:0'),first);assert.equal(wb.mapHistory.get('0:0').length,1);
 wb.undo('0:0');assert.deepEqual(wb.bytes('0:0'),data);assert.equal(wb.mapHistory.has('0:0'),false);assert.throws(()=>wb.undoMap('0:0'),/No map edits/);
});


test('MAP material assignment writes the owning group and rejects a different texture family',()=>{
 const single=fixture(),data=Buffer.alloc(1040);single.copy(data,0,0,672);single.copy(data,672,304,672);data.writeUInt32LE(672,304);data.writeUInt32LE(0,672);data.writeUInt32LE(9,692);
 const result=editMap(data,{...edit(),materialGroup:1});assert.equal(parseMap(result).model.meshes[0].textureIndex,9);
 for(let i=0;i<data.length;i++)if(data[i]!==result[i])assert.ok(i>=324&&i<328);
 const other=Buffer.from(data);other.writeUInt32LE(2,688);assert.throws(()=>editMap(other,{...edit(),materialGroup:1}),/same native texture family/);
});
