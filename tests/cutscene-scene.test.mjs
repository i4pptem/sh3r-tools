import {matchingCutsceneMorph} from '../core/morph-animation.mjs';
import {sceneModelCandidates,defaultSceneModel} from '../core/cutscene-models.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Matrix4,Vector3} from 'three';
import {sceneSections,parseSceneTracks} from '../core/cutscene-scene.mjs';
import {sceneSample,cutsceneCamera} from '../core/cutscene-camera.mjs';
import {sceneMapName,sceneEnvironment,readSceneResources} from '../core/cutscene-resources.mjs';
import {samplePropMatrix} from '../core/cutscene-props.mjs';
import {motionPack} from './helpers/pack-fixture.mjs';
const camera=(frames)=>({type:3,modelId:0,index:0,width:32,frames});
const near=(actual,expected,tolerance=1e-5)=>actual.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<tolerance,`${actual} != ${expected}`));

test('camera uses native coordinate adapter, projection and local roll',()=>{
 const result=cutsceneCamera([366.9140319824219,15.126038551330566,366.05780029296875,396.9776611328125,7.233320236206055,427.93536376953125,0,25.65509605407715]);
 near(result.eye,[-18345.701599121094,756.3019275665283,-18302.890014648438]);near(result.target,[-19848.883056640625,361.66601181030273,-21396.768188476562]);assert.ok(Math.abs(result.fov-32.584494)<1e-5);
 assert.equal(cutsceneCamera([0,0,0,0,0,1,90,30]).roll,Math.PI/2);
});
test('scene tracks preserve interleaving, a separate mask with ID zero, and camera cuts',()=>{
 const a=[0,0,0,0,0,1,0,45],b=[5,0,0,5,0,1,0,45];
 const pack=motionPack([{index:1,frames:[[0,0,0,1,2,3],[0,0,0,4,5,6]]},camera([a,b]),{type:8,modelId:0,index:0,width:4,frames:[[0],[0]]},{type:6,modelId:0,index:1,width:32,frames:[[1,2,3,1,1,1,5,10]]}]);
 assert.equal(sceneSections(pack).length,1);const tracks=parseSceneTracks(pack,0);assert.equal(tracks.lights.length,1);assert.equal(tracks.masks.length,1);assert.deepEqual([...tracks.cuts],[1,0]);
 assert.deepEqual(sceneSample(tracks.camera,.005,tracks.cuts),a);assert.deepEqual(sceneSample(tracks.camera,.5,tracks.cuts),b);assert.deepEqual(sceneSample(tracks.camera,100,tracks.cuts),b);
 assert.equal(sceneSample(tracks.lights[0],1,tracks.cuts)[0],1);
});
test('camera roll interpolates linearly and masks remain discrete',()=>{
 const track={frameCount:2,stride:1,values:[179,-179]};assert.deepEqual(sceneSample(track,.5,[]),[0]);
 assert.deepEqual(sceneSample(track,.5,[],true),[179]);assert.deepEqual(sceneSample(track,.5,[1],true),[-179]);
});
test('unsupported or ambiguous cameras and non-finite scene channels fail before playback',()=>{
 const frame=[0,0,0,0,0,1,0,45];assert.throws(()=>sceneSections(motionPack([camera([frame]),camera([frame])])),/ambiguous/);
 assert.throws(()=>parseSceneTracks(motionPack([camera([[NaN,...frame.slice(1)]])]),0),/non-finite/);
 assert.throws(()=>readSceneResources(Buffer.alloc(1)),/PE/);
});
test('native indoor grid resolves camera environment without adding actor holding rooms',()=>{
 const native={mapPrefix:'am',backgroundStage:9};assert.equal(sceneMapName(native,18504,-18704),'am1f.map');assert.equal(sceneMapName({...native,backgroundStage:12},18504,-18704),null);
 const camera={frameCount:1,values:[366,15,366,397,7,428,0,25]};const maps=[{key:'1:1',name:'data/tmp/am1f.map'},{key:'1:2',name:'data/tmp/am11.map'}];assert.deepEqual(sceneEnvironment(native,camera,maps),['1:1']);
 assert.deepEqual(sceneEnvironment(null,camera,maps),[]);
});
test('MAP prop override replaces its baked rest transform and interpolates large translations',()=>{
 const track={frameCount:2,stride:6,values:[0,0,0,10,20,30,0,0,0,3010,20,30]},rest=new Matrix4().makeScale(-1,-1,1).multiply(new Matrix4().makeTranslation(10,20,30));
 const delta=samplePropMatrix(track,0,[]).multiply(rest.clone().invert());near(delta.elements,new Matrix4().elements);
 const point=new Vector3(-11,-22,33).applyMatrix4(samplePropMatrix(track,.5,[]).multiply(rest.clone().invert()));near(point.toArray(),[-1511,-22,33]);
 near(new Vector3().setFromMatrixPosition(samplePropMatrix(track,.5,[1])).toArray(),[-3010,-20,30]);
});

test('native model aliases resolve differing header IDs and scene facial tracks select the matching variant',()=>{
 const models=[{key:'a',modelId:0,nativeIds:[0x1023],boneCount:18,morphCount:0},{key:'b',modelId:257,nativeIds:[257],boneCount:12,morphCount:4},{key:'c',modelId:257,nativeIds:[],boneCount:12,morphCount:8}];
 assert.equal(sceneModelCandidates(models,{modelId:0x1023,boneCount:18})[0].key,'a');
 const actor={modelId:257,boneCount:12,morphCounts:[8]};assert.equal(defaultSceneModel(sceneModelCandidates(models,actor),actor).key,'c');
 assert.equal(defaultSceneModel(models.slice(1),{...actor,morphCounts:[]}).key,'b');
});

test('duplicate facial controls follow the native first match before compatibility, rather than replacing it with a later blank control',()=>{
 const first={type:'morph',modelId:257,targetCount:34,controlIndex:0},second={...first,controlIndex:1},other={...first,modelId:256};
 assert.equal(matchingCutsceneMorph([other,first,second],257,34),first);
 assert.equal(matchingCutsceneMorph([{...first,targetCount:25},second],257,34),null);
});
