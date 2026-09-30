import test from 'node:test';
import assert from 'node:assert/strict';
import {MotionLibrary} from '../core/motion-library.mjs';
import {motionPack} from './helpers/pack-fixture.mjs';

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
