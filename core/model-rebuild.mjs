import {PRIMARY_LIMITS, SECONDARY_LIMITS} from './runtime-buffers.mjs';
import {modelTemplate, encodeModelProvenance} from './model-provenance.mjs';
import {Matrix4, Matrix3, Vector3} from 'three';
import {parseModel, modelLayout} from './model.mjs';
import {readGlb, validateRig} from './gltf.mjs';
import {gltfHierarchy} from './gltf-rig.mjs';
import {requireThat, range, align, MAX_ASSET} from './binary.mjs';

import {MODEL_LIMITS as LIMITS, STOCK_MORPH_NODES} from './model-limits.mjs';
const vector = new Vector3();
const targetNames = (mesh, primitive) => (primitive.targets || []).map((_, i) => mesh.extras?.targetNames?.[i] || `Target ${String(i).padStart(2, '0')}`);
function primitives(doc) {
  return (doc.meshes || []).flatMap((mesh, meshIndex) => mesh.primitives.map((primitive, primitiveIndex) => ({
    meshIndex, primitiveIndex, mesh, primitive, name: (mesh.name || `Mesh ${meshIndex}`) + (mesh.primitives.length > 1 ? ` / ${primitiveIndex}` : ''), targets: targetNames(mesh, primitive),
  })));
}

export function replacementInfo(buffer, glb) {
  const model = parseModel(modelTemplate(buffer)), {doc, accessor} = readGlb(glb); validateRig(model, doc, accessor, true);
  const inputs = primitives(doc);
  requireThat(inputs.length > 0 && inputs.length <= 4096, 'GLB has no supported mesh primitives.');
  return {sourceHash: model.sourceHash, limits: LIMITS, stockMorphNodes: STOCK_MORPH_NODES,
    templates: model.meshes.map(m => ({name: m.name, texture: m.texture, group: m.group})),
    inputs: inputs.map((input, index) => ({index, name: input.name, targets: input.targets,
      vertexCount: doc.accessors[input.primitive.attributes.POSITION]?.count || 0,
      template: model.meshes.findIndex(m => m.name === (input.mesh.extras?.sh3Template || input.name.replace(/_part_\d+$/, '')))})),
    morphs: model.morphNames, targetNames: [...new Set(inputs.flatMap(p => p.targets))]};
}

function normalsFor(positions, indices) {
  const normals = new Array(positions.length).fill(0);
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = indices.slice(i, i + 3).map(n => n * 3);
    const ab = new Vector3().fromArray(positions, b).sub(new Vector3().fromArray(positions, a));
    const ac = new Vector3().fromArray(positions, c).sub(new Vector3().fromArray(positions, a));
    const n = ab.cross(ac);
    for (const vertex of [a, b, c]) {normals[vertex] += n.x; normals[vertex + 1] += n.y; normals[vertex + 2] += n.z;}
  }
  for (let i = 0; i < normals.length; i += 3) vector.fromArray(normals, i).normalize().toArray(normals, i);
  return normals;
}

