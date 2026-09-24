import test from 'node:test';
import assert from 'node:assert/strict';
import {Matrix4, Quaternion, Vector3} from 'three';
import {exportGlb, readGlb} from '../core/gltf.mjs';
import {gltfHierarchy, validateRig} from '../core/gltf-rig.mjs';

function fixture() {
  const root = new Matrix4().makeRotationY(.37); root.setPosition(100, 200, 300);
  const child = root.clone().multiply(new Matrix4().makeTranslation(0, 5, 0));
  const model = {sourceHash: 'fixture', morphNames: ['Smile'], bones: [
    {name: 'root', parent: -1, matrix: root.toArray().map(v => Math.round(v * 1e6) / 1e6)},
    {name: 'child', parent: 0, matrix: child.toArray().map(v => Math.round(v * 1e6) / 1e6)},
  ], meshes: [{name: 'Face', positions: [0, 0, 0, 100, 100, 100, 100, -100, 100],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], uv: [0, 0, 1, 0, 1, 1], indices: [0, 1, 2],
    joints: [0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], weights: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    morphPositions: [[0, 0, 0, 0, 1, 0, 0, 0, 0]], morphNormals: [new Array(9).fill(0)]}]};
  return {model, ...readGlb(exportGlb(model))};
}

test('native rounded rotations export as TRS-representable matrices with matching binds', () => {
  const {model, doc, accessor} = fixture();
  for (const index of doc.skins[0].joints) {
    const matrix = new Matrix4().fromArray(doc.nodes[index].matrix), p = new Vector3(), q = new Quaternion(), s = new Vector3();
    matrix.decompose(p, q, s);
    const composed = new Matrix4().compose(p, q.normalize(), s);
    assert.ok(matrix.elements.every((v, i) => Math.abs(v - composed.elements[i]) < 1e-12));
  }
  assert.deepEqual(validateRig(model, doc, accessor), [0, 1]);
});

test('float32 TRS round trips and bind drift below native storage precision are accepted', () => {
  const {model, doc, accessor} = fixture();
  for (const index of doc.skins[0].joints) {
    const node = doc.nodes[index], p = new Vector3(), q = new Quaternion(), s = new Vector3();
    new Matrix4().fromArray(node.matrix).decompose(p, q, s); delete node.matrix;
    Object.assign(node, {translation: p.toArray().map(Math.fround), rotation: q.toArray().map(Math.fround), scale: s.toArray().map(Math.fround)});
  }
  doc.nodes[0].translation[0] += .001;
  const inverse = accessor(doc.skins[0].inverseBindMatrices); inverse[12] += .001;
  assert.deepEqual(validateRig(model, doc, i => i === doc.skins[0].inverseBindMatrices ? inverse : accessor(i), true), [0, 1]);
});

for (const [label, edit] of [
  ['translation', m => {m.elements[12] += .1;}],
  ['rotation', m => {m.multiply(new Matrix4().makeRotationX(.01));}],
  ['scale', m => {m.scale(new Vector3(1.001, 1, 1));}],
]) test(`actual skeleton ${label} edits remain rejected`, () => {
  const {model, doc, accessor} = fixture(), matrix = new Matrix4().fromArray(doc.nodes[0].matrix);
  edit(matrix); doc.nodes[0].matrix = matrix.toArray();
  assert.throws(() => validateRig(model, doc, accessor, true), /Skeleton edits.*root/);
});

test('changed inverse binds are rejected even when joint transforms are unchanged', () => {
  const {model, doc, accessor} = fixture(), index = doc.skins[0].inverseBindMatrices;
  const inverse = accessor(index); inverse[12] += .1;
  assert.throws(() => validateRig(model, doc, i => i === index ? inverse : accessor(i), true), /Inverse bind matrices changed at root/);
});

test('joint reordering maps by name only in model replacement mode', () => {
  const {model, doc, accessor} = fixture(), index = doc.skins[0].inverseBindMatrices;
  const old = accessor(index), inverse = old.slice(16).concat(old.slice(0, 16)); doc.skins[0].joints.reverse();
  const read = i => i === index ? inverse : accessor(i);
  assert.deepEqual(validateRig(model, doc, read, true), [1, 0]);
  assert.throws(() => validateRig(model, doc, read), /Joint order changed/);
});

test('identity armature wrappers preserve rig and mesh world transforms', () => {
  const {model, doc, accessor} = fixture();
  const wrapper = doc.nodes.length; doc.nodes.push({name: 'Armature', children: [0, 2], translation: [0, 0, 0], scale: [1, 1, 1]});
  doc.scenes[0].nodes = [wrapper];
  assert.deepEqual(validateRig(model, doc, accessor, true), [0, 1]);
  assert.deepEqual(gltfHierarchy(doc).world(2).toArray(), new Matrix4().toArray());
});

test('reparenting a joint is rejected even if its world transform stays unchanged', () => {
  const {model, doc, accessor} = fixture(), world = gltfHierarchy(doc).world(1).toArray();
  doc.nodes[0].children = []; doc.nodes[1].matrix = world; doc.scenes[0].nodes.push(1);
  assert.throws(() => validateRig(model, doc, accessor, true), /Skeleton hierarchy changed at child/);
});

test('replacement morph extent participates in the bind error bound', () => {
  const {model, doc, accessor} = fixture(), matrix = new Matrix4().fromArray(doc.nodes[0].matrix);
  matrix.multiply(new Matrix4().makeRotationY(.00001)); doc.nodes[0].matrix = matrix.toArray();
  assert.deepEqual(validateRig(model, doc, accessor, true), [0, 1]);
  const target = doc.meshes[0].primitives[0].targets[0].POSITION;
  const delta = accessor(target); delta[0] = 100000;
  assert.throws(() => validateRig(model, doc, i => i === target ? delta : accessor(i), true), /Skeleton edits/);
});

test('malformed, singular and cyclic node transforms are rejected', () => {
  assert.throws(() => gltfHierarchy({nodes: [{scale: [0, 1, 1]}]}), /singular/);
  assert.throws(() => gltfHierarchy({nodes: [{translation: [NaN, 0, 0]}]}), /Invalid glTF node transform/);
  assert.throws(() => gltfHierarchy({nodes: [{children: [1]}, {children: [0]}]}), /Cyclic/);
});
