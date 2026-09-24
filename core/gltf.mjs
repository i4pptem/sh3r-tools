import {Matrix4, Matrix3, Vector3, Quaternion} from 'three';
import {exchangeRig, validateRig} from './gltf-rig.mjs';
export {validateRig} from './gltf-rig.mjs';
import {gltfAccessor} from './gltf-accessors.mjs';
import {parseModel} from './model.mjs';
import {requireThat, range, align} from './binary.mjs';

export function exportGlb(model, textures = [], motion = null) {
  const parts = [], views = [], accessors = []; let byteLength = 0;
  const blob = (bytes, target) => {
    const padding = align(byteLength, 4) - byteLength;
    if (padding) {parts.push(Buffer.alloc(padding)); byteLength += padding;}
    const view = {buffer: 0, byteOffset: byteLength, byteLength: bytes.length}; if (target) view.target = target;
    views.push(view); parts.push(bytes); byteLength += bytes.length; return views.length - 1;
  };
  const attribute = (values, type, componentType = 5126, bounds = false) => {
    const size = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16}[type];
    const width = componentType === 5123 ? 2 : 4, bytes = Buffer.alloc(values.length * width);
    values.forEach((value, i) => componentType === 5126 ? bytes.writeFloatLE(value, i * width) : componentType === 5123 ? bytes.writeUInt16LE(value, i * width) : bytes.writeUInt32LE(value, i * width));
    const accessor = {bufferView: blob(bytes), componentType, count: values.length / size, type};
    if (bounds) {
      accessor.min = new Array(size).fill(Infinity); accessor.max = new Array(size).fill(-Infinity);
      values.forEach((value, i) => {accessor.min[i % size] = Math.min(accessor.min[i % size], value); accessor.max[i % size] = Math.max(accessor.max[i % size], value);});
    }
    accessors.push(accessor); return accessors.length - 1;
  };
  const nodes = [], sceneNodes = [], meshes = [], skins = [], worldMaterials = [], materialKeys = new Map();
  const {locals, worlds: boneMatrices} = exchangeRig(model.bones);
  for (const [i, bone] of model.bones.entries()) {
    const matrix = locals[i];
    nodes.push({name: bone.name, matrix: matrix.toArray(), children: []});
    if (bone.parent < 0) sceneNodes.push(i);
  }
  model.bones.forEach((b, i) => {if (b.parent >= 0) nodes[b.parent].children.push(i);});
  if (model.bones.length) skins.push({joints: model.bones.map((_, i) => i), inverseBindMatrices: attribute(boneMatrices.flatMap(m => m.clone().invert().toArray()), 'MAT4')});
  for (const mesh of model.meshes) {
    const attributes = {POSITION: attribute(mesh.positions, 'VEC3', 5126, true), NORMAL: attribute(mesh.normals, 'VEC3'), TEXCOORD_0: attribute(mesh.uv, 'VEC2')};
    if (mesh.colors) attributes.COLOR_0 = attribute(mesh.colors, 'VEC3');
    if (skins.length) { attributes.JOINTS_0 = attribute(mesh.joints, 'VEC4', 5123); attributes.WEIGHTS_0 = attribute(mesh.weights, 'VEC4'); }
    const primitive = {attributes, indices: attribute(mesh.indices, 'SCALAR', 5125), mode: 4};
    if (model.world) {
      const key = mesh.texture + ':' + mesh.transparency;
      if (!materialKeys.has(key)) {
        materialKeys.set(key, worldMaterials.length); const pbr = {metallicFactor: 0, roughnessFactor: 1};
        if (mesh.texture >= 0 && mesh.texture < textures.length) pbr.baseColorTexture = {index: mesh.texture};
        worldMaterials.push({name: 'World_' + key, pbrMetallicRoughness: pbr, doubleSided: true, alphaMode: mesh.transparency === 1 ? 'BLEND' : mesh.transparency === 3 ? 'MASK' : 'OPAQUE', extensions: {KHR_materials_unlit: {}}, extras: {sh3Transparency: mesh.transparency}});
      }
      primitive.material = materialKeys.get(key);
    } else if (mesh.texture >= 0 && mesh.texture < textures.length) primitive.material = mesh.texture;
    if (mesh.morphPositions.length) primitive.targets = mesh.morphPositions.map((p, i) => ({POSITION: attribute(p, 'VEC3', 5126, true), NORMAL: attribute(mesh.morphNormals[i], 'VEC3')}));
    const glMesh = {name: mesh.name, primitives: [primitive], extras: {targetNames: model.morphNames, sh3VertexOrder: true, sh3Template: mesh.templateName}};
    if (primitive.targets) glMesh.weights = new Array(primitive.targets.length).fill(0);
    const node = {name: mesh.name, mesh: meshes.length}; if (skins.length) node.skin = 0;
    meshes.push(glMesh); sceneNodes.push(nodes.length); nodes.push(node);
  }
  const animations = [];
  if (motion) {
    const input = attribute(Array.from({length: motion.count}, (_, i) => i / motion.fps), 'SCALAR', 5126, true), samplers = [], channels = [];
    for (let bone = 0; bone < model.bones.length; bone++) {
      const node = nodes[bone], p = new Vector3(), q = new Quaternion(), scale = new Vector3(); locals[bone].decompose(p,q,scale);
      delete node.matrix; node.translation=p.toArray();node.rotation=q.toArray();node.scale=scale.toArray();
      for (const [path,size] of [['translation',3],['rotation',4],['scale',3]]) {
        const values=motion.samples.flatMap(frame=>frame[bone][path]);
        channels.push({sampler:samplers.length,target:{node:bone,path}});
        samplers.push({input,output:attribute(values,size===4?'VEC4':'VEC3'),interpolation:'LINEAR'});
      }
    }
    animations.push({name:'SH3_ANM',samplers,channels});
  }
  const images = textures.map(t => ({bufferView: blob(t.png), mimeType: 'image/png'}));
  const doc = {asset: {version: '2.0', generator: 'Silent Hill 3 Tools', extras: {...model.exchangeExtras, sh3SourceHash: model.sourceHash}}, scene: 0,
    scenes: [{nodes: sceneNodes}], nodes, meshes, skins, images, animations: animations.length ? animations : undefined, textures: textures.map((_, i) => ({source: i})),
    extensionsUsed: model.world ? ['KHR_materials_unlit'] : undefined,
    materials: model.world ? worldMaterials : textures.map((_, i) => ({name: `Texture_${i}`, pbrMetallicRoughness: {baseColorTexture: {index: i}, metallicFactor: 0, roughnessFactor: 1}, doubleSided: true, alphaMode: 'MASK', alphaCutoff: 0.1})),
    bufferViews: views, accessors, buffers: [{byteLength}]};
  const jsonRaw = Buffer.from(JSON.stringify(doc)), json = Buffer.alloc(align(jsonRaw.length, 4), 32); jsonRaw.copy(json);
  const binRaw = Buffer.concat(parts), bin = Buffer.alloc(align(binRaw.length, 4)); binRaw.copy(bin);
  const result = Buffer.alloc(12 + 8 + json.length + 8 + bin.length);
  result.writeUInt32LE(0x46546c67, 0); result.writeUInt32LE(2, 4); result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(json.length, 12); result.writeUInt32LE(0x4e4f534a, 16); json.copy(result, 20);
  result.writeUInt32LE(bin.length, 20 + json.length); result.writeUInt32LE(0x004e4942, 24 + json.length); bin.copy(result, 28 + json.length);
  return result;
}

