import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openArchive, entryBytes, buildArchive} from '../core/archives.mjs';
import {writeCompactArchive, readVirtualAfs, writeCompactManifest} from '../core/compact-overlay.mjs';
import {planAfsLayout, validateAfsReplacement} from '../core/afs-layout.mjs';

function fixture(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sh3-afs-native-'));
  t.after(() => fs.rmSync(folder, {recursive: true, force: true}));
  const sizes = [9001, 2048, 2049, 0, 70], bytes = Buffer.alloc(24576);
  bytes.write('AFS'); bytes.writeUInt32LE(sizes.length, 4);
  let cursor = 4096;
  for (const [index, size] of sizes.entries()) {
    bytes.writeUInt32LE(cursor, 8 + index * 8); bytes.writeUInt32LE(size, 12 + index * 8);
    bytes.fill(0x40 + index, cursor, cursor + size); cursor += Math.ceil(size / 2048) * 2048;
  }
  bytes.writeUInt32LE(cursor, 48); bytes.writeUInt32LE(240, 52);
  for (let index = 0; index < sizes.length; index++) bytes.write(`sample${index}.wav`, cursor + index * 48);
  bytes.write('retained opaque trailer', cursor + 300);
  const file = path.join(folder, 'test.afs'); fs.writeFileSync(file, bytes);
  const archive = openArchive(file); archive.relativePath = 'sound/test.afs';
  return {folder, archive, bytes};
}

for (const index of [0, 1, 4]) for (const size of [1, 2048, 2049, 12000]) {
  test(`AFS native sector lookup and compact bytes agree after replacing ${index} with ${size} bytes`, t => {
    const {folder, archive, bytes} = fixture(t), replacements = new Map([[index, Buffer.alloc(size, 0x93)]]);
    const output = path.join(folder, 'built.afs'); buildArchive(archive, replacements, output);
    const physical = fs.readFileSync(output), parsed = openArchive(output);
    const report = writeCompactArchive(archive, replacements, path.join(folder, 'mod'));
    assert.deepEqual(readVirtualAfs(bytes, report, replacements, 0, report.virtualSize), physical);
    let nativeOffset = physical.readUInt32LE(8);
    for (const entry of parsed.entries) {
      // CRI ignores offset fields after entry zero and advances by declared sector counts.
      const length = physical.readUInt32LE(12 + entry.index * 8);
      assert.equal(entry.offset, nativeOffset);
      const expected = replacements.get(entry.index) ?? entryBytes(archive, entry.index);
      assert.deepEqual(physical.subarray(nativeOffset, nativeOffset + length), expected);
      assert.equal(entry.name, archive.entries[entry.index].name);
      nativeOffset += Math.ceil(length / 2048) * 2048;
    }
    assert.equal(physical.length % 2048, 0);
    assert.ok(physical.includes(Buffer.from('retained opaque trailer')));
    for (const offset of [0, 9, 4090, 8190, physical.length - 2, physical.length + 2]) {
      assert.deepEqual(readVirtualAfs(bytes, report, replacements, offset, 4096), physical.subarray(offset, offset + 4096));
    }
    assert.deepEqual(fs.readFileSync(archive.file), bytes);
  });
}

test('AFS edits follow entry order across repeated builds regardless of selection order', t => {
  const {folder, archive} = fixture(t), first = path.join(folder, 'first.afs'), second = path.join(folder, 'second.afs');
  buildArchive(archive, new Map([[4, Buffer.alloc(9001, 0x71)], [0, Buffer.alloc(2048, 0x72)]]), first);
  buildArchive(openArchive(first), new Map([[1, Buffer.alloc(12000, 0x73)]]), second);
  const rebuilt = openArchive(second);
  assert.deepEqual(entryBytes(rebuilt, 0), Buffer.alloc(2048, 0x72));
  assert.deepEqual(entryBytes(rebuilt, 1), Buffer.alloc(12000, 0x73));
  assert.deepEqual(entryBytes(rebuilt, 4), Buffer.alloc(9001, 0x71));
  assert.deepEqual(entryBytes(rebuilt, 2), entryBytes(archive, 2));
});

test('compact AFS v2 stores layout metadata and replacements without unchanged payloads', t => {
  const {folder, archive, bytes} = fixture(t), payloads = new Map([[0, Buffer.alloc(10, 0x86)]]), mod = path.join(folder, 'mod');
  const report = writeCompactArchive(archive, payloads, mod); writeCompactManifest(mod, [report]);
  assert.ok(report.virtualSize < bytes.length);
  const metadata = fs.readFileSync(path.join(mod, 'SH3Tools.assets'));
  assert.equal(metadata.toString('ascii', 0, 8), 'SH3DATA2'); assert.equal(metadata.readUInt32LE(8), 2);
  assert.ok(!metadata.includes(Buffer.alloc(100, 0x40)));
  assert.ok(!fs.existsSync(path.join(mod, 'data/sound/test.afs')));
  assert.equal(fs.readFileSync(path.join(mod, report.changes[0].file)).length, 10);
});

test('AFS planning rejects unknown indices and sector counts that the game cannot store', t => {
  const {archive} = fixture(t);
  assert.throws(() => planAfsLayout(archive, new Map([[99, Buffer.from('x')]])), /Unknown/);
  assert.throws(() => planAfsLayout(archive, new Map([[0, {length: 128 * 1024 * 1024}]])), /65535 sectors/);
});

test('SD WAV capacity is checked before staging without restricting streamed AIX', t => {
  const {archive} = fixture(t); archive.name = 'sd.afs';
  validateAfsReplacement(archive, 0, {length: 0xee800});
  assert.throws(() => validateAfsReplacement(archive, 0, {length: 0xee801}), /sound-effect buffer/);
  archive.entries[0].detectedFormat = 'aix';
  validateAfsReplacement(archive, 0, {length: 2 * 1024 * 1024});
});
