import test from 'node:test';
import assert from 'node:assert/strict';
import {readActionTable} from '../core/anm-action-table.mjs';

function fixture() {
  const bytes = Buffer.alloc(36), table = {tableAddress: 0x710000, firstId: 5000, lastId: 5002};
  for (let i = 0; i < 3; i++) {
    const p = i * 12;
    bytes.writeUInt16LE(5000 + i, p); bytes.writeUInt16LE(10, p + 2);
    bytes.writeInt16LE(i ? 1024 : 2048, p + 4); bytes.writeUInt16LE(i * 10, p + 6);
    bytes.writeUInt16LE(i * 10 + 9, p + 8); bytes[p + 10] = i === 0 ? 1 : 0;
  }
  return {bytes, table, read: (address, size) => bytes.subarray(address - table.tableAddress, address - table.tableAddress + size)};
}

test('native enemy actions use inclusive bounds, per-action speed and loop flags', () => {
  const {read, table} = fixture(), clips = readActionTable(read, table, 30);
  assert.deepEqual(clips.map(c => [c.id,c.start,c.end,c.fps,c.loop]), [[5000,0,9,30,true],[5001,10,19,15,false],[5002,20,29,15,false]]);
  assert.equal(clips[2].sourceAddress, '0x710018');
});

test('descriptor bounds belong to the selected bank, not the Heather bank size', () => {
  const {read, table, bytes} = fixture();
  bytes.writeUInt16LE(30, 32);
  assert.throws(() => readActionTable(read, table, 30), /Action 5002/);
  assert.equal(readActionTable(read, table, 31).at(-1).end, 30);
});

test('native placeholders are omitted without shifting subsequent action IDs', () => {
  const {read, table, bytes} = fixture(); bytes.writeUInt16LE(0, 2); bytes.writeInt16LE(0, 16);
  assert.deepEqual(readActionTable(read, table, 30).map(c => c.id), [5002]);
});

test('wrong action identities, malformed intervals and flags fail with the affected ID', () => {
  for (const [offset,value] of [[0,4999],[6,12],[10,2],[4,-1]]) {
    const {read, table, bytes} = fixture(); bytes.writeInt16LE(value, offset);
    assert.throws(() => readActionTable(read, table, 30), /Action 5000/);
  }
});
