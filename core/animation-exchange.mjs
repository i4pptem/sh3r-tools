import {Vector3,Quaternion} from 'three';
import {animationHeader,parseAnimation} from './animation.mjs';
import {encodeNativeShort,encodePackedQuaternion} from './anm-codec.mjs';
import {exchangeRig} from './gltf-rig.mjs';
import {requireThat,sha256} from './binary.mjs';

export function animationExchange(model,data,start,end,fps) {
  const parents=model.bones.map(b=>b.parent),clip=parseAnimation(data,parents);
  requireThat(Number.isInteger(start)&&Number.isInteger(end)&&start>=0&&end>=start&&end<clip.frameCount,'Choose a range inside the ANM bank.');
  requireThat(Number.isFinite(fps)&&fps>=1&&fps<=120,'Choose an exchange FPS from 1 to 120.');
  const count=end-start+1;
  requireThat(count*parents.length<=500000,'Export a shorter animation range (at most 500,000 bone samples).');
  const rig=exchangeRig(model.bones),bind=rig.locals.map(m=>{const p=new Vector3(),q=new Quaternion(),s=new Vector3();m.decompose(p,q,s);return {translation:p.toArray(),rotation:q.toArray(),scale:s.toArray()};});
  const flip=new Quaternion(0,0,1,0),samples=[];
  for(let frame=start;frame<=end;frame++)samples.push(bind.map((rest,bone)=>{
    const pose=structuredClone(rest),r=(frame*parents.length+bone)*4,t=(frame*parents.length+bone)*3;
    if(Number.isFinite(clip.rotations[r])) {const q=new Quaternion().fromArray(clip.rotations,r);if(parents[bone]<0)q.premultiply(flip);pose.rotation=q.toArray();}
    if(Number.isFinite(clip.translations[t])) {pose.translation=Array.from(clip.translations.slice(t,t+3));if(parents[bone]<0){pose.translation[0]*=-1;pose.translation[1]*=-1;}}
    pose.poseScale=[1,1,1];
    return pose;
  }));
  const bones=model.bones.map((bone,i)=>({name:bone.name,parent:bone.parent,world:rig.worlds[i].toArray()}));
  return {count,fps,samples,metadata:{version:1,modelId:clip.modelId,frameCount:clip.frameCount,stride:clip.stride,start,end,fps,bones,
    skeletonHash:sha256(Buffer.from(JSON.stringify(bones))),sourceRange:data.subarray(4+start*clip.stride,4+(end+1)*clip.stride).toString('base64')}};
}

