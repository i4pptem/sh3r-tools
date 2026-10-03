import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {exportGlb} from '../core/gltf.mjs';
import {mapFixture,subdividedPart} from './helpers/map-fixture.mjs';
import {parseCollision,parseMap} from '../core/world-formats.mjs';
import {rebuildCollision} from '../core/collision-rebuild.mjs';
import {collisionPolygons} from '../core/collision-polygons.mjs';
import {Workbench} from '../core/workbench.mjs';
import {sha256} from '../core/binary.mjs';

export function collisionFixture() {
  const data=Buffer.alloc(1024);data.writeFloatLE(-10000,0);data.writeFloatLE(-10000,4);data.writeInt32LE(-1,0x174);
  for(let i=0;i<80;i++)data.writeUInt32LE(0x174,0x20+i*4);
  let offset=0x180;
  for(let g=0;g<5;g++){const stride=g===4?48:80,count=g===0?2:1;data.writeUInt32LE(stride*count,8+g*4);data.writeUInt32LE(offset,0x160+g*4);offset+=stride*count;}
  data[0x180]=1;data[0x181]=1;data.writeUInt32LE(4,0x184);data.writeUInt32LE(7,0x188);
  [[0,0,0,1],[1,0,0,1],[1,0,1,1],[0,0,1,1]].forEach((p,i)=>p.forEach((v,k)=>data.writeFloatLE(v,0x190+i*16+k*4)));data.fill(0xac,offset);
  return data;
}
const binding={group:0,parts:['Map_0_0'],template:0,material:7};
test('CLD rebuild writes native metadata, reverse render winding, terminators and room indices',()=>{
  const base=collisionFixture(), map=mapFixture(), data=rebuildCollision(base,map,[binding],'room'), parsed=parseCollision(data);
  assert.equal(parsed.groups[0].count,1);assert.equal(parsed.groups[0].records[0].shape,0);assert.equal(parsed.groups[0].records[0].weight,4);
  assert.deepEqual(parsed.groups[0].spatialCells[0],[0]);assert.ok(parsed.groups[0].spatialCells.slice(1).every(list=>!list.length));
  const p=parsed.groups[0].records[0].vertices;assert.deepEqual(p,[[10,20,30],[10,24,30],[14,20,30]]);
  for(let g=1;g<5;g++){const old=base.readUInt32LE(0x160+g*4),next=data.readUInt32LE(0x160+g*4),size=base.readUInt32LE(8+g*4);assert.deepEqual(data.subarray(next,next+size),base.subarray(old,old+size));}
  assert.equal(data.at(-1),0xac);
});
test('CLD outdoor indexing includes intersected cells and refuses unreachable geometry',()=>{
  const base=collisionFixture(),map=mapFixture(),data=rebuildCollision(base,map,[binding],'grid');
  assert.deepEqual(parseCollision(data).groups[0].spatialCells[10],[0]);
  const outside=Buffer.from(base);outside.writeFloatLE(20000,0);assert.throws(()=>rebuildCollision(outside,map,[binding],'grid'),/outdoor grid/);
});
test('wall triangles merge into native vertical rectangles and unsupported sloping triangles fail',()=>{
  const model={meshes:[{name:'wall',positions:[0,0,0,4,0,0,4,4,0,0,4,0],normals:[0,0,1,0,0,1,0,0,1,0,0,1],indices:[0,1,2,0,2,3]}]};
  const p=collisionPolygons(model,{group:1,parts:['wall']});assert.equal(p.length,1);assert.equal(p[0].vertices.length,4);
  model.meshes[0].positions[7]=5;assert.throws(()=>collisionPolygons(model,{group:1,parts:['wall']}),/vertical rectangular/);
});
function workspace(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sh3-collision-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const map=mapFixture(),cld=collisionFixture(),data=Buffer.alloc(4096+cld.length);data.write('AFS\0');data.writeUInt32LE(2,4);data.writeUInt32LE(128,24);data.writeUInt32LE(96,28);data.write('room.map',128);data.write('room.cld',176);
  data.writeUInt32LE(2048,8);data.writeUInt32LE(map.length,12);data.writeUInt32LE(4096,16);data.writeUInt32LE(cld.length,20);map.copy(data,2048);cld.copy(data,4096);
  const file=path.join(dir,'room.afs');fs.writeFileSync(file,data);const wb=new Workbench();wb.open(file);
  for(const [i,ext] of ['map','cld'].entries())Object.assign(wb.archives[0].entries[i],{name:`room.${ext}`,extension:ext,detectedFormat:ext});
  return {wb,dir,map,cld};
}
test('map geometry and bound collision update and undo as one action, including binding setup',t=>{
  const {wb,map,cld}=workspace(t);wb.bindMapCollision('0:0',sha256(map),{target:'0:1',mode:'room',...binding});const first=Buffer.from(wb.bytes('0:1'));
  wb.editMap('0:0',sha256(map),[{part:'Map_0_0',translation:[0,0,0],rotation:[0,0,0],scale:[.5,.5,.5],uvOffset:[0,0],uvScale:[1,1],materialGroup:null}]);
  assert.notDeepEqual(wb.bytes('0:1'),first);wb.undoMap('0:0');assert.deepEqual(wb.bytes('0:0'),map);assert.deepEqual(wb.bytes('0:1'),first);assert.ok(wb.mapCollisions.has('0:0'));
  wb.undoMap('0:0');assert.deepEqual(wb.bytes('0:1'),cld);assert.equal(wb.mapCollisions.size,0);
});
test('a conflicting CLD replacement prevents partial map updates and partial undo',t=>{
  const {wb,map}=workspace(t);wb.bindMapCollision('0:0',sha256(map),{target:'0:1',mode:'room',...binding});const modified=Buffer.from(wb.bytes('0:1'));modified.writeUInt32LE(1,0x1c);wb.stage('0:1',modified,'other');
  assert.throws(()=>wb.editMap('0:0',sha256(map),[]),/changed separately/);assert.deepEqual(wb.bytes('0:0'),map);
  assert.throws(()=>wb.undoMap('0:0'),/linked asset changed/);assert.deepEqual(wb.bytes('0:1'),modified);
});


