import test from 'node:test';
import assert from 'node:assert/strict';
import {Matrix4,Quaternion,Vector3} from 'three';
import {animationExchange,replaceAnimation} from '../core/animation-exchange.mjs';
import {decodeNativeShort,encodeNativeShort,encodePackedQuaternion} from '../core/anm-codec.mjs';
import {exportGlb,readGlb} from '../core/gltf.mjs';
import {parseAnimation} from '../core/animation.mjs';

function fixture() {
  const data=Buffer.alloc(4+34*3);data.writeUInt32LE(0x101c);
  for(let frame=0;frame<3;frame++) {
    const at=4+frame*34;data.writeUInt32LE(0xea,at);
    [12.5,-7.25,1000+frame].forEach((v,k)=>data.writeFloatLE(v,at+4+k*4));
    [23171,23171,0].forEach((v,k)=>data.writeInt16LE(v,at+16+k*2));
    [0x0000,0x8001,0x7fff].forEach((v,k)=>data.writeUInt16LE(v,at+22+k*2));
    data.writeInt16LE(16384,at+28);
  }
  const model={bones:[-1,0,1].map((parent,i)=>({name:'bone'+i,parent,matrix:new Matrix4().makeTranslation(i*10,0,0).toArray()}))};
  const {metadata,samples}=animationExchange(model,data,1,1,30);
  return {data,model,exchange:{metadata,samples,baseline:structuredClone(samples)}};
}

test('all 65536 native short codes round trip, including exponent zero and 31',()=>{
  for(let code=0;code<65536;code++)assert.equal(encodeNativeShort(decodeNativeShort(code)),code);
  assert.equal(decodeNativeShort(0),2**-15);assert.equal(decodeNativeShort(0x7fff),131008);
  assert.throws(()=>encodeNativeShort(131009),/range/);assert.throws(()=>encodeNativeShort(NaN),/range/);
});
test('native quaternion encoder preserves high bits and represents a half-turn exactly',()=>{
  const result=encodePackedQuaternion([1,0,0,0],10);assert.equal(result.xyz[0],-32768);assert.equal(result.flag&11,10);assert.equal(result.angularError,0);
});
test('ANM exchange no-op retains every byte, including over-unit source quaternions',()=>{
  const {data,model,exchange}=fixture();assert.deepEqual(replaceAnimation(model,data,exchange).data,data);
});
test('ANM edits stay inside the exported interval and preserve presence and high flags',()=>{
  const {data,model,exchange}=fixture();exchange.samples[0][0].translation[0]+=4;
  exchange.samples[0][1].rotation=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.4).toArray();
  const result=replaceAnimation(model,data,exchange),after=result.data;
  assert.deepEqual(after.subarray(0,38),data.subarray(0,38));assert.deepEqual(after.subarray(72),data.subarray(72));
  assert.equal(after.readUInt32LE(38)&0xbb,data.readUInt32LE(38)&0xbb);
  assert.equal(parseAnimation(after,[-1,0,1]).translations[9],8.5);
  assert.equal(result.report.changedRotations,1);assert.equal(result.report.changedTranslations,1);
  assert.deepEqual(replaceAnimation(model,after,exchange).data,after,'repeat import is stable');
});
test('ANM validates skeletons, metadata and transforms',()=>{
  for(const [change,pattern] of [
        [e=>e.metadata.skeletonHash='wrong',/skeleton/],
    [e=>e.metadata.stride++,/metadata/],
    [e=>e.samples[0][0].rotation[0]=NaN,/Invalid FBX/],
  ]) {const {data,model,exchange}=fixture();change(exchange);assert.throws(()=>replaceAnimation(model,data,exchange),pattern);}
});
test('FBX float32 conversion noise preserves source while meaningful local edits survive',()=>{
  const {data,model,exchange}=fixture();exchange.samples[0][0].translation[2]+=.0001;
  assert.deepEqual(replaceAnimation(model,data,exchange).data,data);
  exchange.samples[0][0].translation[2]+=.0625;assert.notDeepEqual(replaceAnimation(model,data,exchange).data,data);
});

test('absent bone rotation tolerates a measured FBX round trip only when native packed rotations agree',()=>{
  const {data,model,exchange}=fixture();
  exchange.baseline[0][2].rotation=[0.4948790669441223,-0.5050694942474365,0.5050668716430664,0.49488070607185364];
  exchange.samples[0][2].rotation=[0.49488338828086853,-0.5050650835037231,0.505071222782135,0.4948764443397522];
  assert.ok(Math.max(...exchange.samples[0][2].rotation.map((v,i)=>Math.abs(v-exchange.baseline[0][2].rotation[i])))>32*2**-23);
  assert.deepEqual(replaceAnimation(model,data,exchange).data,data);
  exchange.samples[0][2].rotation=exchange.samples[0][2].rotation.map(v=>-v);
  assert.deepEqual(replaceAnimation(model,data,exchange).data,data);
  exchange.samples[0][0].translation[0]+=4;
  const result=replaceAnimation(model,data,exchange);assert.equal(result.report.changedTranslations,1);assert.equal(result.report.changedRotations,0);
  assert.notDeepEqual(result.data,data);assert.deepEqual(replaceAnimation(model,result.data,exchange).data,result.data);
});