function readGeometry(input, doc, accessor, jointMap, mapping, hierarchy) {
  const p = input.primitive, attributes = p.attributes;
  requireThat((p.mode ?? 4) === 4 && !p.extensions, 'Replacement meshes must be uncompressed triangles.');
  const positions = accessor(attributes.POSITION), count = positions.length / 3;
  requireThat(Number.isInteger(count) && count > 0 && count <= 1000000, 'Invalid replacement vertex count.');
  const indices = p.indices === undefined ? Array.from({length: count}, (_, i) => i) : accessor(p.indices);
  requireThat(indices.length > 0 && indices.length % 3 === 0 && indices.every(i => Number.isInteger(i) && i >= 0 && i < count), 'Invalid replacement triangle indices.');
  const normals = attributes.NORMAL === undefined ? normalsFor(positions, indices) : accessor(attributes.NORMAL);
  const uv = attributes.TEXCOORD_0 === undefined ? new Array(count * 2).fill(0) : accessor(attributes.TEXCOORD_0);
  const joints = accessor(attributes.JOINTS_0), weights = accessor(attributes.WEIGHTS_0);
  requireThat(normals.length === count * 3 && uv.length === count * 2 && joints.length === count * 4 && weights.length === count * 4, 'Replacement attributes have inconsistent vertex counts.');
  requireThat([positions, normals, uv, weights].every(a => a.every(Number.isFinite)), 'Non-finite replacement geometry.');
  const influences = Array.from({length: count}, (_, i) => {
    const combined = new Map();
    for (let j = 0; j < 4; j++) {
      const weight = weights[i * 4 + j], joint = joints[i * 4 + j];
      requireThat(weight >= 0 && Number.isInteger(joint) && jointMap[joint] !== undefined, 'Invalid replacement skin weight or joint.');
      if (weight > 0) combined.set(jointMap[joint], (combined.get(jointMap[joint]) || 0) + weight);
    }
    requireThat(combined.size > 0 && combined.size <= 3, 'Every vertex needs one to three bone influences. Limit weights to 3 in your editor.');
    const list = [...combined], sum = list.reduce((n, [, w]) => n + w, 0);
    return list.map(([bone, weight]) => ({bone, weight: weight / sum}));
  });
  const targets = mapping.map(name => {
    const index = name === null ? -1 : input.targets.indexOf(name);
    if (index < 0) return null;
    const target = p.targets[index], delta = target.POSITION === undefined ? new Array(count * 3).fill(0) : accessor(target.POSITION);
    requireThat(delta.length === positions.length && delta.every(Number.isFinite), 'Invalid shape-key positions.');
    const shape = positions.map((value, i) => value + delta[i]);
    let shapeNormals;
    if (target.NORMAL === undefined) shapeNormals = normalsFor(shape, indices);
    else {
      const nd = accessor(target.NORMAL); requireThat(nd.length === normals.length && nd.every(Number.isFinite), 'Invalid shape-key normals.');
      shapeNormals = normals.map((value, i) => value + nd[i]);
    }
    return {positions: shape, normals: shapeNormals};
  });
  const nodes = doc.nodes.filter(node => node.mesh === input.meshIndex);
  requireThat(nodes.length === 1, 'Each replacement mesh must have exactly one scene node.');
  requireThat(nodes[0].skin === 0, 'Replacement meshes must use the preserved skeleton.');
  const nodeIndex = doc.nodes.indexOf(nodes[0]);
  requireThat(hierarchy.world(nodeIndex).elements.every((value, i) => Math.abs(value - (i % 5 === 0 ? 1 : 0)) <= 1e-6),
    'Apply mesh object transforms before exporting GLB. Replacement geometry must use the original model coordinates.');
  return {positions, normals, uv, influences, indices, targets};
}

function orderInfluences(buffer, template, layout, influences) {
  const offset = template.layout.offset, primaryCount = buffer.readUInt32LE(offset + 28);
  const preferred = new Set(template.layout.boneMap.slice(0, primaryCount).map(bone => 'b:' + bone));
  const pairCount = buffer.readUInt32LE(offset + 36), pairOffset = offset + buffer.readUInt32LE(offset + 40);
  for (let i = 0; i < pairCount; i++) {
    const pair = layout.pairOffset + buffer.readUInt16LE(pairOffset + i * 2) * 2;
    preferred.add('p:' + buffer[pair] + ':' + buffer[pair + 1]);
  }
  return influences.map(list => {
    const cost = primary => paletteKeys([primary, ...list.filter(item => item !== primary)]).filter(key => !preferred.has(key)).length;
    const primary = [...list].sort((a, b) => cost(a) - cost(b) || a.bone - b.bone)[0];
    return [primary, ...list.filter(item => item !== primary).sort((a, b) => a.bone - b.bone)];
  });
}

