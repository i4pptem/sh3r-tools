import test from 'node:test';
import assert from 'node:assert/strict';
import {mapFixture,subdividedPart} from './helpers/map-fixture.mjs';
import {parseMap} from '../core/world-formats.mjs';
import {mapAsset} from '../core/map-materials.mjs';
import {exportMapPart,importMapPart} from '../core/map-part.mjs';
import {editMap} from '../core/map-edit.mjs';
import {readGlb,exportGlb} from '../core/gltf.mjs';

const name='Map_0_0';
function replacement(data) {const world=parseMap(data);world.model.meshes=[subdividedPart(world.model.meshes[0])];return exportGlb(world.model);}

test('single MAP export contains only the selected part and image and round-trips byte exactly',()=>{
  const data=mapFixture(),world=mapAsset(data,'am11.map',()=>null),glb=exportMapPart(world,name),doc=readGlb(glb).doc;
  assert.equal(doc.meshes.length,1);assert.equal(doc.images.length,1);assert.equal(doc.meshes[0].name,name);
  assert.ok(importMapPart(data,name,glb).equals(data));
});

test('new topology preserves winding, sibling bytes and relocates light/texture/interest pointers',()=>{
  const data=mapFixture(),world=parseMap(data),glb=replacement(data),result=importMapPart(data,name,glb),after=parseMap(result),delta=result.length-data.length;
  assert.ok(delta>0);assert.equal(delta%16,0);assert.equal(after.model.meshes.length,2);assert.equal(after.model.meshes[0].triangleCount,4);
  const expected=subdividedPart(world.model.meshes[0]),actual=after.model.meshes[0];
  assert.deepEqual(actual.indices.flatMap(i=>actual.positions.slice(i*3,i*3+3)),expected.indices.flatMap(i=>expected.positions.slice(i*3,i*3+3)));
  const oldSibling=world.model.meshes[1].layout,newSibling=after.model.meshes[1].layout;
  assert.ok(data.subarray(oldSibling.offset,oldSibling.offset+oldSibling.length).equals(result.subarray(newSibling.offset,newSibling.offset+newSibling.length)));
  for(const at of [16,48,52,56])assert.equal(result.readUInt32LE(at),data.readUInt32LE(at)+delta);
  const oldLight=data.readUInt32LE(56),newLight=result.readUInt32LE(56),oldEntry=data.readUInt32LE(oldLight),newEntry=result.readUInt32LE(newLight);
  assert.equal(newEntry,oldEntry+delta);for(const at of [80,84])assert.equal(result.readUInt32LE(newEntry+at),data.readUInt32LE(oldEntry+at)+delta);
  assert.ok(data.subarray(data.readUInt32LE(16)).equals(result.subarray(result.readUInt32LE(16))));
  const repeat=importMapPart(result,name,glb,data);assert.ok(repeat.equals(result),'Repeated replacement must not grow or reorder the map');
  const restored=importMapPart(result,name,exportMapPart(mapAsset(data,'am11.map',()=>null),name),data);assert.equal(parseMap(restored).model.meshes[0].triangleCount,1);
  assert.deepEqual(parseMap(restored).model.meshes[1].positions,world.model.meshes[1].positions);
  const edited=editMap(result,{part:name,translation:[0,0,0],rotation:[0,0,0],scale:[.5,.5,.5],uvOffset:[0,0],uvScale:[1,1],materialGroup:null},data);assert.equal(parseMap(edited).model.meshes[0].triangleCount,4);
});

test('special payload parts allow original-topology round trips and reject arbitrary topology',()=>{
  const data=mapFixture({tail:32}),world=parseMap(data);
  assert.ok(importMapPart(data,name,exportMapPart(world,name)).equals(data));
  assert.throws(()=>importMapPart(data,name,replacement(data)),/special native payload/);
});

test('transparent replacement respects original triangle budget and malformed attributes never stage',()=>{
  const data=mapFixture({family:2});assert.throws(()=>importMapPart(data,name,replacement(data)),/transparent MAP/);
  const world=parseMap(mapFixture());world.model.meshes=[subdividedPart(world.model.meshes[0])];delete world.model.meshes[0].colors;
  assert.throws(()=>importMapPart(mapFixture(),name,exportGlb(world.model)),/vertex colors/);
});

test('subdivided planar parts retain native plane coordinates across float32 GLB exchange',()=>{
  const data=mapFixture();data.writeFloatLE(30.2,168);
  for(let i=0;i<4;i++) data.writeFloatLE(.1,512+i*36+8);
  const result=importMapPart(data,name,replacement(data)),before=parseMap(data).model.meshes[0],after=parseMap(result).model.meshes[0];
  assert.ok(after.positions.every((v,i)=>i%3!==2 || v===before.positions[2]));
});
