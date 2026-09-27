import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PNG} from 'pngjs';
import {Workbench} from '../core/workbench.mjs';
import {looseFolder} from '../core/loose-files.mjs';
import {readTextures} from '../core/textures.mjs';
import {readBitmap, replaceBitmap} from '../core/bitmap.mjs';
import {mapFixture, textureFixture} from './helpers/map-fixture.mjs';

function workspace(t, files) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sh3tools-texture-library-'));
  t.after(() => {assert.ok(folder.startsWith(path.join(os.tmpdir(), 'sh3tools-texture-library-'))); fs.rmSync(folder, {recursive: true, force: true});});
  for (const [name, data] of Object.entries(files)) fs.writeFileSync(path.join(folder, name), data);
  const wb = new Workbench(); wb.archives = [looseFolder(folder, 'tmp')];
  const input = path.join(folder, 'input.png'), rgba = Buffer.alloc(7 * 5 * 4);
  for (let i = 0; i < rgba.length; i += 4) rgba.set([40, 70, 90, 255], i);
  fs.writeFileSync(input, PNG.sync.write({width: 7, height: 5, data: rgba}));
  return {wb, folder, input};
}
function bitmap(bits = 24, topDown = false) {
  const stride = 12, data = Buffer.alloc(54 + stride * 2 + 6, 0x67);
  data.fill(0, 0, 54); data.write('BM'); data.writeUInt32LE(data.length, 2); data.writeUInt32LE(54, 10); data.writeUInt32LE(40, 14);
  data.writeInt32LE(3, 18); data.writeInt32LE(topDown ? -2 : 2, 22); data.writeUInt16LE(1, 26); data.writeUInt16LE(bits, 28);
  for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) data.set([x * 40, y * 90, 160], 54 + y * stride + x * bits / 8);
  return data;
}
function model() {
  const prefix = Buffer.alloc(256);
  prefix.writeUInt32LE(1, 8); prefix.writeUInt32LE(256, 12); prefix.writeUInt32LE(256, 16); prefix.writeUInt32LE(32, 20);
  prefix.writeUInt32LE(0xffff0003, 32);
  return Buffer.concat([prefix, textureFixture()]);
}

test('catalog scans native owners once and links shared map companions without duplicating slots', t => {
  const {wb} = workspace(t, {'am11.map': mapFixture({family: 1}), 'am12.map': mapFixture({family: 1}), 'amGB.tex': textureFixture(), 'character.mdl': model(), 'bad.tex': Buffer.alloc(12)});
  const result = wb.textureCatalog(), shared = result.items.find(item => item.name.endsWith('amGB.tex'));
  assert.equal(result.items.length, 4); assert.equal(shared.usedBy.length, 2);
  assert.equal(result.items.filter(item => item.kind === 'map').length, 2);
  assert.equal(result.items.filter(item => item.kind === 'model').length, 1);
  assert.equal(result.issues.length, 1); assert.match(result.issues[0].name, /bad.tex/);
  let reads = 0; const bytes = wb.bytes.bind(wb); wb.bytes = key => {reads++; return bytes(key);};
  assert.deepEqual(wb.textureCatalog(), result); assert.equal(reads, 0);
  wb.textureCatalog(true); assert.equal(reads, 5);
});

test('shared texture replacement changes its TEX owner and immediately updates every referencing map', t => {
  const {wb, input} = workspace(t, {'am11.map': mapFixture({family: 1}), 'am12.map': mapFixture({family: 1}), 'amGB.tex': textureFixture()});
  const shared = wb.textureCatalog().items.find(item => item.usedBy.length), preview = wb.texturePreview(shared.id), originalRevision = wb.snapshot().textureRevision;
  wb.replaceLibraryTexture(shared.id, preview.hash, input);
  assert.deepEqual([...wb.changes.keys()], [shared.key]);
  for (const ref of shared.usedBy) assert.deepEqual([...wb.worldAsset(ref.key).textures[0].rgba.slice(0, 4)], [40, 70, 90, 255]);
  assert.ok(wb.snapshot().textureRevision > originalRevision);
  const refreshed = wb.textureCatalog(); assert.ok(refreshed.items.find(item => item.id === shared.id).changed);
  assert.throws(() => wb.replaceLibraryTexture(shared.id, preview.hash, input), /source changed/);
  wb.undo(shared.key); assert.equal(wb.textureCatalog().items.find(item => item.id === shared.id).changed, false);
  assert.equal(wb.texturePreview(shared.id).hash, preview.hash);
});

test('embedded MAP import preserves geometry, headers and suffix; full-size mode cannot bypass pointer safety', t => {
  const original = Buffer.concat([mapFixture(), Buffer.from('opaque suffix')]);
  const {wb, folder, input} = workspace(t, {'room.map': original}), item = wb.textureCatalog().items[0], preview = wb.texturePreview(item.id);
  assert.equal(item.fullSize, false);
  assert.throws(() => wb.replaceLibraryTexture(item.id, preview.hash, input, 'fullSize'), /Full-size import is unavailable/);
  const geometry = wb.worldAsset(item.key).model;
  wb.replaceLibraryTexture(item.id, preview.hash, input);
  const modified = wb.bytes(item.key), offset = original.readUInt32LE(16);
  assert.deepEqual(modified.subarray(0, offset), original.subarray(0, offset));
  assert.deepEqual(modified.subarray(-13), original.subarray(-13));
  assert.deepEqual(wb.worldAsset(item.key).model.meshes, geometry.meshes);
  wb.textureCatalog();
  const output = path.join(folder, 'export.png');
  wb.exportLibraryTexture(item.id, wb.texturePreview(item.id).hash, output);
  const image = PNG.sync.read(fs.readFileSync(output)); assert.equal(image.width, 2); assert.deepEqual([...image.data.slice(0, 4)], [40, 70, 90, 255]);
  assert.throws(() => wb.exportLibraryTexture(item.id, preview.hash, output + '.stale'), /source changed/);
});