function paletteKeys(influences) {
  const primary = influences[0].bone;
  return [`b:${primary}`, ...influences.slice(1).map(i => `p:${primary}:${i.bone}`)];
}

function splitGeometry(geometry, maxVertices) {
  const chunks = []; let chunk = {vertices: [], indices: [], palette: new Set(), lookup: new Map()};
  for (let i = 0; i < geometry.indices.length; i += 3) {
    const triangle = geometry.indices.slice(i, i + 3);
    if (new Set(triangle).size < 3) continue;
    const keys = new Set(triangle.flatMap(v => paletteKeys(geometry.influences[v])));
    if ((new Set([...chunk.palette, ...keys]).size > LIMITS.palette || chunk.vertices.length + triangle.filter(vertex => !chunk.lookup.has(vertex)).length > maxVertices) && chunk.indices.length) {chunks.push(chunk); chunk = {vertices: [], indices: [], palette: new Set(), lookup: new Map()};}
    keys.forEach(key => chunk.palette.add(key));
    for (const vertex of triangle) {
      if (!chunk.lookup.has(vertex)) {chunk.lookup.set(vertex, chunk.vertices.length); chunk.vertices.push(vertex);}
      chunk.indices.push(chunk.lookup.get(vertex));
    }
  }
  if (chunk.indices.length) chunks.push(chunk);
  requireThat(chunks.length, 'Replacement mesh has no non-degenerate triangles.'); return chunks;
}

/** Convert isolated triangles into a strip with parity-correct degenerate joins. */
export function triangleStrip(indices) {
  const result = [];
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = indices.slice(i, i + 3);
    if (result.length) {result.push(result.at(-1), a); if (result.length % 2) result.push(a);}
    result.push(a, b, c);
  }
  while (result.length % 4) result.push(result.at(-1)); return result;
}

function quantize(values, scale, label) {
  return values.map(value => {
    const n = Math.round(value * scale);
    requireThat(Number.isInteger(n) && n >= -32768 && n <= 32767, `${label} exceeds native signed-16 range.`); return n;
  });
}

class MorphPool {
  constructor(count) {this.count = count; this.nodes = []; this.lookup = new Map();}
  add(bone, base, shapes) {
    if (!shapes.some(shape => shape.some((n, i) => n !== base[i]))) return -1;
    const key = [bone, ...base, ...shapes.flat()].join(',');
    if (this.lookup.has(key)) return this.lookup.get(key);
    requireThat(this.nodes.length < LIMITS.morphNodes, `Replacement exceeds the native signed-index range of ${LIMITS.morphNodes} unique morph nodes.`);
    const deltas = shapes.map(shape => shape.map((value, i) => {
      const delta = value - base[i]; requireThat(delta >= -32768 && delta <= 32767, 'Morph delta exceeds native signed-16 range.'); return delta;
    }));
    const index = this.nodes.length; this.nodes.push({base, deltas}); this.lookup.set(key, index); return index;
  }
}

