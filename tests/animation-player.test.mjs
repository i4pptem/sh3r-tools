import test from 'node:test';import assert from 'node:assert/strict';
import {Object3D,Quaternion,Vector3} from 'three';
import {applySkeletalPose,AnimationPlayer} from '../app/ui/animation-player.mjs';
function fixture(){const bones=[new Object3D()],bind=[{position:new Vector3(),quaternion:new Quaternion()}],clip={frameCount:12,rotations:new Float32Array(48).fill(NaN),translations:Float32Array.from(Array.from({length:12},(_,i)=>[i,0,0]).flat())};return {bones,bind,clip};}
test('a selected loop interpolates its last frame to its own first, never the next action',()=>{
 const {bones,bind,clip}=fixture();applySkeletalPose(clip,9.5,bones,bind,[0],{start:2,end:9,loop:true});assert.equal(bones[0].position.x,5.5);
 applySkeletalPose(clip,9.5,bones,bind,[0],{start:2,end:9,loop:false});assert.equal(bones[0].position.x,9);
});
test('range 0–9 contains ten sample intervals without an extra frame',()=>{
 const {bones,bind,clip}=fixture(),player=new AnimationPlayer({rigBones:bones,bindPose:bind,parents:[0],meshes:[]});
 player.clip('skeletal',clip);player.fps=10;player.range(0,9);player.update(.9);assert.equal(player.frame,9);player.update(.1);assert.equal(player.frame,0);
 player.loop=false;player.seek(9);player.update(.1);assert.equal(player.playing,false);assert.equal(player.frame,9);
});

test('choosing a cutscene replaces its paired face atomically and restores bind scale afterwards',()=>{
 const {bones,bind}=fixture();bind[0].scale=new Vector3(2,2,2);
 const mesh={morphTargetInfluences:[0]}, player=new AnimationPlayer({rigBones:bones,bindPose:bind,parents:[-1],meshes:[mesh]});
 const morph={id:'face',frameCount:1,targetCount:1,segments:[{startFrame:0,endFrame:1,frameCount:1,tracks:[{frames:[0],weights:[.75]}]}]};
 const cutscene={sourceFormat:'pack',frameCount:2,boneCount:1,eulers:new Float32Array(6),translations:new Float32Array(6),morphClip:morph};
 player.clip('skeletal',cutscene);assert.equal(player.morphClip,morph);assert.equal(mesh.morphTargetInfluences[0],.75);
 player.seek(1);assert.equal(mesh.morphTargetInfluences[0],.75);
 player.clip('skeletal',{...cutscene,morphClip:null});assert.equal(player.morphClip,null);
 player.clip('skeletal',null);assert.deepEqual(bones[0].scale.toArray(),[2,2,2]);
});
