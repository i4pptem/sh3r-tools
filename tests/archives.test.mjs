import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {openArchive, parseCatalog, entryBytes, buildArchive} from '../core/archives.mjs';
import {safeOutput} from '../core/binary.mjs';
function fixture(t, format = 'ARC') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh3tools-test-')); t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const bytes = Buffer.alloc(1024, 0x6a), file = path.join(dir, `test.${format.toLowerCase()}`);
  bytes.writeUInt32LE(format === 'ARC' ? 0x20030507 : 0x00534641, 0); bytes.writeUInt32LE(2, 4);
  if (format === 'ARC') {
    bytes.writeUInt32LE(200, 8); bytes.writeUInt32LE(0, 12);
    for (let i = 0; i < 2; i++) {const p = 16 + i * 16; bytes.writeUInt32LE(256 + i * 128, p); bytes.writeUInt32LE(400 + i, p + 4); bytes.writeUInt32LE(64, p + 8); bytes.writeUInt32LE(64, p + 12);}
  } else {
    for (let i = 0; i < 2; i++) {bytes.writeUInt32LE(256 + i * 128, 8 + i * 8); bytes.writeUInt32LE(64, 12 + i * 8);}
    bytes.writeUInt32LE(512, 24); bytes.writeUInt32LE(96, 28); bytes.fill(0, 512, 608); bytes.write('same.wav', 512); bytes.write('same.wav', 560);
  }
  Buffer.from('original first payload').copy(bytes, 256); Buffer.from('second untouched payload').copy(bytes, 384);
  fs.writeFileSync(file, bytes); return {dir, file, bytes};
}
for (const format of ['ARC', 'AFS']) {
  test(`${format}: no-op build is byte-identical`, t => {
    const f = fixture(t, format), a = openArchive(f.file), out = path.join(f.dir, 'copy.bin'); buildArchive(a, new Map(), out); assert.deepEqual(fs.readFileSync(out), f.bytes);
  });
  test(`${format}: larger replacement preserves original, untouched entry and opaque bytes`, t => {
    const f = fixture(t, format), a = openArchive(f.file), out = path.join(f.dir, 'patched.bin'), replacement = Buffer.alloc(2300, 0x42);
    buildArchive(a, new Map([[0, replacement]]), out); const b = openArchive(out);
    assert.deepEqual(entryBytes(b, 0), replacement); assert.deepEqual(entryBytes(b, 1), entryBytes(a, 1)); assert.deepEqual(fs.readFileSync(f.file), f.bytes);
    assert.deepEqual(fs.readFileSync(out).subarray(48, 256), f.bytes.subarray(48, 256)); assert.equal(b.entries[0].fileId, a.entries[0].fileId);
    if (format === 'AFS') assert.equal(b.entries[0].offset % 2048, 0);
  });
  test(`${format}: overlapping entries are rejected`, t => {const f = fixture(t, format), b = Buffer.from(f.bytes); b.writeUInt32LE(260, format === 'ARC' ? 32 : 16); fs.writeFileSync(f.file, b); assert.throws(() => openArchive(f.file), /Overlapping/);});
}
test('Changed sources and existing output cannot be built', t => {
  const f = fixture(t), a = openArchive(f.file); assert.throws(() => buildArchive(a, new Map(), f.file), /already exists/);
  fs.appendFileSync(f.file, 'x'); assert.throws(() => buildArchive(a, new Map(), path.join(f.dir, 'new.arc')), /changed/);
});
test('Truncated entry is rejected', t => {const f = fixture(t), b = Buffer.from(f.bytes); b.writeUInt32LE(2000, 24); fs.writeFileSync(f.file, b); assert.throws(() => openArchive(f.file), /outside/);});
test('Catalog preserves cluster indices and names', t => {
  const f = fixture(t), data = Buffer.alloc(16); data.writeUInt32LE(0x20030417);
  const count = Buffer.alloc(12); count.writeUInt16LE(1); count.writeUInt16LE(12, 2); count.writeUInt32LE(1, 4); count.writeUInt32LE(1, 8);
  const cluster = Buffer.alloc(12); cluster.writeUInt16LE(2); cluster.writeUInt16LE(12, 2); cluster.writeUInt32LE(1, 4); cluster.write('chr', 8);
  const name = Buffer.from('data/pcchr/example.mdl\0'), entry = Buffer.alloc(8 + name.length); entry.writeUInt16LE(3); entry.writeUInt16LE(entry.length, 2); name.copy(entry, 8);
  const file = path.join(f.dir, 'arc.arc'); fs.writeFileSync(file, gzipSync(Buffer.concat([data, count, cluster, entry])));
  const catalog = parseCatalog(file); assert.equal(catalog.clusters[0].name, 'chr'); assert.equal(catalog.files[0].name, 'data/pcchr/example.mdl');
});
for (const name of ['../escape', 'a/../../escape', 'C:/Windows/file', '/absolute', 'a\\..\\x', 'CON.txt', 'foo:bar', 'a./b']) test(`Reject export path ${name}`, () => assert.throws(() => safeOutput(path.resolve('test-output'), name)));
