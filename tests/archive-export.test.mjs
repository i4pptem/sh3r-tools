import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Workbench} from '../core/workbench.mjs';
import {waveFile, decodeAdx} from '../core/audio.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh3tools-test-'));
  t.after(() => {assert.ok(dir.startsWith(path.join(os.tmpdir(), 'sh3tools-test-'))); fs.rmSync(dir, {recursive: true, force: true});});
  const adx = Buffer.alloc(72); adx.writeUInt16BE(0x8000); adx.writeUInt16BE(32, 2); adx.set([3,18,4,2], 4);
  adx.writeUInt32BE(48000, 8); adx.writeUInt32BE(32, 12); adx.writeUInt16BE(500, 16); adx.writeUInt16BE(0x0300, 18); adx.write('(c)CRI', 30); adx[38] = 0x12;
  const pack = Buffer.alloc(16); pack.writeUInt32LE(0x12345678);
  const items = [adx, waveFile(Buffer.from([1,0,2,0]), 25254, 1), pack, Buffer.from('opaque')];
  const data = Buffer.alloc(2048 * (items.length + 1)); data.write('AFS\0'); data.writeUInt32LE(items.length, 4);
  items.forEach((item, i) => {data.writeUInt32LE((i+1)*2048, 8+i*8); data.writeUInt32LE(item.length, 12+i*8); item.copy(data, (i+1)*2048);});
  const file = path.join(dir, 'voices.afs'); fs.writeFileSync(file, data);
  const workbench = new Workbench(); workbench.open(file); return {dir, workbench, items};
}

test('unnamed AFS classifies ADX/WAV/PACK by content while preserving .bin identity', t => {
  const {workbench, items} = fixture(t), entries = workbench.snapshot().entries;
  assert.deepEqual(entries.map(e => e.detectedFormat), ['adx','wav','pack','bin']);
  assert.deepEqual(entries.map(e => e.kind), ['audio','audio','animation','binary']);
  assert.ok(entries.every(e => e.extension === 'bin'));
  const preview = workbench.preview('0:0'), wav = Buffer.from(preview.audio.split(',')[1], 'base64');
  assert.deepEqual(wav.subarray(44), decodeAdx(items[0]).pcm);
  assert.equal(workbench.preview('0:1').audio, 'data:audio/wav;base64,' + items[1].toString('base64'));
});

test('archive export scopes all entries of one source and includes staged payloads', t => {
  const {dir, workbench} = fixture(t), replacement = Buffer.from('edited opaque bytes'); workbench.stage('0:3', replacement, 'test');
  const result = workbench.exportArchive(0, path.join(dir, 'native'), 'native');
  assert.equal(result.count, 4); assert.deepEqual(fs.readFileSync(path.join(result.folder, 'voices.afs/00003_entry_00003.bin')), replacement);
  assert.throws(() => workbench.exportArchive(1, path.join(dir, 'invalid')), /Select an archive/);
  assert.throws(() => workbench.exportArchive(0, result.folder), /new export folder/);
});

test('converted export retains unknown and malformed assets and reports conversion failures', t => {
  const {dir, workbench, items} = fixture(t);
  const result = workbench.exportArchive(0, path.join(dir, 'converted'), 'converted');
  const report = JSON.parse(fs.readFileSync(path.join(result.folder, 'export-report.json')));
  assert.equal(report.entries.length, 4); assert.equal(report.converted, 2); assert.equal(report.native, 1); assert.equal(report.failed, 1);
  assert.deepEqual(fs.readFileSync(path.join(result.folder, report.entries[1].files[0])), items[1]);
  assert.deepEqual(fs.readFileSync(path.join(result.folder, report.entries[2].files[0])), items[2]);
  assert.deepEqual(fs.readFileSync(path.join(result.folder, report.entries[3].files[0])), items[3]);
  assert.match(report.entries[2].reason, /PACK/);
});


test('all-source export includes every archive and staged replacement in both modes', t => {
 const {dir,workbench}=fixture(t),other={...workbench.archives[0],name:'nested/other.afs'};workbench.archives.push(other);
 workbench.stage('1:3',Buffer.from('second source edit'),'test');
 for(const mode of ['native','converted']) {const result=workbench.exportAllArchives(path.join(dir,'all-'+mode),mode);assert.equal(result.count,8);
 const file=mode==='native'?'nested/other.afs/00003_entry_00003.bin':'nested/other.afs/00003_entry_00003.bin/entry_00003.bin';assert.equal(fs.readFileSync(path.join(result.folder,file),'utf8'),'second source edit');}
});
