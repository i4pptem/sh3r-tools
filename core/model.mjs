import {modelProvenance} from './model-provenance.mjs';
import {Matrix4, Matrix3, Vector3} from 'three';
import {requireThat, range, floats, sha256} from './binary.mjs';

const flip = new Matrix4().makeScale(-1, -1, 1);
const v3 = (buffer, offset) => floats(buffer, offset, 3);
const vec = (values, matrix, normal = false) => {
  const result = new Vector3(...values);
  if (normal) result.applyMatrix3(new Matrix3().getNormalMatrix(matrix)); else result.applyMatrix4(matrix);
  return result.toArray();
};
export function modelLayout(buffer) {
  range(buffer, 0, 24, 'MDL header');
  const base = buffer.readUInt32LE(20); range(buffer, base, 84, 'MDL model header');
  requireThat(buffer.readUInt32LE(base) === 0xffff0003, 'Unsupported MDL variant. Expected a PC character model.');
  const u32 = offset => buffer.readUInt32LE(base + offset);
  const result = {base, boneOffset: base + u32(8), boneCount: u32(12), parentOffset: base + u32(16),
    pairCount: u32(20), pairOffset: base + u32(24), groups: [[u32(32), base + u32(36)], [u32(40), base + u32(44)]],
    materialCount: u32(56), materialOffset: base + u32(60), morphBaseCount: u32(68), morphBaseOffset: base + u32(72),
    morphCount: u32(76), morphOffset: base + u32(80), textureCount: buffer.readUInt32LE(8), textureOffset: buffer.readUInt32LE(12) + 32};
  requireThat(result.boneCount <= 256 && result.pairCount <= 4096 && result.morphCount <= 512 && result.morphBaseCount <= 65536, 'Unsupported MDL limits.');
  range(buffer, result.boneOffset, result.boneCount * 64, 'Bones');
  range(buffer, result.parentOffset, result.boneCount, 'Bone parents');
  range(buffer, result.pairOffset, result.pairCount * 2, 'Bone pairs');
  range(buffer, result.materialOffset, result.materialCount * 8, 'Materials');
  range(buffer, result.morphBaseOffset, result.morphBaseCount * 12, 'Morph base');
  range(buffer, result.morphOffset, result.morphCount * 8, 'Morph descriptors');
  return result;
}

export function morphDocument(buffer) {
  const h = modelLayout(buffer);
  const targets = Array.from({length: h.morphCount}, (_, index) => {
    const p = h.morphOffset + index * 8, count = buffer.readUInt32LE(p), offset = h.base + buffer.readUInt32LE(p + 4);
    requireThat(count <= h.morphBaseCount, 'Invalid morph delta count.'); range(buffer, offset, count * 14, 'Morph deltas');
    const deltas = Array.from({length: count}, (_, j) => {
      const a = offset + j * 14, vertex = buffer.readUInt16LE(a + 12);
      requireThat(vertex < h.morphBaseCount, 'Invalid morph vertex reference.');
      return {vertex, position: [0, 2, 4].map(k => buffer.readInt16LE(a + k)), normal: [6, 8, 10].map(k => buffer.readInt16LE(a + k))};
    });
    requireThat(new Set(deltas.map(d => d.vertex)).size === deltas.length, 'Duplicate morph vertex reference.');
    return {index, name: `Morph ${String(index).padStart(2, '0')}`, offset, deltas};
  });
  return {format: 'sh3-morphs-v1', sourceHash: sha256(buffer), positionScale: 16, normalScale: 4096,
    baseCount: h.morphBaseCount, targets};
}

export function replaceMorphs(buffer, document) {
  const original = morphDocument(buffer), result = Buffer.from(buffer);
  requireThat(document.format === original.format && document.sourceHash === original.sourceHash, 'Morph data belongs to a different MDL revision. Export it again from this model.');
  requireThat(document.baseCount === original.baseCount && document.targets?.length === original.targets.length, 'Morph layout must remain unchanged.');
  for (let i = 0; i < original.targets.length; i++) {
    const source = original.targets[i], edited = document.targets[i];
    requireThat(edited.index === i && edited.deltas?.length === source.deltas.length, 'Morph target indices and sparse vertex lists must be preserved.');
    for (let j = 0; j < source.deltas.length; j++) {
      const delta = edited.deltas[j]; requireThat(delta.vertex === source.deltas[j].vertex, 'Morph vertex order changed.');
      requireThat(delta.position?.length === 3 && delta.normal?.length === 3, 'A morph delta needs XYZ position and XYZ normal.');
      [...delta.position, ...delta.normal].forEach((value, k) => {
        requireThat(Number.isInteger(value) && value >= -32768 && value <= 32767, 'Morph values must be signed 16-bit integers.');
        result.writeInt16LE(value, source.offset + j * 14 + k * 2);
      });
    }
  }
  return result;
}

