import test from 'node:test';
import assert from 'node:assert/strict';
import {parseModel, morphDocument, replaceMorphs} from '../core/model.mjs';
import {exportGlb, importGlb} from '../core/gltf.mjs';
import {align} from '../core/binary.mjs';
import {modelFixture} from './helpers/model-fixture.mjs';
import {modelLayout} from '../core/model.mjs';
function fixture() {
  const data = Buffer.alloc(1024), base = 96, mesh = 304;
  data.writeUInt32LE(base, 20); data.writeUInt32LE(0xffff0003, base);
  const fields = {8: 128, 12: 1, 16: 192, 32: 1, 36: 208, 56: 1, 60: 624, 68: 1, 72: 576, 76: 1, 80: 592};
  for (const [offset, value] of Object.entries(fields)) data.writeUInt32LE(value, base + Number(offset));
  for (const i of [0, 5, 10, 15]) data.writeFloatLE(1, 224 + i * 4); data[288] = 255;
  const meshFields = {0: 256, 8: 96, 20: 1, 24: 84, 28: 1, 32: 80, 56: 82, 68: 3, 72: 240, 76: 3};
  for (const [offset, value] of Object.entries(meshFields)) data.writeUInt32LE(value, mesh + Number(offset));
  data.writeUInt16LE(1, mesh + 88);
  [[-1, 0, 0], [1, 0, 0], [0, 1, 0]].forEach((position, v) => {
    const p = mesh + 96 + v * 48; position.forEach((value, i) => data.writeFloatLE(value, p + i * 4)); data.writeFloatLE(1, p + 12); data.writeFloatLE(1, p + 36);
    data.writeUInt32LE(v, mesh + 240 + v * 4);
  });
  data.writeInt16LE(-16, 672); data.writeInt16LE(-4096, 682);
  data.writeUInt32LE(1, 688); data.writeUInt32LE(608, 692); data.writeInt16LE(16, 704);
  return data;
}
function changeJson(glb, edit) {
  const oldJsonSize = glb.readUInt32LE(12), doc = JSON.parse(glb.subarray(20, 20 + oldJsonSize).toString()); edit(doc);
  const raw = Buffer.from(JSON.stringify(doc)), json = Buffer.alloc(align(raw.length, 4), 32); raw.copy(json);
  const result = Buffer.concat([Buffer.from(glb.subarray(0, 20)), json, glb.subarray(20 + oldJsonSize)]);
  result.writeUInt32LE(result.length, 8); result.writeUInt32LE(json.length, 12); return result;
}
test('MDL transforms and morph mapping decode', () => {const m = parseModel(fixture()); assert.equal(m.meshes.length, 1); assert.equal(m.bones.length, 1); assert.equal(m.morphNames.length, 1); assert.equal(m.meshes[0].positions[0], 1); assert.equal(m.meshes[0].morphPositions[0][0], -1);});
test('MDL to GLB to MDL is byte-identical', () => {const b = fixture(), glb = exportGlb(parseModel(b)); assert.deepEqual(importGlb(b, glb), b);});
test('Changed skeleton is explicitly rejected', () => {const b = fixture(), glb = changeJson(exportGlb(parseModel(b)), doc => {doc.nodes[0].matrix[12] = 9;}); assert.throws(() => importGlb(b, glb), /Skeleton edits/);});
test('Removed shape keys are rejected', () => {const b = fixture(), glb = changeJson(exportGlb(parseModel(b)), doc => {delete doc.meshes[0].primitives[0].targets;}); assert.throws(() => importGlb(b, glb), /shape keys/);});
test('Mismatched GLB source hash is rejected', () => {const b = fixture(), glb = changeJson(exportGlb(parseModel(b)), doc => {doc.asset.extras.sh3SourceHash = 'wrong';}); assert.throws(() => importGlb(b, glb), /different MDL/);});
test('Morph no-op preserves all unknown bytes', () => {const b = fixture(); assert.deepEqual(replaceMorphs(b, morphDocument(b)), b);});
test('Morph delta import edits only its existing record', () => {const b = fixture(), doc = morphDocument(b); doc.targets[0].deltas[0].position[0] = 24; const expected = Buffer.from(b); expected.writeInt16LE(24, 704); assert.deepEqual(replaceMorphs(b, doc), expected);});
test('Out-of-range morph and moved vertex mapping are rejected', () => {const b = fixture(), doc = morphDocument(b); doc.targets[0].deltas[0].position[0] = 40000; assert.throws(() => replaceMorphs(b, doc), /16-bit/); doc.targets[0].deltas[0].position[0] = 16; doc.targets[0].deltas[0].vertex = 10; assert.throws(() => replaceMorphs(b, doc), /order/);});
test('Corrupt MDL pointers fail before reading geometry', () => {const b = fixture(); b.writeUInt32LE(0xffffff00, 20); assert.throws(() => parseModel(b), /outside/);});

