import test from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {readTextures, replaceTexture} from '../core/textures.mjs';
function bgra() {
  const b = Buffer.alloc(160); b.writeUInt32LE(0xffffffff); b.writeUInt16LE(4, 8); b.writeUInt16LE(4, 10); b.writeUInt32LE(64, 16); b.writeUInt32LE(b.length, 20); b.writeUInt16LE(0x9999, 30);
  for (let i = 0; i < 16; i++) {b[96 + i * 4] = 10; b[97 + i * 4] = 20; b[98 + i * 4] = 30; b[99 + i * 4] = 255;} return b;
}
test('BGRA channels and no-op preserve source', () => {const b = bgra(), t = readTextures(b)[0]; assert.deepEqual([...t.rgba.subarray(0, 4)], [30, 20, 10, 255]); assert.deepEqual(replaceTexture(b, 0, t.png), b);});
test('PNG import changes only pixel data', () => {const b = bgra(), image = PNG.sync.read(readTextures(b)[0].png); image.data[0] = 200; const out = replaceTexture(b, 0, PNG.sync.write(image)); assert.equal(out[98], 200); assert.deepEqual(out.subarray(0, 96), b.subarray(0, 96));});
test('PNG dimension changes are rejected', () => {const png = PNG.sync.write({width: 2, height: 2, data: Buffer.alloc(16)}); assert.throws(() => replaceTexture(bgra(), 0, png), /dimensions/);});
test('Record size is not a ushort pixel offset', () => assert.equal(readTextures(bgra())[0].layout.pixelOffset, 96));
test('Malformed and unknown encoding fail', () => {const b = bgra(); b.writeUInt32LE(0x7fffffff, 20); assert.throws(() => readTextures(b)); b.writeUInt32LE(100, 20); b.writeUInt32LE(8, 16); assert.throws(() => readTextures(b), /Unsupported swizzled texture dimensions/);});
function pic() {const b = Buffer.alloc(114); b.writeUInt32BE(0x5380f634); b.write('PICT', 88); b.writeUInt16BE(2, 92); b.writeUInt16BE(1, 94); b[105] = 8; b[107] = 0xe0; Buffer.from([1, 2, 3, 4, 5, 6]).copy(b, 108); return b;}
test('PIC raw decoding and PNG replacement', () => {const b = pic(), t = readTextures(b)[0]; assert.deepEqual([...t.rgba], [1, 2, 3, 255, 4, 5, 6, 255]); const img = PNG.sync.read(t.png); img.data[1] = 100; assert.equal(readTextures(replaceTexture(b, 0, PNG.sync.write(img)))[0].rgba[1], 100);});
test('PIC run cannot cross a row', () => {const b = pic(); b[106] = 2; b[108] = 140; assert.throws(() => readTextures(b), /scanline/);});