function encodeVertices(geometry, chunk, model, pool) {
  const inverses = model.bones.map(b => new Matrix4().fromArray(b.matrix).invert());
  const normals = inverses.map(m => new Matrix3().getNormalMatrix(m));
  const vertexData = Buffer.alloc(chunk.vertices.length * 48), refs = [];
  const palette = [...chunk.palette].filter(k => k.startsWith('b:')).concat([...chunk.palette].filter(k => k.startsWith('p:')));
  const paletteIndex = new Map(palette.map((key, i) => [key, i]));
  for (const [index, vertex] of chunk.vertices.entries()) {
    const influences = geometry.influences[vertex], bone = influences[0].bone, offset = index * 48;
    let position = vector.fromArray(geometry.positions, vertex * 3).applyMatrix4(inverses[bone]).toArray();
    let normal = vector.fromArray(geometry.normals, vertex * 3).applyMatrix3(normals[bone]).toArray();
    let node = -1;
    if (geometry.targets.some(Boolean)) {
      const base = [...quantize(position, 16, 'Morph base position'), ...quantize(normal, -4096, 'Morph base normal')];
      const shapes = geometry.targets.map(target => target ? [
        ...quantize(vector.fromArray(target.positions, vertex * 3).applyMatrix4(inverses[bone]).toArray(), 16, 'Morph position'),
        ...quantize(vector.fromArray(target.normals, vertex * 3).applyMatrix3(normals[bone]).toArray(), -4096, 'Morph normal'),
      ] : base);
      node = pool.add(bone, base, shapes);
      if (node >= 0) {position = base.slice(0, 3).map(v => v / 16); normal = base.slice(3).map(v => -v / 4096);}
    }
    position.forEach((v, k) => vertexData.writeFloatLE(v, offset + k * 4));
    influences.forEach((influence, k) => vertexData.writeFloatLE(influence.weight, offset + 12 + k * 4));
    const keys = paletteKeys(influences);
    for (let k = 0; k < 4; k++) vertexData[offset + 24 + k] = paletteIndex.get(keys[k] || keys[0]);
    normal.forEach((v, k) => vertexData.writeFloatLE(v, offset + 28 + k * 4));
    for (let k = 0; k < 2; k++) vertexData.writeFloatLE(geometry.uv[vertex * 2 + k], offset + 40 + k * 4);
    if (node >= 0) {
      const last = refs.at(-1);
      if (last && last[0] + last[2] === node && last[1] + last[2] === index && last[2] < 65535) last[2]++;
      else refs.push([node, index, 1]);
    }
  }
  return {vertexData, refs, palette};
}

function buildMesh(buffer, template, geometry, chunk, model, pool, pairs) {
  requireThat(chunk.vertices.length <= 65535, 'A mesh partition exceeds the native morph-reference vertex range.');
  const {vertexData, refs, palette} = encodeVertices(geometry, chunk, model, pool);
  const primary = palette.filter(key => key.startsWith('b:')).map(key => Number(key.slice(2)));
  const pairMap = palette.filter(key => key.startsWith('p:')).map(key => {
    const pair = key.slice(2).split(':').map(Number), id = pairs.findIndex(p => p[0] === pair[0] && p[1] === pair[1]);
    if (id >= 0) return id;
    requireThat(pairs.length < LIMITS.pairs, 'Replacement needs more than 256 skinning bone pairs.'); pairs.push(pair); return pairs.length - 1;
  });
  const referenceOffset = 160, boneOffset = align(referenceOffset + refs.length * 6, 16), pairOffset = boneOffset + primary.length * 2;
  const materialOffset = pairOffset + pairMap.length * 2, endHeader = align(materialOffset + 2, 16), vertexOffset = endHeader + 16;
  const indices = triangleStrip(chunk.indices), indexOffset = vertexOffset + vertexData.length, size = indexOffset + indices.length * 4;
  const result = Buffer.alloc(size), source = template.layout.offset;
  range(buffer, source, 160, 'Original mesh header'); buffer.copy(result, 0, source, source + 160);
  const sourceEndHeader = buffer.readUInt32LE(source + 60); range(buffer, source + sourceEndHeader, 16);
  buffer.copy(result, endHeader, source + sourceEndHeader, source + sourceEndHeader + 16);
  const fields = {0: size, 8: vertexOffset, 16: indices.length, 20: refs.length, 24: referenceOffset, 28: primary.length,
    32: boneOffset, 36: pairMap.length, 40: pairOffset, 52: 1, 56: materialOffset, 60: endHeader, 64: vertexOffset,
    68: chunk.vertices.length, 72: indexOffset, 76: indices.length};
  for (const [offset, value] of Object.entries(fields)) result.writeUInt32LE(value, Number(offset));
  refs.forEach((ref, i) => ref.forEach((value, k) => result.writeUInt16LE(value, referenceOffset + i * 6 + k * 2)));
  primary.forEach((bone, i) => result.writeUInt16LE(bone, boneOffset + i * 2));
  pairMap.forEach((pair, i) => result.writeUInt16LE(pair, pairOffset + i * 2));
  result.writeUInt16LE(buffer.readUInt16LE(source + buffer.readUInt32LE(source + 56)), materialOffset);
  vertexData.copy(result, vertexOffset); indices.forEach((value, i) => result.writeUInt32LE(value, indexOffset + i * 4));
  return result;
}

