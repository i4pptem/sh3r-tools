import test from 'node:test';
import assert from 'node:assert/strict';
import {animationHeader, parseAnimation} from '../core/animation.mjs';

function frame(records, size = 34) {
  const data = Buffer.alloc(size);
  let flags = 0, offset = 4;
  for (const [bone, record] of records.entries()) {
    if (!record) continue;
    flags |= record.flag << (bone * 4);
    if (record.position) {
      for (const value of record.position) {
        if (record.half) {data.writeUInt16LE(value, offset); offset += 2;}
        else {data.writeFloatLE(value, offset); offset += 4;}
      }
    }
    for (const value of record.quaternion || [0, 0, 0]) {data.writeInt16LE(value, offset); offset += 2;}
  }
  assert.equal(offset, size, 'Synthetic frame must fill its independently specified format stride');
  data.writeUInt32LE(flags >>> 0);
  return data;
}
function animation(frames, id = 0x101c) {
  const header = Buffer.alloc(4); header.writeUInt32LE(id);
  return Buffer.concat([header, ...frames]);
}
const root = {flag: 10, position: [12.5, -7.25, 1000], quaternion: [16384, 0, 0]};
const child = {flag: 14, position: [0x3c00, 0xc000, 0x0001], half: true, quaternion: [0, 16384, 0]};
const fixture = () => animation([frame([root, child])]);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} differs from ${expected}`);

test('ANM reads exact fixed frame count and identity from its header', () => {
  const header = animationHeader(animation([frame([root, child]), frame([root, child])]));
  assert.deepEqual(header, {modelId: 0x101c, stride: 34, model: 'bg_fre', frameCount: 2});
});

test('ANM distinguishes root float32 and child native-short translations, including exponent zero', () => {
  const decoded = parseAnimation(fixture(), [-1, 0]);
  assert.deepEqual([...decoded.translations.slice(0, 3)], [12.5, -7.25, 1000]);
  assert.deepEqual([...decoded.translations.slice(3, 6)], [1, -2, (1+1/1024)*2**-15]);
  assert.deepEqual(decoded.animatedBones, [0, 1]);
});

test('ANM reconstructs signed W and ignores the non-payload high flag bit', () => {
  const decoded = parseAnimation(fixture(), [-1, 0]);
  close(decoded.rotations[0], 0.5); close(decoded.rotations[3], Math.sqrt(0.75));
  close(decoded.rotations[5], 0.5); close(decoded.rotations[7], -Math.sqrt(0.75));
  const lowFlags = Buffer.from(fixture()); lowFlags.writeUInt32LE(0x62, 4);
  assert.deepEqual(parseAnimation(lowFlags, [-1, 0]).rotations, decoded.rotations);
});

test('ANM treats every negative-parent bone as a float32 root', () => {
  const secondRoot = {...root, position: [-4.5, 8.25, 2.5]};
  const rotationOnly = {flag: 9, quaternion: [0, 0, 16384]};
  const data = animation([frame([root, secondRoot, child, child, rotationOnly], 70)], 0x1020);
  const decoded = parseAnimation(data, [-1, -1, 0, 1, 1]);
  assert.deepEqual([...decoded.translations.slice(3, 6)], secondRoot.position);
  assert.ok([...decoded.translations.slice(12, 15)].every(Number.isNaN));
  close(decoded.rotations[18], 0.5);
});

test('ANM preserves sparse bone indices and marks unanimated bind components explicitly', () => {
  const data = animation([frame([root, null, child])]);
  const decoded = parseAnimation(data, [-1, 0, 0, 2]);
  assert.deepEqual(decoded.animatedBones, [0, 2]);
  assert.ok([...decoded.rotations.slice(4, 8)].every(Number.isNaN));
  assert.ok([...decoded.rotations.slice(12, 16)].every(Number.isNaN));
  assert.deepEqual([...decoded.translations.slice(6, 9)], [1, -2, (1+1/1024)*2**-15]);
});

test('ANM stores consecutive frames without bleeding into adjacent poses', () => {
  const second = {...root, flag: 6, position: [-1, -2, -3]};
  const data = animation([frame([root, child]), frame([second, {...child, flag: 2}])]);
  const decoded = parseAnimation(data, [-1, 0]);
  assert.deepEqual([...decoded.translations.slice(6, 9)], [-1, -2, -3]);
  assert.ok(decoded.rotations[3] > 0 && decoded.rotations[11] < 0);
  assert.ok(decoded.rotations[7] < 0 && decoded.rotations[15] > 0);
});

test('ANM rejects unsupported IDs and incomplete or empty fixed frame banks', () => {
  const unknown = Buffer.from(fixture()); unknown.writeUInt32LE(0x101);
  assert.throws(() => animationHeader(unknown), /Unsupported ANM model ID/);
  assert.throws(() => animationHeader(Buffer.alloc(3)), /outside/);
  assert.throws(() => animationHeader(fixture().subarray(0, 4)), /fixed frame/);
  assert.throws(() => animationHeader(fixture().subarray(0, 37)), /fixed frame/);
});

test('ANM never borrows bytes from the next frame after a wrong root hierarchy', () => {
  const data = animation([frame([root, child]), frame([root, child])]);
  assert.throws(() => parseAnimation(data, [-1, -1]), /frame 0 exceeds its boundary/);
  assert.throws(() => parseAnimation(data, [-1]), /Unsupported ANM bone/);
});

test('ANM rejects unsupported flag types and non-finite translations', () => {
  const invalidFlag = Buffer.from(fixture()); invalidFlag[4] = 0xe3;
  assert.throws(() => parseAnimation(invalidFlag, [-1, 0]), /flag 3/);
  const infiniteRoot = Buffer.from(fixture()); infiniteRoot.writeFloatLE(Infinity, 8);
  assert.throws(() => parseAnimation(infiniteRoot, [-1, 0]), /Non-finite ANM translation/);

});

test('ANM rejects impossible quaternions but normalizes signed-16 rounding at the unit sphere', () => {
  const invalid = Buffer.from(fixture()); [20, 22, 24].forEach(offset => invalid.writeInt16LE(-32768, offset));
  assert.throws(() => parseAnimation(invalid, [-1, 0]), /Invalid ANM rotation/);
  const rounded = Buffer.from(fixture()); rounded.writeInt16LE(23171, 20); rounded.writeInt16LE(23171, 22); rounded.writeInt16LE(0, 24);
  const decoded = parseAnimation(rounded, [-1, 0]);
  close(Math.hypot(...decoded.rotations.slice(0, 4)), 1);
  assert.equal(decoded.rotations[3], 0);
});

test('ANM rejects temporal bone-presence mask changes with an otherwise valid stride', () => {
  const data = animation([frame([root, child]), frame([root, null, child])]);
  assert.throws(() => parseAnimation(data, [-1, 0, 0]), /changes its animated bone layout/);
});

test('ANM rejects temporal translation-mask changes even with unchanged bone presence', () => {
  const rotation = {flag: 1, quaternion: [0, 0, 0]};
  const first = frame([rotation, child, child]);
  const second = frame([rotation, rotation, child, rotation]);
  assert.throws(() => parseAnimation(animation([first, second]), [-1, 0, 0, 0]), /changes its animated bone layout/);
});
