import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Workbench} from '../core/workbench.mjs';
import {encodeMovie} from '../core/media.mjs';

function movie(marker) {
  const header = Buffer.alloc(0x8000); let key = 1234; header.writeUInt32LE(key);
  for (let i = 1; i < 8192; i++) {key = (Math.imul(key, 0x5d588b65) + 1) >>> 0; header.writeUInt32LE(key, i * 4);}
  const payload = Buffer.alloc(20, marker); payload.writeUInt32BE(0x000001ba);
  return encodeMovie(payload, header);
}

test('movie projects restore staged payloads and build only changed loose files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sh3tools-loose-test-'));
  try {
    const source = path.join(root, 'movie'); fs.mkdirSync(source);
    const original = movie(1), replacement = movie(2), untouched = movie(3);
    fs.writeFileSync(path.join(source, 'a.000'), original); fs.writeFileSync(path.join(source, 'b.000'), untouched);
    const first = new Workbench(); first.open(path.join(source, 'a.000')); first.stage('0:0', replacement, 'Test replacement');
    const project = path.join(root, 'movie.sh3project'); first.saveProject(project);
    const restored = new Workbench(); assert.equal(restored.loadProject(project).changes.length, 1);
    assert.deepEqual(restored.bytes('0:0'), replacement);
    const destination = path.join(root, 'build'); assert.equal(restored.build(destination).changes, 1);
    assert.deepEqual(fs.readFileSync(path.join(destination, 'data/movie/a.000')), replacement);
    assert.equal(fs.existsSync(path.join(destination, 'data/movie/b.000')), false);
    assert.deepEqual(fs.readFileSync(path.join(source, 'a.000')), original);
    assert.deepEqual(fs.readFileSync(path.join(source, 'b.000')), untouched);
    assert.equal(JSON.parse(fs.readFileSync(path.join(destination, 'manifest.json'))).verified, true);
    fs.writeFileSync(path.join(source, 'b.000'), movie(4));
    assert.throws(() => new Workbench().loadProject(project), /original folder file changed/);
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, {recursive: true, force: true});
  }
});