/** Rebuild geometry and native morph mappings while preserving model identity, rig and materials. */
export function rebuildModel(buffer, glb, selection) {
  const originalSize = buffer.length; buffer = modelTemplate(buffer);
  const model = parseModel(buffer), h = modelLayout(buffer), {doc, accessor} = readGlb(glb), inputs = primitives(doc);
  const jointMap = validateRig(model, doc, accessor, true);
  const hierarchy = gltfHierarchy(doc);
  requireThat(jointMap.length, 'Topology rebuilding requires a skinned character model.');
  requireThat(Array.isArray(selection.meshes) && selection.meshes.length && new Set(selection.meshes.map(m => m.input)).size === selection.meshes.length, 'Select each replacement primitive at most once.');
  requireThat(selection.morphs?.length === h.morphCount, 'Map every native morph slot, or explicitly choose Neutral.');
  const names = new Set(inputs.flatMap(input => input.targets));
  requireThat(selection.morphs.every(name => name === null || names.has(name)), 'Unknown or unmapped shape key.');
  const textureStart = buffer.readUInt32LE(12);
  requireThat(textureStart === buffer.readUInt32LE(16) && textureStart >= h.base + 112 && textureStart <= buffer.length, 'Unsupported MDL texture-block layout.');
  const pool = new MorphPool(h.morphCount), pairs = [], groups = [[], []], identities = [[], []], partCounts = new Map();
  for (const choice of [...selection.meshes].sort((a, b) => a.template - b.template || a.input - b.input)) {
    const input = inputs[choice.input], template = model.meshes[choice.template];
    requireThat(input && template, 'Choose a valid native mesh/material template for each part.');
    requireThat(template.layout.stride === 48, 'Choose a skinned (48-byte) mesh template. Rigid mesh conversion has not been validated.');
    const geometry = readGeometry(input, doc, accessor, jointMap, selection.morphs, hierarchy);
    geometry.influences = orderInfluences(buffer, template, h, geometry.influences);
    for (const chunk of splitGeometry(geometry, template.group === 1 ? 682 : 65535)) {
      const part = partCounts.get(template.name) || 0; partCounts.set(template.name, part + 1);
      identities[template.group].push({name: template.name + (part ? '_part_' + part : ''), template: template.name});
      groups[template.group].push(buildMesh(buffer, template, geometry, chunk, model, pool, pairs));
    }
  }
  const parts = [Buffer.from(buffer.subarray(0, textureStart))]; let offset = textureStart;
  const append = bytes => {const padding = align(offset, 16) - offset; if (padding) {parts.push(Buffer.alloc(padding)); offset += padding;} const start = offset; parts.push(bytes); offset += bytes.length; return start;};
  const header = parts[0], field = (at, value) => header.writeUInt32LE(value, h.base + at);
  const pairData = Buffer.from(pairs.flat()); field(20, pairs.length); field(24, append(pairData) - h.base);
  const storedPairs = new Map(Array.from({length: h.pairCount}, (_, i) => [`${buffer[h.pairOffset + i * 2]}:${buffer[h.pairOffset + i * 2 + 1]}`, i]));
  const originalHelpers = h.base + buffer.readUInt32LE(h.base + 28), helpers = Buffer.alloc(pairs.length * 64);
  pairs.forEach(([a, b], i) => {
    const original = storedPairs.get(`${a}:${b}`);
    if (original !== undefined) {range(buffer, originalHelpers + original * 64, 64); buffer.copy(helpers, i * 64, originalHelpers + original * 64, originalHelpers + (original + 1) * 64);}
    else new Matrix4().fromArray(model.bones[b].matrix).invert().multiply(new Matrix4().fromArray(model.bones[a].matrix)).elements.forEach((v, k) => helpers.writeFloatLE(v, i * 64 + k * 4));
  });
  field(28, append(helpers) - h.base);
  const baseData = Buffer.alloc(pool.nodes.length * 12); pool.nodes.forEach((node, i) => node.base.forEach((value, k) => baseData.writeInt16LE(value, i * 12 + k * 2)));
  field(68, pool.nodes.length); field(72, append(baseData) - h.base);
  const descriptors = Buffer.alloc(h.morphCount * 8); field(80, append(descriptors) - h.base);
  for (let target = 0; target < h.morphCount; target++) {
    const records = pool.nodes.flatMap((node, index) => node.deltas[target].some(Boolean) ? [{index, delta: node.deltas[target]}] : []);
    const data = Buffer.alloc(records.length * 14);
    records.forEach((record, i) => {record.delta.forEach((value, k) => data.writeInt16LE(value, i * 14 + k * 2)); data.writeUInt16LE(record.index, i * 14 + 12);});
    descriptors.writeUInt32LE(records.length, target * 8); descriptors.writeUInt32LE(append(data) - h.base, target * 8 + 4);
  }
  for (let group = 0; group < 2; group++) {field(32 + group * 8, groups[group].length); field(36 + group * 8, append(Buffer.concat(groups[group])) - h.base);}
  append(encodeModelProvenance(buffer, identities.flat()));
  const newTextureStart = append(buffer.subarray(textureStart)); header.writeUInt32LE(newTextureStart, 12); header.writeUInt32LE(newTextureStart, 16);
  requireThat(offset <= MAX_ASSET, 'Rebuilt MDL exceeds the editing size limit.');
  const output = Buffer.concat(parts), decoded = parseModel(output);
  requireThat(decoded.morphNames.length === model.morphNames.length && decoded.bones.length === model.bones.length && decoded.meshes.length === groups.flat().length, 'Rebuilt model validation failed.');
  requireThat(output.subarray(newTextureStart).equals(buffer.subarray(textureStart)), 'Embedded texture data changed unexpectedly.');
  const primaryVertices = decoded.meshes.filter(m => m.group === 0).reduce((n, m) => n + m.vertexCount, 0);
  const secondary = decoded.meshes.filter(m => m.group === 1), secondaryVertices = secondary.reduce((n,m) => n+m.vertexCount,0), secondaryTriangles = secondary.reduce((n,m) => n+m.triangleCount,0);
  requireThat(secondaryVertices <= SECONDARY_LIMITS.vertices && secondaryTriangles <= SECONDARY_LIMITS.triangles, 'Secondary geometry exceeds the expanded native index or sorting capacity.');
  return {data: output, report: {vertices: decoded.vertexCount, triangles: decoded.triangleCount, meshes: decoded.meshes.length,
    morphTargets: h.morphCount, morphNodes: pool.nodes.length, bonePairs: pairs.length, maximumPalette: Math.max(...decoded.meshes.map(m => m.layout.boneMap.length)),
    preservedTextureBytes: buffer.length - textureStart, originalSize, newSize: output.length,
    primaryVertices, requiresPrimaryIndexPatch: primaryVertices > PRIMARY_LIMITS.stockVertices,
    requiresMorphPatch: pool.nodes.length > STOCK_MORPH_NODES, secondaryVertices, secondaryTriangles, requiresSecondaryPatch: secondaryVertices > 1024 || secondaryTriangles > 2048, runtimeVerified: false, limits: LIMITS}};
}