test('PC morph normals keep the render orientation at zero delta', () => {const m = parseModel(fixture()).meshes[0]; assert.deepEqual(m.morphNormals[0].slice(0, 3), [0, 0, 0]);});
test('PC morph normal deltas invert the packed normal convention before bone transformation', () => {const b = fixture(); b.writeInt16LE(2048, 710); const m = parseModel(b).meshes[0]; assert.deepEqual(m.morphNormals[0].slice(0, 3), [.5, 0, 0]);});

test('zero explicit MDL weights use the implicit fourth palette influence', () => {
  const b = fixture(), at = 400;
  b.fill(0, at + 12, at + 24);
  const mesh = parseModel(b).meshes[0];
  assert.deepEqual(mesh.weights.slice(0, 4), [0, 0, 0, 1]);
  assert.deepEqual(mesh.joints.slice(0, 4), [0, 0, 0, 0]);
  assert.deepEqual(importGlb(b, exportGlb(parseModel(b))), b);
});

test('partial explicit MDL weights retain their residual instead of being renormalized away', () => {
  const b = fixture(), at = 400;
  b.writeFloatLE(.25, at + 12); b.writeFloatLE(.125, at + 16); b.writeFloatLE(.125, at + 20);
  assert.deepEqual(parseModel(b).meshes[0].weights.slice(0, 4), [.25, .125, .125, .5]);
  assert.deepEqual(importGlb(b, exportGlb(parseModel(b))), b);
});

test('the implicit weight validates the fourth palette index only when it contributes', () => {
  const b = fixture(), at = 400;
  b[at + 27] = 255;
  assert.doesNotThrow(() => parseModel(b));
  b.writeFloatLE(0, at + 12);
  assert.throws(() => parseModel(b), /Mesh_0_0, vertex 0: invalid skin bone reference for influence 4/);
});

test('invalid explicit weights still fail with the affected mesh and vertex', () => {
  const b = fixture(); b.writeFloatLE(-.5, 412);
  assert.throws(() => parseModel(b), /Mesh_0_0, vertex 0: invalid skin weights/);
});

test('four native palette indices remain independent in GLB skin data', () => {
  const b = modelFixture(4), h = modelLayout(b), mesh = h.groups[0][1], at = mesh + b.readUInt32LE(mesh + 8);
  b.writeUInt32LE(4, mesh + 28); b.writeUInt32LE(168, mesh + 32);
  for (let i = 0; i < 4; i++) {b.writeUInt16LE(i, mesh + 168 + i * 2); b[at + 24 + i] = i;}
  [.125, .25, .125].forEach((w, i) => b.writeFloatLE(w, at + 12 + i * 4));
  const m = parseModel(b).meshes[0];
  assert.deepEqual(m.weights.slice(0, 4), [.125, .25, .125, .5]);
  assert.deepEqual(m.joints.slice(0, 4), [0, 1, 2, 3]);
  assert.deepEqual(importGlb(b, exportGlb(parseModel(b))), b);
});
