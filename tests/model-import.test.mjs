import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PNG} from 'pngjs';
import jpeg from 'jpeg-js';
import {exportGlb,readGlb,importGlb} from '../core/gltf.mjs';
import {loadGltfFile,writeGlb} from '../core/model-import.mjs';
import {modelTexturePlan} from '../core/model-textures.mjs';
import {rebuildModel,replacementInfo} from '../core/model-rebuild.mjs';
import {rebuildModelTextures} from '../core/texture-rebuild.mjs';
import {modelTemplate} from '../core/model-provenance.mjs';
import {parseModel,modelLayout} from '../core/model.mjs';
import {readTextures} from '../core/textures.mjs';
import {Workbench} from '../core/workbench.mjs';
import {texturedModelFixture} from './helpers/model-fixture.mjs';
import {validateNativeLayout} from './helpers/native-layout.mjs';
const picture=(rgba=[41,85,129,255],width=3,height=5)=>PNG.sync.write({width,height,data:Buffer.from(Array(width*height).fill(rgba).flat())});
function exchange(source,slots) {
 const model=parseModel(source);model.meshes=slots.map((texture,i)=>({...model.meshes[0],name:'Replacement_'+i,templateName:'Mesh_0_0',texture}));
 const images=Array.from({length:Math.max(...slots)+1},(_,i)=>({png:picture([20+i*20,70,100,255]),width:3,height:5}));
 return exportGlb(model,images);
}
const choices=info=>({meshes:info.inputs.map(input=>({input:input.index,template:input.template,texture:input.texture})),morphs:info.morphs});
function expand(source,slots) {const plan=modelTexturePlan(source,exchange(source,slots));const info=replacementInfo(source,plan.glb,plan.count);return rebuildModel(source,plan.glb,choices(info),plan);}

test('new fifth and sixth native images preserve material metadata, tables and repeat-import identity',()=>{
 const source=texturedModelFixture(4),layout=modelLayout(source);source.writeUInt32LE(0x12345678,layout.materialOffset+4);
 const glb=exchange(source,[0,4,5]),plan=modelTexturePlan(source,glb);assert.equal(plan.added,2);
 const info=replacementInfo(source,plan.glb,plan.count),selection=choices(info),first=rebuildModel(source,plan.glb,selection,plan);
 const h=modelLayout(first.data),base=h.base,table=base+first.data.readUInt32LE(base+52);
 assert.equal(h.textureCount,6);assert.equal(first.data.readUInt32LE(base+48),6);
 assert.deepEqual(Array.from({length:6},(_,i)=>first.data.readUInt32LE(table+i*4)),[0,1,2,3,4,5]);
 assert.deepEqual(parseModel(first.data).meshes.map(mesh=>mesh.texture),[0,4,5]);
 for(const mesh of parseModel(first.data).meshes) {
  const ref=first.data.readUInt16LE(mesh.layout.offset+first.data.readUInt32LE(mesh.layout.offset+56));
  assert.equal(first.data.readUInt32LE(h.materialOffset+ref*8+4),0x12345678);
 }
 const images=readTextures(first.data,true);assert.equal(images.length,6);assert.equal(images[5].width,3);assert.equal(images[5].height,5);
 assert.deepEqual([...images[5].rgba.slice(0,4)],[120,70,100,255]);validateNativeLayout(first.data);
 let current=first.data;
 for(let i=0;i<3;i++) {const nextPlan=modelTexturePlan(current,glb);const next=rebuildModel(current,nextPlan.glb,choices(replacementInfo(current,nextPlan.glb,nextPlan.count)),nextPlan);assert.deepEqual(next.data,first.data);current=next.data;}
 assert.equal(readTextures(modelTemplate(current),true).length,6);
});

test('six primary groups request the extension while five groups retain stock tables',()=>{
 const source=texturedModelFixture(4),expanded=expand(source,[0,1,2,3,4,5]);
 assert.equal(expanded.report.requiresModelTexturePatch,true);assert.equal(expanded.report.primaryRuns,6);
 assert.equal(expand(source,[0,1,2,3,4]).report.requiresModelTexturePatch,false);
});