/** Rewrite existing channels only; untouched samples use the exported native bytes. */
export function replaceAnimation(model,source,exchange) {
  const {metadata,baseline}=exchange,samples=structuredClone(exchange.samples),header=animationHeader(source),parents=model.bones.map(b=>b.parent);
  requireThat(metadata?.version===1&&metadata.modelId===header.modelId&&metadata.frameCount===header.frameCount&&metadata.stride===header.stride,'FBX belongs to a different ANM bank layout.');
  const expected=animationExchange(model,source,metadata.start,metadata.end,metadata.fps);
  requireThat(metadata.skeletonHash===expected.metadata.skeletonHash && JSON.stringify(metadata.bones)===JSON.stringify(expected.metadata.bones),'FBX skeleton differs from the selected model.');
  const count=expected.count,bones=parents.length,raw=Buffer.from(metadata.sourceRange,'base64');
  requireThat(raw.length===count*header.stride&&samples?.length===count&&baseline?.length===count,'Invalid animation exchange samples.');
  const output=Buffer.from(source);raw.copy(output,4+metadata.start*header.stride);
  const current=parseAnimation(source,parents),reference=parseAnimation(output,parents);
  for(let bone=0;bone<parents.length;bone++)requireThat(Number.isFinite(current.rotations[bone*4])===Number.isFinite(reference.rotations[bone*4]) && Number.isFinite(current.translations[bone*3])===Number.isFinite(reference.translations[bone*3]),'FBX belongs to a different ANM channel layout.');
  const original=animationExchange(model,output,metadata.start,metadata.end,metadata.fps).samples,report={start:metadata.start,end:metadata.end,changedRotations:0,changedTranslations:0,maxRotationErrorDegrees:0,maxTranslationError:0};
  const flip=new Quaternion(0,0,-1,0);
  for(let f=0;f<count;f++) {
    requireThat(samples[f]?.length===bones&&baseline[f]?.length===bones,'Missing FBX bones.');
    const changes=samples[f].map((pose,b)=>{
      const base=baseline[f][b],changed={};
      for(const [field,size] of [['translation',3],['rotation',4]]) {
        requireThat(Array.isArray(pose[field])&&pose[field].length===size&&pose[field].every(Number.isFinite)&&base[field]?.length===size&&base[field].every(Number.isFinite),'Invalid FBX transform.');
        // Two affine products and FBX Euler/TRS conversion use float32 intermediates.
        // Their roundoff envelope is 32 machine epsilons, scaled by the rest-coordinate magnitude.
        const coordinate = field==='translation' ? Math.max(1,...[b,parents[b]].filter(i=>i>=0).flatMap(i=>metadata.bones[i].world.slice(12,15).map(Math.abs)),...base[field].map(Math.abs)) : 1;
        const bound=32*2**-23*coordinate;
        let values=pose[field];
        if(field==='rotation' && values.reduce((n,v,k)=>n+v*base[field][k],0)<0)values=values.map(v=>-v);
        changed[field]=values.some((v,k)=>Math.abs(v-base[field][k])>bound);
        if(!changed[field])pose[field]=original[f][b][field].slice();
        else if(field==='translation')pose[field]=values.map((v,k)=>original[f][b][field][k]+v-base[field][k]);
        else if(field==='rotation')pose[field]=new Quaternion().fromArray(values).multiply(new Quaternion().fromArray(base[field]).invert()).multiply(new Quaternion().fromArray(original[f][b][field])).normalize().toArray();
      }
      const poseScale=pose.poseScale;
      requireThat(Array.isArray(poseScale)&&poseScale.length===3&&poseScale.every(Number.isFinite),'Invalid FBX pose-bone scale.');
      const scaleBound=32*2**-23*Math.max(1,...poseScale.map(Math.abs));
      requireThat(poseScale.every(value=>Math.abs(value-1)<=scaleBound),`${model.bones[b].name}: ANM has no scale channel. Keep Pose Mode scale at 1.`);
      return changed;
    });
    let offset=4+(metadata.start+f)*header.stride,group=0;
    const end=offset+header.stride,seen=new Set();
    while(offset<end) {
      const flagOffset=offset;let word=output.readUInt32LE(offset);offset+=4;
      for(let slot=0;slot<8;slot++) {
        const flag=word>>>(slot*4)&15,bone=group*8+slot;if(!(flag&7))continue;
        const pose=samples[f][bone],change=changes[bone];seen.add(bone);
        if(flag&2) {
          const width=parents[bone]<0?4:2;
          if(change.translation)for(let k=0;k<3;k++) {
            const value=pose.translation[k]*(parents[bone]<0&&k<2?-1:1);
            if(width===4){requireThat(Number.isFinite(Math.fround(value)),'Root translation exceeds float32.');output.writeFloatLE(value,offset+k*width);report.maxTranslationError=Math.max(report.maxTranslationError,Math.abs(value-Math.fround(value)));}
            else {const encoded=encodeNativeShort(value);output.writeUInt16LE(encoded,offset+k*width);}
          }
          if(change.translation)report.changedTranslations++;
          offset+=width*3;
        } else requireThat(!change.translation,`${model.bones[bone].name}: this ANM has no translation channel.`);
        if(change.rotation) {
          const q=new Quaternion().fromArray(pose.rotation);if(parents[bone]<0)q.premultiply(flip);
          const packed=encodePackedQuaternion(q.toArray(),flag);packed.xyz.forEach((v,k)=>output.writeInt16LE(v,offset+k*2));
          word=((word&~(15<<(slot*4)))|(packed.flag<<(slot*4)))>>>0;
          report.changedRotations++;report.maxRotationErrorDegrees=Math.max(report.maxRotationErrorDegrees,packed.angularError*180/Math.PI);
        }
        offset+=6;
      }
      output.writeUInt32LE(word,flagOffset);group++;
    }
    changes.forEach((change,bone)=>requireThat(seen.has(bone)||(!change.translation&&!change.rotation),`${model.bones[bone].name}: this ANM has no writable animation channel.`));
  }
  const decoded=parseAnimation(output,parents);
  for(let f=0;f<count;f++)for(let b=0;b<bones;b++)for(let k=0;k<3;k++) {
    const at=((metadata.start+f)*bones+b)*3+k;if(!Number.isFinite(reference.translations[at]))continue;
    if(samples[f][b].translation[k]!==baseline[f][b].translation[k])report.maxTranslationError=Math.max(report.maxTranslationError,Math.abs(decoded.translations[at]-samples[f][b].translation[k]*(parents[b]<0&&k<2?-1:1)));
  }
  return {data:output,report};
}
