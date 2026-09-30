import test from 'node:test';import assert from 'node:assert/strict';
import {Matrix4,Quaternion,Vector3} from 'three';
import {motionPack} from './helpers/pack-fixture.mjs';
import {packSections} from '../core/pack.mjs';
import {motionSection,parseCutsceneAnimation} from '../core/cutscene-animation.mjs';
import {cutsceneExchange,replaceCutsceneAnimation} from '../core/cutscene-exchange.mjs';
import {parseMorphAnimations} from '../core/morph-animation.mjs';
import {sampleMorphAnimation} from '../core/morph-sampling.mjs';
import {validateMorphBudget} from '../core/cutscene-morph-exchange.mjs';

function fixture(face=false) {
 const tracks=[{index:0,frames:Array.from({length:10},()=>[1,2,3,9000,8000,7000])},
  ...[1,2].map(index=>({index,frames:Array.from({length:10},(_,f)=>[.05*index,.2+f*.01,-.03,12000+index*20,40-f,300+index*40])})),
  {type:3,modelId:0,index:0,width:32,frames:Array.from({length:10},()=>[0,0,0,1,2,3,0,40])},
  {modelId:257,index:1,frames:Array.from({length:10},()=>[1,2,3,4,5,6])}];
 const raw=motionPack(tracks,face?1024:undefined),sections=packSections(raw).sort((a,b)=>a.type-b.type);
 let offset=2048;const output=Buffer.alloc(2048+sections.reduce((n,s)=>n+Math.ceil(s.size/2048)*2048,0));raw.copy(output,0,0,16);
 sections.forEach((s,i)=>{[offset,s.type,s.size,0].forEach((v,k)=>output.writeUInt32LE(v,16+i*16+k*4));raw.copy(output,offset,s.offset,s.offset+s.size);offset+=Math.ceil(s.size/2048)*2048;});
 const model={bones:[-1,0].map((parent,i)=>({name:'bone'+i,parent,matrix:new Matrix4().makeTranslation(0,i*30,0).toArray()})),morphNames:face?['Morph_0']:[],meshes:face?[{name:'face',morphPositions:[[1,0,0]]}]:[]};
 const section=sections.findIndex(s=>s.type===2),exchange=cutsceneExchange(model,output,section,256,2,4,30);
 exchange.baseline=structuredClone(exchange.samples);exchange.morphBaseline=structuredClone(exchange.morphSamples);
 return {data:output,model,section,exchange};
}
test('PACK no-op roundtrip preserves all native bytes including angle representatives',()=>{
 const {data,model,section,exchange}=fixture();assert.deepEqual(replaceCutsceneAnimation(model,data,section,256,exchange).data,data);
});
test('PACK local root edits propagate to children and preserve all other records and frames',()=>{
 const {data,model,section,exchange}=fixture();for(const frame of exchange.samples)frame[0].translation[0]+=8;
 const result=replaceCutsceneAnimation(model,data,section,256,exchange),a=parseCutsceneAnimation(data,section,256,[-1,0]),b=parseCutsceneAnimation(result.data,section,256,[-1,0]);
 for(let f=0;f<10;f++)for(let bone=0;bone<2;bone++)assert.ok(Math.abs(b.translations[(f*2+bone)*3]-a.translations[(f*2+bone)*3]-(f>=2&&f<=4?-8:0))<.001);
 const descriptor=packSections(data)[section],layout=motionSection(data,descriptor);let at=descriptor.offset+layout.dataOffset;
 for(let f=0;f<10;f++)for(const track of layout.tracks){if(!(f>=2&&f<=4&&track.type===1&&track.modelId===256&&track.index>0))assert.deepEqual(result.data.subarray(at,at+track.width),data.subarray(at,at+track.width));at+=track.width;}
 assert.deepEqual(replaceCutsceneAnimation(model,result.data,section,256,exchange).data,result.data);
});
test('PACK preserves Euler branches across a no-op and encodes real local rotations',()=>{
 const {data,model,section,exchange}=fixture();exchange.samples[1][1].rotation=new Quaternion().fromArray(exchange.samples[1][1].rotation).multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),.2)).toArray();
 const result=replaceCutsceneAnimation(model,data,section,256,exchange);assert.equal(result.report.changedRotations,1);assert.equal(result.report.changedTranslations,0);
});
test('PACK validates format, rig, ranges and numeric transforms',()=>{
 for(const [edit,pattern] of [[e=>e.metadata.format='anm',/cutscene animation/],[e=>e.metadata.skeletonHash='bad',/skeleton/],[e=>e.samples[0][0].translation[0]=NaN,/Invalid/]]){
 const {data,model,section,exchange}=fixture();edit(exchange);assert.throws(()=>replaceCutsceneAnimation(model,data,section,256,exchange),pattern);}
 const {data,model,section,exchange}=fixture();assert.throws(()=>replaceCutsceneAnimation(model,data,section,256,exchange,{end:5}),/Match the ranges/);
});
test('PACK morph no-op preserves bytes and an edited key preserves other tracks and sector starts',()=>{
 const {data,model,section}=fixture(true),exchange=cutsceneExchange(model,data,section,256,0,0,30);exchange.baseline=structuredClone(exchange.samples);exchange.morphBaseline=structuredClone(exchange.morphSamples);
 assert.deepEqual(replaceCutsceneAnimation(model,data,section,256,exchange).data,data);
 exchange.morphSamples[0][0]=.75;
 const result=replaceCutsceneAnimation(model,data,section,256,exchange,{importBones:false}),[clip]=parseMorphAnimations(result.data);
 assert.equal(sampleMorphAnimation(clip,0)[0],.75);for(let f=1;f<10;f++)assert.equal(sampleMorphAnimation(clip,f)[0],.25);
 const before=packSections(data),after=packSections(result.data);assert.equal(after[1].offset%2048,0);
 assert.deepEqual(result.data.subarray(after[1].offset,after[1].offset+after[1].size),data.subarray(before[1].offset,before[1].offset+before[1].size));
 assert.equal(result.report.changedMorphSamples,1);assert.deepEqual(replaceCutsceneAnimation(model,result.data,section,256,exchange,{importBones:false}).data,result.data);
});
test('PACK rejects a morph edit that would change an unselected held interval',()=>{
 const {data,model,section,exchange}=fixture(true);exchange.morphSamples.forEach(frame=>frame[0]=.75);
 assert.throws(()=>replaceCutsceneAnimation(model,data,section,256,exchange),/held morph sample/);
});
test('PACK reports absent facial inputs and permits explicit bones-only import',()=>{
 const {data,model,section,exchange}=fixture(true);exchange.morphSamples=null;exchange.importReport={morphError:'Missing face mesh'};
 assert.throws(()=>replaceCutsceneAnimation(model,data,section,256,exchange),/Missing face mesh/);
 assert.deepEqual(replaceCutsceneAnimation(model,data,section,256,exchange,{importMorphs:false}).data,data);
});
test('PACK resident budget reserves three native streaming blocks',()=>{
 const {data}=fixture(true),budget=validateMorphBudget(data);assert.equal(budget.minimumStreamingBytes,307200);
 const oversized=Buffer.concat([data,Buffer.alloc(0x200000)]);oversized.writeUInt32LE(0x200000,24);
 assert.throws(()=>validateMorphBudget(oversized),/memory budget/);
});

