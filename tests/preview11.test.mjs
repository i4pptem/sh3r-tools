import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Matrix4,Vector3} from 'three';
import {openArchive,entryBytes,buildArchive} from '../core/archives.mjs';
import {writeCompactArchive,writeCompactManifest,readVirtualAfs} from '../core/compact-overlay.mjs';
import {Workbench} from '../core/workbench.mjs';
import {cutsceneVisibility} from '../core/cutscene-visibility.mjs';
import {scriptedProps,sampleScriptProp,scriptedPartVisible,sceneAudioLeadIn} from '../core/cutscene-script.mjs';
import {modelName} from '../core/model-names.mjs';
import {assertFixedAnimation,animationHeader} from '../core/animation.mjs';
import {sha256} from '../core/binary.mjs';

function fixture(t){const folder=fs.mkdtempSync(path.join(os.tmpdir(),'sh3-compact-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));return folder;}
function archive(folder,format){
  const bytes=Buffer.alloc(4096,0x31);bytes.writeUInt32LE(format==='ARC'?0x20030507:0x00534641);bytes.writeUInt32LE(1,4);
  if(format==='ARC'){bytes.writeUInt32LE(16,8);bytes.writeUInt32LE(2048,16);bytes.writeUInt32LE(32,20);bytes.writeUInt32LE(32,24);bytes.writeUInt32LE(32,28);bytes.fill(0,32,48);}
  else{bytes.writeUInt32LE(2048,8);bytes.writeUInt32LE(32,12);bytes.fill(0,16,24);}
  const file=path.join(folder,'test.'+format.toLowerCase());fs.writeFileSync(file,bytes);const result=openArchive(file,[{index:0,name:'data/pcchr/test.mdl'}]);result.relativePath=path.basename(file);return result;
}
for(const format of ['ARC','AFS'])test(`${format} compact package contains changed bytes only and merges against exact source`,t=>{
  const root=fixture(t),source=archive(root,format),folder=path.join(root,'mod'),content=path.join(folder,'plugins/SH3Tools'),replacement=Buffer.alloc(9001,0x42);
  const report=writeCompactArchive(source,new Map([[0,replacement]]),content);writeCompactManifest(content,[report]);
  assert.equal(fs.existsSync(path.join(content,'data',source.relativePath)),false);assert.deepEqual(fs.readFileSync(path.join(content,report.changes[0].file)),replacement);
  const index=fs.readFileSync(path.join(content,'SH3Tools.assets'));assert.equal(index.subarray(-32).toString('hex'),sha256(index.subarray(0,-32)));
  fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify({format:'sh3tools-build-v1',mode:'overlay',contentRoot:'plugins/SH3Tools',archives:[report]}));
  const work=new Workbench();work.open(source.file);const plan=work.prepareModMerge([folder]);work.applyModMerge(plan.token,{});assert.deepEqual(work.bytes('0:0'),replacement);
  fs.writeFileSync(path.join(content,report.changes[0].file),Buffer.alloc(replacement.length));assert.throws(()=>work.prepareModMerge([folder]),/checksum/);
});
test('virtual AFS is byte-equivalent across header, original, padding, new payload and EOF reads',t=>{
  const root=fixture(t),source=archive(root,'AFS'),base=fs.readFileSync(source.file),payloads=new Map([[0,Buffer.alloc(9001,0x76)]]),report=writeCompactArchive(source,payloads,path.join(root,'mod'));
  const all=readVirtualAfs(base,report,payloads,0,report.virtualSize);assert.equal(all.readUInt32LE(8),4096);assert.equal(all.readUInt32LE(12),9001);assert.deepEqual(all.subarray(4096,13097),payloads.get(0));
  for(const start of [0,8,10,4090,4096,8190,13090,report.virtualSize-1,report.virtualSize+1])assert.deepEqual(readVirtualAfs(base,report,payloads,start,4096),all.subarray(start,start+4096));
});
test('ordinary ARC reserves a raw block table for every 64KiB of an enlarged entry',t=>{
  const root=fixture(t),source=archive(root,'ARC'),out=path.join(root,'built.arc'),payload=Buffer.alloc(600000,0x77);buildArchive(source,new Map([[0,payload]]),out);
  const rebuilt=openArchive(out),entry=rebuilt.entries[0],bytes=fs.readFileSync(out);assert.deepEqual(entryBytes(rebuilt,0),payload);assert.ok(bytes.subarray(entry.chunkTableOffset,entry.chunkTableOffset+Math.ceil(payload.length/65536)*4).every(v=>v===0));
  const again=path.join(root,'again.arc');buildArchive(rebuilt,new Map([[0,Buffer.alloc(800000,0x66)]]),again);assert.equal(entryBytes(openArchive(again),0).length,800000);
});
test('stage-script visibility is scoped to scene41 and Dark Heather scene65',()=>{
 const tracks={masks:[{modelId:0,frameCount:1,stride:1,values:[31]}],cuts:[]};assert.equal(cutsceneVisibility({...tracks,sceneId:41}).at(0),15);assert.equal(cutsceneVisibility({...tracks,sceneId:43}).at(0),31);
 assert.equal(scriptedPartVisible(65,0x215,{visibilityId:3}),true);assert.equal(scriptedPartVisible(65,0x215,{visibilityId:4}),false);assert.equal(scriptedPartVisible(64,0x215,{visibilityId:4}),true);assert.equal(scriptedPartVisible(65,0x100,{visibilityId:4}),true);
 assert.ok(sceneAudioLeadIn(48)>31&&sceneAudioLeadIn(48)<32);assert.equal(sceneAudioLeadIn(43),0);
});
test('carousel preserves rest pose and rotates satellites around its base',()=>{
 const F=new Matrix4().makeScale(-1,-1,1),base=new Matrix4().makeTranslation(100,20,300),satellite=new Matrix4().makeTranslation(200,20,300);
 const parts=[base,satellite].map((m,i)=>({objectType:3,partId:i+1,layout:{matrix:F.clone().multiply(m).toArray()}}));
 const tracks=scriptedProps(80,[{key:'0:0',model:{meshes:parts}}]);assert.equal(tracks.length,2);assert.deepEqual(sampleScriptProp(tracks[1],0).toArray(),parts[1].layout.matrix);
 const position=new Vector3().setFromMatrixPosition(sampleScriptProp(tracks[1],60));assert.ok(position.distanceTo(new Vector3(-100,-20,200))<1e-8);
 assert.deepEqual(scriptedProps(79,[{key:'0:0',model:{meshes:parts}}]),[]);
});
test('model labels preserve coded names and support known character aliases',()=>{
 assert.equal(modelName('DATA\\PCCHR\\PL\\CHHAA.MDL').name,'Heather');assert.match(modelName('bg_hry.mdl').aliases,/Harry/);assert.match(modelName('rchhaa.mdl').name,/Heather/);assert.equal(modelName('custom.mdl'),null);
});
test('retired Action extensions are rejected without changing ordinary fixed-range banks',()=>{
 const native=Buffer.alloc(4+264*10);native.writeUInt32LE(256);assert.equal(animationHeader(native).frameCount,10);assert.throws(()=>assertFixedAnimation(Buffer.concat([native,Buffer.from('SH3ANM1\0')])),/Restore the original ANM/);
});
