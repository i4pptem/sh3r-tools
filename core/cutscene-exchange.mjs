import {Bone,Euler,Matrix4,Quaternion,Vector3} from 'three';
import {requireThat,sha256} from './binary.mjs';
import {exchangeRig} from './gltf-rig.mjs';
import {packSections} from './pack.mjs';
import {motionSection,parseCutsceneAnimation} from './cutscene-animation.mjs';
import {applyCutscenePose} from './cutscene-sampling.mjs';
import {parseMorphAnimations,matchingCutsceneMorph} from './morph-animation.mjs';
import {sampleMorphAnimation} from './morph-sampling.mjs';
import {animationImportRange,sampleExchange} from './animation-sampling.mjs';
import {validateSamples,correctedSamples} from './motion-calibration.mjs';
import {replaceCutsceneMorphs} from './cutscene-morph-exchange.mjs';

function skeleton(model) {
  const rig=exchangeRig(model.bones),bones=model.bones.map((bone,i)=>({name:bone.name,parent:bone.parent,world:rig.worlds[i].toArray()}));
  return {bones,skeletonHash:sha256(Buffer.from(JSON.stringify(bones)))};
}
function localSamples(clip,parents,start,end,origin) {
  const bones=parents.map(()=>new Bone()),samples=[];
  for(let frame=start;frame<=end;frame++) {
    applyCutscenePose(clip,frame,frame,0,bones,parents);
    bones.forEach((bone,i)=>{if(parents[i]<0){bone.position.x+=origin[0];bone.position.y+=origin[1];bone.position.z-=origin[2];}});
    samples.push(bones.map(bone=>({translation:bone.position.toArray(),rotation:bone.quaternion.toArray()})));
  }
  return samples;
}

/** Export one character's inclusive range in the same local rig used by ANM exchange. */
export function cutsceneExchange(model,data,sectionIndex,modelId,start,end,fps) {
  const parents=model.bones.map(b=>b.parent),clip=parseCutsceneAnimation(data,sectionIndex,modelId,parents);
  requireThat(Number.isInteger(start)&&Number.isInteger(end)&&start>=0&&end>=start&&end<clip.frameCount,'Choose a range inside the cutscene.');
  requireThat(Number.isFinite(fps)&&fps>=1&&fps<=120,'Choose an exchange FPS from 1 to 120.');
  const count=end-start+1,root=parents.findIndex(parent=>parent<0);
  const origin=Array.from(clip.translations.slice((start*parents.length+root)*3,(start*parents.length+root)*3+3));
  requireThat(count*parents.length<=500000,'Export a shorter animation range (at most 500,000 bone samples).');
  const raw=Buffer.alloc(count*parents.length*24);
  for(let f=0;f<count;f++) for(let bone=0;bone<parents.length;bone++) for(let axis=0;axis<3;axis++) {
    const source=((start+f)*parents.length+bone)*3+axis,dest=(f*parents.length+bone)*24+axis*4;
    raw.writeFloatLE(clip.eulers[source],dest);raw.writeFloatLE(clip.translations[source],dest+12);
  }
  const face=matchingCutsceneMorph(parseMorphAnimations(data),modelId,model.morphNames.length);
  const morphSamples=face?Array.from({length:count},(_,f)=>sampleMorphAnimation(face,start+f)):null;
  const morph=face?{controlIndex:face.controlIndex,names:model.morphNames,weights:structuredClone(morphSamples),
    bindings:model.meshes.filter(mesh=>mesh.morphPositions.some(values=>values.some(v=>v!==0))).map(mesh=>({name:mesh.name,
      targets:mesh.morphPositions.flatMap((values,i)=>values.some(v=>v!==0)?[i]:[])}))}:null;
  return {count,fps,samples:localSamples(clip,parents,start,end,origin),morphSamples,metadata:{version:1,format:'pack',modelId,frameCount:clip.frameCount,
    sectionIndex,start,end,fps,origin,...skeleton(model),sourcePose:raw.toString('base64'),morph}};
}
function sourceExchange(model,exchange) {
  const {metadata,baseline,samples}=exchange,rig=skeleton(model);
  requireThat(metadata?.version===1&&metadata.format==='pack','Choose a cutscene animation exported by Silent Hill 3 Tools. ANM and PACK use different motion formats.');
  requireThat(metadata.skeletonHash===rig.skeletonHash&&JSON.stringify(metadata.bones)===JSON.stringify(rig.bones),'Cutscene skeleton differs from the selected model. Keep the original rest skeleton.');
  requireThat(Array.isArray(metadata.origin)&&metadata.origin.length===3&&metadata.origin.every(Number.isFinite),'Invalid cutscene scene origin.');
  const count=metadata.end-metadata.start+1,n=model.bones.length;
  requireThat(Number.isSafeInteger(count)&&count>0&&count*n<=500000&&typeof metadata.sourcePose==='string','Invalid cutscene source range metadata.');
  const raw=Buffer.from(metadata.sourcePose,'base64');requireThat(raw.length===count*n*24,'Invalid cutscene pose metadata.');
  const clip={boneCount:n,eulers:new Float32Array(count*n*3),translations:new Float32Array(count*n*3)};
  for(let i=0;i<count*n;i++)for(let axis=0;axis<3;axis++){clip.eulers[i*3+axis]=raw.readFloatLE(i*24+axis*4);clip.translations[i*3+axis]=raw.readFloatLE(i*24+12+axis*4);}
  requireThat(clip.eulers.every(Number.isFinite)&&clip.translations.every(Number.isFinite),'Non-finite cutscene source pose.');
  requireThat(baseline?.length===count,'Invalid cutscene export baseline.');
  requireThat((exchange.sampleEnd??samples.length-1)-(exchange.sampleStart??0)+1===samples.length,'Source sample range does not match its frame count.');
  validateSamples(baseline,model.bones,'export baseline');validateSamples(samples,model.bones,'import');
  return {samples:localSamples(clip,model.bones.map(b=>b.parent),0,count-1,metadata.origin)};
}
function nativeWorlds(frame,parents,origin) {
  const worlds=[],flip=new Matrix4().makeRotationZ(Math.PI),one=new Vector3(1,1,1);
  function world(i) {
    if(worlds[i])return worlds[i];
    const pose=frame[i],local=new Matrix4().compose(new Vector3().fromArray(pose.translation),new Quaternion().fromArray(pose.rotation).normalize(),one);
    return worlds[i]=parents[i]<0?local:world(parents[i]).clone().multiply(local);
  }
  return frame.map((_,i)=>{
    const m=world(i).clone().premultiply(flip),position=new Vector3(),rotation=new Quaternion();m.decompose(position,rotation,new Vector3());
    return {position:position.toArray().map((v,k)=>v+origin[k]),rotation};
  });
}
function closestEuler(rotation,reference) {
  const principal=new Euler().setFromQuaternion(rotation,'ZYX').toArray().slice(0,3),turn=2*Math.PI;
  const choices=[principal,[principal[0]+Math.PI,Math.PI-principal[1],principal[2]+Math.PI]].map(values=>values.map((v,i)=>v+turn*Math.round((reference[i]-v)/turn)));
  return choices.sort((a,b)=>a.reduce((n,v,i)=>n+(v-reference[i])**2,0)-b.reduce((n,v,i)=>n+(v-reference[i])**2,0))[0];
}
function writePose(output,offset,pose,report,label) {
  const angles=[0,1,2].map(k=>output.readFloatLE(offset+k*4)),stored=[0,1,2].map(k=>output.readFloatLE(offset+12+k*4));
  const q=new Quaternion().setFromEuler(new Euler(...angles,'ZYX'));
  const sign=q.dot(pose.rotation)<0?-1:1;
  if(q.toArray().some((v,i)=>Math.abs(v-pose.rotation.toArray()[i]*sign)>64*Number.EPSILON)) {
    closestEuler(pose.rotation,angles).forEach((v,k)=>output.writeFloatLE(v,offset+k*4));report.changedRotations++;
  }
  const epsilon=64*Number.EPSILON*Math.max(1,...stored.map(Math.abs),...pose.position.map(Math.abs));
  if(stored.some((v,i)=>Math.abs(v-pose.position[i])>epsilon&&v!==Math.fround(pose.position[i]))) {
    pose.position.forEach((v,k)=>{requireThat(Number.isFinite(Math.fround(v)),`${label}: position exceeds float32 storage.`);output.writeFloatLE(v,offset+12+k*4);});report.changedTranslations++;
  }
}

