import {Vector3,Quaternion} from 'three';
import {validateSamples,correctedSamples} from './motion-calibration.mjs';
import {animationHeader,parseAnimation} from './animation.mjs';
import {decodeNativeShort,encodeNativeShort,encodePackedQuaternion} from './anm-codec.mjs';
import {exchangeRig} from './gltf-rig.mjs';
import {requireThat,sha256} from './binary.mjs';
import {animationImportRange,sampleExchange} from './animation-sampling.mjs';

export function animationExchange(model,data,start,end,fps) {
  const parents=model.bones.map(b=>b.parent),clip=parseAnimation(data,parents);
  requireThat(Number.isInteger(start)&&Number.isInteger(end)&&start>=0&&end>=start&&end<clip.frameCount,'Choose a range inside the ANM bank.');
  requireThat(Number.isFinite(fps)&&fps>=1&&fps<=120,'Choose an exchange FPS from 1 to 120.');
  const count=end-start+1;
  requireThat(count*parents.length<=500000,'Export a shorter animation range (at most 500,000 bone samples).');
  const rig=exchangeRig(model.bones),bind=rig.locals.map(m=>{const p=new Vector3(),q=new Quaternion(),s=new Vector3();m.decompose(p,q,s);return {translation:p.toArray(),rotation:q.toArray()};});
  const flip=new Quaternion(0,0,1,0),samples=[];
  for(let frame=start;frame<=end;frame++)samples.push(bind.map((rest,bone)=>{
    const pose=structuredClone(rest),r=(frame*parents.length+bone)*4,t=(frame*parents.length+bone)*3;
    if(Number.isFinite(clip.rotations[r])) {const q=new Quaternion().fromArray(clip.rotations,r);if(parents[bone]<0)q.premultiply(flip);pose.rotation=q.toArray();}
    if(Number.isFinite(clip.translations[t])) {pose.translation=Array.from(clip.translations.slice(t,t+3));if(parents[bone]<0){pose.translation[0]*=-1;pose.translation[1]*=-1;}}
    return pose;
  }));
  const bones=model.bones.map((bone,i)=>({name:bone.name,parent:bone.parent,world:rig.worlds[i].toArray()}));
  return {count,fps,samples,metadata:{version:1,modelId:clip.modelId,frameCount:clip.frameCount,stride:clip.stride,start,end,fps,bones,
    skeletonHash:sha256(Buffer.from(JSON.stringify(bones))),sourceRange:data.subarray(4+start*clip.stride,4+(end+1)*clip.stride).toString('base64')}};
}

function rotationEqual(first,second,root) {
  const packed=values=>{const q=new Quaternion().fromArray(values);if(root)q.premultiply(new Quaternion(0,0,-1,0));return encodePackedQuaternion(q.toArray(),1).decoded;};
  const a=packed(first),b=packed(second);
  return a.every((v,i)=>v===b[i]) || a.every((v,i)=>v===-b[i]);
}
function translatedEqual(a,b,root) {
  return a.every((v,k)=>root ? Math.fround(v)===Math.fround(b[k]) : encodeNativeShort(v)===encodeNativeShort(b[k]));
}
function sourceExchange(model,exchange) {
  const {metadata,baseline,samples}=exchange;
  requireThat(metadata?.version===1,'Unsupported animation exchange metadata. Export an animation from Silent Hill 3 Tools first.');
  const raw=Buffer.from(metadata.sourceRange,'base64'),count=metadata.end-metadata.start+1;
  requireThat(Number.isSafeInteger(count)&&count>0&&raw.length===count*metadata.stride,'Invalid source animation range metadata.');
  const bank=Buffer.alloc(4+raw.length);bank.writeUInt32LE(metadata.modelId);raw.copy(bank,4);
  const original=animationExchange(model,bank,0,count-1,metadata.fps);
  requireThat(metadata.skeletonHash===original.metadata.skeletonHash&&JSON.stringify(metadata.bones)===JSON.stringify(original.metadata.bones),'FBX skeleton differs from the selected model. Use the original rig for this character.');
  requireThat((exchange.sampleEnd??samples.length-1)-(exchange.sampleStart??0)+1===samples.length,'Source sample range does not match its frame count.');
  requireThat(baseline?.length===count,'Invalid exported animation baseline.');
  validateSamples(baseline,model.bones,'export baseline',131008);validateSamples(samples,model.bones,'import',131008);
  return original;
}

function channelIssue(issues,model,bone,field,frame,sourceFrame) {
  const key=bone+':'+field,existing=issues.get(key);
  if(existing){existing.lastFrame=frame;existing.samples++;return;}
  issues.set(key,{bone: model.bones[bone].name,channel:field,firstFrame:frame,lastFrame:frame,sourceFrame,samples:1,
    reason:`The target ANM has no ${field} channel. Its original runtime-controlled component is preserved.`});
}

