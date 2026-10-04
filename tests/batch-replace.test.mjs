import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PNG} from 'pngjs';
import {Workbench} from '../core/workbench.mjs';
import {looseFolder} from '../core/loose-files.mjs';
import {openArchive} from '../core/archives.mjs';
import {waveFile} from '../core/audio.mjs';
import {readTextures} from '../core/textures.mjs';
import {textureFixture, mapFixture} from './helpers/map-fixture.mjs';

const wav = value => waveFile(Buffer.alloc(40, value), 22050, 1);
function png(value, width = 2, height = 2) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([value, 40, 80, 255], i);
  return PNG.sync.write({width, height, data});
}
function workspace(t, files) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sh3-batch-'));
  t.after(() => {assert.ok(folder.startsWith(path.join(os.tmpdir(), 'sh3-batch-'))); fs.rmSync(folder, {recursive: true, force: true});});
  const source = path.join(folder, 'source'), incoming = path.join(folder, 'incoming'); fs.mkdirSync(source); fs.mkdirSync(incoming);
  for (const [name, data] of Object.entries(files)) fs.writeFileSync(path.join(source, name), data);
  const wb = new Workbench(); wb.archives = [looseFolder(source, 'tmp')];
  const put = (name, data) => {const file = path.join(incoming, name); fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, data); return file;};
  return {wb, source, incoming, put, folder};
}
const select = plan => plan.rows.filter(row => row.status === 'ready').map(row => row.id);
function model() {
  const prefix = Buffer.alloc(256); prefix.writeUInt32LE(1, 8); prefix.writeUInt32LE(256, 12); prefix.writeUInt32LE(256, 16); prefix.writeUInt32LE(32, 20); prefix.writeUInt32LE(0xffff0003, 32);
  const single = textureFixture(), textures = Buffer.concat([single, single.subarray(32)]); textures.writeUInt32LE(textures.length, 12); textures.writeUInt32LE(2, 20);
  return Buffer.concat([prefix, textures]);
}
function afs(file, names) {
  const data = Buffer.alloc((names.length + 2) * 2048), attributes = (names.length + 1) * 2048; data.write('AFS'); data.writeUInt32LE(names.length, 4);
  names.forEach((name, index) => {const bytes = wav(0); data.writeUInt32LE((index + 1) * 2048, 8 + index * 8); data.writeUInt32LE(bytes.length, 12 + index * 8); bytes.copy(data, (index + 1) * 2048); data.write(name, attributes + index * 48);});
  data.writeUInt32LE(attributes, 8 + names.length * 8); data.writeUInt32LE(names.length * 48, 12 + names.length * 8); fs.writeFileSync(file, data); return openArchive(file);
}

test('batch preview never stages; selected WAV files stage together and unchanged files stay untouched', async t => {
  const {wb, incoming, put, source} = workspace(t, {'menu.wav': wav(0), 'back.wav': wav(0), 'same.wav': wav(1)});
  put('menu.wav', wav(3)); put('back.wav', wav(4)); put('same.wav', wav(1)); put('readme.txt', Buffer.from('notes'));
  const plan = await wb.prepareBatchReplace(incoming, {kind: 'audio'});
  assert.equal(wb.changes.size, 0); assert.equal(select(plan).length, 2); assert.equal(plan.rows.find(row => row.name === 'same.wav').status, 'unchanged');
  const result = await wb.applyBatchReplace(plan.token, select(plan)); assert.deepEqual(result.batchReport, {files: 2, assets: 2});
  assert.equal(wb.changes.size, 2); assert.deepEqual(fs.readFileSync(path.join(source, 'menu.wav')), wav(0));
});

test('AFS duplicates require an entry index and compact overlay names identify the right record', async t => {
  const {wb, incoming, put, folder} = workspace(t, {}); wb.archives = [afs(path.join(folder, 'sd.afs'), ['10000.wav', '10000.wav'])];
  put('10000.wav', wav(2)); let plan = await wb.prepareBatchReplace(incoming, {kind: 'audio'}); assert.equal(plan.rows[0].status, 'ambiguous');
  put('sd.afs.entries/entry_00001.wav', wav(7)); plan = await wb.prepareBatchReplace(incoming, {kind: 'audio'});
  assert.equal(select(plan).length, 1); await wb.applyBatchReplace(plan.token, select(plan)); assert.deepEqual([...wb.changes.keys()], ['0:1']); assert.deepEqual(wb.bytes('0:1'), wav(7));
});

test('archive context and archive subfolders disambiguate identical names across archives', async t => {
  const {wb, incoming, put, folder} = workspace(t, {}); wb.archives = [afs(path.join(folder, 'first.afs'), ['menu.wav']), afs(path.join(folder, 'second.afs'), ['menu.wav'])];
  put('menu.wav', wav(1)); let plan = await wb.prepareBatchReplace(incoming, {kind: 'audio'}); assert.equal(plan.rows[0].status, 'ambiguous');
  plan = await wb.prepareBatchReplace(incoming, {kind: 'audio', archive: 1}); assert.equal(select(plan).length, 1);
  await wb.applyBatchReplace(plan.token, select(plan)); assert.deepEqual([...wb.changes.keys()], ['1:0']);
  fs.unlinkSync(path.join(incoming, 'menu.wav')); put('first.afs/menu.wav', wav(2)); plan = await wb.prepareBatchReplace(incoming, {kind: 'audio'});
  await wb.applyBatchReplace(plan.token, select(plan)); assert.deepEqual(wb.bytes('0:0'), wav(2));
  fs.unlinkSync(path.join(incoming, 'first.afs/menu.wav')); put('unknown.afs/menu.wav', wav(2)); plan = await wb.prepareBatchReplace(incoming, {kind: 'audio'}); assert.equal(plan.rows[0].status, 'unmatched');
});