test('an absent channel reports motion that crosses a native quantization boundary',()=>{
  const {data,model,exchange}=fixture();
  const x=0.6/32768;exchange.samples[0][2].rotation=[x,0,0,Math.sqrt(1-x*x)];
  const result=replaceAnimation(model,data,exchange);assert.deepEqual(result.data,data);assert.equal(result.report.skippedChannels[0].bone,'bone2');assert.equal(result.report.skippedChannels[0].firstFrame,1);assert.throws(()=>replaceAnimation(model,data,exchange,{missingChannels:'reject'}),/no writable rotation channel/);
});

test('real absent-channel rotation changes are reported regardless of quaternion sign',()=>{
  for(const sign of [1,-1]) {
    const {data,model,exchange}=fixture();exchange.samples[0][2].rotation=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.01).toArray().map(v=>v*sign);
    assert.equal(replaceAnimation(model,data,exchange).report.skippedChannels[0].channel,'rotation');
  }
});

test('ANM exchange ignores unsupported scale fields while preserving real translation and rotation edits',()=>{
  const {data,model,exchange}=fixture();
  for(const pose of exchange.samples[0]) {pose.scale=[.8,1.1,2];pose.poseScale=[.9999938,1,1.0000056];}
  assert.deepEqual(replaceAnimation(model,data,exchange).data,data);
  exchange.samples[0][0].translation[0]+=4;
  exchange.samples[0][1].rotation=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.4).toArray();
  const result=replaceAnimation(model,data,exchange);
  const reference=structuredClone(exchange);reference.samples.forEach(frame=>frame.forEach(pose=>{delete pose.scale;delete pose.poseScale;}));
  assert.deepEqual(result.data,replaceAnimation(model,data,reference).data);
  assert.equal(result.report.changedRotations,1);assert.equal(result.report.changedTranslations,1);
});

test('animation export emits translation and rotation tracks without changing static rig transforms',()=>{
  const {data,model}=fixture();model.meshes=[];model.bones[2].matrix=new Matrix4().makeScale(1.2,.8,1.1).setPosition(20,0,0).toArray();
  const motion=animationExchange(model,data,0,2,30),{doc}=readGlb(exportGlb(model,[],motion));
  assert.deepEqual(new Set(doc.animations[0].channels.map(c=>c.target.path)),new Set(['translation','rotation']));
  assert.deepEqual(doc.nodes[2].scale.map(v=>Math.round(v*1000)/1000),[1.2,.8,1.1]);
  assert.ok(motion.samples.every(frame=>frame.every(pose=>!('scale' in pose)&&!('poseScale' in pose))));
});


test('unsupported translations preserve the native channel and retain compatible edits',()=>{
  const {data,model,exchange}=fixture();exchange.samples[0][2].translation[1]+=5;exchange.samples[0][0].translation[0]+=2;
  const {report,data:result}=replaceAnimation(model,data,exchange);
  assert.equal(report.changedTranslations,1);assert.equal(report.skippedChannels.length,1);assert.equal(report.skippedChannels[0].channel,'translation');
  assert.equal(parseAnimation(result,[-1,0,1]).translations[9],10.5);assert.deepEqual(result.subarray(72),data.subarray(72));
});
test('transfer to a different same-skeleton bank keeps target length and surrounding frames',()=>{
  const {data,model}=fixture(),source=animationExchange(model,data,1,2,30),exchange={...source,baseline:structuredClone(source.samples)};
  const target=Buffer.concat([data,data.subarray(4)]);target.writeFloatLE(999,4+4);
  const result=replaceAnimation(model,target,exchange,{start:3,end:4});
  assert.equal(result.data.length,target.length);assert.deepEqual(result.data.subarray(0,4+3*34),target.subarray(0,4+3*34));
  assert.deepEqual(result.data.subarray(4+5*34),target.subarray(4+5*34));
  assert.deepEqual(result.data.subarray(4+3*34,4+5*34),data.subarray(4+34));
});
test('inclusive source ranges map exact endpoints and require explicit resampling',()=>{
  const {data,model}=fixture(),source=animationExchange(model,data,0,2,30),exchange={...source,baseline:structuredClone(source.samples),sampleStart:1,sampleEnd:3};
  const result=replaceAnimation(model,data,exchange,{sourceStart:2,sourceEnd:3,start:0,end:1});
  assert.equal(result.report.frameCount,2);assert.deepEqual(result.data.subarray(4,4+68),data.subarray(38,106));assert.deepEqual(result.data.subarray(72),data.subarray(72));
  assert.throws(()=>replaceAnimation(model,data,exchange,{start:0,end:1}),/Match the ranges/);
  assert.equal(replaceAnimation(model,data,exchange,{start:0,end:1,resample:true}).report.resampled,true);
});
