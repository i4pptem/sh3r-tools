import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Matrix4} from 'three';
import {exportGlb, readGlb} from '../core/gltf.mjs';
import {gltfHierarchy, validateRig} from '../core/gltf-rig.mjs';
import {loadGltfFile, writeGlb} from '../core/model-import.mjs';
import {modelFixture} from './helpers/model-fixture.mjs';
import {parseModel} from '../core/model.mjs';

function authoringScene() {
  const model = parseModel(modelFixture(3)); model.bones[1].parent = 0; model.bones[2].parent = 1;
  const original = exportGlb(model, []), parsed = readGlb(original), {doc, binary, accessor} = parsed;
  const skin = doc.skins[0], old = gltfHierarchy(doc), joints = new Set(skin.joints);
  const basis = new Matrix4().set(0,0,-1,0, 1,0,0,0, 0,-1,0,0, 0,0,0,1);
  // Calibration also restores bind drift introduced by FBX, not just an axis permutation.
  const bases = new Map(skin.joints.map((index, i) => [index, basis.clone().multiply(new Matrix4().makeRotationX(i * 0.00004))]));
  const worlds = doc.nodes.map((_, i) => joints.has(i) ? old.world(i).clone().multiply(bases.get(i)) : old.world(i).clone());
  doc.nodes.forEach((node, i) => {
    const parent = old.parents.get(i), local = parent === undefined ? worlds[i] : worlds[parent].clone().invert().multiply(worlds[i]);
    node.matrix = local.toArray(); delete node.translation; delete node.rotation; delete node.scale;
  });
  const binds = accessor(skin.inverseBindMatrices), acc = doc.accessors[skin.inverseBindMatrices], view = doc.bufferViews[acc.bufferView];
  skin.joints.forEach((index, i) => {
    const bind = new Matrix4().fromArray(binds, i * 16).premultiply(bases.get(index).clone().invert());
    bind.elements.forEach((v, j) => binary.writeFloatLE(v, (view.byteOffset || 0) + (acc.byteOffset || 0) + (i * 16 + j) * 4));
  });
  const corrections = Object.fromEntries(skin.joints.map(index => [doc.nodes[index].name, bases.get(index).clone().invert().toArray()]));
  const root = doc.nodes.length;
  doc.nodes.push({name:'Exported armature', children:doc.scenes[0].nodes, extras:{sh3_model_bind:JSON.stringify({version:1, corrections})}});
  doc.scenes[0].nodes = [root];
  return {model, original, doc, binary, root};
}

function temporary(callback) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sh3-fbx-bind-'));
  try { callback(folder); } finally { fs.rmSync(folder, {recursive:true, force:true}); }
}

test('FBX authoring axes restore native rest and inverse binds from GLB and GLTF without changing geometry', () => temporary(folder => {
  for (const extension of ['glb', 'gltf']) {
    const {model, original, doc, binary, root} = authoringScene(), file = path.join(folder, 'edited.' + extension);
    const source = readGlb(original);
    if (extension === 'glb') fs.writeFileSync(file, writeGlb(doc, binary));
    else { doc.buffers[0].uri = 'model.bin'; fs.writeFileSync(path.join(folder, 'model.bin'), binary); fs.writeFileSync(file, JSON.stringify(doc)); }
    const restored = loadGltfFile(file), parsed = readGlb(restored);
    assert.deepEqual(validateRig(model, parsed.doc, parsed.accessor, true), [0,1,2]);
    assert.equal(parsed.doc.nodes[root].extras.sh3_model_bind, undefined);
    for (const [i, mesh] of source.doc.meshes.entries()) for (const key of ['POSITION','NORMAL','JOINTS_0','WEIGHTS_0']) {
      assert.deepEqual(parsed.accessor(parsed.doc.meshes[i].primitives[0].attributes[key]), source.accessor(mesh.primitives[0].attributes[key]));
    }
    const again = path.join(folder, 'restored.glb'); fs.writeFileSync(again, restored);
    assert.deepEqual(loadGltfFile(again), restored);
  }
}));

test('FBX calibration preserves actual rest-pose edits for strict validation', () => temporary(folder => {
  const {model, doc, binary} = authoringScene(), file = path.join(folder, 'edited.glb');
  doc.nodes[doc.skins[0].joints[1]].matrix[12] += 2;
  fs.writeFileSync(file, writeGlb(doc, binary)); const result = readGlb(loadGltfFile(file));
  assert.throws(() => validateRig(model, result.doc, result.accessor, true), /bone001 rest pose differs/);
}));

test('FBX calibration does not replace edited inverse bind matrices with a stored snapshot', () => temporary(folder => {
  const {model, doc, binary} = authoringScene(), file = path.join(folder, 'edited.glb');
  const acc = doc.accessors[doc.skins[0].inverseBindMatrices], offset = (doc.bufferViews[acc.bufferView].byteOffset || 0) + (acc.byteOffset || 0) + 12 * 4;
  binary.writeFloatLE(binary.readFloatLE(offset) + 2, offset);
  fs.writeFileSync(file, writeGlb(doc, binary)); const result = readGlb(loadGltfFile(file));
  assert.throws(() => validateRig(model, result.doc, result.accessor, true), /Inverse bind matrices changed/);
}));
