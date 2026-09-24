import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCameras,parseMap,parseCollision,inspectWorld} from '../core/world-formats.mjs';

function putFloats(buffer,offset,values){values.forEach((v,i)=>buffer.writeFloatLE(v,offset+i*4));}
function cameraFixture(){
  const data=Buffer.alloc(256);putFloats(data,0,[0,0,2,1,1,3,0,-4]);
  data.writeUInt32LE(2048,68);data.writeInt32LE(2,108);data.write('test.cam',128);data.writeUInt32LE(1,196);return data;
}
function mapFixture(){
  const data=Buffer.alloc(640),put=(offset,values)=>values.forEach((v,i)=>data.writeUInt32LE(v>>>0,offset+i*4));
  put(0,[-1,0,0,80]);put(24,[80,304,0,0]);
  put(80,[0,224,224,0]);putFloats(data,112,[1,0,0,0,0,1,0,0,0,0,1,0,10,20,30,1]);
  for(const[offset,header,length]of[[304,48,316],[352,48,268],[400,48,220],[448,64,172]])put(offset,[0,header,length,0]);
  put(464,[3,1,0,0]);
  [[0,0,0],[1,0,0],[0,1,0]].forEach((p,i)=>{putFloats(data,512+i*36,p);putFloats(data,524+i*36,[0,0,1]);});return data;
}
function collisionFixture(){
  const data=Buffer.alloc(1024);data.writeInt32LE(-1,0x174);
  for(let i=0;i<80;i++)data.writeUInt32LE(0x174,0x20+i*4);
  let offset=0x180;
  for(let g=0;g<5;g++){const stride=g===4?48:80,count=g===0?2:1;data.writeUInt32LE(stride*count,8+g*4);data.writeUInt32LE(offset,0x160+g*4);offset+=stride*count;}
  data.writeUInt32LE(0x101,0x180);data.writeUInt32LE(4,0x184);data.writeUInt32LE(7,0x188);
  [[0,0,0,1],[1,0,0,1],[1,0,1,1],[0,0,1,1]].forEach((p,i)=>putFloats(data,0x190+i*16,p));return data;
}
function dedFixture(){
  const data=Buffer.alloc(192);data.writeUInt16LE(0x11,0);data.writeUInt16LE(1,2);data.writeUInt32LE(1,36);data.writeUInt32LE(112,40);data.writeUInt32LE(160,84);
  putFloats(data,112,[.2,.4,.6,1,100,300,0,0,10,20,30]);data.writeUInt32LE(0xA0000,156);return data;
}
function sdbFixture(){
  const data=Buffer.alloc(288);putFloats(data,0,[-9900000256,9900000256,9900000256,-9900000256,9900000256,-9900000256]);
  putFloats(data,96,[10,20,30,40,50,-60]);data.writeUInt32LE(17,120);data.writeUInt32LE(2,124);data.writeUInt32LE(20001,132);
  data.write('test.sdb',192);data.writeUInt32LE(0x80000000,220);return data;
}

test('CAM visualizes oriented regions using all three ground points and preserves camera flags',()=>{
  const parsed=parseCameras(cameraFixture());assert.equal(parsed.count,1);assert.equal(parsed.records[0].flags,2048);assert.equal(parsed.records[0].cameraMovementType,2);
  assert.equal(parsed.sourceName,'test.cam');assert.equal(parsed.model.triangleCount,12);
  const points=parsed.model.meshes[0].positions,contains=p=>points.some((_,i)=>i%3===0&&p.every((n,k)=>points[i+k]===n));
  assert.ok(contains([1,4,2]),'The derived fourth oriented corner is retained');assert.ok(contains([-2,0,1]));
});

test('CAM stops before filename sentinel and rejects incomplete or unterminated records',()=>{
  const empty=cameraFixture().subarray(128);assert.equal(parseCameras(empty).count,0);assert.equal(parseCameras(empty).model.meshes.length,0);
  assert.throws(()=>parseCameras(Buffer.alloc(127)),/128-byte/);assert.throws(()=>parseCameras(Buffer.alloc(128)),/end marker/);
});

test('MAP decodes nested geometry, global translation and triangle winding',()=>{
  const parsed=parseMap(mapFixture()),mesh=parsed.model.meshes[0];assert.equal(parsed.model.triangleCount,1);assert.deepEqual(mesh.indices,[0,1,2]);
  assert.deepEqual(mesh.positions,[-10,-20,30,-11,-20,30,-10,-21,30]);assert.deepEqual(mesh.normals,[0,0,1,0,0,1,0,0,1]);
});

test('MAP linked cycles and out-of-file vertex payloads are rejected',()=>{
  const cyclic=mapFixture();cyclic.writeUInt32LE(304,304);assert.throws(()=>parseMap(cyclic),/Cyclic/);
  const truncated=mapFixture();truncated.writeUInt32LE(100,464);assert.throws(()=>parseMap(truncated),/mesh record/);
  const crossing=mapFixture();crossing.writeUInt32LE(128,456);assert.throws(()=>parseMap(crossing),/mesh record/);
});

test('CLD preserves quad topology and material metadata',()=>{
  const parsed=parseCollision(collisionFixture());assert.equal(parsed.groups[0].count,1);assert.equal(parsed.groups[0].records[0].material,7);assert.equal(parsed.model.triangleCount,2);
  assert.deepEqual(parsed.model.meshes[0].indices,[0,1,2,0,2,3]);
});

test('CLD spatial cell indices cannot reference absent faces',()=>{
  const data=collisionFixture();data.writeUInt32LE(0x178,0x20);data.writeInt32LE(4,0x178);assert.throws(()=>parseCollision(data),/face index/);
});

test('DED decodes real light records instead of labeling them animation frames',()=>{
  const parsed=inspectWorld(dedFixture(),'ded');assert.equal(parsed.lightCount,1);assert.equal(parsed.tables[0].kind,10);assert.equal(parsed.tables[0].category,'Point lights');
  assert.deepEqual(parsed.tables[0].records[0].position,[10,20,30]);assert.equal(parsed.tables[0].records[0].parameters[1],300);
  assert.equal(parsed.environmentOffset,160);assert.equal(parsed.environmentBytes,32);
});

test('DED light tables cannot overlap the environment block',()=>{
  const data=dedFixture();data.writeUInt32LE(2,36);assert.throws(()=>inspectWorld(data,'ded'),/exceeds its section/);
});

test('SDB exposes bounded region controls and recognizes the filename end record',()=>{
  const parsed=inspectWorld(sdbFixture(),'sdb');assert.equal(parsed.sourceName,'test.sdb');assert.equal(parsed.count,2);
  assert.equal(parsed.records[0].kind,'Global default');assert.equal(parsed.records[1].flags,2);assert.equal(parsed.records[1].controlId,17);
  assert.deepEqual(parsed.records[1].coordinates,[10,20,30,40,50,-60]);assert.equal(parsed.records[1].controlWords[1],20001);
});

test('SDB malformed size and trailing records fail explicitly',()=>{
  assert.throws(()=>inspectWorld(Buffer.alloc(200),'sdb'),/96-byte/);
  const data=Buffer.concat([sdbFixture(),Buffer.alloc(96)]);assert.throws(()=>inspectWorld(data,'sdb'),/after the SDB end marker/);
});
