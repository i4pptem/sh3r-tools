import {Quaternion} from 'three';
import {requireThat} from './binary.mjs';
import {sampleExchange} from './animation-sampling.mjs';

export function validateSamples(samples,bones,label,maxChildTranslation=Infinity) {
  requireThat(Array.isArray(samples)&&samples.length>0&&samples.length*bones.length<=500000,`${label}: invalid or oversized animation sample count.`);
  samples.forEach((frame,f)=>{
    requireThat(frame?.length===bones.length,`${label}, frame ${f}: missing original bones. Keep the original bone names; control bones may be added.`);
    frame.forEach((pose,b)=>{
      for(const [field,size] of [['translation',3],['rotation',4]])
        requireThat(Array.isArray(pose[field])&&pose[field].length===size&&pose[field].every(Number.isFinite),`${bones[b].name}, ${label} frame ${f}: Invalid FBX ${field}. Check constraints for non-finite transforms.`);
      requireThat(pose.translation.every(value=>Number.isFinite(Math.fround(value))&&(bones[b].parent<0||Math.abs(value)<=maxChildTranslation)),`${bones[b].name}, ${label} frame ${f}: translation exceeds the native numeric range. Reduce the motion or check scene units.`);
      requireThat(Math.hypot(...pose.rotation)>1e-12,`${bones[b].name}, ${label} frame ${f}: zero rotation quaternion. Correct the pose or constraint.`);
    });
  });
}
export function correctedSamples(model,exchange,original,equal={}) {
  const {samples,baseline,metadata}=exchange;
  return samples.map((frame,f)=>{
    const index=samples.length===1?0:f*(baseline.length-1)/(samples.length-1),base=sampleExchange(baseline,index),native=sampleExchange(original.samples,index);
    return frame.map((pose,b)=>{
      const root=model.bones[b].parent<0,rest=base[b],result={};
      for(const field of ['translation','rotation']) {
        const coordinate=field==='translation'?Math.max(1,...[b,model.bones[b].parent].filter(i=>i>=0).flatMap(i=>metadata.bones[i].world.slice(12,15).map(Math.abs)),...rest.translation.map(Math.abs)):1;
        const bound=32*2**-23*coordinate;
        let values=pose[field];if(field==='rotation'&&values.reduce((n,v,k)=>n+v*rest[field][k],0)<0)values=values.map(v=>-v);
        let changed=values.some((v,k)=>Math.abs(v-rest[field][k])>bound);
        if(changed && equal[field])changed=!equal[field](values,rest[field],root);
        if(!changed)result[field]=native[b][field].slice();
        else if(field==='translation')result[field]=values.map((v,k)=>native[b][field][k]+v-rest[field][k]);
        else result[field]=new Quaternion().fromArray(values).multiply(new Quaternion().fromArray(rest.rotation).invert()).multiply(new Quaternion().fromArray(native[b].rotation)).normalize().toArray();
      }
      return result;
    });
  });
}
