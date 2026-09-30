import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {AnimationRangeCatalog, readHeatherAnimationRanges} from '../core/anm-ranges.mjs';

test('unverified banks and modified layouts never acquire guessed action ranges', () => {
  const catalog = new AnimationRangeCatalog();
  assert.deepEqual(catalog.forBank({bankName:'other.anm',modelId:256,frameCount:1763}).ranges, []);
  const modified = catalog.forBank({bankName:'chhaa_basic1_none.anm',modelId:256,frameCount:1700});
  assert.deepEqual(modified.ranges, []); assert.match(modified.rangeNote, /1763/);
  assert.deepEqual(catalog.forBank({bankName:'chhaa_basic1_none.anm',modelId:512,frameCount:1763}).ranges, []);
});

test('missing and unsupported executables allow manual ranges and refresh after file replacement', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sh3-action-ranges-'));
  t.after(() => fs.rmSync(folder, {recursive: true, force: true}));
  const catalog = new AnimationRangeCatalog(), args = {dataRoot:path.join(folder,'data'),bankName:'chhaa_basic1_none.anm',modelId:256,frameCount:1763};
  assert.match(catalog.forBank(args).rangeNote, /could not be read/);
  fs.writeFileSync(path.join(folder,'sh3.exe'), Buffer.alloc(70));
  assert.match(catalog.forBank(args).rangeNote, /Not a PE/);
  fs.writeFileSync(path.join(folder,'sh3.exe'), Buffer.alloc(12));
  assert.match(catalog.forBank(args).rangeNote, /Truncated PE/);
});

test('truncated PE section tables are rejected before reading animation descriptors', () => {
  const pe = Buffer.alloc(128); pe.writeUInt16LE(0x5a4d); pe.writeUInt32LE(64,0x3c);
  pe.writeUInt32LE(0x4550,64);pe.writeUInt16LE(0x14c,68);pe.writeUInt16LE(2,70);pe.writeUInt16LE(32,84);
  pe.writeUInt16LE(0x10b,88);pe.writeUInt32LE(0x400000,116);
  assert.throws(() => readHeatherAnimationRanges(pe), /Truncated PE/);
});
