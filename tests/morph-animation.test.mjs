import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMorphAnimations} from '../core/morph-animation.mjs';
import {sampleMorphAnimation} from '../core/morph-sampling.mjs';

function curve(frameCount, tracks) {
  const buffer = Buffer.alloc(16 + tracks.length * 4 + tracks.reduce((sum, track) => sum + 2 + track.length * 4, 0));
  buffer.writeUInt32LE(0x29843918); buffer.writeUInt16LE(1, 4);
  buffer.writeUInt16LE(tracks.length, 8); buffer.writeUInt16LE(frameCount, 12);
  let cursor = 16 + tracks.length * 4;
  tracks.forEach((track, index) => {
    buffer.writeUInt32LE(cursor, 16 + index * 4); buffer.writeUInt16LE(track.length, cursor); cursor += 2;
    for (const [frame, weight] of track) {buffer.writeUInt16LE(frame, cursor); buffer.writeInt16LE(weight, cursor + 2); cursor += 4;}
  });
  return buffer;
}

function pack(segments, modelId = 0x100) {
  const size = 12 + segments.length * 16 + segments.reduce((sum, segment) => sum + (segment.data?.length ?? 0), 0);
  const buffer = Buffer.alloc(32 + size);
  buffer.writeUInt32LE(0x12345678); buffer.writeUInt32LE(1, 4); buffer.writeUInt32LE(1, 8);
  buffer.writeUInt32LE(32, 16); buffer.writeUInt32LE(1, 20); buffer.writeUInt32LE(size, 24);
  buffer.writeUInt32LE(modelId, 32); buffer.writeUInt32LE(segments.length, 40);
  let cursor = 12 + segments.length * 16;
  segments.forEach(({start, end, data}, index) => {
    const p = 44 + index * 16;
    buffer.writeUInt32LE(start, p); buffer.writeUInt32LE(end, p + 4);
    if (data) {buffer.writeUInt32LE(data.length, p + 8); buffer.writeUInt32LE(cursor, p + 12); data.copy(buffer, 32 + cursor); cursor += data.length;}
  });
  return buffer;
}

test('native morph tracks preserve signed weights and zero/constant defaults', () => {
  const [clip] = parseMorphAnimations(curve(11, [[], [[4, 2048]], [[0, -4096], [10, 4096]]]));
  assert.equal(clip.modelId, null); assert.equal(clip.fpsSource, 'preview-default');
  assert.deepEqual(sampleMorphAnimation(clip, 2.5), [0, 0.5, -0.5]);
  assert.deepEqual(sampleMorphAnimation(clip, 10.75), [0, 0.5, 1]);
  assert.deepEqual(sampleMorphAnimation(clip, -1), [0, 0.5, -1]);
  assert.throws(() => sampleMorphAnimation(clip, NaN), /finite/);
});

test('PACK playback uses inclusive ends, ceil selection and retains the final payload', () => {
  const [clip] = parseMorphAnimations(pack([
    {start: 0, end: 10, data: curve(10, [[[0, 0], [9, 4096]]])},
    {start: 10, end: 12},
    {start: 12, end: 17, data: curve(9, [[[0, -4096], [8, 4096]]])},
  ]));
  assert.equal(clip.modelId, 0x100); assert.equal(clip.frameCount, 21);
  assert.equal(clip.segments[2].frameCount, 9);
  assert.deepEqual(sampleMorphAnimation(clip, 9.9), [1]);
  assert.deepEqual(sampleMorphAnimation(clip, 10), [1]);
  assert.deepEqual(sampleMorphAnimation(clip, 12), [0]);
  assert.deepEqual(sampleMorphAnimation(clip, 10.1), [0]);
  assert.deepEqual(sampleMorphAnimation(clip, 12.5), [-.875]);
  assert.deepEqual(sampleMorphAnimation(clip, 16), [0]);
  assert.deepEqual(sampleMorphAnimation(clip, 100), [1]);
});

test('PACK gaps select the upcoming payload before its start and clamp local time', () => {
  const [clip] = parseMorphAnimations(pack([
    {start: 1, end: 3, data: curve(2, [[[0, 4096], [1, 4096]]])},
    {start: 5, end: 7, data: curve(2, [[[0, 2048], [1, 2048]]])},
  ]));
  assert.deepEqual(sampleMorphAnimation(clip, 0), [1]);
  assert.deepEqual(sampleMorphAnimation(clip, 4), [0.5]);
  assert.deepEqual(sampleMorphAnimation(clip, 5), [0.5]);
});

test('unrecognized asset formats have no morph clips', () => {
  assert.deepEqual(parseMorphAnimations(Buffer.alloc(0)), []);
  assert.deepEqual(parseMorphAnimations(Buffer.alloc(80)), []);
});

test('alternate cluster signature is supported and unknown revisions are rejected', () => {
  const buffer = curve(1, [[[0, 1024]]]); buffer.writeUInt32LE(0x29853918);
  assert.equal(parseMorphAnimations(buffer).length, 1);
  buffer.writeUInt16LE(0, 4); assert.throws(() => parseMorphAnimations(buffer), /revision 1/);
});

test('invalid morph pointers, key bounds, ordering and coverage are rejected', () => {
  const buffer = curve(3, [[[0, 0], [2, 4096]]]);
  const pointer = Buffer.from(buffer); pointer.writeUInt32LE(0xfffffffc, 16);
  assert.throws(() => parseMorphAnimations(pointer), /outside/);
  const truncated = buffer.subarray(0, buffer.length - 1);
  assert.throws(() => parseMorphAnimations(truncated), /outside/);
  assert.throws(() => parseMorphAnimations(curve(3, [[[0, 0], [0, 1], [2, 4096]]])), /increase/);
  assert.throws(() => parseMorphAnimations(curve(3, [[[0, 0], [3, 4096]]])), /increase/);
  assert.throws(() => parseMorphAnimations(curve(3, [[[1, 0], [2, 4096]]])), /cover/);
});

test('PACK boundaries constrain embedded curves and reject inconsistent target counts', () => {
  const buffer = pack([{start: 0, end: 2, data: curve(2, [[[0, 0], [1, 4096]]])}]);
  buffer.writeUInt32LE(buffer.readUInt32LE(52) - 1, 52);
  assert.throws(() => parseMorphAnimations(buffer), /outside/);
  assert.throws(() => parseMorphAnimations(pack([
    {start: 0, end: 2, data: curve(2, [[]])}, {start: 2, end: 4, data: curve(2, [[], []])},
  ])), /target count/);
  assert.throws(() => parseMorphAnimations(pack([
    {start: 0, end: 3, data: curve(3, [[]])}, {start: 2, end: 4, data: curve(2, [[]])},
  ])), /overlap/);
});
