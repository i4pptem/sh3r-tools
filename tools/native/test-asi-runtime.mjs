import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {peLayout} from '../../core/morph-runtime.mjs';
import {encodeRuntimePlan} from '../../core/runtime-plan.mjs';
import {sha256} from '../../core/binary.mjs';
const root=fileURLToPath(new URL('../../build/asi/',import.meta.url)),exe=path.join(root,'test-asi-host.exe'),dll=path.join(root,'SH3Tools.dll');
const source=fs.readFileSync(exe),layout=peLayout(source),signature=Buffer.from('543348534354415054534554','hex'),at=source.indexOf(signature);
assert.ok(at>=0);const section=layout.sections.find(s=>at>=s.raw&&at<s.raw+s.rawSize),address=layout.imageBase+section.rva+at-section.raw;
const base={imageBase:layout.imageBase,imageSize:source.readUInt32LE(layout.optional+56),sourceHash:sha256(source),regions:[
 {size:6,executable:true,data:Buffer.from('b85a000000c3','hex'),relocations:[]},
 {size:32,executable:false,data:Buffer.alloc(0),relocations:[]},
],writes:[{address,expected:signature,data:Buffer.from('000000000000000039300000','hex'),relocations:[{offset:0,target:0,addend:0,relative:false},{offset:4,target:1,addend:0,relative:false}]}]};
fs.mkdirSync(path.join(root,'SH3Tools'),{recursive:true});
function run(label,plan,exit,mutate=bytes=>bytes){fs.writeFileSync(path.join(root,'SH3Tools/SH3Tools.patch'),mutate(encodeRuntimePlan(plan)));const result=spawnSync(exe,[dll],{cwd:root,encoding:'utf8',windowsHide:true,timeout:20000});assert.equal(result.status,exit,label+' '+result.stderr);console.log(label+': '+(result.stdout.trim()||'rejected before activation'));}
run('Relocation and code execution',base,0);
run('Combined expanded arenas',{...base,regions:[base.regions[0],{...base.regions[1],size:400*1024*1024}]},0);
run('Patch conflict',{...base,writes:[{...base.writes[0],expected:Buffer.alloc(12)}]},86);
run('Wrong executable',{...base,sourceHash:'00'.repeat(32)},86);
run('Allocation bound',{...base,regions:[{...base.regions[0],size:0x70000000},base.regions[1]]},86);
run('Corrupted plan',base,86,bytes=>{bytes[80]^=1;return bytes});
run('Out-of-region relocation',{...base,writes:[{...base.writes[0],relocations:[{offset:0,target:0,addend:100,relative:false}]}]},86);
