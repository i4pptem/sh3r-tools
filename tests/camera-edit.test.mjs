import test from 'node:test';
import assert from 'node:assert/strict';
import {editCameras, importCameras} from '../core/camera-edit.mjs';
import {cameraRecords} from '../core/world-records.mjs';

function fixture() {
  const data = Buffer.alloc(384); data.fill(0xa7, 256);
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 32; j++) data.writeFloatLE(j / 7 + i, i * 128 + j * 4);
    for (const at of [64, 68, 72, 76, 80, 92, 108]) data.writeInt32LE(at === 68 ? 2048 : 2, i * 128 + at);
  }
  data.writeFloatLE(-0, 0); data.writeUInt32LE(0x2001, 324); return data;
}
test('CAM JSON no-op retains signed zero, complete sentinel and opaque tail byte-for-byte', () => {
  const data = fixture(), document = JSON.parse(JSON.stringify(cameraRecords(data)));
  assert.deepEqual(importCameras(data, document), data);
});
test('CAM zone edit changes only selected fields and leaves other records untouched', () => {
  const data = fixture(), edited = editCameras(data, [{index: 1, activeGroundPoints: [[1, 2], [3, 4], [5, 6]], projection: [2, .5, 1]}]);
  assert.deepEqual(edited.subarray(0, 128), data.subarray(0, 128));
  assert.deepEqual(edited.subarray(152, 224), data.subarray(152, 224));
  assert.deepEqual(edited.subarray(236), data.subarray(236));
  assert.deepEqual(cameraRecords(edited).records[1].activeGroundPoints, [[1, 2], [3, 4], [5, 6]]);
});
test('CAM rejects terminator flags, non-native numbers, incomplete vectors and duplicate indices', () => {
  const data = fixture();
  for (const edit of [{index: 0, flags: 3}, {index: 0, flags: -1}, {index: 0, kindId: .5}, {index: 0, projection: [1, 2]}, {index: 0, traceBottomHeight: 1e100}, {index: 0, watchHeightOffset: null}]) assert.throws(() => editCameras(data, [edit]));
  assert.throws(() => editCameras(data, [{index: 0}, {index: 0}]), /repeated/);
  assert.throws(() => importCameras(data, {format: 'SH3 camera zones', records: []}), /count/);
});
