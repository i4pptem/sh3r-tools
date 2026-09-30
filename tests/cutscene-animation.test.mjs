import test from 'node:test';
import assert from 'node:assert/strict';
import {Object3D, Quaternion, Vector3} from 'three';
import {cutsceneAnimations, parseCutsceneAnimation} from '../core/cutscene-animation.mjs';
import {applySkeletalPose} from '../app/ui/animation-player.mjs';
import {motionPack} from './helpers/pack-fixture.mjs';

const pose = (x, y = 0, z = 0, rz = 0) => [0, 0, rz, x, y, z];
const close = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-5, `${a} != ${b}`));

test('PACK consumes interleaved cameras and shorter tracks without mixing character identities or origin', () => {
  const data = motionPack([
    {index: 0, frames: [pose(999), pose(888), pose(777)]},
    {index: 1, frames: [pose(10), pose(20), pose(30)]},
    {type: 3, index: 1, width: 4, frames: [[45]]},
    {index: 1, modelId: 257, frames: [pose(111), pose(222)]},
    {index: 2, frames: [pose(12), pose(24)]},
  ]);
  assert.equal(cutsceneAnimations(data).length, 2);
  const clip = parseCutsceneAnimation(data, 0, 256, [-1, 0]);
  assert.equal(clip.frameCount, 3); assert.deepEqual([...clip.translations], [10,0,0,12,0,0,20,0,0,24,0,0,30,0,0,24,0,0]);
  assert.throws(() => parseCutsceneAnimation(data, 0, 256, [-1]), /skeleton/);
});

test('absolute PACK bone positions become parent-local poses with the display flip applied once', () => {
  const data = motionPack([{index: 1, frames: [pose(10,20,30,Math.PI/2), pose(12,20,30,Math.PI/2)]},
    {index: 2, frames: [pose(10,22,30,Math.PI/2), pose(12,22,30,Math.PI/2)]}]);
  const clip = parseCutsceneAnimation(data, 0, 256, [-1,0]), bones = [new Object3D(), new Object3D()];
  const bind = bones.map(b => ({position:b.position.clone(), quaternion:b.quaternion.clone()}));
  applySkeletalPose(clip, .5, bones, bind, [-1,0]);
  close(bones[0].position.toArray(), [-11,-20,30]); close(bones[1].position.toArray(), [2,0,0]);
  close(bones[1].quaternion.toArray(), [0,0,0,1]);
  applySkeletalPose(clip, .005, bones, bind, [-1,0]); close(bones[0].position.toArray(), [-10,-20,30]);
});

test('PACK yaw interpolation wraps across pi and range endpoints hold or loop explicitly', () => {
  const data = motionPack([{index:1,frames:[[0,3,0,0,0,0],[0,-3,0,2,0,0]]}]);
  const clip = parseCutsceneAnimation(data,0,256,[-1]), bones=[new Object3D()], bind=[{position:new Vector3(),quaternion:new Quaternion()}];
  applySkeletalPose(clip,.5,bones,bind,[-1]);
  const expected = new Quaternion(0,0,1,0).multiply(new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI));
  assert.ok(Math.abs(bones[0].quaternion.dot(expected)) > 1 - 1e-6);
  applySkeletalPose(clip,1.5,bones,bind,[-1],{loop:false}); close(bones[0].position.toArray(),[-2,0,0]);
  applySkeletalPose(clip,1.5,bones,bind,[-1],{loop:true}); close(bones[0].position.toArray(),[-1,0,0]);
});

test('PACK rejects incomplete bones, wrong widths, non-finite poses and invalid section lengths', () => {
  assert.deepEqual(cutsceneAnimations(Buffer.alloc(4)), []);
  assert.throws(() => cutsceneAnimations(motionPack([{index:2,frames:[pose(0)]}])), /incomplete/);
  assert.throws(() => cutsceneAnimations(motionPack([{index:1,frames:[pose(0)]},{index:1,frames:[pose(0)]}])), /duplicate/);
  assert.throws(() => cutsceneAnimations(motionPack([{index:1,width:28,frames:[pose(0)]}])), /layout/);
  assert.throws(() => parseCutsceneAnimation(motionPack([{index:1,frames:[pose(NaN)]}]),0,256,[-1]), /non-finite/);
  const data = motionPack([{index:1,frames:[pose(0)]}]); data.writeUInt32LE(data.readUInt32LE(24)-1,24);
  assert.throws(() => cutsceneAnimations(data), /section/);
});

test('native cutscene interpolation holds large position jumps and uses nlerp for large pitch/roll changes', () => {
  const clip=parseCutsceneAnimation(motionPack([{index:1,frames:[[0,0,0,0,0,0],[2,0,0,1000,0,0]]}]),0,256,[-1]);
  const bones=[new Object3D()], bind=[{position:new Vector3(),quaternion:new Quaternion()}];
  applySkeletalPose(clip,.25,bones,bind,[-1]);close(bones[0].position.toArray(),[0,0,0]);
  const angle=2*Math.atan2(Math.sin(1)*.25,.75+Math.cos(1)*.25);
  const expected=new Quaternion(0,0,1,0).multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),angle));
  assert.ok(Math.abs(bones[0].quaternion.dot(expected)) > 1-1e-6);
  const yaw=parseCutsceneAnimation(motionPack([{index:1,frames:[[0,0,0,0,0,0],[0,Math.PI,0,0,0,0]]}]),0,256,[-1]);
  applySkeletalPose(yaw,.5,bones,bind,[-1]);
  const half=new Quaternion(0,0,1,0).multiply(new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/2));
  assert.ok(Math.abs(bones[0].quaternion.dot(half)) > 1-1e-6);
});

test('camera cuts snap character poses to the next frame while the native fractional dead zone keeps the current pose', () => {
  const data=motionPack([{index:1,frames:[pose(0),pose(10)]},
    {type:3,index:0,modelId:0,width:32,frames:[[0,0,0,0,0,1,0,45],[5,0,0,5,0,1,0,45]]}]);
  const clip=parseCutsceneAnimation(data,0,256,[-1]),bones=[new Object3D()],bind=[{position:new Vector3(),quaternion:new Quaternion()}];
  assert.deepEqual([...clip.cuts],[1,0]);
  applySkeletalPose(clip,.5,bones,bind,[-1]);close(bones[0].position.toArray(),[-10,0,0]);
  applySkeletalPose(clip,.005,bones,bind,[-1]);close(bones[0].position.toArray(),[0,0,0]);
});
