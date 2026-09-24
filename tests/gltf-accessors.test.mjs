import test from 'node:test';
import assert from 'node:assert/strict';
import {gltfAccessor} from '../core/gltf-accessors.mjs';

test('interleaved attributes respect stride and normalized signed endpoints', () => {
  const bytes = Buffer.from([128, 127, 91, 91, 0, 64, 91, 91]);
  const doc = {bufferViews: [{buffer: 0, byteLength: 8, byteStride: 4}], accessors: [{bufferView: 0, componentType: 5120, type: 'VEC2', count: 2, normalized: true}]};
  assert.deepEqual(gltfAccessor(doc, bytes, 0), [-1, 1, 0, 64 / 127]);
  doc.bufferViews[0].byteLength = 5; assert.throws(() => gltfAccessor(doc, bytes, 0), /exceeds/);
});

test('sparse shape keys fill the neutral base and reject duplicate indices', () => {
  const bytes = Buffer.alloc(28); bytes[0] = 1; bytes[1] = 3;
  [1, 2, 3, -1, -2, -3].forEach((v, i) => bytes.writeFloatLE(v, 4 + i * 4));
  const doc = {bufferViews: [{buffer: 0, byteLength: 2}, {buffer: 0, byteOffset: 4, byteLength: 24}], accessors: [{componentType: 5126, type: 'VEC3', count: 4, sparse: {count: 2, indices: {bufferView: 0, componentType: 5121}, values: {bufferView: 1}}}]};
  assert.deepEqual(gltfAccessor(doc, bytes, 0), [0, 0, 0, 1, 2, 3, 0, 0, 0, -1, -2, -3]);
  bytes[1] = 1; assert.throws(() => gltfAccessor(doc, bytes, 0), /must increase/);
});
