import path from 'node:path';
import {parseMap} from './world-formats.mjs';
import {readTextures} from './textures.mjs';

/** Resolve native GB, TR and embedded material references using catalog virtual paths. */
export function mapAsset(data, virtualPath, findCompanion) {
  const world = parseMap(data), stem = path.posix.basename(virtualPath.replaceAll('\\', '/'), '.map');
  const textures = [], families = new Map(), warnings = [], companions = [];
  const needed = new Set(world.groups.map(group => group.textureSource));
  for (const [family, name] of [[1, stem.slice(0, 2) + 'GB.tex'], [2, stem.startsWith('cc') ? 'cc01TR.tex' : stem + 'TR.tex'], [3, null]]) {
    if (!needed.has(family)) continue;
    const source = name ? findCompanion(name) : world.textureOffset ? {name: virtualPath, data: data.subarray(world.textureOffset)} : null;
    if (!source) {warnings.push(`Missing ${name || 'embedded texture batch'}.`); families.set(family, []); continue;}
    try {
      const images = readTextures(source.data), indices = images.map(image => {
        const index = textures.length; textures.push({...image, index, sourceIndex: image.index, sourceKey: source.key ?? null, sourceOffset: name ? 0 : world.textureOffset, sourceName: source.name, editable: true}); return index;
      });
      families.set(family, indices); companions.push({family, name: source.name, images: images.length});
    } catch (error) {if (error.syscall) throw error; warnings.push(`${source.name}: ${error.message}`); families.set(family, []);}
  }
  const localBase = world.globalTextureGroupCount + world.transparentTextureGroupCount;
  for (const mesh of world.model.meshes) {
    const family = families.get(mesh.textureSource) || [];
    const index = mesh.textureIndex === 0xffffffff && mesh.textureSource === 1 ? family.length - 1 : mesh.textureSource === 3 ? mesh.textureIndex - localBase : mesh.textureIndex;
    mesh.texture = family[index] ?? -1;
    if (mesh.texture < 0) warnings.push(`Group ${mesh.group}: texture family ${mesh.textureSource}, index ${mesh.textureIndex} is unavailable.`);
  }
  world.model.textureCount = textures.length;
  return {...world, textures, companions, warnings: [...new Set(warnings)], note: 'Textured MAP geometry with stored object transforms. Edit parts, UVs and material groups; static parts must stay inside their original visibility bounds. Collision, camera zones and events remain separate.'};
}
