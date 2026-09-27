import test from 'node:test';
import assert from 'node:assert/strict';
import {Matrix4} from 'three';
import {align} from '../core/binary.mjs';
import {parseModel,modelLayout,morphDocument} from '../core/model.mjs';
import {exportGlb} from '../core/gltf.mjs';
import {rebuildModel,triangleStrip,replacementInfo} from '../core/model-rebuild.mjs';
import {validateNativeLayout} from './helpers/native-layout.mjs';
import {Workbench} from '../core/workbench.mjs';
import {importGlb} from '../core/gltf.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function fixture(boneCount=1) {
  const base=96,bones=224,parents=bones+boneCount*64,pairs=align(parents+boneCount,16),textureTable=pairs,
    materials=textureTable+16,morphBase=materials+16,descriptors=morphBase+16,delta0=descriptors+16,delta1=delta0+16,
    hit=delta1+16,box=hit+16,mesh=box+128,vertex=208,index=vertex+3*48,size=align(index+16,16),textures=mesh+size;
  const data=Buffer.alloc(textures+32),set=(start,fields)=>{for(const[k,v]of Object.entries(fields))data.writeUInt32LE(v,start+Number(k));};
  set(0,{4:0x100,12:textures,16:textures,20:base,28:1});
  set(base,{0:0xffff0003,4:3,8:bones-base,12:boneCount,16:parents-base,24:pairs-base,28:pairs-base,32:1,36:mesh-base,
    44:textures-base,48:1,52:textureTable-base,56:1,60:materials-base,68:1,72:morphBase-base,76:2,80:descriptors-base,88:hit-base,92:hit-base,96:box-base,100:1});
  for(let b=0;b<boneCount;b++){for(const i of[0,5,10,15])data.writeFloatLE(1,bones+b*64+i*4);data.writeFloatLE(b*3,bones+b*64+48);data[parents+b]=255;}
  data.writeInt16LE(-16,morphBase);data.writeInt16LE(-3072,morphBase+10);
  set(descriptors,{0:1,4:delta0-base,8:1,12:delta1-base});data.writeInt16LE(16,delta0);data.writeInt16LE(16,delta1+2);
  set(mesh,{0:size,8:vertex,16:4,20:1,24:160,28:1,32:176,40:178,52:1,56:178,60:192,64:vertex,68:3,72:index,76:4,80:2});
  data.writeUInt16LE(1,mesh+164);
  for(const[v,p]of[[-1,0,0],[1,0,0],[0,1,0]].entries()){p.forEach((n,k)=>data.writeFloatLE(n,mesh+vertex+v*48+k*4));data.writeFloatLE(1,mesh+vertex+v*48+12);data.writeFloatLE(.75,mesh+vertex+v*48+36);}
  [0,1,2,2].forEach((n,i)=>data.writeUInt32LE(n,mesh+index+i*4));data.fill(0xA7,textures);return data;
}
const select=model=>({meshes:model.meshes.map((m,input)=>({input,template:input})),morphs:model.morphNames});
function triangles(strip){const out=[];for(let i=2;i<strip.length;i++){let a=strip[i-2],b=strip[i-1],c=strip[i];if(i%2)[a,b]=[b,a];if(a!==b&&b!==c&&a!==c)out.push(a,b,c);}return out;}
function close(a,b,epsilon=1e-6){assert.equal(a.length,b.length);for(let i=0;i<a.length;i++)assert.ok(Math.abs(a[i]-b[i])<=epsilon,`component ${i}: ${a[i]} != ${b[i]}`);}

test('disconnected native strips preserve triangle order and winding',()=>{
  const indices=[0,1,2,2,3,0,9,4,7,7,4,3,0,3,8];assert.deepEqual(triangles(triangleStrip(indices)),indices);
});