test('slot overflow, gaps and conflicting named images fail before native writing',()=>{
 const source=texturedModelFixture(4);
 assert.throws(()=>modelTexturePlan(source,exchange(source,[32])),/exceeds the expanded/);
 assert.throws(()=>modelTexturePlan(source,exchange(source,[5])),/Missing new Texture_4/);
 const {doc,binary}=readGlb(exchange(source,[0,1]));doc.materials[1].name='Texture_0.001';
 assert.throws(()=>modelTexturePlan(source,writeGlb(doc,binary)),/Different images use Texture_0/);
});

test('unnamed materials share identical images and explicit empty native materials retain pixels',()=>{
 const source=texturedModelFixture(4),{doc,binary}=readGlb(exchange(source,[0,1]));
 doc.materials[0].name='Body';doc.materials[1].name='Hair';doc.materials[1].pbrMetallicRoughness.baseColorTexture.index=0;
 const plan=modelTexturePlan(source,writeGlb(doc,binary));assert.equal(plan.summary.length,1);
 assert.deepEqual(readGlb(plan.glb).doc.materials.map(m=>m.name),['Texture_0','Texture_0']);
 doc.materials[0]={name:'Texture_3'};doc.meshes.splice(1);const retained=modelTexturePlan(source,writeGlb(doc,binary));assert.equal(retained.replacements.length,0);
});

test('base-color factor is baked in linear color space including alpha',()=>{
 const source=texturedModelFixture(),{doc,binary}=readGlb(exchange(source,[0]));doc.materials[0].pbrMetallicRoughness.baseColorFactor=[0,1,1,.5];
 const image=PNG.sync.read(modelTexturePlan(source,writeGlb(doc,binary)).replacements[0].png);assert.deepEqual([...image.data.slice(0,4)],[0,70,100,128]);
});

test('unsupported UV transforms and alternate UV sets produce explicit errors',()=>{
 const source=texturedModelFixture(),{doc,binary}=readGlb(exchange(source,[0]));
 doc.materials[0].pbrMetallicRoughness.baseColorTexture.texCoord=1;
 assert.throws(()=>modelTexturePlan(source,writeGlb(doc,binary)),/UV map 0/);
 doc.materials[0].pbrMetallicRoughness.baseColorTexture={index:0,extensions:{KHR_texture_transform:{offset:[1,0]}}};
 assert.throws(()=>modelTexturePlan(source,writeGlb(doc,binary)),/UV transforms/);
});

test('GLTF external BIN, percent-encoded PNG and JPEG are embedded with geometry intact',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'sh3-gltf-'));
 try {
  const source=texturedModelFixture(),{doc,binary,accessor}=readGlb(exchange(source,[0]));doc.buffers[0].uri='geometry.bin';
  fs.writeFileSync(path.join(folder,'geometry.bin'),binary);const expected=accessor(doc.meshes[0].primitives[0].attributes.POSITION);
  for(const extension of ['png','jpg']) {
   const raw=extension==='png'?picture():jpeg.encode(PNG.sync.read(picture()),90).data;
   fs.writeFileSync(path.join(folder,'color image.'+extension),raw);doc.images[0]={uri:'color%20image.'+extension};
   const file=path.join(folder,'model.gltf');fs.writeFileSync(file,JSON.stringify(doc));
   const loaded=loadGltfFile(file),parsed=readGlb(loaded);assert.deepEqual(parsed.accessor(parsed.doc.meshes[0].primitives[0].attributes.POSITION),expected);
   const plan=modelTexturePlan(source,loaded);assert.equal(plan.summary[0].width,3);assert.equal(plan.summary[0].height,5);
  }
 } finally {fs.rmSync(folder,{recursive:true,force:true});}
});

