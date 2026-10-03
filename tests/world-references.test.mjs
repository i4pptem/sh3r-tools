import test from 'node:test';
import assert from 'node:assert/strict';
import {worldReferences, worldReference} from '../core/world-references.mjs';
import {cameraFixture} from './helpers/camera-fixture.mjs';

function workspace() {
  const archives = [
    {name: 'room.arc', entries: [{name: 'data/tmp/room.map', extension: 'map', index: 0}, {name: 'data/bg/room.cld', extension: 'cld', index: 1}, {name: 'data/bg/room.cam', extension: 'cam', index: 2}]},
    {name: 'other.arc', entries: [{name: 'data/bg/room.cam', extension: 'cam', index: 0}, {name: 'data/bg/other.cld', extension: 'cld', index: 1}]},
  ];
  return {archives, mapCollisions: new Map(), get(key) {const [a, e] = key.split(':').map(Number); return {archive: archives[a], entry: archives[a].entries[e]};}, format(key) {return this.get(key).entry.extension;}};
}

test('references prefer same-room files and a bound CLD without guessing ambiguous names', () => {
  const wb = workspace();
  assert.equal(worldReferences(wb, '0:0').cam.selected, '0:2');
  assert.equal(worldReferences(wb, '0:0').cld.selected, '0:1');
  wb.mapCollisions.set('0:0', {target: '1:1'});
  assert.equal(worldReferences(wb, '0:0').cld.selected, '1:1');
  wb.archives[0].entries[2].name = 'unmatched.cam';
  wb.archives[1].entries.push({name: 'another/room.cam', extension: 'cam', index: 2});
  assert.equal(worldReferences(wb, '0:0').cam.selected, null);
});

test('reference loading uses current staged bytes and cannot accept another editable MAP', () => {
  const wb = workspace(); let data = cameraFixture(); wb.bytes = () => data;
  const first = worldReference(wb, '0:0', '0:2');
  data = Buffer.from(data); data.writeFloatLE(123, 84);
  const second = worldReference(wb, '0:0', '0:2');
  assert.notEqual(second.hash, first.hash); assert.equal(second.records[0].watchHeightOffset, 123);
  assert.throws(() => worldReference(wb, '0:0', '0:0'), /CLD or CAM/);
  assert.throws(() => worldReference(wb, '0:2', '0:2'), /Select a MAP/);
});
