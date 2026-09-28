import {PNG} from 'pngjs';
import jpeg from 'jpeg-js';
import {readGlb} from './gltf.mjs';
import {writeGlb} from './model-import.mjs';
import {range, requireThat, sha256} from './binary.mjs';
import {MODEL_TEXTURE_LIMITS} from './model-limits.mjs';

const linear = n => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
const srgb = n => n <= 0.0031308 ? n * 12.92 : 1.055 * n ** (1 / 2.4) - 0.055;
function decodeImage(data) {
  range(data, 0, 3, 'Material image');
  let image;
  if (data[0] === 0xff && data[1] === 0xd8) image = jpeg.decode(data, {tolerantDecoding: false, maxResolutionInMP: 16, maxMemoryUsageInMB: 256});
  else {
    range(data, 0, 24, 'PNG');
    requireThat(data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')), 'Model color textures must be PNG or JPEG.');
    const width = data.readUInt32BE(16), height = data.readUInt32BE(20);
    requireThat(width && height && width <= 8192 && height <= 8192 && width * height <= 16777216, 'Unsupported material image dimensions.');
    image = PNG.sync.read(data);
  }
  requireThat(image.width <= 8192 && image.height <= 8192 && image.width * image.height <= 16777216, 'Unsupported material image dimensions.');
  return image;
}
function materialImage(doc, binary, material, cache) {
  const pbr = material.pbrMetallicRoughness || {}, info = pbr.baseColorTexture, factors = pbr.baseColorFactor || [1, 1, 1, 1];
  requireThat(factors.length === 4 && factors.every(v => Number.isFinite(v) && v >= 0 && v <= 1), 'Invalid material base color.');
  requireThat(!info || (info.texCoord || 0) === 0, 'Use UV map 0 for native model textures.');
  requireThat(!info?.extensions?.KHR_texture_transform, 'Apply material UV transforms before exporting the model.');
  let image = {width: 1, height: 1, data: Buffer.from([255, 255, 255, 255])};
  if (info) {
    const texture = doc.textures?.[info.index], source = doc.images?.[texture?.source], view = doc.bufferViews?.[source?.bufferView];
    requireThat(view && view.buffer === 0, 'A model material has a missing embedded color image.');
    range(binary, view.byteOffset || 0, view.byteLength, 'Material image');
    if (!cache.has(texture.source)) cache.set(texture.source, decodeImage(binary.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength)));
    image = cache.get(texture.source);
  }
  const data = Buffer.from(image.data);
  if (factors.some(v => v !== 1)) for (let i = 0; i < data.length; i += 4) {
    for (let channel = 0; channel < 3; channel++) data[i + channel] = Math.round(srgb(linear(data[i + channel] / 255) * factors[channel]) * 255);
    data[i + 3] = Math.round(data[i + 3] * factors[3]);
  }
  return {width: image.width, height: image.height, png: PNG.sync.write({...image, data}), hash: sha256(data)};
}

/** Match named native slots; assign unnamed base-color materials to available slots. */
export function modelTexturePlan(buffer, glb) {
  const {doc, binary} = readGlb(glb), count = buffer.readUInt32LE(8), materials = doc.materials || [], reserved = new Set(), mapping = new Map(), images = new Map(), cache = new Map(), signatures = new Map();
  const used = [...new Set((doc.meshes || []).flatMap(mesh => mesh.primitives.map(primitive => primitive.material).filter(index => index !== undefined)))].sort((a, b) => a - b);
  for (const index of used) {
    const material = materials[index]; requireThat(material, 'Unknown model material.');
    const match = /^Texture_(\d+)(?:\.\d{3})?$/.exec(material.name || '');
    if (match) {
      const slot = Number(match[1]); requireThat(slot < MODEL_TEXTURE_LIMITS.slots, 'Texture_' + slot + ' exceeds the expanded ' + MODEL_TEXTURE_LIMITS.slots + '-slot model limit.');
      mapping.set(index, slot); reserved.add(slot);
    }
  }
  for (const index of [...used.filter(i => mapping.has(i)), ...used.filter(i => !mapping.has(i))]) {
    const material = materials[index], pbr = material.pbrMetallicRoughness || {};
    requireThat(!material.extensions?.KHR_materials_pbrSpecularGlossiness, 'Convert legacy specular-glossiness materials to base-color materials before export.');
    if (!pbr.baseColorTexture && !pbr.baseColorFactor && mapping.has(index) && mapping.get(index) < count) continue;
    const image = materialImage(doc, binary, material, cache), signature = image.width + 'x' + image.height + ':' + image.hash;
    let slot = mapping.get(index);
    if (slot === undefined) {
      slot = signatures.get(signature);
      if (slot === undefined) slot = Array.from({length: MODEL_TEXTURE_LIMITS.slots}, (_, i) => i).find(i => !reserved.has(i));
      requireThat(slot !== undefined, 'The model needs more than ' + MODEL_TEXTURE_LIMITS.slots + ' color texture slots. Combine materials or use a texture atlas.');
      mapping.set(index, slot); reserved.add(slot);
    }
    const previous = images.get(slot);
    requireThat(!previous || previous.signature === signature, 'Different images use Texture_' + slot + '. Give distinct materials distinct Texture_N names.');
    images.set(slot, {...image, slot, signature, name: material.name || 'Material ' + index});
    if (!signatures.has(signature)) signatures.set(signature, slot);
  }
  const targetCount = Math.max(count, ...[...mapping.values()].map(slot => slot + 1));
  for (let slot = count; slot < targetCount; slot++) requireThat(images.has(slot), 'Missing new Texture_' + slot + '. Add consecutive new slots with color images.');
  const normalized = structuredClone(doc);
  for (const [index, slot] of mapping) normalized.materials[index].name = 'Texture_' + slot;
  const replacements = [...images.values()].sort((a, b) => a.slot - b.slot).map(({slot, png}) => ({slot, png}));
  const summary = [...images.values()].sort((a, b) => a.slot - b.slot).map(({slot, name, width, height}) => ({slot, name, width, height, added: slot >= count}));
  return {glb: writeGlb(normalized, binary), replacements, summary, count: targetCount, added: targetCount - count};
}
