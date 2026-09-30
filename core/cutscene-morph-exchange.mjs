import {requireThat,align} from './binary.mjs';
import {packSections} from './pack.mjs';
import {motionSection} from './cutscene-animation.mjs';
import {parseMorphAnimations} from './morph-animation.mjs';
import {sampleMorphAnimation,sampleMorphTrack} from './morph-sampling.mjs';

function sample(frames,at) {
  at=Math.max(0,Math.min(frames.length-1,at));const a=Math.floor(at),b=Math.min(a+1,frames.length-1);
  return frames[a].map((v,i)=>v+(frames[b][i]-v)*(at-a));
}
function weightCode(value,label) {
  const code=Math.round(value*4096);
  requireThat(Number.isFinite(value)&&code>=-32768&&code<=32767,`${label}: weight ${value} exceeds signed native Q12 (-8 to 7.99975). Reduce the shape key value.`);
  return code;
}
function trackBytes(track,changes,frameCount) {
  const points=new Map(track.frames.map((f,i)=>[f,weightCode(track.weights[i],'Original morph')]));
  const first=Math.min(...changes.keys()),last=Math.max(...changes.keys());
  for(const boundary of [0,first-1,last+1,frameCount-1])if(boundary>=0&&boundary<frameCount&&!changes.has(boundary))
    points.set(boundary,weightCode(sampleMorphTrack(track,boundary),'Morph boundary'));
  for(const [frame,code] of changes)points.set(frame,code);
  const keys=[...points].sort((a,b)=>a[0]-b[0]),compact=[];
  for(const key of keys) {
    while(compact.length>=2) {
      const a=compact.at(-2),b=compact.at(-1);
      if((b[1]-a[1])*(key[0]-b[0])!==(key[1]-b[1])*(b[0]-a[0]))break;
      compact.pop();
    }
    compact.push(key);
  }
  requireThat(compact.length<=65535,'Too many native morph keys. Use a shorter range.');
  const result=Buffer.alloc(2+compact.length*4);result.writeUInt16LE(compact.length);
  compact.forEach(([frame,code],i)=>{result.writeUInt16LE(frame,2+i*4);result.writeInt16LE(code,4+i*4);});return result;
}
function rebuildCluster(source,segment,changes,targetCount,template) {
  const frames=segment.tracks.length?segment.frameCount:segment.endFrame-segment.startFrame+1;
  requireThat(frames>0&&frames<=65535,'Morph segment exceeds the native 16-bit frame range.');
  const tracks=Array.from({length:targetCount},(_,i)=>{
    const track=segment.tracks[i]||{frames:[],weights:[]};
    if(changes.has(i))return trackBytes(track,changes.get(i),frames);
    if(segment.offset!==null) {
      const at=segment.offset+source.readUInt32LE(segment.offset+16+i*4),length=2+source.readUInt16LE(at)*4;
      return source.subarray(at,at+length);
    }
    return Buffer.alloc(2);
  });
  const header=16+targetCount*4,output=Buffer.alloc(header+tracks.reduce((n,t)=>n+t.length,0));
  (segment.offset===null?template:source.subarray(segment.offset,segment.offset+16)).copy(output);
  output.writeUInt16LE(targetCount,8);output.writeUInt16LE(frames,12);let cursor=header;
  tracks.forEach((track,i)=>{output.writeUInt32LE(cursor,16+i*4);track.copy(output,cursor);cursor+=track.length;});return output;
}
function replaceSection(source,index,data) {
  const sections=packSections(source),section=sections.find(s=>s.index===index),end=section.offset+section.size;
  for(const other of sections)if(other!==section)requireThat(other.offset+other.size<=section.offset||other.offset>=end,'Overlapping PACK sections cannot be rebuilt.');
  // Native streaming seeks in 2048-byte sectors; all following section alignments stay intact.
  const span=section.size+align(Math.max(0,data.length-section.size),2048),payload=Buffer.alloc(span);data.copy(payload);
  const output=Buffer.concat([source.subarray(0,section.offset),payload,source.subarray(end)]),delta=span-section.size;
  for(const other of sections) {
    if(other.index===index)output.writeUInt32LE(data.length,16+index*16+8);
    else if(other.offset>=end)output.writeUInt32LE(other.offset+delta,16+other.index*16);
  }
  return output;
}