/** Transfer sampled local motion into a selected bank, preserving its native layout and other frames. */
export function replaceAnimation(model,source,exchange,options={}) {
  requireThat(['keep','reject'].includes(options.missingChannels??'keep'),'Choose a supported missing-channel policy.');
  const original=sourceExchange(model,exchange),header=animationHeader(source),parents=model.bones.map(b=>b.parent);
  requireThat(exchange.metadata.modelId===header.modelId,'The target ANM uses another character skeleton. Select a bank for the same model.');
  const range=animationImportRange(exchange,header.frameCount,options),poses=correctedSamples(model,exchange,original,{translation:translatedEqual,rotation:rotationEqual});
  const target=animationExchange(model,source,range.start,range.end,exchange.metadata.fps).samples;
  const output=Buffer.from(source),issues=new Map(),report={start:range.start,end:range.end,sourceStart:range.sourceStart,sourceEnd:range.sourceEnd,frameCount:range.count,resampled:range.resampled,
    changedRotations:0,changedTranslations:0,maxRotationErrorDegrees:0,maxTranslationError:0,skippedChannels:[]};
  const flip=new Quaternion(0,0,-1,0);
  for(let f=0;f<range.count;f++) {
    const position=range.sourceStart-range.first+(range.count===1?0:f*(range.sourceEnd-range.sourceStart)/(range.count-1));
    const frame=sampleExchange(poses,position),seen=new Set();let offset=4+(range.start+f)*header.stride,group=0;
    while(offset<4+(range.start+f+1)*header.stride) {
      const flagOffset=offset;let word=output.readUInt32LE(offset);offset+=4;
      for(let slot=0;slot<8;slot++) {
        const flag=word>>>(slot*4)&15,bone=group*8+slot;if(!(flag&7))continue;
        seen.add(bone);const pose=frame[bone],base=target[f][bone],root=parents[bone]<0;
        if(flag&2) {
          const width=root?4:2;
          if(!translatedEqual(pose.translation,base.translation,root)) {
            for(let k=0;k<3;k++) {
              const value=pose.translation[k]*(root&&k<2?-1:1);
              requireThat(Number.isFinite(Math.fround(value)),`${model.bones[bone].name}, target frame ${range.start+f}: translation exceeds the native numeric range. Reduce the motion or check scene units.`);
              if(root){output.writeFloatLE(value,offset+k*width);report.maxTranslationError=Math.max(report.maxTranslationError,Math.abs(value-Math.fround(value)));}
              else {const encoded=encodeNativeShort(value);output.writeUInt16LE(encoded,offset+k*width);report.maxTranslationError=Math.max(report.maxTranslationError,Math.abs(value-decodeNativeShort(encoded)));}
            }
            report.changedTranslations++;
          }
          offset+=width*3;
        } else if(!translatedEqual(pose.translation,base.translation,root))channelIssue(issues,model,bone,'translation',range.start+f,position+range.first);
        if(!rotationEqual(pose.rotation,base.rotation,root)) {
          const q=new Quaternion().fromArray(pose.rotation);if(root)q.premultiply(flip);
          const packed=encodePackedQuaternion(q.toArray(),flag);packed.xyz.forEach((v,k)=>output.writeInt16LE(v,offset+k*2));
          word=((word&~(15<<(slot*4)))|(packed.flag<<(slot*4)))>>>0;report.changedRotations++;report.maxRotationErrorDegrees=Math.max(report.maxRotationErrorDegrees,packed.angularError*180/Math.PI);
        }
        offset+=6;
      }
      output.writeUInt32LE(word,flagOffset);group++;
    }
    frame.forEach((pose,bone)=>{if(seen.has(bone))return;for(const field of ['translation','rotation']) {
      const same=field==='rotation'?rotationEqual(pose[field],target[f][bone][field],parents[bone]<0):translatedEqual(pose[field],target[f][bone][field],parents[bone]<0);
      if(!same)channelIssue(issues,model,bone,field,range.start+f,position+range.first);
    }});
  }
  report.skippedChannels=[...issues.values()];
  if(options.missingChannels==='reject'&&report.skippedChannels.length){const issue=report.skippedChannels[0];throw new Error(`${issue.bone}, target frame ${issue.firstFrame}: no writable ${issue.channel} channel. Choose Preserve unsupported channels to import the compatible motion, or select another ANM bank.`);}
  parseAnimation(output,parents);return {data:output,report};
}
