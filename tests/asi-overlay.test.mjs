import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {encodeRuntimePlan, materializeRuntimePlan, runtimePlan} from '../core/runtime-plan.mjs';
import {writeOverlay, loaderFromArchive} from '../core/asi-overlay.mjs';
import {sha256} from '../core/binary.mjs';
import profile from '../core/asi-runtime-profile.json' with {type:'json'};

function plan() {
  return {imageBase:0x400000,imageSize:0x10000,sourceHash:'12'.repeat(32),regions:[
    {size:32,executable:true,data:Buffer.alloc(8),relocations:[{offset:0,target:1,addend:4,relative:false},{offset:4,target:0xffffffff,addend:0x405000,relative:true}]},
    {size:64,executable:false,data:Buffer.alloc(0),relocations:[]},
  ],writes:[{address:0x401000,expected:Buffer.alloc(5,0x90),data:Buffer.from('e900000000','hex'),relocations:[{offset:1,target:0,addend:0,relative:true}]}]};
}

test('ASI relocations distinguish runtime pointers, game branches and entry trampolines',()=>{
  const p=plan(),addresses=[0x11000000,0x21000000],output=materializeRuntimePlan(p,addresses);
  assert.equal(output.regions[0].readUInt32LE(0),addresses[1]+4);
  assert.equal((output.regions[0].readUInt32LE(4)+addresses[0]+8)>>>0,0x405000);
  assert.equal((output.writes[0].readUInt32LE(1)+0x401005)>>>0,addresses[0]);
  assert.equal(p.regions[0].data.readUInt32LE(0),0,'materialization must not mutate the stored plan');
});

test('ASI encoding carries original identity and a checksum without allocating zero buffers',()=>{
  const p=plan(),bytes=encodeRuntimePlan(p);
  assert.equal(bytes.subarray(0,8).toString(),'SH3ASI1\0');
  assert.equal(bytes.readUInt32LE(12),p.imageBase);
  assert.equal(bytes.subarray(28,60).toString('hex'),p.sourceHash);
  assert.equal(bytes.subarray(-32).toString('hex'),sha256(bytes.subarray(0,-32)));
  p.regions[1].size=128*1024*1024;
  assert.equal(encodeRuntimePlan(p).length,bytes.length,'zero-initialized arenas are described, not distributed');
});

test('ASI overlay rejects unknown executables and unverified loader archives',()=>{
  assert.throws(()=>runtimePlan(Buffer.from('unknown executable'),{}),/supported original sh3.exe/);
  assert.throws(()=>loaderFromArchive(Buffer.from('unverified ZIP')),/checksum/);
});

test('overlay output keeps executable and vanilla data paths out of the build',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sh3-asi-output-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const asi=Buffer.from(profile.bytes,'base64');assert.equal(sha256(asi),profile.sha256);
  assert.equal(asi.readUInt16LE(asi.readUInt32LE(60)+4),0x14c);
  writeOverlay(root,{asi,plan:encodeRuntimePlan(plan()),report:{originalExecutableHash:plan().sourceHash}});
  assert.equal(fs.existsSync(path.join(root,'sh3.exe')),false);
  assert.equal(fs.existsSync(path.join(root,'data')),false);
  assert.ok(fs.existsSync(path.join(root,'plugins/SH3Tools.dll')));
  assert.ok(fs.readFileSync(path.join(root,'INSTALL.txt'),'utf8').includes('Keep the original data folder untouched'));
  assert.throws(()=>writeOverlay(root,{asi,plan:encodeRuntimePlan(plan()),report:{}}),/EEXIST/);
});