test('topology rebuild preserves nonunit normals, every morph slot and shared neutral baseline',()=>{
  const source=fixture(),model=parseModel(source),m=model.meshes[0];
  m.positions.push(0,-.5,0);m.normals.push(0,0,.75);m.uv.push(.5,.5);m.joints.push(0,0,0,0);m.weights.push(1,0,0,0);
  m.morphPositions[0].push(-.5,0,0);m.morphPositions[1].push(0,-.5,0);m.morphNormals.forEach(a=>a.push(0,0,0));m.indices=[0,1,3,1,2,3,2,0,3];
  const {data}=rebuildModel(source,exportGlb(model),select(model)),native=validateNativeLayout(data),decoded=parseModel(data).meshes[0];
  assert.equal(native.vertexCount,4);assert.equal(native.targets,2);assert.equal(native.nodes,2);assert.equal(decoded.triangleCount,3);
  const v=decoded.positions.findIndex((n,i)=>i%3===0&&n===0&&decoded.positions[i+1]===-.5)/3;
  assert.ok(v>=0);close(decoded.normals.slice(v*3,v*3+3),[0,0,.75]);
  close(decoded.morphPositions[0].slice(v*3,v*3+3),[-.5,0,0]);close(decoded.morphPositions[1].slice(v*3,v*3+3),[0,-.5,0]);
  const combined=decoded.positions.slice(v*3,v*3+3).map((n,k)=>n+.25*decoded.morphPositions[0][v*3+k]+.75*decoded.morphPositions[1][v*3+k]);
  close(combined,[-.125,-.875,0]);
  const h=modelLayout(data);assert.equal(data.readInt16LE(h.morphBaseOffset+10),-3072);
  assert.deepEqual(data.subarray(data.readUInt32LE(12)),source.subarray(source.readUInt32LE(12)));
});

test('explicit neutral mapping clears contributions but retains native animation target indices',()=>{
  const source=fixture(),model=parseModel(source),selection=select(model);selection.morphs[0]=null;
  const {data}=rebuildModel(source,exportGlb(model),selection),morphs=morphDocument(data);
  assert.equal(morphs.targets.length,2);assert.equal(morphs.targets[0].deltas.length,0);assert.equal(morphs.targets[1].deltas.length,1);
});

test('palette partitioning preserves all triangles while keeping native shader slots within sixteen',()=>{
  const source=fixture(18),model=parseModel(source),m=model.meshes[0];
  Object.assign(m,{positions:[],normals:[],uv:[],joints:[],weights:[],indices:[],morphPositions:[],morphNormals:[]});
  for(let i=0;i<18;i++){m.positions.push(i,Math.floor(i/3)%2,0);m.normals.push(0,0,1);m.uv.push(0,0);m.joints.push(i,0,0,0);m.weights.push(1,0,0,0);m.indices.push(i);}
  const selection=select(model);selection.morphs=[null,null];
  const {data}=rebuildModel(source,exportGlb(model),selection),native=validateNativeLayout(data),decoded=parseModel(data);
  assert.equal(native.meshCount,2);assert.equal(decoded.triangleCount,6);assert.equal(native.vertexCount,18);assert.ok(native.maxPalette<=16);
});

test('new secondary skin pairs store the correct primary-to-secondary local transform',()=>{
  const source=fixture(3),model=parseModel(source),m=model.meshes[0];
  for(let i=0;i<3;i++){m.joints.splice(i*4,4,0,1,2,0);m.weights.splice(i*4,4,.5,.3,.2,0);}
  const {data}=rebuildModel(source,exportGlb(model),select(model)),h=modelLayout(data);validateNativeLayout(data);assert.equal(h.pairCount,2);
  const helpers=h.base+data.readUInt32LE(h.base+28);
  for(let i=0;i<2;i++){const a=data[h.pairOffset+i*2],b=data[h.pairOffset+i*2+1],expected=new Matrix4().fromArray(model.bones[b].matrix).invert().multiply(new Matrix4().fromArray(model.bones[a].matrix));close(Array.from({length:16},(_,j)=>data.readFloatLE(helpers+i*64+j*4)),expected.elements);}
});

test('four nonzero skin influences are rejected without silently dropping weights',()=>{
  const source=fixture(4),model=parseModel(source),m=model.meshes[0];m.joints.splice(0,4,0,1,2,3);m.weights.splice(0,4,.25,.25,.25,.25);
  assert.throws(()=>rebuildModel(source,exportGlb(model),select(model)),/one to three/);
});

test('unrepresentable morph coordinates are rejected without clamping',()=>{
  const source=fixture(),model=parseModel(source);model.meshes[0].morphPositions[0][0]=10000;
  assert.throws(()=>rebuildModel(source,exportGlb(model),select(model)),/signed-16/);
});

function morphCapacityGeometry(count) {
  const source=fixture(), model=parseModel(source), mesh=model.meshes[0];
  Object.assign(mesh,{positions:[],normals:[],uv:[],joints:[],weights:[],indices:[],morphPositions:[[],[]],morphNormals:[[],[]]});
  for(let i=0;i<count;i++) {
    mesh.positions.push((i%64)/4,Math.floor(i/64)/4,0); mesh.normals.push(0,0,.75); mesh.uv.push(0,0);
    mesh.joints.push(0,0,0,0); mesh.weights.push(1,0,0,0);
    mesh.morphPositions[0].push(1/16,0,0); mesh.morphPositions[1].push(0,1/8,0);
    mesh.morphNormals.forEach(values=>values.push(0,0,0));
    if(i>=2) mesh.indices.push(0,i-1,i);
  }
  return {source, model};
}

