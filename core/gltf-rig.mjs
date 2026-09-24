import {Box3, Matrix3, Matrix4, Quaternion, Vector3} from 'three';
import {requireThat} from './binary.mjs';

// Bind drift is measured in the coordinates the MDL writer actually stores.
// Accepted drift must stay below half a native position/normal quantization step.
const POSITION_ERROR = 1 / 32, NORMAL_ERROR = 1 / 8192;

function localMatrix(node) {
  const valid = (values, size) => Array.isArray(values) && values.length === size && values.every(Number.isFinite);
  requireThat(node && (node.matrix === undefined || valid(node.matrix, 16)) &&
    (node.translation === undefined || valid(node.translation, 3)) &&
    (node.rotation === undefined || valid(node.rotation, 4)) &&
    (node.scale === undefined || valid(node.scale, 3)), 'Invalid glTF node transform.');
  const matrix = node.matrix ? new Matrix4().fromArray(node.matrix) : new Matrix4().compose(
    new Vector3(...(node.translation || [0, 0, 0])), new Quaternion(...(node.rotation || [0, 0, 0, 1])), new Vector3(...(node.scale || [1, 1, 1])));
  requireThat(matrix.elements.every(Number.isFinite) && matrix.determinant() !== 0, 'Invalid or singular glTF node transform.');
  const e = matrix.elements;
  requireThat(e[3] === 0 && e[7] === 0 && e[11] === 0 && e[15] === 1, 'glTF node transforms must be affine.');
  return matrix;
}

/** Resolve and validate a glTF hierarchy, including non-joint wrapper nodes. */
export function gltfHierarchy(doc) {
  requireThat(Array.isArray(doc.nodes), 'GLB requires scene nodes.');
  const parents = new Map(), matrices = new Map(), visiting = new Set();
  for (const [index, node] of doc.nodes.entries()) for (const child of node.children || []) {
    requireThat(Number.isInteger(child) && doc.nodes[child] && !parents.has(child), 'Invalid glTF node hierarchy.');
    parents.set(child, index);
  }
  function world(index) {
    if (matrices.has(index)) return matrices.get(index);
    requireThat(!visiting.has(index), 'Cyclic glTF node hierarchy.'); visiting.add(index);
    const matrix = localMatrix(doc.nodes[index]);
    if (parents.has(index)) matrix.premultiply(world(parents.get(index)));
    visiting.delete(index); matrices.set(index, matrix); return matrix;
  }
  doc.nodes.forEach((_, index) => world(index));
  return {parents, world};
}

/** Produce TRS-representable exchange matrices from rounded native bind matrices. */
export function exchangeRig(bones) {
  const native = bones.map(b => new Matrix4().fromArray(b.matrix));
  const locals = bones.map((bone, i) => {
    const local = bone.parent < 0 ? native[i].clone() : native[bone.parent].clone().invert().multiply(native[i]);
    const position = new Vector3(), rotation = new Quaternion(), scale = new Vector3();
    local.decompose(position, rotation, scale);
    return new Matrix4().compose(position, rotation.normalize(), scale);
  });
  const nodes = locals.map(matrix => ({matrix: matrix.toArray(), children: []}));
  bones.forEach((bone, i) => {if (bone.parent >= 0) nodes[bone.parent].children.push(i);});
  const hierarchy = gltfHierarchy({nodes});
  return {locals, worlds: bones.map((_, i) => hierarchy.world(i))};
}

