import {Matrix4} from 'three';
import {range, requireThat, floats} from './binary.mjs';

/** MAP object records use relative links and store matrices and boxes in world coordinates. */
export function mapTransforms(data) {
  let offset = data.readUInt32LE(24); const records = [], seen = new Set();
  while (offset) {
    requireThat(!seen.has(offset) && records.length < 4096, 'Cyclic MAP object transforms.'); seen.add(offset); range(data, offset, 224, 'MAP object transform');
    const next = data.readUInt32LE(offset), length = data.readUInt32LE(offset + 8);
    requireThat(length >= 224, 'Invalid MAP object transform length.'); range(data, offset, length);
    const matrix = floats(data, offset + 32, 16); requireThat(matrix.every(Number.isFinite), 'Non-finite MAP object matrix.');
    requireThat(Math.abs(new Matrix4().fromArray(matrix).determinant()) > 1e-12, 'Singular MAP object transform.');
    records.push({offset, type: data.readUInt32LE(offset + 16), id: data.readUInt32LE(offset + 20), matrix, box: Array.from({length: 8}, (_, i) => floats(data, offset + 96 + i * 16, 3))});
    offset = next ? offset + next : 0;
  }
  requireThat(records.length > 0, 'MAP has no object transform.'); return records;
}

export function mapPartTransform(records, type, id) {
  const record = type === 3 ? records.find(record => record.type === 3 && record.id === id) : records[0];
  requireThat(record, `MAP object ${type}:${id} has no transform.`);
  return {record, matrix: new Matrix4().makeScale(-1, -1, 1).multiply(new Matrix4().fromArray(record.matrix))};
}