test('expanded PC morph buffer accepts all 32768 signed-index nodes shared by targets',()=>{
  const {source,model}=morphCapacityGeometry(32768);
  const {data,report}=rebuildModel(source,exportGlb(model),select(model));
  assert.equal(report.morphNodes,32768); assert.equal(validateNativeLayout(data).nodes,32768);
  const document=morphDocument(data);
  assert.equal(document.targets.length,2); assert.ok(document.targets.every(target=>target.deltas.length===32768));
});

test('PC morph rebuilding rejects node 32769 before signed indices become negative',()=>{
  const {source,model}=morphCapacityGeometry(32769);
  assert.throws(()=>rebuildModel(source,exportGlb(model),select(model)),/signed-index range of 32768/);
});


test('models above stock capacity require the expanded runtime without blocking import',()=>{
 const {source,model}=morphCapacityGeometry(4096);
 const {report}=rebuildModel(source,exportGlb(model),select(model));
 assert.equal(report.morphNodes,4096); assert.equal(report.requiresMorphPatch,true);
});

test('Blender joint-weight order preserves native palette preferences and skin semantics',()=>{
 const source=fixture(3),model=parseModel(source),mesh=model.meshes[0];
 for(let i=0;i<3;i++){mesh.joints.splice(i*4,4,2,0,1,0);mesh.weights.splice(i*4,4,.6,.1,.3,0);}
 const {data,report}=rebuildModel(source,exportGlb(model),select(model)),decoded=parseModel(data).meshes[0];
 assert.equal(report.meshes,1); assert.equal(report.bonePairs,2);
 for(let i=0;i<3;i++) {assert.deepEqual(decoded.joints.slice(i*4,i*4+4),[0,1,2,0]);close(decoded.weights.slice(i*4,i*4+4),[.1,.3,.6,0]);}
});

test('secondary mesh staging splits before its 682-vertex buffer boundary',()=>{
 const {source,model}=morphCapacityGeometry(900),base=source.readUInt32LE(20),mesh=source.readUInt32LE(base+36);
 source.writeUInt32LE(0,base+32); source.writeUInt32LE(1,base+40);source.writeUInt32LE(mesh,base+44);
 model.meshes[0].name='Mesh_1_0';
 const {data}=rebuildModel(source,exportGlb(model),select(model)),decoded=parseModel(data);
 assert.equal(decoded.meshes.length,2);assert.ok(decoded.meshes.every(m=>m.group===1&&m.vertexCount<=682));
 assert.equal(decoded.triangleCount,898);
});


test('rebuilding split parts repeatedly retains template identity, UVs and constant file size',()=>{
 const {source,model}=morphCapacityGeometry(1500),base=source.readUInt32LE(20),offset=source.readUInt32LE(base+36);
 source.writeUInt32LE(0,base+32);source.writeUInt32LE(1,base+40);source.writeUInt32LE(offset,base+44);model.meshes[0].name=model.meshes[0].templateName='Mesh_1_0';
 const glb=exportGlb(model),first=rebuildModel(source,glb,select(model));
 let data=first.data;
 for(let i=0;i<4;i++) {const info=replacementInfo(data,glb);assert.equal(info.templates.length,1);assert.equal(info.inputs[0].template,0);data=rebuildModel(data,glb,{meshes:info.inputs.map(input=>({input:input.index,template:input.template})),morphs:info.morphs}).data;assert.deepEqual(data,first.data);}
 const decoded=parseModel(data);assert.deepEqual(decoded.meshes.map(m=>m.name),['Mesh_1_0','Mesh_1_0_part_1','Mesh_1_0_part_2']);
 const splitGlb=exportGlb(decoded),info=replacementInfo(data,splitGlb);assert.ok(info.inputs.every(i=>i.template===0));
 const next=parseModel(rebuildModel(data,splitGlb,{meshes:info.inputs.map(input=>({input:input.index,template:input.template})),morphs:info.morphs}).data);
 assert.equal(next.triangleCount,decoded.triangleCount);assert.deepEqual(next.meshes.map(m=>m.uv),decoded.meshes.map(m=>m.uv));assert.deepEqual(next.meshes.map(m=>m.texture),decoded.meshes.map(m=>m.texture));
});