function geometryBounds(model, doc, accessor) {
  const box = new Box3(), point = new Vector3();
  const include = values => {
    requireThat(values.length % 3 === 0 && values.every(Number.isFinite), 'Invalid replacement position data.');
    for (let i = 0; i < values.length; i += 3) box.expandByPoint(point.fromArray(values, i));
  };
  for (const mesh of model.meshes) {
    include(mesh.positions);
    for (const delta of mesh.morphPositions) include(mesh.positions.map((p, i) => p + delta[i]));
  }
  for (const mesh of doc.meshes || []) for (const primitive of mesh.primitives) {
    const positions = accessor(primitive.attributes.POSITION); include(positions);
    for (const target of primitive.targets || []) if (target.POSITION !== undefined) {
      const delta = accessor(target.POSITION);
      requireThat(delta.length === positions.length, 'Invalid shape-key positions.');
      include(positions.map((p, i) => p + delta[i]));
    }
  }
  if (box.isEmpty()) box.expandByPoint(point.set(0, 0, 0));
  return Array.from({length: 8}, (_, i) => new Vector3(
    i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
}

function bindError(actual, expected, corners) {
  requireThat(actual.elements.every(Number.isFinite) && actual.determinant() !== 0, 'Invalid inverse bind matrix.');
  let position = 0;
  for (const corner of corners) {
    const delta = corner.clone().applyMatrix4(actual).sub(corner.clone().applyMatrix4(expected));
    position = Math.max(position, Math.abs(delta.x), Math.abs(delta.y), Math.abs(delta.z));
  }
  const a = new Matrix3().getNormalMatrix(actual).elements, b = new Matrix3().getNormalMatrix(expected).elements;
  // The row norm bounds the component error for every unit normal, not just its axes.
  const normal = Math.max(...[0, 1, 2].map(row => Math.hypot(...[0, 1, 2].map(col => a[col * 3 + row] - b[col * 3 + row]))));
  return {position, normal};
}

/** Match the original rig and reject changes that exceed native storage precision. */
export function validateRig(model, doc, accessor, reorder = false) {
  if (!model.bones.length) return [];
  requireThat(doc.skins?.length === 1 && doc.skins[0].joints?.length === model.bones.length, 'Keep the original skeleton and skin.');
  const hierarchy = gltfHierarchy(doc), skin = doc.skins[0], joints = new Set(skin.joints);
  const jointMap = skin.joints.map(nodeIndex => model.bones.findIndex(b => b.name === doc.nodes[nodeIndex]?.name));
  requireThat(jointMap.every(i => i >= 0) && new Set(jointMap).size === model.bones.length, 'Keep every original bone name exactly once.');
  const nativeIndex = new Map(skin.joints.map((node, index) => [node, jointMap[index]]));
  const binds = accessor(skin.inverseBindMatrices), corners = geometryBounds(model, doc, accessor);
  requireThat(binds.length === model.bones.length * 16, 'Invalid inverse bind matrices.');
  for (const [index, mapped] of jointMap.entries()) {
    requireThat(reorder || mapped === index, 'Joint order changed. Use model replacement import.');
    const bone = model.bones[mapped], nodeIndex = skin.joints[index];
    let parent = hierarchy.parents.get(nodeIndex);
    while (parent !== undefined && !joints.has(parent)) parent = hierarchy.parents.get(parent);
    requireThat((parent === undefined ? -1 : nativeIndex.get(parent)) === bone.parent, `Skeleton hierarchy changed at ${bone.name}. Keep the original bone parents.`);
    const expected = new Matrix4().fromArray(bone.matrix).invert();
    const rest = bindError(hierarchy.world(nodeIndex).clone().invert(), expected, corners);
    requireThat(rest.position < POSITION_ERROR && rest.normal < NORMAL_ERROR,
      `Skeleton edits are not supported: ${bone.name} rest pose differs beyond native precision (position ${rest.position.toPrecision(4)}, normal ${rest.normal.toPrecision(4)}).`);
    const bind = bindError(new Matrix4().fromArray(binds.slice(index * 16, index * 16 + 16)), expected, corners);
    requireThat(bind.position < POSITION_ERROR && bind.normal < NORMAL_ERROR,
      `Inverse bind matrices changed at ${bone.name} beyond native precision (position ${bind.position.toPrecision(4)}, normal ${bind.normal.toPrecision(4)}).`);
  }
  return jointMap;
}
