import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeAdx, parseAdx, parseAix, extractAixAdx, decodeAix, parseSoundBank, decodeSoundBank, waveFile} from '../core/audio.mjs';

function adx() {
  const data = Buffer.alloc(36 + 18 * 2); data.writeUInt16BE(0x8000); data.writeUInt16BE(32, 2); data[4] = 3; data[5] = 18; data[6] = 4; data[7] = 2;
  data.writeUInt32BE(48000, 8); data.writeUInt32BE(32, 12); data.writeUInt16BE(500, 16); data.writeUInt16BE(0x0300, 18); data.write('(c)CRI', 30);
  data[38] = 0x12; data[56] = 0xff; return data;
}

function aix() {
  const audio = adx(), data = Buffer.alloc(96 + 16 + audio.length);
  data.write('AIXF'); data.writeUInt32BE(88, 4); data.writeUInt32BE(0x01000014, 8); data.writeUInt32BE(0x800, 12); data.writeUInt16BE(1, 24);
  data.writeUInt32BE(96, 32); data.writeUInt32BE(16 + audio.length, 36); data.writeUInt32BE(32, 40); data.writeUInt32BE(48000, 44); data[48] = 1;
  data[64] = 1; data.writeUInt32BE(48000, 72); data[76] = 2; data.write('AIXP', 96); data.writeUInt32BE(8 + audio.length, 100); data[105] = 1; data.writeUInt16BE(audio.length, 106); audio.copy(data, 112);
  return data;
}

function bank() {
  const header = Buffer.alloc(128), body = Buffer.alloc(32);
  header.write('IECSsreV'); header.write('IECSdaeH', 16); header.writeUInt32LE(128, 28); header.writeUInt32LE(32, 32); header.writeUInt32LE(80, 48);
  header.write('IECSigaV', 80); header.writeUInt32LE(20, 96); header.writeUInt16LE(22050, 104);
  body[0] = 12; body[2] = 0xf1; body[16] = 12; body[17] = 3;
  return {header, body};
}

test('ADX decodes high nibble first with independent channel history', () => {
  const decoded = decodeAdx(adx()); assert.equal(decoded.samples, 32); assert.equal(decoded.channels, 2);
  assert.equal(decoded.pcm.readInt16LE(0), 1); assert.equal(decoded.pcm.readInt16LE(2), -1);
  assert.notEqual(decoded.pcm.readInt16LE(4), decoded.pcm.readInt16LE(6));
});

test('AIX packet demultiplexing preserves the complete ADX stream', () => {
  const data = aix(); assert.deepEqual(extractAixAdx(data), adx()); assert.deepEqual(decodeAix(data).pcm, decodeAdx(adx()).pcm);
  assert.equal(parseAix(data).layers.length, 1); assert.throws(() => extractAixAdx(data, 1), /Unknown/);
  const malformed = Buffer.from(data); malformed.writeUInt32BE(100000, 100); assert.throws(() => extractAixAdx(malformed), /packet size/);
});

test('HD bank uses its companion BD boundaries and PS ADPCM low nibble first', () => {
  const {header, body} = bank(); assert.equal(parseSoundBank(header, body).samples.length, 1);
  const decoded = decodeSoundBank(header, body); assert.equal(decoded.samples, 56); assert.equal(decoded.pcm.readInt16LE(0), 1); assert.equal(decoded.pcm.readInt16LE(2), -1);
  assert.throws(() => parseSoundBank(header, body.subarray(0, 16)), /sizes/);
  body[17] = 7; body[18] = 0x77; assert.equal(decodeSoundBank(header, body).pcm.readInt16LE(28 * 2), 0);
  body[0] = 0x50; assert.throws(() => decodeSoundBank(header, body), /PS ADPCM/);
});

test('audio parsers reject truncated payloads before decoding', () => {
  assert.throws(() => parseAdx(adx().subarray(0, 45)), /outside/);
  const invalid = adx(); invalid[19] = 8; assert.throws(() => parseAdx(invalid), /encrypted/);
  assert.throws(() => parseAix(Buffer.alloc(64)), /AIX/);
});

test('WAV export describes the exact PCM sample layout', () => {
  const pcm = Buffer.from([1, 0, 255, 255]); const wav = waveFile(pcm, 48000, 2);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF'); assert.equal(wav.readUInt32LE(24), 48000); assert.equal(wav.readUInt16LE(22), 2);
  assert.equal(wav.readUInt32LE(40), 4); assert.deepEqual(wav.subarray(44), pcm);
});