export function parseModel(buffer) {
  const h = modelLayout(buffer), morphs = morphDocument(buffer), provenance = modelProvenance(buffer);
  const bones = Array.from({length: h.boneCount}, (_, index) => {
    const matrix = new Matrix4().fromArray(floats(buffer, h.boneOffset + index * 64, 16));
    const parent = buffer.readInt8(h.parentOffset + index);
    requireThat(parent < h.boneCount && parent !== index, 'Invalid bone hierarchy.');
    requireThat(Math.abs(matrix.determinant()) > 1e-8, 'Invalid bone bind matrix.');
    return {name: `bone${String(index).padStart(3, '0')}`, parent, matrix: flip.clone().multiply(matrix).toArray()};
  });
  for (let i = 0; i < bones.length; i++) {
    const seen = new Set(); let p = i;
    while (p >= 0) { requireThat(!seen.has(p), 'Cyclic skeleton.'); seen.add(p); p = bones[p].parent; }
  }
  const matrices = bones.map(b => new Matrix4().fromArray(b.matrix));
  const materials = Array.from({length: h.materialCount}, (_, i) => buffer.readUInt32LE(h.materialOffset + i * 8));
  const targets = morphs.targets.map(t => {
    const values = new Map();
    for (const d of t.deltas) values.set(d.vertex, d);
    return values;
  });
  const meshes = [];
  for (const [group, [count, offset]] of h.groups.entries()) {
    requireThat(count <= 4096, 'Too many meshes.'); let p = offset;
    for (let index = 0; index < count; index++) {
      range(buffer, p, 80, 'Mesh header'); const u = k => buffer.readUInt32LE(p + k);
      const size = u(0), header = u(8), refCount = u(20), refOffset = p + u(24), boneCount = u(28), boneOffset = p + u(32);
      const pairCount = u(36), pairOffset = p + u(40), materialOffset = p + u(56), vertexCount = u(68), indexOffset = p + u(72), indexCount = u(76);
      range(buffer, p, size, 'Mesh');
      requireThat(size >= 80 && header >= 80 && header <= size && vertexCount > 0 && vertexCount <= 2000000 && indexCount <= 10000000, 'Unsupported mesh counts.');
      const stride = (indexOffset - p - header) / vertexCount;
      requireThat(stride === 32 || stride === 48, `Unsupported vertex stride ${stride}.`);
      requireThat(indexOffset + indexCount * 4 <= p + size, 'Index buffer exceeds mesh.');
      range(buffer, boneOffset, boneCount * 2); range(buffer, pairOffset, pairCount * 2); range(buffer, materialOffset, 2); range(buffer, refOffset, refCount * 6);
      const boneMap = Array.from({length: boneCount}, (_, n) => buffer.readUInt16LE(boneOffset + n * 2));
      for (let n = 0; n < pairCount; n++) {
        const pair = buffer.readUInt16LE(pairOffset + n * 2); requireThat(pair < h.pairCount, 'Invalid bone pair.');
        boneMap.push(buffer[h.pairOffset + pair * 2 + 1]);
      }
      const positions = [], normals = [], uv = [], joints = [], weights = [], vertexBones = [];
      for (let n = 0; n < vertexCount; n++) {
        const a = p + header + n * stride, skinned = stride === 48;
        const bind = skinned ? boneMap[buffer[a + 24]] : 0;
        requireThat(matrices[bind] || !bones.length, 'Invalid vertex bone reference.');
        const matrix = matrices[bind] || flip;
        vertexBones.push(bind);
        positions.push(...vec(v3(buffer, a), matrix));
        normals.push(...vec(v3(buffer, a + (skinned ? 28 : 12)), matrix, true));
        uv.push(...floats(buffer, a + (skinned ? 40 : 24), 2));
        const ws = skinned ? v3(buffer, a + 12) : [1, 0, 0];
        requireThat(ws.every(w => w >= -0.001 && w <= 1.001), `Mesh_${group}_${index}, vertex ${n}: invalid skin weights.`);
        // The native shader supplies a fourth influence as 1 - (w0 + w1 + w2).
        ws.push(Math.max(0, 1 - ws.reduce((a, b) => a + b, 0)));
        const sum = ws.reduce((a, b) => a + b, 0);
        weights.push(...ws.map(w => w / sum));
        for (let j = 0; j < 4; j++) {
          const bone = skinned && ws[j] > 0 ? boneMap[buffer[a + 24 + j]] : 0;
          requireThat(!bones.length || bone < bones.length, `Mesh_${group}_${index}, vertex ${n}: invalid skin bone reference for influence ${j + 1}.`);
          joints.push(bone || 0);
        }
      }
      const strip = Array.from({length: indexCount}, (_, i) => buffer.readUInt32LE(indexOffset + i * 4));
      requireThat(strip.every(i => i < vertexCount), 'Invalid triangle strip index.');
      const indices = [];
      for (let i = 2; i < strip.length; i++) {
        let a = strip[i - 2], b = strip[i - 1], c = strip[i]; if (i % 2) [a, b] = [b, a];
        if (a !== b && b !== c && a !== c) indices.push(a, b, c);
      }
      const refs = Array.from({length: refCount}, (_, n) => [0, 2, 4].map(k => buffer.readUInt16LE(refOffset + n * 6 + k)));
      for (const [src, dest, count] of refs) requireThat(src + count <= h.morphBaseCount && dest + count <= vertexCount, 'Invalid mesh morph range.');
      const morphPositions = [], morphNormals = [];
      if (refs.length) for (const target of targets) {
        const pos = new Array(positions.length).fill(0), norm = new Array(normals.length).fill(0);
        for (const [src, dest, count] of refs) for (let n = 0; n < count; n++) {
          const baseOffset = h.morphBaseOffset + (src + n) * 12, delta = target.get(src + n);
          const rawPos = [0, 1, 2].map(k => (buffer.readInt16LE(baseOffset + k * 2) + (delta?.position[k] || 0)) / 16);
          // PC cluster normals have the opposite orientation to render-vertex normals.
          const rawNorm = [0, 1, 2].map(k => -(buffer.readInt16LE(baseOffset + 6 + k * 2) + (delta?.normal[k] || 0)) / 4096);
          const matrix = matrices[vertexBones[dest + n]] || flip;
          const pv = vec(rawPos, matrix), nv = vec(rawNorm, matrix, true);
          for (let k = 0; k < 3; k++) { pos[(dest + n) * 3 + k] = pv[k] - positions[(dest + n) * 3 + k]; norm[(dest + n) * 3 + k] = nv[k] - normals[(dest + n) * 3 + k]; }
        }
        morphPositions.push(pos); morphNormals.push(norm);
      }
      const identity = provenance?.meshes[meshes.length];
      meshes.push({name: identity?.name || `Mesh_${group}_${index}`, templateName: identity?.template || `Mesh_${group}_${index}`, positions, normals, uv, joints, weights, indices, morphPositions, morphNormals,
        texture: materials[buffer.readUInt16LE(materialOffset)] ?? -1, vertexCount, triangleCount: indices.length / 3, group, visibilityId: header >= 84 ? buffer[p + 0x52] : null,
        layout: {offset: p, header, stride, indexOffset, indexCount, size, boneMap, vertexBones}});
      p += size;
    }
  }
  requireThat(!provenance || provenance.meshes.length === meshes.length, 'Model part identity count mismatch.');
  return {modelId: buffer.readUInt32LE(4), bones, meshes, morphNames: morphs.targets.map(t => t.name), textureCount: h.textureCount,
    vertexCount: meshes.reduce((n, m) => n + m.vertexCount, 0), triangleCount: meshes.reduce((n, m) => n + m.triangleCount, 0), sourceHash: sha256(buffer)};
}