test('PACK exact-frame exchange keeps native half-turn representatives without wrapping drift',()=>{
 const {data,model,section}=fixture(),descriptor=packSections(data)[section],layout=motionSection(data,descriptor),width=layout.tracks.reduce((n,t)=>n+t.width,0);
 for(let f=2;f<=4;f++)data.writeFloatLE(-Math.PI,descriptor.offset+layout.dataOffset+f*width+24);
 const exchange=cutsceneExchange(model,data,section,256,2,4,30);exchange.baseline=structuredClone(exchange.samples);
 assert.deepEqual(replaceCutsceneAnimation(model,data,section,256,exchange).data,data);
});

test('PACK can animate an existing empty facial segment without shifting its boundaries',()=>{
 const {data,model,section}=fixture(true),descriptor=packSections(data)[0],at=descriptor.offset,curve=Buffer.from(data.subarray(at+28,at+54));
 const control=Buffer.alloc(70);control.writeUInt32LE(256);control.writeUInt32LE(2,8);
 [0,2,26,44,2,9,0,0].forEach((v,i)=>control.writeUInt32LE(v,12+i*4));curve.copy(control,44);control.copy(data,at);data.writeUInt32LE(control.length,24);
 const exchange=cutsceneExchange(model,data,section,256,3,5,30);exchange.baseline=structuredClone(exchange.samples);exchange.morphBaseline=structuredClone(exchange.morphSamples);
 exchange.morphSamples=[[.5],[-.5],[.75]];
 const result=replaceCutsceneAnimation(model,data,section,256,exchange,{importBones:false}),[clip]=parseMorphAnimations(result.data);
 assert.deepEqual(clip.segments.map(s=>[s.startFrame,s.endFrame]),[[0,2],[2,9]]);
 assert.equal(sampleMorphAnimation(clip,2)[0],.25);assert.equal(sampleMorphAnimation(clip,3)[0],.5);assert.equal(sampleMorphAnimation(clip,4)[0],-.5);assert.equal(sampleMorphAnimation(clip,5)[0],.75);
 for(let f=6;f<10;f++)assert.equal(sampleMorphAnimation(clip,f)[0],0);
});
