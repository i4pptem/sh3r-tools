import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Workbench} from '../core/workbench.mjs';
import {entryBytes} from '../core/archives.mjs';

function archive(file, records) {
  const bytes = Buffer.alloc(256 + records.reduce((n, item) => n + item.data.length + 16, 0));
  bytes.writeUInt32LE(0x20030507); bytes.writeUInt32LE(records.length, 4);
  let offset = 256;
  records.forEach((item, i) => {
    const p = 16 + i * 16;
    bytes.writeUInt32LE(offset, p); bytes.writeUInt32LE(item.id, p + 4);
    bytes.writeUInt32LE(item.data.length, p + 8); bytes.writeUInt32LE(item.data.length, p + 12);
    item.data.copy(bytes, offset); offset += item.data.length + 16;
  });
  fs.writeFileSync(file, bytes);
}
const record = (id, text) => ({id, data: Buffer.from(text)});
function fixture(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sh3-source-reload-')), file = path.join(folder, 'test.arc');
  t.after(() => fs.rmSync(folder, {recursive: true, force: true}));
  archive(file, [record(10, 'original A'), record(11, 'original B'), record(12, 'original C')]);
  const work = new Workbench(); work.open(file); return {folder, file, work};
}

test('reloading relocated ARC block tables preserves catalog identities and clears installed edits', t => {
  const {work, file, folder} = fixture(t);
  work.stage('0:0', Buffer.from('edited A'), 'A'); work.stage('0:1', Buffer.from('edited B'), 'B');
  const oldMotion = work.motion, oldTextureRevision = work.textureLibrary.revision;
  archive(file, [record(80, 'original A'), record(80, 'edited B'), record(80, 'longer C after external edit')]);
  assert.throws(() => entryBytes(work.archives[0], 0), {code: 'SOURCE_CHANGED'});
  assert.throws(() => work.saveProject(path.join(folder, 'stale.sh3project')), {code: 'SOURCE_CHANGED'});
  assert.equal(fs.existsSync(path.join(folder, 'stale.sh3project')), false);
  const preview = work.prepareSourceReload(); assert.equal(preview.kept, 1); assert.equal(preview.installed.length, 1); assert.equal(preview.conflicts.length, 0);
  // Preparing a reload never changes the active workspace.
  assert.equal(work.changes.size, 2); assert.equal(work.archives[0].entries[0].chunkTableOffset, 10);
  const result = work.reloadSources(preview.token);
  assert.equal(result.keyMap['0:0'], '0:0'); assert.equal(work.changes.size, 1);
  assert.equal(work.bytes('0:0').toString(), 'edited A'); assert.equal(work.bytes('0:1').toString(), 'edited B');
  assert.notEqual(work.motion, oldMotion); assert.ok(work.textureLibrary.revision > oldTextureRevision);
  assert.deepEqual(work.sourceChanges(), []);
  const saved = path.join(folder, 'fresh.sh3project'); work.saveProject(saved);
  const restored = new Workbench(); restored.loadProject(saved); assert.equal(restored.bytes('0:0').toString(), 'edited A');
});

test('conflicting edits require explicit discard and unrelated edits survive', t => {
  const {work, file} = fixture(t);
  work.stage('0:0', Buffer.from('my A'), 'A'); work.stage('0:1', Buffer.from('my B'), 'B');
  archive(file, [record(10, 'someone else A'), record(11, 'original B'), record(12, 'original C')]);
  const plan = work.prepareSourceReload(); assert.equal(plan.conflicts.length, 1); assert.equal(plan.kept, 1);
  assert.throws(() => work.reloadSources(plan.token), /Review conflicting/); assert.equal(work.changes.size, 2);
  const snapshot = work.reloadSources(plan.token, true);
  assert.equal(snapshot.reloadSummary.discarded, 1); assert.equal(work.bytes('0:0').toString(), 'someone else A');
  assert.equal(work.bytes('0:1').toString(), 'my B');
});

test('source changes while the reload dialog is open invalidate its plan atomically', t => {
  const {work, file} = fixture(t); work.stage('0:1', Buffer.from('my B'), 'B');
  const plan = work.prepareSourceReload(); archive(file, [record(10, 'updated A'), record(11, 'new B'), record(12, 'C')]);
  assert.throws(() => work.reloadSources(plan.token), {code: 'SOURCE_CHANGED'});
  assert.equal(work.changes.size, 1); assert.equal(work.bytes('0:1').toString(), 'my B');
});

test('changed ARC record order conflicts instead of treating block offsets as identities', t => {
  const {work, file} = fixture(t); work.stage('0:0', Buffer.from('A'), 'A'); work.stage('0:1', Buffer.from('B'), 'B');
  archive(file, [record(11, 'original B'), record(11, 'different payload'), record(12, 'original C')]);
  const plan = work.prepareSourceReload(); assert.equal(plan.conflicts.length, 2); assert.equal(plan.kept, 0);
  assert.throws(() => work.reloadSources(plan.token), /Review conflicting/);
});

test('an invalid source replacement leaves the complete old workspace intact', t => {
  const {work, file} = fixture(t); work.stage('0:0', Buffer.from('keep'), 'A'); const archives = work.archives;
  fs.writeFileSync(file, 'invalid'); assert.throws(() => work.prepareSourceReload());
  assert.equal(work.archives, archives); assert.equal(work.changes.size, 1);
});

test('loose files keep identity by path when a new filename changes sorted indices', t => {
  const {folder} = fixture(t), sound = path.join(folder, 'sound'); fs.mkdirSync(sound);
  fs.writeFileSync(path.join(sound, 'b.txt'), 'original'); const work = new Workbench(); work.open(sound);
  work.stage('0:0', Buffer.from('replacement'), 'edit'); fs.writeFileSync(path.join(sound, 'a.txt'), 'new file');
  const plan = work.prepareSourceReload(), result = work.reloadSources(plan.token);
  assert.equal(result.keyMap['0:0'], '0:1'); assert.equal(work.bytes('0:1').toString(), 'replacement');
  assert.equal(work.bytes('0:0').toString(), 'new file');
});