/** Replace selected character samples; other tracks and unselected frames retain their bytes. */
export function replaceCutsceneAnimation(model,source,sectionIndex,modelId,exchange,options={}) {
  const original=sourceExchange(model,exchange),parents=model.bones.map(b=>b.parent);
  requireThat(exchange.metadata.modelId===modelId,'Choose a cutscene for the same character.');
  const clip=parseCutsceneAnimation(source,sectionIndex,modelId,parents),range=animationImportRange(exchange,clip.frameCount,options);
  const poses=correctedSamples(model,exchange,original),section=packSections(source).find(s=>s.index===sectionIndex),layout=motionSection(source,section);
  let output=Buffer.from(source);
  const report={format:'pack',...range,frameCount:range.count,changedRotations:0,changedTranslations:0,changedMorphSamples:0,skippedChannels:[]};
  if(options.importBones!==false) {
    const frames=Array.from({length:range.count},(_,f)=>nativeWorlds(sampleExchange(poses,range.sourceStart-range.first+(range.count===1?0:f*(range.sourceEnd-range.sourceStart)/(range.count-1))),parents,exchange.metadata.origin));
    const targetBones=layout.tracks.filter(t=>t.type===1&&t.modelId===modelId&&t.index>0);
    for(const track of targetBones) requireThat(track.frameCount>range.end,`${model.bones[track.index-1].name}: this cutscene track ends at frame ${track.frameCount-1}. Choose a range within that track.`);
    let offset=section.offset+layout.dataOffset;
    for(let frame=0;frame<=range.end;frame++)for(const track of layout.tracks) {
      if(frame>=track.frameCount)continue;
      if(frame>=range.start&&track.type===1&&track.modelId===modelId&&track.index>0)
        writePose(output,offset,frames[frame-range.start][track.index-1],report,`${model.bones[track.index-1].name}, PACK frame ${frame}`);
      offset+=track.width;
    }
  }
  if(options.importMorphs!==false&&exchange.metadata.morph) {
    const result=replaceCutsceneMorphs(output,modelId,exchange,{...range,targetFrames:clip.frameCount});output=result.data;report.changedMorphSamples=result.changed;report.maxMorphBoundaryError=result.maxBoundaryError||0;
  }
  parseCutsceneAnimation(output,sectionIndex,modelId,parents);parseMorphAnimations(output);
  return {data:output,report};
}
