import profile from './character-layout-profile.json' with {type: 'json'};
import {align, requireThat} from './binary.mjs';

const startupNames = new Set(profile.groups.flatMap(group => group.names));
const normalize = name => name.replaceAll('\\', '/').toLowerCase();
export const isCharacterAsset = name => /^data\/(?:pcchr|chr)\//.test(normalize(name)) && /\.(?:mdl_?|anm_?|kg1)$/.test(normalize(name));

/** Calculate native startup slots from the complete catalog and effective staged sizes. */
export function characterRequirements(entries) {
  const sizes = new Map(entries.map(entry => [normalize(entry.name), entry.size]));
  const missing = [...startupNames].filter(name => !sizes.has(name));
  requireThat(missing.length === 0, 'Open the complete game data folder to verify character memory, including chrpl and item archives.');
  const slots = profile.groups.map(group => ({name: group.id, bytes: align(Math.max(...group.names.map(name => sizes.get(name))), profile.blockBytes)}));
  const startupBytes = slots.reduce((sum, slot) => sum + slot.bytes, 0);
  const cacheAssetBytes = Math.max(0, ...entries.filter(entry => isCharacterAsset(entry.name) && !startupNames.has(normalize(entry.name))).map(entry => align(entry.size, profile.blockBytes)));
  const stockCacheBytes = Math.max(0, Math.floor((profile.stockArenaBytes - profile.stockLeadingAlignmentBytes - startupBytes) / profile.blockBytes) * profile.blockBytes);
  const requiresCharacterPatch = startupBytes + profile.stockLeadingAlignmentBytes >= profile.stockArenaBytes || cacheAssetBytes > stockCacheBytes;
  if (requiresCharacterPatch) {
    requireThat(startupBytes <= profile.maxExpandedStartupBytes, 'Character startup files exceed 88 MiB. Reduce embedded texture sizes; the expanded arena also reserves 40 MiB for other characters.');
    requireThat(cacheAssetBytes <= profile.reservedCacheBytes, 'A cached character asset exceeds the 40 MiB native cache. Reduce its embedded textures.');
  }
  return {requiresCharacterPatch, character: {startupBytes, stockCacheBytes, largestCacheAssetBytes: cacheAssetBytes, cacheBytes: requiresCharacterPatch ? profile.reservedCacheBytes : stockCacheBytes, slots}};
}
