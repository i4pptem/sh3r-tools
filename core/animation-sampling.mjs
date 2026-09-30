import {Quaternion} from 'three';
import {requireThat} from './binary.mjs';

/** Sample an inclusive sequence of absolute local transforms on a continuous frame grid. */
export function sampleExchange(frames, position) {
  const at=Math.max(0,Math.min(frames.length-1,position)),a=Math.floor(at),b=Math.min(a+1,frames.length-1),mix=at-a;
  return frames[a].map((pose,i)=>({
    translation:pose.translation.map((v,k)=>v+(frames[b][i].translation[k]-v)*mix),
    rotation:new Quaternion().fromArray(pose.rotation).slerp(new Quaternion().fromArray(frames[b][i].rotation),mix).toArray(),
  }));
}

/** Resolve explicit source/destination ranges without shifting other native bank frames. */
export function animationImportRange(exchange, targetFrames, options={}) {
  const first=exchange.sampleStart ?? 0,last=exchange.sampleEnd ?? exchange.samples.length-1;
  const sourceStart=options.sourceStart ?? first,sourceEnd=options.sourceEnd ?? last;
  const start=options.start ?? exchange.metadata.start,end=options.end ?? start+(sourceEnd-sourceStart);
  requireThat([first,last,sourceStart,sourceEnd,start,end].every(Number.isInteger),'Animation ranges must use whole frame numbers.');
  requireThat(sourceStart>=first && sourceEnd>=sourceStart && sourceEnd<=last,'Choose source frames inside the imported animation. Both endpoints are included.');
  requireThat(start>=0 && end>=start && end<targetFrames,`Destination frames ${start}–${end} exceed this animation bank (0–${targetFrames-1}). Choose a shorter range or another destination.`);
  const count=end-start+1,sourceCount=sourceEnd-sourceStart+1;
  requireThat(options.resample || count===sourceCount,`Source has ${sourceCount} samples; destination has ${count}. Match the ranges or enable Fit to destination range.`);
  return {first,last,sourceStart,sourceEnd,start,end,count,sourceCount,resampled:count!==sourceCount};
}
