import {sampleScriptProp,scriptedPartVisible} from './cutscene-script.mjs';
import {sceneTrackId} from './cutscene-import.mjs';
import fs from 'node:fs';
import {Matrix4} from 'three';
import {requireThat,sha256} from './binary.mjs';
import {exportGlb} from './gltf.mjs';
import {parseModel} from './model.mjs';
import {readTextures} from './textures.mjs';
import {cutsceneExchange} from './cutscene-exchange.mjs';
import {blenderExchange} from './blender-bridge.mjs';
import {sceneSample,cutsceneCamera} from './cutscene-camera.mjs';
import {samplePropMatrix} from './cutscene-props.mjs';
import {cutsceneVisibility,mapPartVisible} from './cutscene-visibility.mjs';
import {cutscenePartVisible} from './model-visibility.mjs';

/** Bake the selected scene resources on one inclusive 30 FPS timeline. */
export function sceneExportJob(wb,id,options={}) {
  const scene=wb.cutscenes.load(id,options),record=wb.cutscenes.catalog().scenes.find(s=>s.id===id);
  const start=options.start??0,end=options.end??scene.frameCount-1;
  requireThat(Number.isInteger(start)&&Number.isInteger(end)&&start>=0&&end>=start&&end<scene.frameCount,'Choose an inclusive range inside this cutscene.');
  const frames=Array.from({length:end-start+1},(_,i)=>start+i),files={},actors=[],maps=[];
  const visibility=cutsceneVisibility(scene);
  const channel=track=>{const last=Math.min(end,track.frameCount-1),readOnly=last<start,selected=readOnly?[last]:frames.filter(f=>f<=last);return {id:sceneTrackId(track),type:track.type,modelId:track.modelId,index:track.index,readOnly,native:selected.map(f=>Array.from(track.values.slice(f*track.stride,(f+1)*track.stride)))};};
  for(const [i,actor] of scene.actors.entries()) {
    wb.progress({message:'Preparing character assets',done:i,total:scene.actors.length,unit:'characters'});
    const model=parseModel(wb.bytes(actor.key)),last=Math.min(end,actor.clip.frameCount-1),first=Math.min(start,last);
    const motion=cutsceneExchange(model,wb.bytes(record.key),record.sectionIndex,actor.modelId,first,last,30);
    const file=`actor-${i}.glb`;files[file]=exportGlb(model,readTextures(wb.bytes(actor.key),true),motion);
    actors.push({file,name:actor.name,hash:sha256(wb.bytes(actor.key)),modelId:actor.modelId,readOnly:first!==start,metadata:motion.metadata,
      hidden:model.meshes.filter(part=>!cutscenePartVisible(model,part)||!scriptedPartVisible(scene.sceneId,actor.modelId,part)).map(part=>part.name)});
  }
  for(const [i,asset] of scene.environment.entries()) {
    wb.progress({message:'Preparing environment assets',done:i,total:scene.environment.length,unit:'maps'});
    const world=wb.worldAsset(asset.key),file=`map-${i}.glb`;files[file]=exportGlb(world.model,world.textures,null,{nativeMapSides:true});
    maps.push({file,name:asset.name,parts:world.model.meshes.map(part=>{
      const target=scene.propTargets.find(t=>t.key===asset.key&&t.identity===part.partId);
      const scripted=scene.proceduralProps.find(t=>t.key===asset.key&&t.identity===part.partId&&part.objectType===3);
      const track=scripted||(part.objectType===3&&target?scene.props.find(t=>part.partId===t.modelId*65536+t.index):null);
      const inverse=track?new Matrix4().fromArray(part.layout.matrix).invert():null;
      return {name:part.name,objectType:part.objectType,partId:part.partId,track:scripted?scripted.id:track?sceneTrackId(track):null,inverse:inverse?.toArray(),
        visible:part.objectType===2&&visibility.available&&options.visibility!==false?frames.map(frame=>mapPartVisible(part,visibility.at(frame))):null};
    })});
  }
  if(scene.audioFile)files['soundtrack.wav']=fs.readFileSync(scene.audioFile);
  const job={script:'scene_export',outputType:'blend',name:scene.name,start,end,fps:30,actors,maps,
    cameraTrack:channel(scene.camera),
    lights:scene.lights.map(channel),props:scene.props.map(track=>{const item=channel(track);return {...item,matrices:item.native.map((_,i)=>samplePropMatrix(track,start+i,scene.cuts).toArray())};}),
    camera:frames.map(frame=>cutsceneCamera(sceneSample(scene.camera,frame,scene.cuts))),
    cuts:frames.map(frame=>!!scene.cuts[frame]),audio:scene.audioFile?'soundtrack.wav':null,audioOffset:scene.audioOffset,
    issues:scene.issues,exchange:{version:2,sourceHash:sha256(wb.bytes(record.key)),sectionIndex:record.sectionIndex,start,end,actors:actors.map(({name,hash,modelId,readOnly})=>({name,hash,modelId,readOnly}))},limitations:'Reimport supports existing character/morph, camera, light and moving-object channels at the exported duration. Geometry, audio, visibility, particles and stage scripts use separate asset workflows. Blender lighting is an approximation of native lighting.'};
  job.props.push(...scene.proceduralProps.map(track=>({...track,matrices:frames.map(frame=>sampleScriptProp(track,frame).toArray())})));
  return {job,files};
}

export async function exportCutscene(wb,id,options,file) {
  wb.assertSources();const {job,files}=sceneExportJob(wb,id,options);
  const result=await blenderExchange(job,null,wb.cacheFolder,wb.progress,files,file);
  return {file,...result.report};
}
