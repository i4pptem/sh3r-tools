import {align} from '../../core/binary.mjs';
import {textureFixture} from './map-fixture.mjs';
export function modelFixture(boneCount=1) {
  const base=96,bones=224,parents=bones+boneCount*64,pairs=align(parents+boneCount,16),textureTable=pairs,
    materials=textureTable+16,morphBase=materials+16,descriptors=morphBase+16,delta0=descriptors+16,delta1=delta0+16,
    hit=delta1+16,box=hit+16,mesh=box+128,vertex=208,index=vertex+3*48,size=align(index+16,16),textures=mesh+size;
  const data=Buffer.alloc(textures+32),set=(start,fields)=>{for(const[k,v]of Object.entries(fields))data.writeUInt32LE(v,start+Number(k));};
  set(0,{4:0x100,12:textures,16:textures,20:base,28:1});
  set(base,{0:0xffff0003,4:3,8:bones-base,12:boneCount,16:parents-base,24:pairs-base,28:pairs-base,32:1,36:mesh-base,
    44:textures-base,48:1,52:textureTable-base,56:1,60:materials-base,68:1,72:morphBase-base,76:2,80:descriptors-base,88:hit-base,92:hit-base,96:box-base,100:1});
  for(let b=0;b<boneCount;b++){for(const i of[0,5,10,15])data.writeFloatLE(1,bones+b*64+i*4);data.writeFloatLE(b*3,bones+b*64+48);data[parents+b]=255;}
  data.writeInt16LE(-16,morphBase);data.writeInt16LE(-3072,morphBase+10);
  set(descriptors,{0:1,4:delta0-base,8:1,12:delta1-base});data.writeInt16LE(16,delta0);data.writeInt16LE(16,delta1+2);
  set(mesh,{0:size,8:vertex,16:4,20:1,24:160,28:1,32:176,40:178,52:1,56:178,60:192,64:vertex,68:3,72:index,76:4,80:2});
  data.writeUInt16LE(1,mesh+164);
  for(const[v,p]of[[-1,0,0],[1,0,0],[0,1,0]].entries()){p.forEach((n,k)=>data.writeFloatLE(n,mesh+vertex+v*48+k*4));data.writeFloatLE(1,mesh+vertex+v*48+12);data.writeFloatLE(.75,mesh+vertex+v*48+36);}
  [0,1,2,2].forEach((n,i)=>data.writeUInt32LE(n,mesh+index+i*4));data.fill(0xA7,textures);return data;
}
export function texturedModelFixture(count = 2) {
  const original = modelFixture(), start = original.readUInt32LE(12), base = original.readUInt32LE(20);
  const tables = Buffer.alloc(align(count * 12, 16)), prefix = Buffer.concat([original.subarray(0, start), tables]);
  for (let i = 0; i < count; i++) {prefix.writeUInt32LE(i, start + i * 4); prefix.writeUInt32LE(i, start + count * 4 + i * 8);}
  prefix.writeUInt32LE(count, 8); prefix.writeUInt32LE(prefix.length, 12); prefix.writeUInt32LE(prefix.length, 16);
  prefix.writeUInt32LE(count, base + 48); prefix.writeUInt32LE(start - base, base + 52);
  prefix.writeUInt32LE(count, base + 56); prefix.writeUInt32LE(start + count * 4 - base, base + 60);
  const texture = textureFixture(), records = Array.from({length: count}, () => texture.subarray(32)), header = Buffer.from(texture.subarray(0, 32));
  header.writeUInt32LE(count, 20); header.writeUInt32LE(32 + records.reduce((sum, r) => sum + r.length, 0), 12);
  return Buffer.concat([prefix, header, ...records]);
}
