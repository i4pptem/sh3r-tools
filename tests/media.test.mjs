import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeMovie, encodeMovie} from '../core/media.mjs';

function header() {
  const data = Buffer.alloc(0x8000); let state = 0x12345678;
  data.writeUInt32LE(state);
  for (let i = 1; i < 8192; i++) {state = (Math.imul(state, 0x5d588b65) + 1) >>> 0; data.writeUInt32LE(state, i * 4);}
  return data;
}

test('movie cipher repeats its key schedule across multiple blocks and preserves wrapper bytes', () => {
  const mpeg = Buffer.alloc(0x40000 + 12); mpeg.writeUInt32BE(0x000001ba);
  for (let i = 4; i < mpeg.length; i++) mpeg[i] = (i * 31 + 17) & 255;
  const original = header(), encoded = encodeMovie(mpeg, original);
  assert.deepEqual(encoded.subarray(0, 0x8000), original);
  assert.deepEqual(decodeMovie(encoded), mpeg);
  assert.deepEqual(encodeMovie(decodeMovie(encoded), encoded), encoded);
});

test('movie encryption pads the last word without losing MPEG bytes', () => {
  const mpeg = Buffer.alloc(15); mpeg.writeUInt32BE(0x000001ba);
  const decoded = decodeMovie(encodeMovie(mpeg, header()));
  assert.deepEqual(decoded.subarray(0, 15), mpeg); assert.equal(decoded[15], 255);
});

test('movie decryption rejects corrupt wrappers and wrong payloads', () => {
  const corrupt = header(); corrupt[40] ^= 1;
  assert.throws(() => decodeMovie(corrupt), /checksum/);
  assert.throws(() => decodeMovie(Buffer.alloc(33)), /size/);
  assert.throws(() => encodeMovie(Buffer.alloc(100), header()), /program stream/);
});
