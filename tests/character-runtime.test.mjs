import test from 'node:test';
import assert from 'node:assert/strict';
import {expandCharacterRuntime, restoreCharacterRuntime} from '../core/character-runtime.mjs';
import {characterRequirements} from '../core/character-requirements.mjs';
import {peLayout} from '../core/morph-runtime.mjs';
import profile from '../core/character-runtime-profile.json' with {type:'json'};
import layoutProfile from '../core/character-layout-profile.json' with {type:'json'};

function executable() {
  const data = Buffer.alloc(0x202000), pe=0x80, optional=pe+24, table=optional+224;
  data.write('MZ'); data.writeUInt32LE(pe,60); data.writeUInt32LE(0x4550,pe); data.writeUInt16LE(0x14c,pe+4);
  data.writeUInt16LE(1,pe+6); data.writeUInt16LE(224,pe+20); data.writeUInt16LE(1,pe+22); data.writeUInt16LE(0x10b,optional);
  data.writeUInt32LE(0x201000,optional+4); data.writeUInt32LE(0x400000,optional+28); data.writeUInt32LE(4096,optional+32);
  data.writeUInt32LE(512,optional+36); data.writeUInt32LE(0x202000,optional+56); data.writeUInt32LE(4096,optional+60);
  data.write('.text',table);data.writeUInt32LE(0x201000,table+8);data.writeUInt32LE(4096,table+12);
  data.writeUInt32LE(0x201000,table+16);data.writeUInt32LE(4096,table+20);data.writeUInt32LE(0x60000020,table+36);
  data.write('header padding must survive',table+40);
  const layout=peLayout(data); for(const patch of profile.patches)Buffer.from(patch.expected,'hex').copy(data,layout.offset(patch.address));
  return data;
}
const entries=()=>layoutProfile.groups.flatMap(group=>group.names.map(name=>({name,size:1024})));

test('character patch maps separate RX code and aligned RW zero storage and reverses exactly',()=>{
  const original=executable(),{data,report}=expandCharacterRuntime(original),layout=peLayout(data);
  assert.equal(data.length-original.length,512);assert.equal(report.arenaAddress%8192,0);
  assert.equal(layout.sections.at(-1).rawSize,0);assert.equal(layout.sections.at(-1).size,128*1024*1024);
  assert.equal(data.readUInt32LE(layout.table+40+36),0x60000020);assert.equal(data.readUInt32LE(layout.table+80+36),0xc0000080);
  assert.deepEqual(restoreCharacterRuntime(data).data,original);
  assert.deepEqual(original,executable());
});
test('character restore rejects edited machine code, redirects and arena metadata',()=>{
  const {data}=expandCharacterRuntime(executable()),layout=peLayout(data);
  for(const offset of [layout.sections.at(-2).raw+112,layout.offset(profile.patches[0].address)+1,layout.table+80+8]) {
    const changed=Buffer.from(data);changed[offset]^=1;assert.throws(()=>restoreCharacterRuntime(changed));
  }
});
test('character patch checks original instructions and header capacity',()=>{
  const changed=executable(),layout=peLayout(changed);changed[layout.offset(profile.patches[1].address)]^=1;
  assert.throws(()=>expandCharacterRuntime(changed),/instruction differs/);
  const short=executable();short.writeUInt32LE(layout.table+40,layout.optional+60);assert.throws(()=>expandCharacterRuntime(short),/section headers/);
});
test('startup accounting selects the largest costume and rounds native slots independently',()=>{
  const files=entries();files[0].size=53551728;
  files.push({name:'data/pcchr/en/enemy.mdl',size:6*1024*1024});
  const result=characterRequirements(files);assert.equal(result.requiresCharacterPatch,true);
  assert.equal(result.character.startupBytes,Math.ceil(53551728/8192)*8192+3*8192);
  assert.equal(result.character.cacheBytes,40*1024*1024);
});
test('small character files keep the original executable; oversized caches and incomplete catalogs fail',()=>{
  assert.equal(characterRequirements(entries()).requiresCharacterPatch,false);
  assert.throws(()=>characterRequirements(entries().slice(1)),/complete game data folder/);
  assert.throws(()=>characterRequirements([...entries(),{name:'data/pcchr/en/enemy.mdl',size:41*1024*1024}]),/40 MiB native cache/);
  const files=entries();files[0].size=88*1024*1024;
  assert.throws(()=>characterRequirements(files),/88 MiB/);
});