test('new topology rebuilds bound collision and restores both files with one undo',t=>{
  const {wb,dir,map}=workspace(t);wb.bindMapCollision('0:0',sha256(map),{target:'0:1',mode:'room',...binding});const first=Buffer.from(wb.bytes('0:1'));
  const world=parseMap(map);world.model.meshes=[subdividedPart(world.model.meshes[0])];const file=path.join(dir,'part.glb');fs.writeFileSync(file,exportGlb(world.model));
  wb.importMapPart('0:0',sha256(map),'Map_0_0',file);assert.equal(parseCollision(wb.bytes('0:1')).groups[0].count,4);
  wb.undoMap('0:0');assert.deepEqual(wb.bytes('0:0'),map);assert.deepEqual(wb.bytes('0:1'),first);
});


test('outdoor lists use the projected triangle footprint, including shared boundaries',()=>{
  const base=collisionFixture(),map=mapFixture();base.writeFloatLE(0,0);base.writeFloatLE(0,4);map.writeFloatLE(0,160);map.writeFloatLE(0,164);map.writeFloatLE(0,168);
  [[0,0,0],[14000,0,0],[0,0,14000],[0,0,14000]].forEach((point,i)=>point.forEach((v,k)=>map.writeFloatLE(v,512+i*36+k*4)));
  const group=parseCollision(rebuildCollision(base,map,[binding],'grid')).groups[0];
  assert.deepEqual(group.spatialCells[0],[0]);assert.deepEqual(group.spatialCells[5],[0]);assert.deepEqual(group.spatialCells[10],[]);
});

test('outdoor wall quads split at grid lines and retain diagonal height spans',()=>{
  const base=collisionFixture(),map=mapFixture();base.writeFloatLE(0,0);base.writeFloatLE(0,4);map.writeFloatLE(1000,160);map.writeFloatLE(0,164);map.writeFloatLE(1000,168);
  [[0,0,0],[12000,0,0],[0,400,0],[12000,400,0]].forEach((point,i)=>point.forEach((v,k)=>map.writeFloatLE(v,512+i*36+k*4)));
  const group=parseCollision(rebuildCollision(base,map,[{...binding,group:1,template:-1}],'grid')).groups[1];
  assert.equal(group.count,3);assert.ok(group.records.every(r=>r.shape===1 && r.vertices[0][1]!==r.vertices[2][1]));
  assert.deepEqual(group.records.map(r=>Math.max(...r.vertices.map(v=>v[0]))-Math.min(...r.vertices.map(v=>v[0]))).sort((a,b)=>a-b),[3000,4000,5000]);
});


test('CLD cylinder preview uses absolute top Y, not a height added to its foot',()=>{
  const data=Buffer.concat([collisionFixture(),Buffer.alloc(96)]),at=1024;data.writeUInt32LE(at,0x170);data.writeUInt32LE(96,24);data[at]=1;data[at+1]=3;data.writeUInt32LE(4,at+4);
  [10,-100,20,1,0,-125,0,4].forEach((v,i)=>data.writeFloatLE(v,at+16+i*4));
  const collision=parseCollision(data),positions=collision.model.meshes.find(m=>m.name==='Cylinders').positions;
  assert.equal(collision.groups[4].records[0].topY,-125);const ys=positions.filter((_,i)=>i%3===1);assert.equal(Math.min(...ys),100);assert.equal(Math.max(...ys),125);
});

test('whole-map import automatically rebuilds linked collision and persists it through project reload',t=>{
 const {wb,dir,map}=workspace(t);wb.bindMapCollision('0:0',sha256(map),{target:'0:1',mode:'room',...binding});const before=Buffer.from(wb.bytes('0:1'));
 const model=parseMap(map).model;for(const mesh of model.meshes)mesh.positions=mesh.positions.map((v,i)=>v+(i%3===0?50:0));
 const file=path.join(dir,'map.glb');fs.writeFileSync(file,exportGlb(model));wb.replace('0:0',file,'mapGlb');assert.notDeepEqual(wb.bytes('0:1'),before);
 const project=path.join(dir,'auto.sh3project');wb.saveProject(project);const restored=new Workbench();restored.loadProject(project);assert.deepEqual(restored.bytes('0:1'),wb.bytes('0:1'));assert.equal(restored.mapCollisions.size,1);
 wb.undoMap('0:0');assert.deepEqual(wb.bytes('0:1'),before);assert.deepEqual(wb.bytes('0:0'),map);
});
test('stopping automatic rebuild retains collision bytes and can be undone as a binding action',t=>{
 const {wb,map}=workspace(t);wb.bindMapCollision('0:0',sha256(map),{target:'0:1',mode:'room',...binding});const before=Buffer.from(wb.bytes('0:1'));
 wb.bindMapCollision('0:0',sha256(map),{disconnect:true});assert.equal(wb.mapCollisions.size,0);assert.deepEqual(wb.bytes('0:1'),before);
 wb.undoMap('0:0');assert.equal(wb.mapCollisions.size,1);assert.deepEqual(wb.bytes('0:1'),before);
});