/** Rebuild only edited morph curves; preserve segment switches and unrelated tracks. */
export function replaceCutsceneMorphs(source,modelId,exchange,range) {
  const metadata=exchange.metadata.morph,{morphSamples:samples,morphBaseline:baseline}=exchange;
  requireThat(samples&&baseline,exchange.importReport?.morphError||'Facial animation data is missing. Restore the exported shape keys or uncheck Import facial shape keys.');
  const count=metadata.names.length;
  for(const [name,frames] of [['import',samples],['baseline',baseline],['source',metadata.weights]])
    requireThat(Array.isArray(frames)&&frames.length>0&&frames.every(values=>Array.isArray(values)&&values.length===count&&values.every(Number.isFinite)),`Invalid ${name} facial samples.`);
  requireThat(samples.length===exchange.samples.length&&baseline.length===metadata.weights.length,'Facial and skeletal sample counts differ.');
  const matches=parseMorphAnimations(source).filter(c=>c.modelId===modelId&&c.targetCount===count);
  requireThat(matches.length===1,'The destination has no unique matching facial bank. Import bone motion only or choose a matching cutscene.');
  const clip=matches[0],sections=packSections(source),section=sections.find(s=>s.index===clip.controlIndex),changes=new Map(),seen=new Map();let changed=0;
  const corrected=samples.map((values,f)=>{
    const at=samples.length===1?0:f*(baseline.length-1)/(samples.length-1),base=sample(baseline,at),native=sample(metadata.weights,at);
    return values.map((v,i)=>Math.abs(v-base[i])<=32*2**-23*Math.max(1,Math.abs(base[i]))?native[i]:native[i]+v-base[i]);
  });
  for(let f=0;f<range.count;f++) {
    const frame=range.start+f,at=range.sourceStart-range.first+(range.count===1?0:f*(range.sourceEnd-range.sourceStart)/(range.count-1)),values=sample(corrected,at),original=sampleMorphAnimation(clip,frame);
    const si=clip.segments.findIndex(s=>frame<=s.endFrame),segment=clip.segments[si]||clip.segments.at(-1);
    const actualIndex=clip.segments.findIndex(s=>s===segment),duration=segment.tracks.length?segment.frameCount:segment.endFrame-segment.startFrame+1;
    const local=Math.max(0,Math.min(duration-1,frame-segment.startFrame));
    for(let target=0;target<count;target++) {
      const code=weightCode(values[target],`${metadata.names[target]}, PACK frame ${frame}`);
      const identity=actualIndex+':'+target+':'+local;
      requireThat(!seen.has(identity)||seen.get(identity)===code,`${metadata.names[target]}: different values target one held native sample. Use one value across the held interval.`);
      seen.set(identity,code);
      if(code===weightCode(original[target],'Original morph'))continue;
      const first=actualIndex===0?0:clip.segments[actualIndex-1].endFrame+1;
      const last=actualIndex===clip.segments.length-1?range.targetFrames-1:segment.endFrame;
      const aliasFirst=local===0?first:segment.startFrame+local,aliasLast=local===duration-1?last:segment.startFrame+local;
      requireThat(aliasFirst>=range.start&&aliasLast<=range.end,`${metadata.names[target]}, PACK frame ${frame}: this held morph sample also controls frames ${aliasFirst}–${aliasLast}. Include that range or keep its original value.`);
      if(!changes.has(actualIndex))changes.set(actualIndex,new Map());const group=changes.get(actualIndex);
      if(!group.has(target))group.set(target,new Map());const points=group.get(target);
      requireThat(!points.has(local)||points.get(local)===code,`${metadata.names[target]}: different values target one held native sample. Use one value across the held interval.`);
      points.set(local,code);changed++;
    }
  }
  if(!changed)return {data:source,changed:0};
  const original=source.subarray(section.offset,section.offset+section.size),templateSegment=clip.segments.find(s=>s.offset!==null);
  const template=source.subarray(templateSegment.offset,templateSegment.offset+16),payloads=[];
  for(let i=0;i<clip.segments.length;i++) {
    const length=original.readUInt32LE(12+i*16+8),offset=original.readUInt32LE(12+i*16+12);
    payloads.push(changes.has(i)?rebuildCluster(source,clip.segments[i],changes.get(i),count,template):original.subarray(offset,offset+length));
  }
  const header=12+clip.segments.length*16,parts=[],descriptors=Buffer.from(original.subarray(0,header));let cursor=header;
  payloads.forEach((payload,i)=>{
    if(!payload.length)return;
    const padding=align(cursor,16)-cursor;if(padding){parts.push(Buffer.alloc(padding));cursor+=padding;}
    descriptors.writeUInt32LE(payload.length,12+i*16+8);descriptors.writeUInt32LE(cursor,12+i*16+12);parts.push(payload);cursor+=payload.length;
  });
  const output=replaceSection(source,clip.controlIndex,Buffer.concat([descriptors,...parts]));
  validateMorphBudget(output);
  const after=parseMorphAnimations(output).find(c=>c.controlIndex===clip.controlIndex);let maxBoundaryError=0;
  for(let frame=0;frame<range.targetFrames;frame++)if(frame<range.start||frame>range.end) {
    const before=sampleMorphAnimation(clip,frame),values=sampleMorphAnimation(after,frame);
    before.forEach((value,i)=>{maxBoundaryError=Math.max(maxBoundaryError,Math.abs(value-values[i]));});
  }
  requireThat(maxBoundaryError<=1/8192+Number.EPSILON*64,'Morph edit would alter unselected frames beyond native Q12 rounding. Extend the selected range.');
  return {data:output,changed,maxBoundaryError};
}

/** Conservative resident allocation bound for the stock PC demo arena. */
export function validateMorphBudget(data) {
  const sections=packSections(data);
  requireThat(sections.length<=5&&sections.at(-1)?.type===2&&sections.slice(0,-1).every(s=>s.type===1),
    'This PACK allocation layout has not been verified for morph rebuilding. Import bone motion only.');
  requireThat(sections.every(section=>section.offset%2048===0),'Native PACK sections must be aligned to 2048 bytes before rebuilding morphs.');
  const {tracks}=motionSection(data,sections.at(-1)),width=tracks.reduce((n,t)=>n+t.width,0);
  const resident=2048+align(sections.length*16,64)+sections.filter(s=>s.type===1).reduce((n,s)=>n+align(s.size,2048),0)+
    2048+align(4+20*tracks.length,2048)+align(8*tracks.length,64)+4*align(width,64)+2047;
  requireThat(resident+0x4B000<=0x210000,`Morph curves exceed the stock cutscene memory budget by ${resident+0x4B000-0x210000} bytes. Use fewer facial keys or a shorter edited range; at least three streaming blocks must remain free.`);
  return {residentUpperBound:resident,arenaBytes:0x210000,minimumStreamingBytes:0x4B000};
}