test('MDL texture import supports fit and full-size while retaining the model prefix', t => {
  const original = model(), {wb, input} = workspace(t, {'character.mdl': original});
  let item = wb.textureCatalog().items[0]; assert.equal(item.kind, 'model'); assert.equal(item.fullSize, true);
  wb.replaceLibraryTexture(item.id, wb.texturePreview(item.id).hash, input);
  assert.deepEqual(wb.bytes(item.key).subarray(0, 256), original.subarray(0, 256));
  item = wb.textureCatalog().items[0]; assert.equal(item.width, 2);
  wb.replaceLibraryTexture(item.id, wb.texturePreview(item.id).hash, input, 'fullSize');
  assert.deepEqual(wb.bytes(item.key).subarray(0, 256), original.subarray(0, 256));
  item = wb.textureCatalog().items[0]; assert.equal(item.width, 7); assert.equal(item.height, 5);
});

test('catalog previews reject changed sources and regenerate slots after a container replacement', t => {
  const {wb} = workspace(t, {'image.tex': textureFixture()});
  const item = wb.textureCatalog().items[0], first = wb.textureThumbnails([item.id]);
  assert.match(first[0].url, /^data:image\/png/);
  const empty = Buffer.alloc(64); wb.stage(item.key, empty, 'Empty texture container');
  assert.throws(() => wb.texturePreview(item.id), /catalog changed/);
  assert.equal(wb.textureCatalog().items.length, 0);
  wb.undo(item.key); assert.equal(wb.textureCatalog().items.length, 1);
  assert.equal(wb.textureThumbnails([item.id])[0].url, first[0].url);
  assert.throws(() => wb.textureThumbnails(Array(33).fill(item.id)), /up to 32/);
});

test('metadata-only parsing returns identical native slots without pixel or PNG allocation', () => {
  const decoded = readTextures(textureFixture()), metadata = readTextures(textureFixture(), false, {decode: false});
  assert.equal(metadata.length, decoded.length);
  for (let i = 0; i < metadata.length; i++) {
    const {rgba, png, ...expected} = decoded[i];
    assert.deepEqual(metadata[i], {...expected, rgba: undefined});
  }
  const indexed = Buffer.alloc(96 + 16 + 48 + 4096);
  indexed.writeUInt32LE(0xffffffff); indexed.writeUInt16LE(4, 8); indexed.writeUInt16LE(4, 10);
  indexed.writeUInt32LE(16, 16); indexed.writeUInt32LE(112, 20); indexed.writeUInt16LE(0x9999, 30);
  indexed.writeUInt32LE(4096, 112); indexed[124] = 4; indexed[126] = 64; indexed.set([30, 40, 50, 128], 160); indexed.set([70, 80, 90, 128], 224);
  const full = readTextures(indexed), brief = readTextures(indexed, false, {decode: false});
  assert.equal(full.length, 2);
  assert.deepEqual(brief.map(({width, height, index, format, layout}) => ({width, height, index, format, layout})), full.map(({width, height, index, format, layout}) => ({width, height, index, format, layout})));
  assert.ok(brief.every(image => !image.rgba && !image.png));
});

for (const bits of [24, 32]) for (const topDown of [false, true]) test('BMP ' + bits + '-bit ' + (topDown ? 'top-down' : 'bottom-up') + ' PNG round trip preserves padding and reserved bytes', () => {
  const data = bitmap(bits, topDown), image = readBitmap(data);
  assert.deepEqual([...image.rgba.slice(0, 4)], [160, topDown ? 0 : 90, 0, 255]);
  assert.deepEqual(replaceBitmap(data, image.png), data);
  const changed = Buffer.from(image.rgba); changed.set([21, 43, 65, 255], 0);
  const output = replaceBitmap(data, PNG.sync.write({width: image.width, height: image.height, data: changed}));
  assert.deepEqual(readBitmap(output).rgba, changed); assert.deepEqual(output.subarray(0, 54), data.subarray(0, 54)); assert.deepEqual(output.subarray(-6), data.subarray(-6));
  for (let p = 54; p < 78; p++) if (bits === 32 ? (p - 54) % 4 === 3 : (p - 54) % 12 >= 9) assert.equal(output[p], data[p]);
});

test('BMP participates in the catalog and stages native BMP bytes from a PNG', t => {
  const {wb, input} = workspace(t, {'splash.bmp': bitmap()});
  const item = wb.textureCatalog().items[0]; assert.equal(item.fullSize, false);
  wb.replaceLibraryTexture(item.id, wb.texturePreview(item.id).hash, input);
  assert.equal(wb.bytes(item.key).toString('ascii', 0, 2), 'BM');
  assert.deepEqual([...readBitmap(wb.bytes(item.key)).rgba.slice(0, 4)], [40, 70, 90, 255]);
});
