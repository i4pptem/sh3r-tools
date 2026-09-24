import test from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {readTextures, replaceTexture} from '../core/textures.mjs';
import {rebuildTexture} from '../core/texture-rebuild.mjs';

function direct(width=2,height=2) {
  const data=Buffer.alloc(96+width*height*4);data.writeUInt32LE(0xffffffff);data.writeUInt16LE(width,8);data.writeUInt16LE(height,10);
  data[12]=24;data[13]=48;data.writeUInt32LE(width*height*4,16);data.writeUInt32LE(data.length,20);data.writeUInt16LE(0x9999,30);
  for(let p=96;p<data.length;p+=4)data.set([10,20,30,128],p);return data;
}
function batch(records, zeroCount=false) {
  const header=Buffer.alloc(32);header.writeUInt32LE(0xffffffff);header.writeUInt32LE(32,8);
  header.writeUInt32LE(32+records.reduce((n,r)=>n+r.length,0),12);header.writeUInt32LE(zeroCount?0:records.length,20);
  return Buffer.concat([header,...records]);
}
function image(width,height) {
  const data=Buffer.alloc(width*height*4);
  for(let i=0;i<width*height;i++)data.set([i%256,(i>>2)%256,(i*37)%256,255],i*4);
  return PNG.sync.write({width,height,data});
}
function indexed(shared=false) {
  const data=Buffer.alloc(96+16+48+4096);direct().copy(data,0,0,96);data.writeUInt16LE(4,8);data.writeUInt16LE(4,10);data[12]=8;data[25]=19;data[26]=1;data.writeUInt32LE(16,16);data.writeUInt32LE(112,20);
  data.writeUInt32LE(4096,112);data[124]=4;data[126]=64;data.set([20,40,60,128],160);
  if(shared)data.set([80,60,40,128],224);return data;
}
test('experimental picture resizing preserves the zero-count wrapper and native channel/alpha convention',()=>{
  const wrapper=Buffer.alloc(64);wrapper.writeUInt32LE(64,4);wrapper.writeUInt32LE(0xa7a7a7a7,12);
  const data=Buffer.concat([wrapper,batch([direct()],true)]), input=image(1024,1024), output=rebuildTexture(data,0,input,false,{picture:true});
  const t=readTextures(output,false,{picture:true})[0];assert.equal(t.width,1024);assert.equal(t.height,1024);
  assert.equal(output.length,4194496);assert.deepEqual(output.subarray(0,64),wrapper);assert.equal(output.readUInt32LE(84),0);
  assert.equal(output.readUInt32LE(76),output.length-64);assert.equal(output[124],10);assert.equal(output[125],10);
  assert.equal(output[195],128);assert.deepEqual(t.rgba,PNG.sync.read(input).data);
  assert.equal(readTextures(replaceTexture(data,0,input,false,{picture:true,adapt:true}),false,{picture:true})[0].width,2);
});
test('growing the first image relocates later records byte-exactly and preserves opaque suffix bytes',()=>{
  const first=direct(),second=direct(4,4),tail=Buffer.from('opaque suffix'),data=Buffer.concat([batch([first,second]),tail]);
  data.writeUInt32LE(32+first.length,12);
  const output=rebuildTexture(data,0,image(7,9)),textures=readTextures(output);
  assert.equal(textures.length,2);assert.deepEqual(output.subarray(textures[1].layout.start,textures[1].end),second);
  assert.deepEqual(output.subarray(textures[1].end),tail);assert.equal(output.readUInt32LE(12),textures[1].end);
  assert.equal(textures[0].layout.pixelOffset-textures[0].layout.start,output[textures[0].layout.start+13]+48);
});
test('single-palette import promotes photographic colors to direct storage and removes only its palette',()=>{
  const other=direct(),data=batch([indexed(),other]),input=image(64,64),output=rebuildTexture(data,0,input),textures=readTextures(output);
  assert.equal(textures.length,2);assert.equal(textures[0].layout.kind,'bgra');assert.deepEqual(textures[0].rgba,PNG.sync.read(input).data);
  assert.equal(output[32+25],0);assert.equal(output[32+26],0);assert.equal(output[32+12],32);
  assert.deepEqual(output.subarray(textures[1].layout.start,textures[1].end),other);
  assert.throws(()=>rebuildTexture(batch([indexed(true)]),0,input),/shared palette/);
});
test('experimental MDL texture growth preserves all preceding rig/geometry bytes and validates terminal layout',()=>{
  const prefix=Buffer.alloc(256,0x6a);prefix.writeUInt32LE(2,8);prefix.writeUInt32LE(256,12);prefix.writeUInt32LE(256,16);
  const data=Buffer.concat([prefix,batch([direct(),direct()])]),output=rebuildTexture(data,1,image(32,16),true);
  assert.deepEqual(output.subarray(0,256),prefix);assert.equal(readTextures(output,true)[1].width,32);
  assert.throws(()=>rebuildTexture(Buffer.concat([data,Buffer.from('unmapped')]),1,image(32,16),true),/terminal texture batch/);
  assert.deepEqual(rebuildTexture(data,0,readTextures(data,true)[0].png,true),data);
});
test('PIC resizing updates big-endian dimensions and preserves channel packets',()=>{
  const data=Buffer.alloc(114);data.writeUInt32BE(0x5380f634);data.write('PICT',88);data.writeUInt16BE(2,92);data.writeUInt16BE(1,94);data[105]=8;data[107]=0xe0;
  const input=image(20,10),output=rebuildTexture(data,0,input),texture=readTextures(output)[0];
  assert.equal(output.readUInt16BE(92),20);assert.equal(output.readUInt16BE(94),10);assert.deepEqual(texture.rgba,PNG.sync.read(input).data);
});
