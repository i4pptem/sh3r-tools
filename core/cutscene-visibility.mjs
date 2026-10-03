import {sceneSample} from './cutscene-camera.mjs';
/** The event manager clears the map mask each update before PACK contributes its current bits. */
export function cutsceneVisibility(data) {
  const tracks=data.masks.filter(track=>track.modelId===0);
  return {available:tracks.length>0, at(frame) {
    const mask=tracks.reduce((mask,track)=>mask|sceneSample(track,frame,data.cuts,true)[0],0)>>>0;
    return data.sceneId===41?(mask&~16)>>>0:mask;
  }};
}
export function mapPartVisible(part,mask) {return part.objectType!==2 || !!(mask & (1<<(part.partId&31)));}