test('GLTF packs multiple buffers and base64 resources and reports missing or escaping companions',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'sh3-gltf-'));
 try {
  const file=path.join(folder,'model.gltf'),doc={asset:{version:'2.0'},buffers:[{byteLength:3,uri:'data:application/octet-stream;base64,AQID'},{byteLength:2,uri:'second.bin'}],bufferViews:[{buffer:1,byteOffset:0,byteLength:2}]};
  fs.writeFileSync(path.join(folder,'second.bin'),Buffer.from([4,5]));fs.writeFileSync(file,JSON.stringify(doc));
  const parsed=readGlb(loadGltfFile(file));assert.equal(parsed.doc.bufferViews[0].byteOffset,4);assert.deepEqual([...parsed.binary.subarray(4,6)],[4,5]);
  for(const [uri,error] of [['missing.bin',/Missing glTF companion/],['../escape.bin',/inside the model folder/],['https://example.com/file.bin',/relative local/]]) {
   doc.buffers[1].uri=uri;fs.writeFileSync(file,JSON.stringify(doc));assert.throws(()=>loadGltfFile(file),error);
  }
 } finally {fs.rmSync(folder,{recursive:true,force:true});}
});

test('model import stages geometry and texture pixels atomically, including original-template reselection after slot growth',async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'sh3-import-'));
 try {
  const original=texturedModelFixture(4),file=path.join(folder,'model.glb'),wb=new Workbench();let data=original;
  wb.bytes=()=>data;wb.stage=(_key,value)=>{data=value;wb.changes.set('model',{});return {entries:[]};};
  const edited=exportGlb(parseModel(original),readTextures(original,true).map((image,i)=>i===0?{...image,png:picture([90,40,20,255])}:image));
  fs.writeFileSync(file,edited);const result=await wb.importModel('model',file);assert.equal(result.modelImport,'attributes');assert.deepEqual([...readTextures(data,true)[0].rgba.slice(0,4)],[90,40,20,255]);
  fs.writeFileSync(file,exchange(original,[0,4,5]));const plan=await wb.importModel('model',file);assert.equal(plan.modelImport,'rebuild');wb.rebuildModel('model',plan.token,choices(plan));
  fs.writeFileSync(path.join(folder,'original.mdl'),original);const second=await wb.importModel('model',file);
  const templates=wb.modelTemplates('model',second.token,path.join(folder,'original.mdl'));assert.equal(templates.textureSlots.length,6);
  wb.rebuildModel('model',second.token,choices(templates));assert.deepEqual(parseModel(data).meshes.map(m=>m.texture),[0,4,5]);validateNativeLayout(data);
 } finally {fs.rmSync(folder,{recursive:true,force:true});}
});

test('extra skin weight channels cannot be silently discarded by either import route',()=>{
 const source=texturedModelFixture(),{doc,binary}=readGlb(exportGlb(parseModel(source),readTextures(source,true)));
 const attributes=doc.meshes[0].primitives[0].attributes;attributes.WEIGHTS_1=attributes.WEIGHTS_0;attributes.JOINTS_1=attributes.JOINTS_0;
 const glb=writeGlb(doc,binary);assert.throws(()=>importGlb(source,glb),/Additional skin weight/);
 assert.throws(()=>rebuildModel(source,glb,choices(replacementInfo(source,glb))),/Additional skin weight/);
});

test('32 image slots rebuild and repeat without losing bindings or texture pixels',()=>{
 const source=texturedModelFixture(4),slots=Array.from({length:32},(_,i)=>i),glb=exchange(source,slots);
 const first=expand(source,slots),model=parseModel(first.data);assert.deepEqual(model.meshes.map(m=>m.texture),slots);
 assert.equal(readTextures(first.data,true).length,32);assert.equal(first.report.requiresModelTexturePatch,true);
 validateNativeLayout(first.data);
 const plan=modelTexturePlan(first.data,glb),second=rebuildModel(first.data,plan.glb,choices(replacementInfo(first.data,plan.glb,plan.count)),plan);
 assert.deepEqual(second.data,first.data);
});
