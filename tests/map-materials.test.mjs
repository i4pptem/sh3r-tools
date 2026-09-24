import test from 'node:test';
import assert from 'node:assert/strict';
import {mapAsset} from '../core/map-materials.mjs';
import {exportGlb, readGlb} from '../core/gltf.mjs';

function texture(count) {
  const data=Buffer.alloc(32+count*112); data.writeUInt32LE(0xffffffff); data.writeUInt32LE(32,8); data.writeUInt32LE(data.length,12); data.writeUInt32LE(count,20);
  for(let i=0;i<count;i++){const p=32+i*112;data.writeUInt32LE(0xffffffff,p);data.writeUInt16LE(2,p+8);data.writeUInt16LE(2,p+10);data.writeUInt32LE(16,p+16);data.writeUInt32LE(112,p+20);data.writeUInt16LE(0x9999,p+30);data.fill(255,p+96,p+112);}
  return data;
}
function map() {
  const local=texture(1),data=Buffer.alloc(1264+local.length),put=(offset,values)=>values.forEach((v,i)=>data.writeUInt32LE(v>>>0,offset+i*4));
  put(0,[-1,0,0,80,1264,0,80,304,624,944]);data.writeUInt16LE(1,66);data.writeUInt16LE(1,68);data.writeUInt16LE(1,70);
  put(80,[0,32,224,0,1,0]);
  [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1].forEach((v,i)=>data.writeFloatLE(v,112+i*4));
  for(let g=0;g<3;g++){
    const start=304+g*320;put(start,[g===2?0:start+320,48,316,0,g+1,g===0?0xffffffff:g===2?2:0]);
    for(const [offset,header,length] of [[48,48,268],[96,48,220],[144,64,172]])put(start+offset,[0,header,length]);
    data.writeUInt16LE(g===1?1:0,start+48+22);put(start+160,[3,1,0,0]);
    [[0,0,0],[1,0,0],[0,1,0]].forEach((values,i)=>{const p=start+208+i*36;values.forEach((v,k)=>data.writeFloatLE(v,p+k*4));data.writeFloatLE(1,p+20);data.set([25,50,100,0],p+32);});
  }
  local.copy(data,1264);return data;
}
test('MAP maps local indices using group counts, keeps GB sentinel and ignores vertex alpha',()=>{
  const world=mapAsset(map(),'data/tmp/am11.map',name=>({name,data:texture(name==='amGB.tex'?3:1)}));
  assert.deepEqual(world.model.meshes.map(m=>m.texture),[2,3,4]);assert.deepEqual(world.warnings,[]);
  assert.deepEqual(world.model.meshes[0].colors.slice(0,3),[100/255,50/255,25/255]);
  const glb=readGlb(exportGlb(world.model,world.textures));assert.equal(glb.doc.images.length,5);
  assert.equal(glb.doc.materials[1].alphaMode,'BLEND');assert.equal(glb.doc.materials[0].alphaMode,'OPAQUE');
  const colors=glb.doc.meshes[0].primitives[0].attributes.COLOR_0;assert.equal(glb.doc.accessors[colors].type,'VEC3');
});
test('cc maps use shared TR while absent companions keep valid geometry and a precise warning',()=>{
  const requested=[];const world=mapAsset(map(),'data/tmp/cc42.map',name=>{requested.push(name);return name==='cc01TR.tex'?{name,data:texture(1)}:null;});
  assert.deepEqual(requested,['ccGB.tex','cc01TR.tex']);assert.equal(world.model.meshes.length,3);
  assert.equal(world.model.meshes[0].texture,-1);assert.ok(world.warnings.some(w=>w.includes('ccGB.tex')));assert.ok(world.model.meshes[2].texture>=0);
});
