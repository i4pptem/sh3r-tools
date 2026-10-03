import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Workbench} from '../core/workbench.mjs';

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sh3-merge-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const file=path.join(root,'base.afs'),data=Buffer.alloc(6144);data.write('AFS\0');data.writeUInt32LE(2,4);
  for(let i=0;i<2;i++){data.writeUInt32LE(2048*(i+1),8+i*8);data.writeUInt32LE(4,12+i*8);data.write('base',2048*(i+1));}
  fs.writeFileSync(file,data);const wb=new Workbench();wb.open(file);
  const packageFile=(name,key,value)=>{const other=new Workbench();other.open(file);other.stage(key,Buffer.from(value),name);const target=path.join(root,name+'.sh3mod');other.exportModPackage(target);return target;};
  return {root,file,wb,packageFile};
}
test('mods sharing an archive merge distinct entries without copying unchanged entries',t=>{
  const {wb,packageFile}=fixture(t),a=packageFile('a','0:0','first'),b=packageFile('b','0:1','second');
  const plan=wb.prepareModMerge([a,b,a]);assert.equal(plan.items.length,2);assert.equal(plan.duplicates,1);assert.equal(wb.changes.size,0);
  wb.applyModMerge(plan.token);assert.equal(wb.bytes('0:0').toString(),'first');assert.equal(wb.bytes('0:1').toString(),'second');
});
test('conflicts require a reviewed choice and keep staged work on failure',t=>{
  const {wb,packageFile}=fixture(t),a=packageFile('a','0:0','first'),b=packageFile('b','0:0','second');
  wb.stage('0:1',Buffer.from('unrelated'),'mine');const plan=wb.prepareModMerge([a,b]);
  assert.equal(plan.items[0].conflict,true);assert.throws(()=>wb.applyModMerge(plan.token),/Choose which mod/);assert.equal(wb.changes.size,1);
  wb.applyModMerge(plan.token,{'0:0':1});assert.equal(wb.bytes('0:0').toString(),'second');assert.equal(wb.bytes('0:1').toString(),'unrelated');
});
test('review becomes stale after staged replacements change',t=>{
  const {wb,packageFile}=fixture(t),plan=wb.prepareModMerge([packageFile('a','0:0','first')]);
  wb.stage('0:1',Buffer.from('later'),'mine');assert.throws(()=>wb.applyModMerge(plan.token),/stale/);assert.equal(wb.changes.size,1);
});
test('portable package verifies original identity and original option removes conflicting edit',t=>{
  const {wb,packageFile}=fixture(t),file=packageFile('a','0:0','first');wb.stage('0:0',Buffer.from('mine'),'mine');
  const plan=wb.prepareModMerge([file]);assert.equal(plan.items[0].choices.length,2);wb.applyModMerge(plan.token,{'0:0':-1});assert.equal(wb.changes.size,0);
  const doc=JSON.parse(fs.readFileSync(file));doc.assets[0].originalHash='00'.repeat(32);fs.writeFileSync(file,JSON.stringify(doc));
  assert.throws(()=>wb.prepareModMerge([file]),/another original/);assert.equal(wb.changes.size,0);
});
test('saved projects merge embedded edits without requiring the original absolute path',t=>{
  const {wb,root,file}=fixture(t),other=new Workbench();other.open(file);other.stage('0:1',Buffer.from('project'),'project');
  const saved=path.join(root,'source.sh3project');other.saveProject(saved);const doc=JSON.parse(fs.readFileSync(saved));
  doc.sources[0].file='/another-computer/data/base.afs';fs.writeFileSync(saved,JSON.stringify(doc));
  const plan=wb.prepareModMerge([saved]);wb.applyModMerge(plan.token);assert.equal(wb.bytes('0:1').toString(),'project');
});


test('replacement and overlay build folders retain manifest identity and deduplicate archives',async t=>{
 const {wb,root,file}=fixture(t),other=new Workbench();other.open(file);other.stage('0:1',Buffer.from('built'),'built');
 const folder=path.join(root,'built');await other.build(folder);
 const plan=wb.prepareModMerge([folder]);assert.equal(plan.items.length,1);wb.applyModMerge(plan.token);assert.equal(wb.bytes('0:1').toString(),'built');
 wb.changes.clear();const overlay=path.join(root,'overlay');fs.mkdirSync(path.join(overlay,'update'),{recursive:true});
 fs.cpSync(path.join(folder,'data'),path.join(overlay,'update/data'),{recursive:true});const legacy=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json')));delete legacy.contentRoot;legacy.mode='overlay';fs.writeFileSync(path.join(overlay,'manifest.json'),JSON.stringify(legacy));
 const builtFile=path.join(folder,'data/base.afs'),merged=wb.prepareModMerge([path.join(overlay,'manifest.json'),builtFile]);
 assert.equal(merged.items.length,1);assert.equal(merged.duplicates,1);wb.applyModMerge(merged.token);
 const corrupted=fs.readFileSync(builtFile);corrupted[corrupted.length-1]^=1;fs.writeFileSync(builtFile,corrupted);
 assert.throws(()=>wb.prepareModMerge([folder]),/differs from its build manifest/);
});
test('loose picture files merge from saved projects and overlay folders',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sh3-merge-pic-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const pic=path.join(root,'data/pic');fs.mkdirSync(pic,{recursive:true});fs.writeFileSync(path.join(pic,'unknown.bin'),'original');
 const wb=new Workbench(),other=new Workbench();wb.open(pic);other.open(pic);other.stage('0:0',Buffer.from('replacement'),'picture');
 const project=path.join(root,'pictures.sh3project');other.saveProject(project);
 const doc=JSON.parse(fs.readFileSync(project));doc.sources[0].file='/another-install/data/pic';fs.writeFileSync(project,JSON.stringify(doc));
 const plan=wb.prepareModMerge([project]);wb.applyModMerge(plan.token);assert.equal(wb.bytes('0:0').toString(),'replacement');
 wb.changes.clear();const overlay=path.join(root,'overlay'),output=path.join(overlay,'update/data/pic');fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'unknown.bin'),'overlay');
 const next=wb.prepareModMerge([overlay]);wb.applyModMerge(next.token);assert.equal(wb.bytes('0:0').toString(),'overlay');
});
