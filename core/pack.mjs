import {requireThat, range} from './binary.mjs';

/** Read the bounded section table shared by skeletal and facial PACK tracks. */
export function packSections(buffer) {
  if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x12345678) return [];
  range(buffer, 0, 16, 'PACK header');
  requireThat(buffer.readUInt32LE(4) === 1, 'Unsupported PACK revision.');
  const count = buffer.readUInt32LE(8), tableEnd = 16 + count * 16;
  range(buffer, 16, count * 16, 'PACK file table');
  return Array.from({length: count}, (_, index) => {
    const p = 16 + index * 16;
    const offset = buffer.readUInt32LE(p), type = buffer.readUInt32LE(p + 4), size = buffer.readUInt32LE(p + 8);
    range(buffer, offset, size, 'PACK section');
    requireThat(!size || offset >= tableEnd, 'PACK section overlaps its file table.');
    return {index, offset, type, size};
  });
}
