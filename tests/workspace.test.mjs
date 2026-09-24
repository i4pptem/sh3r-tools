import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {gzipSync} from 'node:zlib';
import {Workbench} from '../core/workbench.mjs';
import {openArchive, entryBytes} from '../core/archives.mjs';
import {encodeMovie} from '../core/media.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sh3tools-workspace-')), data = path.join(root, 'data');
  t.after(() => {assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(root, {recursive: true, force: true});});
  const write = (name, bytes) => {const file = path.join(data, name); fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, bytes);};
  const header = Buffer.alloc(16), count = Buffer.alloc(12), cluster = Buffer.alloc(12), name = Buffer.from('data/test.bin\0'), entry = Buffer.alloc(8 + name.length);
  header.writeUInt32LE(0x20030417); count.writeUInt16LE(1); count.writeUInt16LE(12, 2); count.writeUInt32LE(1, 4); count.writeUInt32LE(1, 8);
  cluster.writeUInt16LE(2); cluster.writeUInt16LE(12, 2); cluster.writeUInt32LE(1, 4); cluster.write('chr', 8);
  entry.writeUInt16LE(3); entry.writeUInt16LE(entry.length, 2); name.copy(entry, 8); write('arc.arc', gzipSync(Buffer.concat([header, count, cluster, entry])));
  for (const name of ['chr.arc', 'sound/sd.afs', 'sound/a/same.afs', 'sound/b/same.afs']) {
    const bytes = Buffer.alloc(128), arc = name.endsWith('.arc'); bytes.writeUInt32LE(arc ? 0x20030507 : 0x00534641); bytes.writeUInt32LE(1, 4);
    bytes.writeUInt32LE(64, arc ? 16 : 8); bytes.writeUInt32LE(8, arc ? 24 : 12); if (arc) bytes.writeUInt32LE(8, 28);
    bytes.write('original', 64); write(name, bytes);
  }
  const wrapper = Buffer.alloc(0x8000); let key = 1234; wrapper.writeUInt32LE(key);
  for (let i = 1; i < 8192; i++) {key = (Math.imul(key, 0x5d588b65) + 1) >>> 0; wrapper.writeUInt32LE(key, i * 4);}
  const mpeg = Buffer.alloc(16); mpeg.writeUInt32BE(0x000001ba); write('movie/test.000', encodeMovie(mpeg, wrapper));
  write('pic/a/same.bmp', Buffer.from('picture A')); write('pic/b/same.bmp', Buffer.from('picture B')); write('sound/notes.txt', Buffer.from('sound notes'));
  write('backup_arc/broken.afs', Buffer.from('ignored'));
  return {root, data, write};
}

test('data folder, game root and master catalog discover one scoped workspace', t => {
  const f = fixture(t), workbench = new Workbench(), snapshots = [f.root, f.data, path.join(f.data, 'arc.arc')].map(input => workbench.open(input));
  for (const snapshot of snapshots) {
    assert.equal(snapshot.dataRoot, f.data);
    assert.deepEqual(snapshot.entries.map(e => [e.name, e.section]), snapshots[0].entries.map(e => [e.name, e.section]));
    assert.deepEqual(Object.fromEntries(['assets', 'movie', 'pic', 'sound'].map(section => [section, snapshot.entries.filter(e => e.section === section).length])), {assets: 1, movie: 1, pic: 2, sound: 4});
    assert.equal(snapshot.archives.filter(a => a.name === 'sd.afs').length, 1);
    assert.equal(snapshot.archives.filter(a => a.name.includes('same.afs')).length, 2);
  }
  assert.throws(() => workbench.open(path.join(f.root, 'missing')), /ENOENT/);
  assert.deepEqual(workbench.snapshot(), snapshots[2]);
});

test('mixed projects restore every section and preserve nested output paths', t => {
  const f = fixture(t), workbench = new Workbench(), snapshot = workbench.open(f.data), expected = new Map();
  for (const entry of snapshot.entries) {
    const source = workbench.bytes(entry.key), changed = Buffer.from(source);
    if (entry.extension === '000') {const mpeg = Buffer.alloc(16, 3); mpeg.writeUInt32BE(0x000001ba); expected.set(entry.key, encodeMovie(mpeg, source));}
    else {changed[changed.length - 1] ^= 1; expected.set(entry.key, changed);}
    workbench.stage(entry.key, expected.get(entry.key), 'Test ' + entry.section);
  }
  const project = path.join(f.root, 'mixed.sh3project'); workbench.saveProject(project);
  const restored = new Workbench(); assert.equal(restored.loadProject(project).changes.length, expected.size);
  const output = path.join(f.root, 'build'); restored.build(output);
  for (const entry of snapshot.entries) {
    const {archive} = restored.get(entry.key);
    const bytes = archive.format === 'FOLDER' ? fs.readFileSync(path.join(output, entry.name)) : entryBytes(openArchive(path.join(output, 'data', archive.relativePath)), entry.index);
    assert.deepEqual(bytes, expected.get(entry.key));
    assert.notDeepEqual(restored.originalBytes(archive, restored.get(entry.key).entry), expected.get(entry.key));
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'))).verified, true);
});

test('v1 archive projects migrate by source identity into expanded workspaces', t => {
  const f = fixture(t), original = new Workbench(); original.open(f.data);
  original.stage('1:0', Buffer.from('modified'), 'Old sound replacement');
  const project = path.join(f.root, 'old.sh3project'); original.saveProject(project);
  const doc = JSON.parse(fs.readFileSync(project)); doc.format = 'sh3tools-project-v1'; doc.sources = doc.sources.slice(0, 2).reverse(); doc.changes[0].key = '0:0'; fs.writeFileSync(project, JSON.stringify(doc));
  const restored = new Workbench(), snapshot = restored.loadProject(project);
  assert.equal(snapshot.changes.length, 1); assert.deepEqual(restored.bytes('1:0'), Buffer.from('modified'));
  assert.ok(snapshot.entries.some(e => e.section === 'movie'));
});

test('missing optional folders do not prevent catalog opening', t => {
  const f = fixture(t);
  for (const name of ['movie', 'pic', 'sound']) {const folder = path.resolve(f.data, name); assert.ok(folder.startsWith(path.resolve(f.data) + path.sep)); fs.rmSync(folder, {recursive: true});}
  const snapshot = new Workbench().open(f.data); assert.equal(snapshot.entries.length, 1); assert.equal(snapshot.entries[0].section, 'assets');
});

test('loose files changed outside the app are rejected during build', t => {
  const f = fixture(t), workbench = new Workbench(), entry = workbench.open(f.data).entries.find(e => e.name === 'data/pic/a/same.bmp');
  workbench.stage(entry.key, Buffer.from('replacement'), 'Picture'); f.write('pic/a/same.bmp', Buffer.from('externally changed original'));
  assert.throws(() => workbench.build(path.join(f.root, 'build')), /changed on disk/);
});
