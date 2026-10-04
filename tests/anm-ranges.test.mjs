import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {AnimationRangeCatalog, readAnimationRanges} from '../core/anm-ranges.mjs';

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
  assert.throws(() => readAnimationRanges(pe, 'chhaa_basic1_none.anm'), /Truncated PE/);
});

test('enemy profiles require their own model ID, frame count and non-test bank path', () => {
  const catalog = new AnimationRangeCatalog(), base = {bankName:'data/chr/en/en_nse.anm',modelId:515,frameCount:1433};
  assert.match(catalog.forBank(base).rangeNote, /Open the game data folder/);
  assert.match(catalog.forBank({...base,frameCount:1763}).rangeNote, /1433-frame/);
  assert.match(catalog.forBank({...base,modelId:256}).rangeNote, /model ID 0x203/);
  assert.match(catalog.forBank({...base,bankName:'test/en_nse.anm'}).rangeNote, /No verified/);
  assert.match(catalog.forBank({...base,bankName:'data\\chr\\en\\test\\en_nse.anm'}).rangeNote, /No verified/);
  assert.match(catalog.forBank({...base,bankName:'DATA/CHR/EN/EN_NSE.ANM'}).rangeNote, /Open the game data folder/);
});

test('Game Over actions distinguish Heather and Split Worm while requiring their 996-frame layout', () => {
  const catalog = new AnimationRangeCatalog();
  for (const [prefix,modelId] of [['htr',256],['spi',530]]) {
    const args = {bankName:prefix+'_gameover_none.anm',modelId,frameCount:996};
    assert.match(catalog.forBank(args).rangeNote, /Open the game data folder/);
    assert.match(catalog.forBank({...args,frameCount:1763}).rangeNote, /996-frame/);
    assert.match(catalog.forBank({...args,modelId:modelId===256?530:256}).rangeNote, /model ID/);
  }
});
