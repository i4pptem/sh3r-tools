import test from 'node:test';
import assert from 'node:assert/strict';
import {Matrix4,Quaternion,Vector3} from 'three';
import {animationExchange,replaceAnimation} from '../core/animation-exchange.mjs';
import {decodeNativeShort,encodeNativeShort,encodePackedQuaternion} from '../core/anm-codec.mjs';
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
test('ANM rejects absent channels, scale animation, wrong skeleton and frame count',()=>{
  for(const [change,pattern] of [
    [e=>e.samples[0][2].translation[0]+=1,/no writable/],
    [e=>e.samples[0][0].poseScale[0]+=.01,/no scale/],
    [e=>e.metadata.skeletonHash='wrong',/skeleton/],
    [e=>e.metadata.frameCount++,/bank layout/],
    [e=>e.samples[0][0].rotation[0]=NaN,/Invalid FBX/],
  ]) {const {data,model,exchange}=fixture();change(exchange);assert.throws(()=>replaceAnimation(model,data,exchange),pattern);}
});
test('FBX float32 conversion noise preserves source while meaningful local edits survive',()=>{
  const {data,model,exchange}=fixture();exchange.samples[0][0].translation[2]+=.0001;exchange.samples[0][0].scale[0]+=4.3e-6;exchange.samples[0][0].poseScale[1]+=2**-22;
  assert.deepEqual(replaceAnimation(model,data,exchange).data,data);
  exchange.samples[0][0].translation[2]+=.0625;assert.notDeepEqual(replaceAnimation(model,data,exchange).data,data);
});
