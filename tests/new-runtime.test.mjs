import {expandMapGeometryRuntime,restoreMapGeometryRuntime} from '../core/map-geometry-runtime.mjs';
import geometry from '../core/map-geometry-runtime-profile.json' with {type:'json'};
import test from 'node:test';
import assert from 'node:assert/strict';
import {expandBackgroundRuntime,restoreBackgroundRuntime} from '../core/background-runtime.mjs';
import background from '../core/background-runtime-profile.json' with {type:'json'};
import {peLayout} from '../core/morph-runtime.mjs';
function executable(){
 const data=Buffer.alloc(0x302000),pe=0x80,opt=pe+24,table=opt+224;
 data.write('MZ');data.writeUInt32LE(pe,60);data.writeUInt32LE(0x4550,pe);data.writeUInt16LE(0x14c,pe+4);data.writeUInt16LE(1,pe+6);data.writeUInt16LE(224,pe+20);data.writeUInt16LE(1,pe+22);data.writeUInt16LE(0x10b,opt);
 for(const [at,n] of [[4,0x301000],[28,0x400000],[32,4096],[36,512],[56,0x302000],[60,4096]])data.writeUInt32LE(n,opt+at);
 data.write('.text',table);for(const [at,n] of [[8,0x301000],[12,4096],[16,0x301000],[20,4096],[36,0x60000020]])data.writeUInt32LE(n,table+at);
 data.write('preserve original header padding',table+40);const l=peLayout(data);
 for(const p of [...background.patches,...geometry.patches])Buffer.from(p.expected,'hex').copy(data,l.offset(p.address));
 return data;
}
test('background arena preserves CALL and original auxiliary arguments, then restores exact bytes',()=>{
 const source=executable(),expanded=expandBackgroundRuntime(source),l=peLayout(expanded.data),code=l.sections.at(-2);
 assert.equal(expanded.report.arenaBytes,256*1048576);assert.equal(expanded.data[l.offset(background.patches[0].address)],0xe8);
 assert.equal(expanded.data.readUInt32LE(code.raw+112+12),256*1048576);assert.equal(l.sections.at(-1).rawSize,0);
 assert.deepEqual(restoreBackgroundRuntime(expanded.data).data,source);
 const altered=Buffer.from(expanded.data);altered[code.raw+112]^=1;assert.throws(()=>restoreBackgroundRuntime(altered),/code differs/);
});

test('transparent queue patch composes after background, restores exact bytes and rejects damaged code',()=>{
 const source=executable(),backgroundData=expandBackgroundRuntime(source).data,expanded=expandMapGeometryRuntime(backgroundData).data,l=peLayout(expanded),section=l.sections.at(-1);
 for(const patch of geometry.patches)assert.equal(expanded[l.offset(patch.address)],0xe9);
 assert.deepEqual(restoreMapGeometryRuntime(expanded).data,backgroundData);assert.deepEqual(restoreBackgroundRuntime(restoreMapGeometryRuntime(expanded).data).data,source);
 const damaged=Buffer.from(expanded);damaged[section.raw+72]^=1;assert.throws(()=>restoreMapGeometryRuntime(damaged),/code differs/);
});
