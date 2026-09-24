import test from 'node:test';
import assert from 'node:assert/strict';
import {Bone, Quaternion, Vector3} from 'three';
import {AnimationPlayer, applySkeletalPose} from '../app/ui/animation-player.mjs';

test('Skeletal playback interpolates absolute local poses and converts roots once', () => {
  const bones = [new Bone(), new Bone(), new Bone()]; bones[0].add(bones[1]); bones[1].add(bones[2]);
  const bind = bones.map((_, i) => ({position: new Vector3(0, i ? 2 : 0, 0), quaternion: new Quaternion()}));
  const rotations = new Float32Array(24).fill(NaN), translations = new Float32Array(18).fill(NaN);
  rotations.set([0, 0, 0, 1], 0); rotations.set([0, 0, 0, 1], 12);
  rotations.set([0, 0, 0, 1], 4); rotations.set([0, 0, 1, 0], 16);
  translations.set([0, 0, 0], 0); translations.set([10, 20, 30], 9);
  applySkeletalPose({frameCount: 2, rotations, translations}, .5, bones, bind, [-1, 0, 1]);
  assert.deepEqual(bones[0].position.toArray(), [-5, -10, 15]);
  assert.ok(bones[0].quaternion.angleTo(new Quaternion(0, 0, 1, 0)) < 1e-7);
  assert.deepEqual(bones[1].position.toArray(), [0, 2, 0]);
  assert.ok(bones[1].quaternion.angleTo(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)) < 1e-7);
  assert.deepEqual(bones[2].position.toArray(), [0, 2, 0]);
  bones[0].updateMatrixWorld(true);
  const world = bones[2].getWorldPosition(new Vector3());
  assert.ok(world.distanceTo(new Vector3(-3, -12, 15)) < 1e-6);
});

const viewport = () => ({meshes: [{morphTargetInfluences: [0, 0]}], rigBones: [], bindPose: []});
const morph = {frameCount: 10, targetCount: 2, segments: [{startFrame: 0, endFrame: 10, frameCount: 10,
  tracks: [{frames: [0, 9], weights: [0, 1]}, {frames: [0], weights: [.5]}]}]};

test('Transport advances without manual seeking and loops only inside the selected range', () => {
  const v = viewport(), player = new AnimationPlayer(v); player.clip('morph', morph); player.fps = 10;
  player.range(2, 4); player.update(.1); assert.equal(player.frame, 3); assert.equal(v.meshes[0].morphTargetInfluences[0], 1 / 3);
  player.update(.25); assert.equal(player.frame, 2.5);
  player.loop = false; player.update(1); assert.equal(player.frame, 4); assert.equal(player.playing, false);
  player.stop(); assert.equal(player.frame, 2);
});

test('Morph audition updates continuously and manual control clears the native track', () => {
  const v = viewport(), player = new AnimationPlayer(v); player.clip('morph', morph);
  player.auditionMorph(1, true); player.update(1);
  assert.deepEqual(v.meshes[0].morphTargetInfluences, [0, 1]); assert.equal(player.morphClip, null); assert.equal(player.playing, false);
  player.manual(0, .4); player.update(.2); assert.deepEqual(v.meshes[0].morphTargetInfluences, [.4, 0]);
});
