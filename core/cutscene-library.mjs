import {scriptedProps,sceneAudioLeadIn} from './cutscene-script.mjs';
import {sceneModelCandidates,defaultSceneModel} from './cutscene-models.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {sceneSections,parseSceneTracks} from './cutscene-scene.mjs';
import {localSceneResources,sceneEnvironment} from './cutscene-resources.mjs';
import {modelLayout} from './model.mjs';
import {parseCutsceneAnimation} from './cutscene-animation.mjs';
import {parseMorphAnimations,matchingCutsceneMorph} from './morph-animation.mjs';
import {decodeAdx,waveFile} from './audio.mjs';
import {requireThat,sha256} from './binary.mjs';

export class CutsceneLibrary {
  constructor(workbench){this.workbench=workbench;this.cached=null;}
  catalog(force=false) {
    const wb=this.workbench,snapshot=wb.snapshot(),revision=snapshot.textureRevision;
    if(!force&&this.cached?.revision===revision)return this.cached;
    const metadata=localSceneResources(wb.dataRoot),scenes=[],models=[],issues=[];
    for(const entry of snapshot.entries) {
      if(['mdl','mdl_'].includes(entry.extension)) {
        try{const bytes=wb.bytes(entry.key),h=modelLayout(bytes);models.push({nativeIds:Object.entries(metadata.modelNames).filter(([,name])=>name===entry.name).map(([id])=>Number(id)),key:entry.key,name:entry.name,modelId:bytes.readUInt32LE(4),boneCount:h.boneCount,morphCount:h.morphCount});}
        catch(error){issues.push({name:entry.name,message:error.message});}
      }
      if(entry.detectedFormat!=='pack')continue;
      try {
        const native=metadata.scenes.filter(s=>s.archive.toLowerCase()===path.basename(wb.get(entry.key).archive.file).toLowerCase()&&s.packEntry===entry.index);
        const facialClips=parseMorphAnimations(wb.bytes(entry.key));
        for(const section of sceneSections(wb.bytes(entry.key))) scenes.push({...section,actors:section.actors.map(actor=>({...actor,morphCounts:[...new Set(facialClips.filter(c=>c.modelId===actor.modelId).map(c=>c.targetCount))]})),key:entry.key,id:entry.key+':'+section.sectionIndex,archive:entry.archive,archiveName:entry.archiveName,index:entry.index,
          name:`${entry.archiveName} · entry ${entry.index}`+(native.length===1?` · scene ${native[0].sceneId}`:''),native:native.length===1?native[0]:null});
      }catch(error){issues.push({name:entry.name,message:error.message});}
    }
    const maps=snapshot.entries.filter(e=>e.extension==='map').map(({key,name,archive})=>({key,name,archive}));
    const audio=snapshot.entries.filter(e=>e.detectedFormat==='adx').map(({key,name,archive,index,archiveName})=>({key,name,archive,index,archiveName}));
    this.cached={revision,scenes,models:models.sort((a,b)=>a.name.localeCompare(b.name)),maps,audio,issues,note:metadata.note};return this.cached;
  }
  load(id,options={}) {
    const wb=this.workbench,catalog=this.catalog(),scene=catalog.scenes.find(s=>s.id===id);requireThat(scene,'Select a cutscene from the current catalog.');
    const data=wb.bytes(scene.key),tracks=parseSceneTracks(data,scene.sectionIndex),morphs=parseMorphAnimations(data),actors=[],issues=[];
    const choices=options.models||{};
    for(const actor of scene.actors) {
      const candidates=sceneModelCandidates(catalog.models,actor);
      const preferred=defaultSceneModel(candidates,actor);
      const modelKey=choices[actor.modelId]??preferred?.key??candidates[0]?.key;
      if(modelKey==='')continue;
      if(!modelKey){issues.push(`Character 0x${actor.modelId.toString(16)}: no matching MDL / skeleton is open.`);continue;}
      requireThat(candidates.some(c=>c.key===modelKey),'Selected character model does not match the scene skeleton.');
      try {
        const preview=wb.preview(modelKey);requireThat(preview.model,preview.previewError||'Model has no geometry.');
        const parents=preview.model.bones.map(b=>b.parent),clip=parseCutsceneAnimation(data,scene.sectionIndex,actor.modelId,parents);
        const face=matchingCutsceneMorph(morphs,actor.modelId,preview.model.morphNames.length);
        if(face)clip.morphClip=face;
        else if(morphs.some(m=>m.modelId===actor.modelId))issues.push(`Character 0x${actor.modelId.toString(16)}: the first native facial control has a different target count. Select a matching model variant.`);
        if(candidates.length>1)issues.push(`Character 0x${actor.modelId.toString(16)} has ${candidates.length} model variants. Current choice: ${wb.get(modelKey).entry.name.split('/').pop()}; change it under Resources.`);
        actors.push({modelId:actor.modelId,key:modelKey,name:wb.get(modelKey).entry.name,model:preview.model,textures:preview.textures,clip});
      }catch(error){issues.push(`Character 0x${actor.modelId.toString(16)}: ${error.message}`);}
    }
    const mapKeys=options.maps??sceneEnvironment(scene.native,tracks.camera,catalog.maps),environment=[];
    requireThat(Array.isArray(mapKeys)&&mapKeys.length<=32&&new Set(mapKeys).size===mapKeys.length,'Choose up to 32 distinct environment maps.');
    for(const key of mapKeys){requireThat(catalog.maps.some(m=>m.key===key),'Environment map is not in the current catalog.');
      try{const preview=wb.preview(key);requireThat(preview.model,preview.previewError||'Map has no geometry.');environment.push({key,name:wb.get(key).entry.name,model:preview.model,textures:preview.textures});}
      catch(error){issues.push(`${wb.get(key).entry.name}: ${error.message}`);}}
    const defaultAudio=catalog.audio.find(a=>a.archive===scene.archive&&a.index===scene.native?.audioEntry)?.key;
    const audioKey=options.audio===undefined?defaultAudio:options.audio;
    let audioFile=null;
    if(audioKey){requireThat(catalog.audio.some(a=>a.key===audioKey),'Select a decoded ADX soundtrack.');
      try{const bytes=wb.bytes(audioKey);audioFile=path.join(wb.cacheFolder,'cutscene-'+sha256(bytes)+'.wav');
        if(!fs.existsSync(audioFile)){const decoded=decodeAdx(bytes);fs.mkdirSync(wb.cacheFolder,{recursive:true});const temporary=audioFile+'.tmp';try{fs.writeFileSync(temporary,waveFile(decoded.pcm,decoded.sampleRate,decoded.channels));fs.renameSync(temporary,audioFile);}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}}}
      catch(error){audioFile=null;issues.push('Soundtrack: '+error.message);}}
    else issues.push('No soundtrack selected. This scene plays silently.');
    if(!environment.length)issues.push('No environment selected. Choose the room maps under Resources.');
    const propTargets=[];
    for(const track of tracks.props){const identity=track.modelId*65536+track.index,maps=environment.filter(asset=>asset.model.meshes.some(part=>part.objectType===3&&part.partId===identity));
      if(maps.length===1)propTargets.push({identity,key:maps[0].key});
      else issues.push(maps.length?`Moving map object 0x${identity.toString(16)} exists in several selected rooms. Keep its intended room to preview the motion.`:`Moving map object 0x${identity.toString(16)} has no matching part in the loaded environment.`);
    }
    if(!scene.native)issues.push('Native resource metadata is unresolved for this PACK. Choose its environment and soundtrack manually.');
    if(tracks.masks.length)issues.push('PACK visibility masks control event mesh groups. Known stage-script visibility is applied; other callbacks are not present in the scene file.');
    const sceneId=scene.native?.sceneId,proceduralProps=scriptedProps(sceneId,environment);
    const audioOffset=audioKey===defaultAudio?sceneAudioLeadIn(sceneId):0;
    if(audioOffset)issues.push('This soundtrack begins about 31.5 seconds before PACK animation. Preview starts at the animation; native timing varies slightly with render rate.');
    if(proceduralProps.length)issues.push('Carousel rotation is reconstructed from the stage script with a zero starting phase. These display-only controls cannot be reimported into PACK.');
    return {sceneId,proceduralProps,audioOffset,id,name:scene.name,...tracks,actors,environment,propTargets,audioKey:audioKey||'',audioFile,issues,
      note:'Scene preview: camera, skeletons, facial motion and soundtrack share a 30 FPS clock. Lighting, shadows, particles and scripted effects may differ from the game.'};
  }
}
