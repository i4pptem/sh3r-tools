import test from 'node:test';
import assert from 'node:assert/strict';
import {expandModelTextureRuntime,restoreModelTextureRuntime} from '../core/model-texture-runtime.mjs';
import {peLayout} from '../core/morph-runtime.mjs';
import profile from '../core/model-texture-runtime-profile.json' with {type:'json'};
function executable() {
  const data = Buffer.alloc(0x302000), pe=0x80, optional=pe+24, table=optional+224;
  data.write('MZ'); data.writeUInt32LE(pe,60); data.writeUInt32LE(0x4550,pe); data.writeUInt16LE(0x14c,pe+4);
  data.writeUInt16LE(1,pe+6); data.writeUInt16LE(224,pe+20); data.writeUInt16LE(1,pe+22); data.writeUInt16LE(0x10b,optional);
  data.writeUInt32LE(0x301000,optional+4); data.writeUInt32LE(0x400000,optional+28); data.writeUInt32LE(4096,optional+32);
  data.writeUInt32LE(512,optional+36); data.writeUInt32LE(0x202000,optional+56); data.writeUInt32LE(4096,optional+60);
  data.write('.text',table);data.writeUInt32LE(0x301000,table+8);data.writeUInt32LE(4096,table+12);
  data.writeUInt32LE(0x301000,table+16);data.writeUInt32LE(4096,table+20);data.writeUInt32LE(0x60000020,table+36);
  data.write('header padding must survive',table+40);
  const layout=peLayout(data); for(const patch of profile.patches)Buffer.from(patch.expected,'hex').copy(data,layout.offset(patch.address));
  return data;
}
test('model texture patch adds separate RX/RW sections and restores every original byte',()=>{
 const source=executable(),result=expandModelTextureRuntime(source),layout=peLayout(result.data);
 assert.equal(result.report.slots,32);assert.equal(result.report.resourceCapacity,1120);
 assert.equal(layout.sections.at(-1).rawSize,0);assert.equal(layout.sections.at(-1).size,profile.storageBytes);
 assert.deepEqual(restoreModelTextureRuntime(result.data).data,source);assert.deepEqual(source,executable());
 for(const [offset,flags] of [[40,0x60000020],[80,0xc0000080]])assert.equal(result.data.readUInt32LE(layout.table+offset+36),flags);
});
test('model texture restore rejects tampered code, redirects, BSS and metadata',()=>{
 const {data}=expandModelTextureRuntime(executable()),layout=peLayout(data);
 for(const offset of [layout.sections.at(-2).raw+112,layout.sections.at(-2).raw+25,layout.offset(profile.patches[0].address)+1,layout.table+80+8]) {
  const changed=Buffer.from(data);changed[offset]^=1;assert.throws(()=>restoreModelTextureRuntime(changed));
 }
});
test('model texture patch checks original instructions, relocation mode and header capacity',()=>{
 const changed=executable(),layout=peLayout(changed);changed[layout.offset(profile.patches[1].address)]^=1;
 assert.throws(()=>expandModelTextureRuntime(changed),/instruction differs/);
 const short=executable();short.writeUInt32LE(layout.table+40,layout.optional+60);assert.throws(()=>expandModelTextureRuntime(short),/section headers/);
 const relocatable=executable();relocatable.writeUInt16LE(0,layout.pe+22);assert.throws(()=>expandModelTextureRuntime(relocatable),/Relocatable/);
});
