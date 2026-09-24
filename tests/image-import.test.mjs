import test from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {resizeImage, indexedImage} from '../core/image-import.mjs';
import {readTextures, replaceTexture} from '../core/textures.mjs';

test('image fitting avoids black fringes around transparent pixels', () => {
  const result = resizeImage({width:2,height:1,data:Buffer.from([0,0,0,0,200,100,50,255])},1,1);
  assert.deepEqual([...result.data],[200,100,50,128]);
});
test('indexed import reduces photographic colors deterministically without exceeding the palette', () => {
  const image={width:64,height:64,data:Buffer.alloc(64*64*4)};
  for(let i=0;i<4096;i++){image.data[i*4]=i%256;image.data[i*4+1]=i>>4;image.data[i*4+2]=(i*17)%256;image.data[i*4+3]=255;}
  const result=indexedImage(image,256),colors=new Set();for(let p=0;p<result.data.length;p+=4)colors.add(result.data.subarray(p,p+4).toString('hex'));
  assert.ok(colors.size<=256&&colors.size>100);assert.deepEqual(indexedImage(image,256),result);
  assert.ok(result.data.some(v=>v>0));
});
test('zero-count picture batches decode actual records and preserve native alpha on PNG round trip', () => {
  const data=Buffer.alloc(32+96+16);data.writeUInt32LE(0xffffffff);data.writeUInt32LE(32,8);data.writeUInt32LE(data.length,12);
  data.writeUInt32LE(0xffffffff,32);data.writeUInt16LE(2,40);data.writeUInt16LE(2,42);data.writeUInt32LE(16,48);data.writeUInt32LE(112,52);data.writeUInt16LE(0x9999,62);
  for(let p=128;p<data.length;p+=4)data.set([10,20,30,128],p);
  const texture=readTextures(data,false,{picture:true})[0];assert.deepEqual([...texture.rgba.subarray(0,4)],[10,20,30,255]);
  assert.deepEqual(replaceTexture(data,0,texture.png,false,{picture:true,adapt:true}),data);
  const replacement=PNG.sync.write({width:4,height:1,data:Buffer.from(Array(4).fill([200,100,50,255]).flat())});
  const result=replaceTexture(data,0,replacement,false,{picture:true,adapt:true});
  assert.equal(result.length,data.length);assert.deepEqual(result.subarray(0,128),data.subarray(0,128));
  assert.deepEqual([...result.subarray(128,132)],[200,100,50,128]);
});
