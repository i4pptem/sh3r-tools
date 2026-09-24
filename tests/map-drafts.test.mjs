import test from 'node:test';
import assert from 'node:assert/strict';
import {MapDrafts,mapEditDefaults} from '../app/ui/map-drafts.mjs';

test('map drafts survive selection, own their data and require an explicit clear',()=>{
  const counts=[],drafts=new MapDrafts(count=>counts.push(count)),edit=mapEditDefaults('one');edit.translation[0]=2;
  drafts.set('map','hash',edit);edit.translation[0]=9;assert.equal(drafts.get('map','one').translation[0],2);
  const other=mapEditDefaults('two');other.uvOffset[0]=.5;drafts.set('map','hash',other);
  assert.equal(drafts.edits('map').length,2);assert.deepEqual(drafts.get('different','one'),mapEditDefaults('one'));
  assert.throws(()=>drafts.set('map','changed',edit),/Map changed/);assert.equal(drafts.count,2);
  drafts.clear('map');assert.equal(drafts.count,0);assert.deepEqual(counts,[1,2,0]);
});

test('identity, invalid and negative-scale draft edits cannot become hidden native changes',()=>{
  const drafts=new MapDrafts(),edit=mapEditDefaults('part');drafts.set('map','hash',edit);assert.equal(drafts.count,0);
  edit.scale[0]=-1;assert.throws(()=>drafts.set('map','hash',edit),/positive/);assert.equal(drafts.count,0);
});

test('one gesture moves multiple parts and undoes atomically without erasing the preceding action',()=>{
  const drafts=new MapDrafts(),a=mapEditDefaults('a'),b=mapEditDefaults('b');a.uvOffset[0]=.25;drafts.set('map','hash',a);
  drafts.begin('map');
  for(let x=1;x<=12;x++){a.translation[0]=x;b.translation[0]=x;drafts.setMany('map','hash',[a,b]);}
  drafts.end();assert.equal(drafts.histories.get('map').length,2);
  assert.ok(drafts.undo('map'));assert.equal(drafts.get('map','a').translation[0],0);assert.equal(drafts.get('map','a').uvOffset[0],.25);assert.equal(drafts.edits('map').length,1);
  drafts.undo('map');assert.equal(drafts.count,0);assert.equal(drafts.canUndo('map'),false);
});

test('invalid group edit does not partially mutate a valid draft and discard is undoable',()=>{
  const drafts=new MapDrafts(),a=mapEditDefaults('a'),b=mapEditDefaults('b');a.translation[0]=1;drafts.set('map','hash',a);
  a.translation[0]=9;b.scale[0]=0;assert.throws(()=>drafts.setMany('map','hash',[a,b]),/positive/);assert.equal(drafts.get('map','a').translation[0],1);
  drafts.discard('map');assert.equal(drafts.count,0);drafts.undo('map');assert.equal(drafts.count,1);drafts.clear('map');assert.equal(drafts.canUndo('map'),false);
});