test('primary INDEX32 requirement counts the whole group, independently of morphs and part size',()=>{
  for(const count of [32768,32769]) {
    const {source,model}=morphCapacityGeometry(count),mesh=model.meshes[0];
    mesh.morphPositions.forEach(values=>values.fill(0));
    model.meshes.push({...mesh,name:'AdditionalPart',templateName:'Mesh_0_0'});
    const selection={meshes:[{input:0,template:0},{input:1,template:0}],morphs:[null,null]};
    const {data,report}=rebuildModel(source,exportGlb(model),selection),decoded=parseModel(data);
    assert.equal(decoded.meshes.length,2);
    assert.ok(decoded.meshes.every(part=>part.vertexCount<65536));
    assert.equal(report.primaryVertices,count*2);
    assert.equal(report.requiresPrimaryIndexPatch,count*2>65536);
    assert.equal(report.requiresMorphPatch,false);
    assert.equal(report.requiresSecondaryPatch,false);
  }
});


test('texture assignment changes the material binding while preserving template render flags',()=>{
  const source=fixture(),h=modelLayout(source);source.writeUInt32LE(2,h.base+56);source.writeUInt32LE(1,h.materialOffset+8);
  const model=parseModel(source),selection=select(model);selection.meshes[0].texture=1;
  const rebuilt=rebuildModel(source,exportGlb(model),selection).data,mesh=parseModel(rebuilt).meshes[0];
  assert.equal(mesh.texture,1);
  assert.deepEqual(rebuilt.subarray(mesh.layout.offset+80,mesh.layout.offset+160),source.subarray(model.meshes[0].layout.offset+80,model.meshes[0].layout.offset+160));
  selection.meshes[0].texture=99;assert.throws(()=>rebuildModel(source,exportGlb(model),selection),/no native material binding/);
});


test('interleaved texture choices are grouped into bounded native runs',()=>{
  const source=fixture(),h=modelLayout(source);source.writeUInt32LE(2,h.base+56);source.writeUInt32LE(1,h.materialOffset+8);
  const model=parseModel(source);model.meshes=Array.from({length:6},(_,i)=>({...model.meshes[0],name:'Replacement_'+i}));
  const selection={meshes:model.meshes.map((_,input)=>({input,template:0,texture:input%2})),morphs:model.morphNames};
  const rebuilt=parseModel(rebuildModel(source,exportGlb(model),selection).data);
  assert.deepEqual(rebuilt.meshes.map(m=>m.texture),[0,0,0,1,1,1]);assert.equal(rebuilt.triangleCount,6);
});

function editGlbJson(glb, change) {
  const jsonLength=glb.readUInt32LE(12), doc=JSON.parse(glb.subarray(20,20+jsonLength).toString());
  change(doc);
  const raw=Buffer.from(JSON.stringify(doc)), json=Buffer.alloc(align(raw.length,4),32);raw.copy(json);
  const result=Buffer.concat([glb.subarray(0,20),json,glb.subarray(20+jsonLength)]);
  result.writeUInt32LE(result.length,8);result.writeUInt32LE(json.length,12);return result;
}

test('one GLB import stages compatible edits and opens rebuild for a changed material slot',()=>{
  const source=fixture(),h=modelLayout(source);
  source.writeUInt32LE(2,h.base+56);source.writeUInt32LE(1,h.materialOffset+8);
  const model=parseModel(source),glb=exportGlb(model,[{png:Buffer.alloc(4)},{png:Buffer.alloc(4)}]);
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'sh3-model-import-')),file=path.join(folder,'edited.glb');
  try {
    const workbench=new Workbench();workbench.bytes=()=>source;
    workbench.stage=(_key,data)=>({entries:[],data});
    fs.writeFileSync(file,glb);
    const direct=workbench.importModel('0:0',file);
    assert.equal(direct.modelImport,'attributes');assert.deepEqual(direct.data,source);
    const reordered=editGlbJson(glb,doc=>{doc.materials[0].name='Texture_0.001';doc.materials[0].pbrMetallicRoughness.baseColorTexture.index=1;});
    fs.writeFileSync(file,reordered);
    assert.equal(workbench.importModel('0:0',file).modelImport,'attributes');
    const changed=editGlbJson(glb,doc=>{doc.meshes[0].primitives[0].material=1;});
    assert.throws(()=>importGlb(source,changed),/material or texture slot changed/);
    fs.writeFileSync(file,changed);
    const prepared=workbench.importModel('0:0',file);
    assert.equal(prepared.modelImport,'rebuild');
    assert.equal(prepared.inputs[0].texture,1);
    assert.deepEqual(prepared.textureSlots,[0,1]);
  } finally {fs.rmSync(folder,{recursive:true,force:true});}
});
