import {packSections} from './pack.mjs';
import {motionSection, cutsceneAnimations} from './cutscene-animation.mjs';
import {cameraSample, cameraCut} from './cutscene-sampling.mjs';
import {requireThat} from './binary.mjs';

const widths = new Map([[2,24],[3,32],[5,36],[6,32],[7,52],[8,4]]);

export function sceneSections(buffer) {
  return packSections(buffer).filter(section => section.type === 2).map(section => {
    const {tracks} = motionSection(buffer, section);
    const cameras = tracks.filter(t => t.type === 3 && t.modelId === 0 && t.index === 0);
    const first = tracks.find(t => t.type !== 0 && t.modelId === 0 && t.index === 0);
    requireThat(cameras.length === 1 && first === cameras[0] && cameras[0].width === 32, 'Unsupported or ambiguous PACK camera track.');
    return {sectionIndex:section.index,frameCount:Math.max(...tracks.map(t=>t.frameCount)),cameraFrames:cameras[0].frameCount,
      actors:cutsceneAnimations(buffer).filter(c=>c.sectionIndex===section.index),
      props:tracks.filter(t=>t.type===2).map(({modelId,index,frameCount})=>({modelId,index,frameCount})),
      lightCount:tracks.filter(t=>[5,6,7].includes(t.type)).length};
  });
}

/** Decode camera, rigid-object, light and visibility channels from interleaved PACK frames. */
export function parseSceneTracks(buffer, sectionIndex) {
  const section = packSections(buffer).find(s=>s.index===sectionIndex && s.type===2);
  requireThat(section,'Cutscene section is no longer present.');
  const {data,dataOffset,tracks}=motionSection(buffer,section);
  const selected = new Map(); let total=0;
  for(const track of tracks) if(widths.has(track.type)) {
    requireThat(track.width===widths.get(track.type) && track.frameCount>0,'Unsupported PACK scene channel layout.');
    total+=track.frameCount*track.width;
    requireThat(total<=128*1024*1024,'Cutscene scene channels exceed preview limits.');
    selected.set(track,{...track,stride:track.width/4,values:track.type===8?new Uint32Array(track.frameCount):new Float32Array(track.frameCount*track.width/4)});
  }
  const frameCount=Math.max(...tracks.map(t=>t.frameCount));
  let offset=dataOffset;
  for(let frame=0;frame<frameCount;frame++) for(const track of tracks) {
    if(frame>=track.frameCount)continue;
    const output=selected.get(track);
    if(output) for(let i=0;i<output.stride;i++) {
      const value=track.type===8?data.readUInt32LE(offset+i*4):data.readFloatLE(offset+i*4);
      requireThat(Number.isFinite(value),`Scene channel ${track.type}:${track.modelId}:${track.index}, frame ${frame}: non-finite value.`);
      output.values[frame*output.stride+i]=value;
    }
    offset+=track.width;
  }
  const channels=[...selected.values()], cameras=channels.filter(t=>t.modelId===0&&t.index===0&&t.type===3);
  requireThat(cameras.length===1,'Cutscene needs one supported camera.');
  const camera=cameras[0],cuts=new Uint8Array(frameCount);
  for(let i=0;i<camera.frameCount;i++)requireThat(camera.values[i*8+7]>0&&camera.values[i*8+7]<180,`Cutscene camera, frame ${i}: invalid lens angle.`);
  for(let i=0;i<camera.frameCount-1;i++) cuts[i]=Number(cameraCut(cameraSample(Array.from(camera.values.subarray(i*8,i*8+8))),cameraSample(Array.from(camera.values.subarray(i*8+8,i*8+16)))));
  return {frameCount,fps:30,camera,cuts,props:channels.filter(t=>t.type===2),lights:channels.filter(t=>[5,6,7].includes(t.type)),masks:channels.filter(t=>t.type===8)};
}
