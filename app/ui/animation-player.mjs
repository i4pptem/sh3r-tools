import {Quaternion, Vector3} from 'three';
import {applyCutscenePose} from '../../core/cutscene-sampling.mjs';
import {sampleMorphAnimation} from '../../core/morph-sampling.mjs';

const flip = new Quaternion(0, 0, 1, 0), unitScale = new Vector3(1, 1, 1);
const qa = new Quaternion(), qb = new Quaternion(), pa = new Vector3(), pb = new Vector3();

/** Apply absolute local ANM samples; unanimated components retain their bind pose. */
export function applySkeletalPose(clip, frame, bones, bind, parents, range = {}) {
  const start=Math.max(0,Math.min(clip.frameCount-1,range.start??0)),end=Math.max(start,Math.min(clip.frameCount-1,range.end??clip.frameCount-1));
  const position=Math.max(start,Math.min(end+1-Number.EPSILON,frame));
  const a=Math.min(end,Math.floor(position)),b=a<end?a+1:range.loop?start:end,mix=Math.min(1,position-a);
  if (clip.sourceFormat === 'pack') {applyCutscenePose(clip, a, b, mix, bones, parents); return;}
  for (let i = 0; i < bones.length; i++) {
    const bone = bones[i], ra = (a * bones.length + i) * 4, rb = (b * bones.length + i) * 4;
    bone.position.copy(bind[i].position); bone.quaternion.copy(bind[i].quaternion); bone.scale.copy(bind[i].scale || unitScale);
    if (Number.isFinite(clip.rotations[ra])) {
      qa.fromArray(clip.rotations, ra); qb.fromArray(clip.rotations, rb); bone.quaternion.copy(qa).slerp(qb, mix);
      if (parents[i] < 0) bone.quaternion.premultiply(flip);
    }
    const ta = (a * bones.length + i) * 3, tb = (b * bones.length + i) * 3;
    if (Number.isFinite(clip.translations[ta])) {
      pa.fromArray(clip.translations, ta); pb.fromArray(clip.translations, tb); bone.position.copy(pa).lerp(pb, mix);
      if (parents[i] < 0) {bone.position.x *= -1; bone.position.y *= -1;}
    }
  }
}

export class AnimationPlayer {
  constructor(viewport) {
    this.viewport = viewport; this.skeletal = null; this.morphClip = null;
    this.frame = 0; this.start = 0; this.end = 0; this.fps = 30; this.speed = 1; this.loop = true; this.autoReplay = false; this.playing = false;
    this.audition = false; this.target = 0; this.weight = 0; this.elapsed = 0;
  }
  get repeats() {return this.loop || (this.autoReplay && this.skeletal?.sourceFormat === 'anm');}
  get frameCount() {return Math.max(this.skeletal?.frameCount || 1, this.morphClip?.frameCount || 1);}
  clip(type, clip) {
    if (type === 'skeletal') {
      if (clip?.sourceFormat === 'pack') {this.fps = clip.fps || 30; this.morphClip = clip.morphClip || null; this.audition = false; this.weight = 0;}
      else if (this.skeletal?.sourceFormat === 'pack') this.morphClip = null;
      this.skeletal = clip;
    } else {this.morphClip = clip; this.audition = false; this.weight = 0;}
    this.viewport.visibility?.setCutscene(this.skeletal?.sourceFormat === 'pack');
    this.start = 0; this.end = this.frameCount - 1; this.frame = 0; this.playing = !!(this.skeletal || this.morphClip);
    this.apply(); this.onChange?.(this);
  }
  seek(frame) {this.frame = Math.max(this.start, Math.min(this.end, frame)); this.apply(); this.onChange?.(this);}
  range(start, end) {this.start = start; this.end = end; this.seek(this.frame);}
  stop() {this.playing = false; this.seek(this.start);}
  manual(target, weight) {this.target = target; this.weight = weight; this.audition = false; this.clearMorph(); this.apply(); this.onChange?.(this);}
  auditionMorph(target, enabled) {this.target = target; this.audition = enabled; this.elapsed = 0; this.clearMorph(); this.weight = 0; this.apply(); this.onChange?.(this);}
  clearMorph() {
    this.morphClip = null; this.start = 0; this.end = this.frameCount - 1;
    this.frame = Math.min(this.frame, this.end); if (!this.skeletal) this.playing = false;
  }
  update(seconds) {
    if (this.playing) {
      this.frame += seconds * this.fps * this.speed;
      if (this.frame >= this.end + 1) {
        if (this.repeats) this.frame = this.start + (this.frame - this.start) % (this.end - this.start + 1);
        else {this.frame = this.end; this.playing = false;}
      }
    }
    if (this.audition) {this.elapsed += seconds; this.weight = (1 - Math.cos(this.elapsed * Math.PI)) / 2;}
    if (this.playing || this.audition) {this.apply(); this.onTick?.(this);}
    else if (this.frame === this.end) {this.apply(); this.onTick?.(this);}
  }
  apply() {
    const viewport = this.viewport;
    if (this.skeletal) applySkeletalPose(this.skeletal, this.frame, viewport.rigBones, viewport.bindPose, viewport.parents, {start:this.start,end:this.end,loop:this.loop});
    else viewport.rigBones?.forEach((bone, i) => {bone.position.copy(viewport.bindPose[i].position); bone.quaternion.copy(viewport.bindPose[i].quaternion); bone.scale.copy(viewport.bindPose[i].scale || unitScale);});
    const weights = this.morphClip ? sampleMorphAnimation(this.morphClip, this.frame) : null;
    for (const mesh of viewport.meshes) if (mesh.morphTargetInfluences) {
      mesh.morphTargetInfluences.fill(0);
      if (weights) weights.forEach((weight, i) => {if (i < mesh.morphTargetInfluences.length) mesh.morphTargetInfluences[i] = weight;});
      else if (this.target < mesh.morphTargetInfluences.length) mesh.morphTargetInfluences[this.target] = this.weight;
    }
  }
}
