import {Matrix4} from 'three';
const flip=new Matrix4().makeScale(-1,-1,1);
export const sceneAudioLeadIn=sceneId=>sceneId===48?31.48900032:0;
export const scriptedPartVisible=(sceneId,modelId,part)=>sceneId!==65||modelId!==0x215||[0,3].includes(part.visibilityId);

/** Stage-script objects are preview/export controls, not writable PACK channels. */
export function scriptedProps(sceneId,environment) {
  if(sceneId!==80)return [];
  const candidates=environment.filter(asset=>asset.model.meshes.some(part=>part.objectType===3&&part.partId===1));
  if(candidates.length!==1)return [];
  const asset=candidates[0],parts=asset.model.meshes.filter(part=>part.objectType===3&&[1,2,3,4].includes(part.partId));
  const base=parts.find(part=>part.partId===1).layout.matrix;
  return [...new Map(parts.map(part=>[part.partId,{id:'script:carousel:'+part.partId,readOnly:true,key:asset.key,identity:part.partId,base,rest:part.layout.matrix}])).values()];
}

/** Reproducible zero-phase reconstruction; the game's initial phase is not stored in PACK. */
export function sampleScriptProp(track,frame,target=new Matrix4()) {
  const before=Math.min(Math.max(0,frame),438)/30,after=Math.max(0,frame-438)/30;
  const baseAngle=(before*45+after*50)*Math.PI/180,spinAngle=(before*-150+after*-100)*Math.PI/180;
  const base=new Matrix4().fromArray(track.base).premultiply(flip),rest=new Matrix4().fromArray(track.rest).premultiply(flip);
  target.copy(base).multiply(new Matrix4().makeRotationY(baseAngle));
  if(track.identity!==1)target.multiply(base.clone().invert()).multiply(rest).multiply(new Matrix4().makeRotationY(spinAngle));
  return target.premultiply(flip);
}
