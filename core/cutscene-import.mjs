import {randomUUID} from 'node:crypto';
import {requireThat,sha256} from './binary.mjs';
import {blenderExchange} from './blender-bridge.mjs';
import {parseSceneTracks} from './cutscene-scene.mjs';
import {packSections} from './pack.mjs';
import {motionSection} from './cutscene-animation.mjs';
import {parseModel} from './model.mjs';
import {replaceCutsceneAnimation} from './cutscene-exchange.mjs';

export const sceneTrackId=track=>`${track.type}:${track.modelId}:${track.index}`;
const fieldGroup=type=>type===3?'camera':type===2?'props':'lights';

/** Update existing interleaved channels only; keep descriptors, masks and other sections intact. */
export function replaceSceneChannels(source,sectionIndex,start,channels,options={}) {
  const scene=parseSceneTracks(source,sectionIndex),section=packSections(source).find(s=>s.index===sectionIndex),layout=motionSection(source,section);
  const known=new Map([scene.camera,...scene.lights,...scene.props].map(track=>[sceneTrackId(track),track])),updates=new Map();
  requireThat(Number.isSafeInteger(start)&&start>=0,'Invalid cutscene start frame.');
  for(const channel of channels) {
    const original=known.get(channel.id),label=`Scene track ${channel.id}`;
    requireThat(original&&!updates.has(channel.id),`${label}: missing or duplicate native channel.`);
    requireThat(channel.type===original.type&&channel.modelId===original.modelId&&channel.index===original.index,`${label}: identity changed.`);
    const count=channel.native?.length,width=original.stride;
    requireThat(count>0&&start+count<=original.frameCount&&channel.samples?.length===count&&channel.baseline?.length===count,`${label}: keep the exported frame range and existing channel length.`);
    for(const [field,frames] of Object.entries({native:channel.native,baseline:channel.baseline,samples:channel.samples}))
      frames.forEach((values,frame)=>requireThat(Array.isArray(values)&&values.length===width&&values.every(v=>Number.isFinite(v)&&Number.isFinite(Math.fround(v))),`${label}, frame ${start+frame}: invalid ${field} values.`));
    channel.native.forEach((values,f)=>requireThat(values.every((v,i)=>v===original.values[(start+f)*width+i]),`${label}: the source values changed. Export this scene again.`));
    updates.set(channel.id,channel);
  }
  const output=Buffer.from(source),report={camera:0,lights:0,props:0};let offset=section.offset+layout.dataOffset;
  for(let frame=0;frame<scene.frameCount;frame++)for(const track of layout.tracks){
    if(frame>=track.frameCount)continue;
    const channel=updates.get(sceneTrackId(track)),group=fieldGroup(track.type),f=frame-start;
    if(channel&&options[group]!==false&&f>=0&&f<channel.samples.length){
      let changed=false;
      for(let i=0;i<track.width/4;i++){
        const base=channel.baseline[f][i],sample=channel.samples[f][i];
        // Export baselines include Blender's float32 matrix and quaternion evaluation.
        const error=8*2**-23*Math.max(1,Math.abs(base),Math.abs(sample));
        if(Math.abs(sample-base)<=error)continue;
        const value=Math.fround(channel.native[f][i]+sample-base);
        requireThat(Number.isFinite(value),`Scene track ${channel.id}, frame ${frame}: value exceeds float32 storage.`);
        if(value!==output.readFloatLE(offset+i*4)){output.writeFloatLE(value,offset+i*4);changed=true;}
      }
      if(changed)report[group]++;
    }
    offset+=track.width;
  }
  const parsed=parseSceneTracks(output,sectionIndex);
  for(const light of parsed.lights)for(let f=0;f<light.frameCount;f++)if(light.type!==5){
    const at=f*light.stride;requireThat(light.values[at+7]>=0,`Light ${sceneTrackId(light)}, frame ${f}: far range must not be negative.`);
  }
  return {data:output,report};
}

function validateSource(wb,id,exchange) {
  const record=wb.cutscenes.catalog().scenes.find(s=>s.id===id);requireThat(record,'Select the original cutscene.');
  const meta=exchange.metadata;
  requireThat(meta?.version===2&&meta.sectionIndex===record.sectionIndex&&meta.sourceHash===sha256(wb.bytes(record.key)),
    'This Blender scene belongs to another PACK revision. Export the current cutscene again before importing.');
  const entries=wb.snapshot().entries;
  const actors=(exchange.actors||[]).map(actor=>{
    const info=meta.actors.find(a=>a.modelId===actor.modelId);
    requireThat(info,`Unknown character ${actor.modelId}. Keep the exported game actors.`);
    const candidates=entries.filter(e=>e.name===info.name&&sha256(wb.bytes(e.key))===info.hash);
    requireThat(candidates.length===1,`Character ${info.name}: the source model changed or is missing. Open the exported model revision.`);
    return {...actor,key:candidates[0].key,readOnly:info.readOnly};
  });
  requireThat(actors.length===meta.actors.length&&new Set(actors.map(a=>a.modelId)).size===actors.length,'Missing or duplicate exported character.');
  return {record,actors};
}

function rebuild(wb,id,exchange,options={}) {
  const {record,actors}=validateSource(wb,id,exchange);let data=wb.bytes(record.key);
  const report={characters:[],camera:0,lights:0,props:0};
  if(options.bones!==false||options.morphs!==false)for(const actor of actors){
    if(actor.readOnly){report.characters.push({modelId:actor.modelId,changedRotations:0,changedTranslations:0,changedMorphSamples:0,readOnly:true});continue;}
    requireThat(options.morphs===false||!actor.exchange.morphError,actor.exchange.morphError);
    const result=replaceCutsceneAnimation(parseModel(wb.bytes(actor.key)),data,record.sectionIndex,actor.modelId,actor.exchange,
      {importBones:options.bones!==false,importMorphs:options.morphs!==false});
    data=result.data;report.characters.push({modelId:actor.modelId,...result.report});
  }
  const result=replaceSceneChannels(data,record.sectionIndex,exchange.metadata.start,exchange.channels,options);
  return {key:record.key,data:result.data,report:{...report,...result.report}};
}

export async function prepareCutsceneImport(wb,id,file) {
  wb.assertSources();wb.scenePlan=null;
  const result=await blenderExchange({script:'scene_import',input:file,outputType:'json'},null,wb.cacheFolder,wb.progress);
  const exchange=JSON.parse(result.data),morphErrors=exchange.actors.flatMap(a=>a.exchange.morphError?[a.exchange.morphError]:[]),preview=rebuild(wb,id,exchange,{morphs:!morphErrors.length}),token=randomUUID();
  wb.scenePlan={id,exchange,token};
  return {token,morphErrors,...preview.report,start:exchange.metadata.start,end:exchange.metadata.end,notes:result.report.notes};
}

export function applyCutsceneImport(wb,id,token,options) {
  wb.assertSources();const plan=wb.scenePlan;
  requireThat(plan?.id===id&&plan.token===token,'Cutscene import expired. Choose the Blender scene again.');
  const result=rebuild(wb,id,plan.exchange,options),snapshot=wb.stage(result.key,result.data,'Cutscene motion, camera and lighting from Blender');
  wb.scenePlan=null;return {...snapshot,sceneImportReport:result.report};
}
