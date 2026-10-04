import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import createFileDialogs from '../app/file-dialogs.cjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sh3-dialogs-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const folder = name => {const result = path.join(root, name); fs.mkdirSync(result, {recursive: true}); return result;};
  const userData = folder('settings'), documents = folder('documents'), calls = [], warnings = [];
  let next = {canceled: true, filePaths: []};
  const dialog = {
    async showOpenDialog(parent, options) {assert.equal(parent, 'parent'); calls.push(options); return next;},
    async showSaveDialog(parent, options) {assert.equal(parent, 'parent'); calls.push(options); return next;},
  };
  return {root, folder, userData, documents, calls, warnings, result(value) {next = value;},
    restart: () => createFileDialogs({dialog, parent: () => 'parent', userData, defaultDirectory: documents, warn: text => warnings.push(text)})};
}

test('Open data folder survives a restart and unrelated build/export selections', async t => {
  const f = fixture(t), data = f.folder('game/data'), builds = f.folder('mods');
  const first = f.restart();
  f.result({canceled: false, filePaths: [data]});
  await first.open('game-data', {properties: ['openDirectory']});
  assert.equal(f.calls.at(-1).defaultPath, f.documents);
  f.result({canceled: false, filePaths: [builds]});
  await first.open('builds', {properties: ['openDirectory', 'createDirectory']});
  const reopened = f.restart();
  f.result({canceled: true, filePaths: []});
  await reopened.open('game-data', {properties: ['openDirectory']});
  assert.equal(f.calls.at(-1).defaultPath, data);
  await reopened.open('builds', {properties: ['openDirectory']});
  assert.equal(f.calls.at(-1).defaultPath, builds);
  assert.deepEqual(f.warnings, []);
});

test('model exports and imports share a persisted folder and retain the suggested filename', async t => {
  const f = fixture(t), model = f.folder('editing/heather');
  f.result({canceled: false, filePath: path.join(model, 'export.glb')});
  await f.restart().save('models', {defaultPath: 'Heather.glb', filters: [{extensions: ['glb']}]});
  f.result({canceled: false, filePaths: [path.join(model, 'edited.glb')]});
  const reopened = f.restart();
  await reopened.open('models', {properties: ['openFile']});
  assert.equal(f.calls.at(-1).defaultPath, model);
  f.result({canceled: true});
  await reopened.save('models', {defaultPath: 'Other.fbx'});
  assert.equal(f.calls.at(-1).defaultPath, path.join(model, 'Other.fbx'));
});

test('cancel keeps saved locations; multi-file imports remember the containing directory', async t => {
  const f = fixture(t), mods = f.folder('mods');
  f.result({canceled: false, filePaths: [path.join(mods, 'first.sh3mod'), path.join(mods, 'second.sh3mod')]});
  await f.restart().open('mods', {properties: ['openFile', 'multiSelections']});
  const before = fs.readFileSync(path.join(f.userData, 'file-dialogs.json'));
  f.result({canceled: true, filePaths: []});
  await f.restart().open('mods', {properties: ['openFile']});
  assert.equal(f.calls.at(-1).defaultPath, mods);
  assert.deepEqual(fs.readFileSync(path.join(f.userData, 'file-dialogs.json')), before);
});

test('a deleted last folder falls back to its existing parent after restart', async t => {
  const f = fixture(t), existing = f.folder('editing'), removed = f.folder('editing/session');
  f.result({canceled: false, filePaths: [path.join(removed, 'mesh.glb')]});
  await f.restart().open('models', {properties: ['openFile']});
  fs.rmdirSync(removed);
  f.result({canceled: true, filePaths: []});
  await f.restart().open('models', {properties: ['openFile']});
  assert.equal(f.calls.at(-1).defaultPath, existing);
});

test('a malformed preferences file does not prevent choosing and saving a new location', async t => {
  const f = fixture(t), data = f.folder('game/data');
  fs.writeFileSync(path.join(f.userData, 'file-dialogs.json'), '{');
  f.result({canceled: false, filePaths: [data]});
  await f.restart().open('game-data', {properties: ['openDirectory']});
  assert.equal(f.warnings.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.userData, 'file-dialogs.json'))).directories['game-data'], data);
});

test('explicit initial locations remain available until that workflow has a remembered location', async t => {
  const f = fixture(t), executable = path.join(f.folder('game'), 'sh3.exe');
  const saved = path.join(f.folder('backup'), 'sh3.exe');
  f.result({canceled: false, filePaths: [saved]});
  await f.restart().open('game-executable', {properties: ['openFile'], defaultPath: executable});
  assert.equal(f.calls.at(-1).defaultPath, executable);
  f.result({canceled: true, filePaths: []});
  await f.restart().open('game-executable', {properties: ['openFile'], defaultPath: executable});
  assert.equal(f.calls.at(-1).defaultPath, path.dirname(saved));
});
