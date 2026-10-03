import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Workbench} from '../core/workbench.mjs';
import {sha256} from '../core/binary.mjs';
import {parseCollision,parseCameras} from '../core/world-formats.mjs';
import {editCollision} from '../core/collision-edit.mjs';
import {transformWorldRecord,recordCenter} from '../core/world-shapes.mjs';
import {MapDrafts,mapEditDefaults} from '../app/ui/map-drafts.mjs';
import {mapFixture} from './helpers/map-fixture.mjs';
import {cameraFixture} from './helpers/camera-fixture.mjs';

function collision(){
 const data=Buffer.alloc(0x700);data.writeFloatLE(-10000,0);data.writeFloatLE(-10000,4);data.writeInt32LE(-1,0x174);data.writeInt32LE(0,0x178);data.writeInt32LE(-1,0x17c);
 for(let i=0;i<80;i++)data.writeUInt32LE(0x174,0x20+i*4);let offset=0x180;
 for(let group=0;group<5;group++){
  const stride=group===4?48:80;data.writeUInt32LE(stride*2,8+group*4);data.writeUInt32LE(offset,0x160+group*4);data.writeUInt32LE(0x178,0x20+group*64);data[offset]=1;data[offset+1]=group===4?3:1;data.writeUInt32LE(4,offset+4);data.writeUInt32LE(7,offset+8);
  const points=[1,3].includes(group)?[[0,0,0],[100,0,0],[100,-100,0],[0,-100,0]]:[[0,0,0],[100,0,0],[100,0,100],[0,0,100]];
  if(group===4){[50,0,50,1,0,-100,0,25].forEach((v,i)=>data.writeFloatLE(v,offset+16+i*4));}
  else points.forEach((p,i)=>[...p,1].forEach((v,k)=>data.writeFloatLE(v,offset+16+i*16+k*4)));
  offset+=stride*2;
 }
 data.fill(0xac,offset);return data;
}
function room(t){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'sh3-room-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
 const buffers=[mapFixture(),collision(),cameraFixture()],data=Buffer.alloc(6144+buffers[2].length);data.write('AFS\0');data.writeUInt32LE(3,4);data.writeUInt32LE(128,32);data.writeUInt32LE(144,36);['map','cld','cam'].forEach((ext,i)=>data.write('room.'+ext,128+i*48));
 buffers.forEach((buffer,i)=>{const at=(i+1)*2048;data.writeUInt32LE(at,8+i*8);data.writeUInt32LE(buffer.length,12+i*8);buffer.copy(data,at);});
 const file=path.join(folder,'room.afs');fs.writeFileSync(file,data);const wb=new Workbench();wb.open(file);
 ['map','cld','cam'].forEach((extension,i)=>Object.assign(wb.archives[0].entries[i],{name:`room.${extension}`,extension,detectedFormat:extension}));return {wb,buffers,folder};
}
const moved=(record,region,x=100)=>transformWorldRecord(record,region,{position:recordCenter(record,region).map((v,i)=>v+(i===0?x:0)),rotation:[0,0,0],scale:[1,1,1]});
const ref=(wb,key,kind,record)=>({target:key,kind,hash:sha256(wb.bytes(key)),records:[record]});

test('room edits validate all references before staging and undo MAP, CAM and CLD together',t=>{
 const {wb,buffers}=room(t),cam=moved({...parseCameras(buffers[2]).records[0]},'active'),cld=moved({...parseCollision(buffers[1]).groups[0].records[0],group:0,index:0},null);
 const edit={...mapEditDefaults('Map_0_0'),scale:[.9,.9,.9]},refs=[ref(wb,'0:1','cld',cld),ref(wb,'0:2','cam',cam)];
 const bad=structuredClone(refs);bad[1].hash='stale';assert.throws(()=>wb.editRoom('0:0',sha256(buffers[0]),[edit],bad),/Reference file changed/);assert.equal(wb.changes.size,0);
 wb.editRoom('0:0',sha256(buffers[0]),[edit],refs);assert.equal(wb.changes.size,3);assert.equal(parseCollision(wb.bytes('0:1')).groups[0].records[0].vertices[0][0],-100);
 assert.equal(parseCameras(wb.bytes('0:2')).records[0].activeGroundPoints[0][0],-100);wb.undoMap('0:0');buffers.forEach((b,i)=>assert.deepEqual(wb.bytes(`0:${i}`),b));
});
test('bound collision rejects manual generated-group edits but retains unbound edits through regeneration and saved projects',t=>{
 const {wb,buffers,folder}=room(t);wb.bindMapCollision('0:0',sha256(buffers[0]),{target:'0:1',mode:'room',group:0,parts:['Map_0_0'],template:0,material:7});
 let cld=parseCollision(wb.bytes('0:1'));const generated=moved({...cld.groups[0].records[0],group:0,index:0},null);
 assert.throws(()=>wb.editRoom('0:0',sha256(buffers[0]),[],[ref(wb,'0:1','cld',generated)]),/generated from map/);
 const cylinder=moved({...cld.groups[4].records[0],group:4,index:0},null);wb.editRoom('0:0',sha256(buffers[0]),[],[ref(wb,'0:1','cld',cylinder)]);
 wb.editMap('0:0',sha256(buffers[0]),[{...mapEditDefaults('Map_0_0'),scale:[.9,.9,.9]}]);assert.deepEqual(parseCollision(wb.bytes('0:1')).groups[4].records[0].position,cylinder.position.map(v=>v===0?0:v));
 const file=path.join(folder,'edit.sh3project');wb.saveProject(file);const loaded=new Workbench();loaded.loadProject(file);assert.deepEqual(loaded.bytes('0:1'),wb.bytes('0:1'));
});
test('CLD movement preserves wall ordering, cylinder absolute height, metadata and opaque suffix',()=>{
 const data=collision(),world=parseCollision(data),record={...world.groups[1].records[0],group:1,index:0};
 const changed=transformWorldRecord(record,null,{position:recordCenter(record).map(v=>v+10),rotation:[0,Math.PI/3,0],scale:[2,1,3]});
 const output=editCollision(data,[changed]),parsed=parseCollision(output);assert.deepEqual(parsed.groups[1].records[0].vertices,changed.vertices);assert.equal(parsed.groups[1].records[0].weight,4);assert.equal(output.at(-1),0xac);
 const invalid=structuredClone(changed);invalid.vertices[0][1]+=1;assert.throws(()=>editCollision(data,[invalid]),/vertical rectangles/);
});
test('room draft undo orders map and reference gestures and survives selection without aliasing',()=>{
 const drafts=new MapDrafts(),edit=mapEditDefaults('part');edit.translation[0]=20;drafts.set('map','hash',edit);
 const original={index:0,activeHeights:[0,1]},world={key:'cam',hash:'camhash'};drafts.begin('map');
 for(let n=2;n<10;n++)drafts.setReference('map','hash',world,'cam',{index:0,activeHeights:[0,n]},original);drafts.end();assert.equal(drafts.count,2);
 drafts.undo('map');assert.equal(drafts.references('map').length,0);assert.equal(drafts.get('map','part').translation[0],20);drafts.undo('map');assert.equal(drafts.count,0);
});