test('multiple PNG slots compose in one MDL in fit and full-size modes without losing prior slots', async t => {
  for (const mode of ['fit', 'fullSize']) {
    const original = model(), {wb, incoming, put} = workspace(t, {'chhaa.mdl': original});
    put('chhaa_0.png', png(10, 4, 4)); put('chhaa_1.png', png(210, 8, 4));
    const plan = await wb.prepareBatchReplace(incoming, {kind: 'textures', mode}); assert.equal(select(plan).length, 2, JSON.stringify(plan.rows));
    await wb.applyBatchReplace(plan.token, select(plan)); const images = readTextures(wb.bytes('0:0'), true);
    assert.deepEqual(images.map(image => image.rgba[0]), [10, 210]); assert.deepEqual(images.map(image => image.width), mode === 'fit' ? [2, 2] : [4, 8]);
    assert.deepEqual(wb.bytes('0:0').subarray(0, 256), original.subarray(0, 256));
  }
});

test('MAP PNG replacement preserves geometry and converted-export folder identity', async t => {
  const original = mapFixture(), {wb, incoming, put} = workspace(t, {'room.map': original});
  put('tmp/00000_data/tmp/room.map/texture_000.png', png(15));
  const plan = await wb.prepareBatchReplace(incoming, {kind: 'textures'}); assert.equal(select(plan).length, 1, JSON.stringify(plan.rows));
  await wb.applyBatchReplace(plan.token, select(plan)); const offset = original.readUInt32LE(16);
  assert.deepEqual(wb.bytes('0:0').subarray(0, offset), original.subarray(0, offset)); assert.equal(readTextures(wb.bytes('0:0').subarray(offset))[0].rgba[0], 15);
});

test('duplicate slot inputs and native-plus-PNG inputs are conflicts, never silently last-wins', async t => {
  const {wb, incoming, put} = workspace(t, {'image.tex': textureFixture()}); put('image_0.png', png(10)); put('copy/image_0.png', png(20));
  let plan = await wb.prepareBatchReplace(incoming, {kind: 'textures'}); assert.ok(plan.rows.every(row => row.status === 'conflict'));
  fs.unlinkSync(path.join(incoming, 'copy/image_0.png')); put('image.tex', textureFixture()); plan = await wb.prepareBatchReplace(incoming, {kind: 'textures'});
  assert.ok(plan.rows.every(row => row.status === 'conflict')); assert.equal(wb.changes.size, 0);
});

test('malformed inputs are reported before staging and do not block selecting valid files', async t => {
  const {wb, incoming, put} = workspace(t, {'image.tex': textureFixture(), 'other.tex': textureFixture()}); put('image_0.png', Buffer.from('not a PNG')); put('other_0.png', png(4));
  const plan = await wb.prepareBatchReplace(incoming, {kind: 'textures'}); assert.equal(plan.rows.find(row => row.name === 'image_0.png').status, 'error');
  assert.equal(select(plan).length, 1); await wb.applyBatchReplace(plan.token, select(plan)); assert.deepEqual([...wb.changes.keys()], ['0:1']);
});

test('changed input late in a batch aborts without applying earlier valid replacements', async t => {
  const {wb, incoming, put} = workspace(t, {'a.wav': wav(0), 'b.wav': wav(0)}); put('a.wav', wav(1)); const file = put('b.wav', wav(2));
  const plan = await wb.prepareBatchReplace(incoming, {kind: 'audio'});
  wb.progress = value => {if (value.message === 'Preparing batch' && value.done === 1) fs.writeFileSync(file, wav(9));};
  await assert.rejects(wb.applyBatchReplace(plan.token, select(plan)), /changed since review/); assert.equal(wb.changes.size, 0);
});

test('stale project, repeated IDs, invalid selection and cancelled reviews cannot apply', async t => {
  const {wb, incoming, put} = workspace(t, {'a.wav': wav(0)}); put('a.wav', wav(1));
  let plan = await wb.prepareBatchReplace(incoming, {kind: 'audio'}); await assert.rejects(wb.applyBatchReplace(plan.token, ['0', '0']), /Select/);
  await assert.rejects(wb.applyBatchReplace(plan.token, ['bad']), /validated/); wb.stage('0:0', wav(8), 'previous');
  await assert.rejects(wb.applyBatchReplace(plan.token, select(plan)), /stale/); assert.deepEqual(wb.bytes('0:0'), wav(8));
  plan = await wb.prepareBatchReplace(incoming, {kind: 'audio'}); wb.cancelBatchReplace(plan.token); await assert.rejects(wb.applyBatchReplace(plan.token, select(plan)), /stale/);
});

test('truncated WAV, float WAV and oversized sd.afs samples report actionable validation errors', async t => {
  const {wb, incoming, put, folder} = workspace(t, {}); wb.archives = [afs(path.join(folder, 'sd.afs'), ['a.wav', 'b.wav', 'c.wav'])];
  const float = wav(3); float.writeUInt16LE(3, 20); put('a.wav', float); put('b.wav', wav(2).subarray(0, 48)); put('c.wav', waveFile(Buffer.alloc(1000000), 22050, 1));
  const plan = await wb.prepareBatchReplace(incoming, {kind: 'audio'}); assert.ok(plan.rows.every(row => row.status === 'error'), JSON.stringify(plan.rows));
  assert.match(plan.rows[0].detail, /PCM/); assert.match(plan.rows[1].detail, /truncated/); assert.match(plan.rows[2].detail, /scratch|buffer|976|limit/i);
});
