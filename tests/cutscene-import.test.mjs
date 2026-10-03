import test from 'node:test';
import assert from 'node:assert/strict';
import {replaceSceneChannels,sceneTrackId} from '../core/cutscene-import.mjs';
import {parseSceneTracks} from '../core/cutscene-scene.mjs';
import {motionPack} from './helpers/pack-fixture.mjs';
import {texturedModelFixture} from './helpers/model-fixture.mjs';
import {parseModel} from '../core/model.mjs';
import {exportGlb,readGlb} from '../core/gltf.mjs';
import {readTextures} from '../core/textures.mjs';
import {shadowCompanion} from '../core/shadow-rebuild.mjs';

function fixture(){
  const data=motionPack([{type:3,modelId:0,index:0,width:32,frames:Array.from({length:4},(_,i)=>[i,2,3,4,5,6,7,45])},
    {type:5,modelId:2,index:1,width:36,frames:[[8,9,10,.2,.3,.4,2,0,1],[8,9,10,.3,.4,.5,2,1,0]]},
    {type:2,modelId:0,index:1,width:24,frames:[[0,0,0,10,20,30],[.1,.2,.3,11,21,31]]},
    {type:8,modelId:0,index:0,width:4,frames:[[1],[2],[3],[4]]},
    {type:1,modelId:256,index:1,width:24,frames:[[0,0,0,1,2,3],[0,0,0,4,5,6]]}]);
  const scene=parseSceneTracks(data,0),channels=[scene.camera,...scene.props,...scene.lights].map(track=>{
    const values=Array.from({length:track.frameCount},(_,f)=>Array.from(track.values.slice(f*track.stride,(f+1)*track.stride)));
    return {id:sceneTrackId(track),type:track.type,modelId:track.modelId,index:track.index,native:values,baseline:structuredClone(values),samples:structuredClone(values)};
  });return {data,scene,channels};
}
test('whole-scene channel no-op preserves native PACK bytes and unequal track lengths',()=>{
 const {data,channels}=fixture();assert.deepEqual(replaceSceneChannels(data,0,0,channels).data,data);
});
test('scene edits change only selected existing float channels, with independent scope selection',()=>{
 const {data,channels}=fixture();channels[0].samples[2][0]+=3;channels[1].samples[1][3]+=20;channels[2].samples[1][4]+=.25;
 const result=replaceSceneChannels(data,0,0,channels),actual=parseSceneTracks(result.data,0);
 assert.deepEqual(result.report,{camera:1,props:1,lights:1});assert.equal(actual.camera.values[16],5);
 assert.equal(actual.props[0].values[9],31);assert.equal(actual.lights[0].values[13],Math.fround(channels[2].native[1][4]+.25));
 assert.deepEqual(actual.masks,parseSceneTracks(data,0).masks);
 assert.deepEqual(replaceSceneChannels(data,0,0,channels,{camera:false,props:false,lights:false}).data,data);
 const deltas=[];for(let i=0;i<data.length;i++)if(data[i]!==result.data[i])deltas.push(i);
 assert.ok(deltas.length>0&&deltas.length<=12);
});
test('scene writes reject stale, duplicate, truncated and non-finite channels before staging',()=>{
 for(const change of [c=>c[0].native[0][0]++,c=>c.push(c[0]),c=>c[0].samples.pop(),c=>c[0].samples[0][0]=NaN,c=>c[0].id='5:0:999']){
  const {data,channels}=fixture();change(channels);assert.throws(()=>replaceSceneChannels(data,0,0,channels));
 }
});
test('secondary character materials preserve partial alpha without changing texture slot identity',()=>{
 const source=texturedModelFixture(),model=parseModel(source);model.meshes.push({...model.meshes[0],name:'transparent',group:1});
 const doc=readGlb(exportGlb(model,readTextures(source,true))).doc;
 const a=doc.materials[doc.meshes[0].primitives[0].material],b=doc.materials[doc.meshes[1].primitives[0].material];
 assert.equal(a.alphaMode,'MASK');assert.equal(b.alphaMode,'BLEND');assert.equal(a.name,b.name);assert.deepEqual(a.pbrMetallicRoughness.baseColorTexture,b.pbrMetallicRoughness.baseColorTexture);
});
test('anonymous standalone model entries cannot match themselves as KG1 companions',()=>{
 const wb={get:()=>({entry:{name:'entry_00051.bin'},archive:{entries:[{name:'entry_00051.bin',index:51}]}})};
 assert.equal(shadowCompanion(wb,'0:51'),null);
});
