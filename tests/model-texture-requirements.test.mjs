import test from 'node:test';
import assert from 'node:assert/strict';
import {modelTextureRequirements} from '../core/model-texture-requirements.mjs';
const model = (textureCount, primary, secondary = []) => ({textureCount,
  meshes: [...primary.map(texture => ({group: 0, texture})), ...secondary.map(texture => ({group: 1, texture}))]});

test('six model slots fitting stock run tables do not request an extension', () => {
  assert.deepEqual(modelTextureRequirements(model(6, [0, 0, 1, 2, 3, 4], [5, 5])),
    {textureSlots: 6, primaryRuns: 5, secondaryRuns: 1, requiresModelTexturePatch: false});
  assert.equal(modelTextureRequirements(model(7, [0], [0])).requiresModelTexturePatch, true);
});

test('texture run requirements follow mesh order and native secondary branch', () => {
  assert.equal(modelTextureRequirements(model(2, [0, 1, 0, 1, 0, 1])).requiresModelTexturePatch, true);
  assert.deepEqual(modelTextureRequirements(model(3, [0, 1, 2], [0, 1, 2])),
    {textureSlots: 3, primaryRuns: 3, secondaryRuns: 0, requiresModelTexturePatch: false});
  assert.equal(modelTextureRequirements(model(4, [0, 1, 2], [2, 3])).secondaryRuns, 1);
  assert.equal(modelTextureRequirements(model(4, [0], [1, 2])).requiresModelTexturePatch, true);
});

test('zero/one-image native fast path and secondary-only models retain their branch semantics', () => {
  assert.deepEqual(modelTextureRequirements(model(0, [])),
    {textureSlots: 0, primaryRuns: 1, secondaryRuns: 0, requiresModelTexturePatch: false});
  assert.equal(modelTextureRequirements(model(2, [], [0, 1])).secondaryRuns, 2);
});

test('Build mod derives texture requirements from staged MDL bytes, including raw replacements', async () => {
  const {Workbench} = await import('../core/workbench.mjs');
  const {texturedModelFixture} = await import('./helpers/model-fixture.mjs');
  const wb = new Workbench();
  wb.get = () => ({entry: {name: 'models/test.mdl', extension: 'mdl'}});
  for (const slots of [4, 6, 7, 32]) {
    wb.changes.set('0:0', {data: texturedModelFixture(slots)});
    const requirements = wb.buildRequirements();
    assert.equal(requirements.textureSlots, slots);
    assert.equal(requirements.requiresModelTexturePatch, slots > 6);
    assert.equal(requirements.requiresRuntimePatch, slots > 6);
  }
  wb.changes.set('0:0', {data: texturedModelFixture(33)});
  assert.throws(() => wb.buildRequirements(), /expanded texture tables/);
});

test('Build mod rejects image header/batch disagreement and missing material slots', async () => {
  const {Workbench} = await import('../core/workbench.mjs');
  const {texturedModelFixture} = await import('./helpers/model-fixture.mjs');
  const wb = new Workbench(); wb.get = () => ({entry: {name: 'models/test.mdl', extension: 'mdl'}});
  const data = texturedModelFixture(7); data.writeUInt32LE(6,8); wb.changes.set('0:0',{data});
  assert.throws(()=>wb.buildRequirements(),/header and batch counts/);
  const missing = texturedModelFixture(7), base=missing.readUInt32LE(20), material=base+missing.readUInt32LE(base+60);
  missing.writeUInt32LE(7,material); wb.changes.set('0:0',{data:missing});
  assert.throws(()=>wb.buildRequirements(),/missing texture slot/);
});
