import test from 'node:test';
import assert from 'node:assert/strict';
import {MotionLibrary} from '../core/motion-library.mjs';
import {motionPack} from './helpers/pack-fixture.mjs';
import {modelFixture} from './helpers/model-fixture.mjs';
import {modelLayout} from '../core/model.mjs';

function fixture() {
  const data = new Map(['0:0','0:1'].map((key,i) => [key,motionPack([{index:1,frames:[[0,0,0,i,0,0],[0,0,0,i+1,0,0]]}],1024*(i+1))]));
  const entries = [...data.keys()].map((key,index) => ({key,index,name:`entry${index}.bin`,archiveName:'scene.afs',detectedFormat:'pack',extension:'bin'}));
  const workbench = {changes:new Map(),snapshot:()=>({entries}),bytes:key=>workbench.changes.get(key)?.data || data.get(key)};
  const library = new MotionLibrary(workbench); library.model = () => ({modelId:256,morphCount:1,parents:[-1]});
  return {library,workbench};
}

test('motion catalog pairs facial motion only from the exact selected PACK entry', () => {
  const {library} = fixture(), first = library.list('model'), second = library.list('model');
  assert.equal(first.clips.length,4); assert.deepEqual(second, first);
  const bodies = first.clips.filter(c=>c.type==='skeletal');
  for(let i=0;i<bodies.length;i++) {
    const clip = library.get('model',bodies[i].id);
    assert.equal(clip.sceneId,clip.morphClip.sceneId); assert.equal(clip.assetKey,`0:${i}`);
    assert.equal(clip.morphClip.tracks[0].weights[0],.25*(i+1));
  }
});

test('changed PACK payload invalidates old motion identities and recalculates matching tracks', () => {
  const {library,workbench} = fixture(), id = library.list('model').clips[0].id;
  workbench.changes.set('0:0',{data:motionPack([{index:1,frames:[[0,0,0,12,0,0]]}])});
  assert.throws(()=>library.get('model',id),/source changed/);
  const updated=library.list('model').clips.find(c=>c.assetKey==='0:0');
  assert.notEqual(updated.id,id); assert.equal(library.get('model',updated.id).morphClip,null);
});

test('Heather reflections share ANM banks only after matching the loaded canonical hierarchy', () => {
  const original = modelFixture(73), reflection = Buffer.from(original); reflection.writeUInt32LE(0x180, 4);
  const entries = [{key:'model',name:'data/pcchr/pl/chhaa.mdl'}];
  const workbench = {bytes:key=>key==='model'?original:reflection,snapshot:()=>({entries})};
  const library = new MotionLibrary(workbench), clip = {modelId:256,type:'skeletal',sourceFormat:'anm',model:'chhaa'};
  const model = library.model('reflection');
  assert.equal(library.compatible(model, clip), true); assert.doesNotThrow(()=>library.validateSkeleton(model,clip));
  assert.equal(library.compatible(model, {...clip,sourceFormat:'pack'}), false);
  assert.equal(library.compatible(model, {...clip,type:'morph',targetCount:model.morphCount}), false);
  assert.equal(library.compatible(model, {...clip,modelId:532}), false);
  const layout = modelLayout(reflection); reflection.writeInt8(0, layout.parentOffset + 1);
  assert.equal(library.compatible(library.model('reflection'), clip), false);
  reflection.writeInt8(-1, layout.parentOffset + 1); entries.length = 0;
  assert.equal(library.compatible(library.model('reflection'), clip), false);
});

test('Heather costume IDs retain their normal bank compatibility', () => {
  const {library} = fixture();
  assert.equal(library.compatible({modelId:256,parents:[-1]}, {modelId:256,type:'skeletal'}), true);
  assert.equal(library.compatible({modelId:532,parents:[-1]}, {modelId:256,type:'skeletal'}), false);
});

test('motion metadata identifies banks with verified actions without attributing them to PACK tracks', () => {
  const {library} = fixture();
  const calls = []; library.actionRanges = (clip,name) => {calls.push(name); return {ranges:[{id:5000},{id:5001}]};};
  const clip = {name:'en_one.anm',modelId:512,frameCount:1208,type:'skeletal'};
  assert.equal(library.metadata(clip).actionCount, 2);
  assert.equal(library.metadata({...clip,sourceFormat:'pack'}).actionCount, 0);
  assert.equal(library.metadata({...clip,type:'morph'}).actionCount, 0);
  assert.deepEqual(calls, ['en_one.anm']);
});