export function readGlb(buffer) {
  range(buffer, 0, 20, 'GLB');
  requireThat(buffer.readUInt32LE(0) === 0x46546c67 && buffer.readUInt32LE(4) === 2 && buffer.readUInt32LE(8) === buffer.length, 'Expected a binary glTF 2.0 (.glb) file.');
  let doc, binary;
  for (let offset = 12; offset < buffer.length;) {
    range(buffer, offset, 8); const size = buffer.readUInt32LE(offset), type = buffer.readUInt32LE(offset + 4); range(buffer, offset + 8, size);
    if (type === 0x4e4f534a) doc = JSON.parse(buffer.subarray(offset + 8, offset + 8 + size).toString());
    if (type === 0x004e4942) binary = buffer.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size;
  }
  requireThat(doc && binary, 'GLB requires JSON and embedded binary data.');
  const accessor = index => gltfAccessor(doc, binary, index);
  return {doc, accessor};
}

/** Edit only vertex attributes on an unchanged topology; rig and native morph storage remain authoritative. */
export function importGlb(buffer, glb) {
  const original = parseModel(buffer), {doc, accessor} = readGlb(glb), output = Buffer.from(buffer);
  const exported = readGlb(exportGlb(original)); validateRig(original, doc, accessor);
  requireThat(doc.meshes?.length === original.meshes.length, 'Keep the original mesh count. New topology requires the native MDL replacement workflow.');
  if (doc.asset.extras?.sh3SourceHash) requireThat(doc.asset.extras.sh3SourceHash === original.sourceHash, 'GLB was exported from a different MDL revision.');
  const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  for (const [index, source] of original.meshes.entries()) {
    const mesh = doc.meshes.find(m => m.name === source.name);
    requireThat(mesh && mesh.primitives.length === 1, `Keep mesh ${source.name} and its single material slot.`);
    const p = mesh.primitives[0], base = exported.doc.meshes[index].primitives[0];
    requireThat((p.mode ?? 4) === 4 && p.indices !== undefined && equal(accessor(p.indices), source.indices), `${source.name}: triangle order or vertex topology changed.`);
    requireThat(!p.extensions, 'Compressed glTF meshes are unsupported.');
    for (const attr of ['JOINTS_0', 'WEIGHTS_0']) if (base.attributes[attr] !== undefined) requireThat(p.attributes[attr] !== undefined && equal(accessor(p.attributes[attr]), exported.accessor(base.attributes[attr])), 'Keep original skin weights and joints in this import mode.');
    const node = doc.nodes.find(n => n.mesh === doc.meshes.indexOf(mesh));
    requireThat(node && !node.matrix && !node.translation && !node.rotation && !node.scale, 'Apply object transforms before export. Mesh nodes must use identity transforms.');
    requireThat((p.targets?.length || 0) === (base.targets?.length || 0), 'Keep all shape keys. Use Import morph data to edit native morphs.');
    for (let t = 0; t < (base.targets?.length || 0); t++) for (const attr of ['POSITION', 'NORMAL']) {
      requireThat(p.targets[t][attr] !== undefined && equal(accessor(p.targets[t][attr]), exported.accessor(base.targets[t][attr])), 'Shape key editing through GLB is not yet verified. Use native morph data import.');
    }
    for (const [attr, size, byteOffset] of [['POSITION', 3, 0], ['NORMAL', 3, source.layout.stride === 48 ? 28 : 12], ['TEXCOORD_0', 2, source.layout.stride === 48 ? 40 : 24]]) {
      const values = accessor(p.attributes[attr]), reference = exported.accessor(base.attributes[attr]);
      requireThat(values.length === source.vertexCount * size && values.every(Number.isFinite), `${source.name}: invalid ${attr}.`);
      for (let v = 0; v < source.vertexCount; v++) {
        const valuesForVertex = values.slice(v * size, v * size + size);
        if (equal(valuesForVertex, reference.slice(v * size, v * size + size))) continue;
        let raw = valuesForVertex;
        if (size === 3) {
          const matrix = original.bones[source.layout.vertexBones[v]]?.matrix;
          const inverse = (matrix ? new Matrix4().fromArray(matrix) : new Matrix4().makeScale(-1, -1, 1)).invert();
          const vector = new Vector3(...raw);
          if (attr === 'NORMAL') vector.applyMatrix3(new Matrix3().getNormalMatrix(inverse)); else vector.applyMatrix4(inverse);
          raw = vector.toArray();
        }
        raw.forEach((value, k) => output.writeFloatLE(value, source.layout.offset + source.layout.header + v * source.layout.stride + byteOffset + k * 4));
      }
    }
  }
  parseModel(output);
  return output;
}
