import {restoreModelTextureRuntime, expandModelTextureRuntime} from './model-texture-runtime.mjs';
import {restoreCharacterRuntime, expandCharacterRuntime} from './character-runtime.mjs';
import {restoreFontRuntime, expandFontRuntime} from './font-runtime.mjs';
import primary from './primary-index-runtime-profile.json' with {type: 'json'};
import picture from './picture-runtime-profile.json' with {type: 'json'};
import secondary from './secondary-runtime-profile.json' with {type: 'json'};
import morph from './morph-runtime-profile.json' with {type: 'json'};
import {expandMorphRuntime, peLayout, checksum} from './morph-runtime.mjs';
import {align, range, requireThat, sha256} from './binary.mjs';

const sectionName = '.sh3mesh';
export const PRIMARY_LIMITS = {stockVertices: 65536};
export const SECONDARY_LIMITS = {vertices: 65536, triangles: 131072, perMeshVertices: 682};
export const PICTURE_LIMITS = {stockBytes: 0x14c800, slotBytes: picture.slotBytes, arenaBytes: picture.arenaBytes};
const knownHashes = new Set([...morph.originalHashes, ...morph.patched.map(item => item.hash)]);
const storageBytes = Object.values(secondary.buffers).reduce((size, buffer) => size + buffer.stride * buffer.recommendedCount, 0);
function addresses(base) {
  const result = {}; let offset = 0;
  for (const [name, buffer] of Object.entries(secondary.buffers)) {result[name] = base + offset; offset += buffer.stride * buffer.recommendedCount;}
  return result;
}
function instruction(reference, buffers) {
  const bytes = Buffer.from(reference.bytes, 'hex');
  if (buffers) bytes.writeUInt32LE(buffers[reference.buffer] + reference.relative, reference.operand);
  return bytes;
}
function replaceChecked(data, at, expected, replacement) {
  range(data, at, expected.length);
  requireThat(data.subarray(at, at + expected.length).equals(expected), `Runtime patch instruction differs at file offset 0x${at.toString(16)}.`);
  replacement.copy(data, at);
}

/** Reverse only our exact additions, then authenticate the entire supported executable. */
function supportedBase(source) {
  const textures = restoreModelTextureRuntime(source), character = restoreCharacterRuntime(textures.data), font = restoreFontRuntime(character.data), data = Buffer.from(font.data), layout = peLayout(data), {pe, optional, table, count, offset} = layout;
  const hasPrimaryIndices = primary.patches.some(p => data.subarray(offset(p.address), offset(p.address) + p.replacement.length / 2).equals(Buffer.from(p.replacement, 'hex')));
  if (hasPrimaryIndices) for (const p of primary.patches) replaceChecked(data, offset(p.address), Buffer.from(p.replacement, 'hex'), Buffer.from(p.expected, 'hex'));
  const hasPicture = picture.patches.some(p => data.subarray(offset(p.address), offset(p.address) + p.replacement.length / 2).equals(Buffer.from(p.replacement, 'hex')));
  if (hasPicture) for (const p of picture.patches) replaceChecked(data, offset(p.address), Buffer.from(p.replacement, 'hex'), Buffer.from(p.expected, 'hex'));
  const sectionIndex = Array.from({length: count}, (_, i) => i).find(i => data.toString('ascii', table + i * 40, table + i * 40 + 8) === sectionName);
  const hasSecondary = sectionIndex !== undefined;
  if (hasSecondary) {
    const at = table + sectionIndex * 40, section = layout.sections[sectionIndex];
    requireThat(sectionIndex === count - 1 && section.size === storageBytes && section.raw === 0 && section.rawSize === 0 && data.readUInt32LE(at + 36) === 0xc0000080, 'Secondary section layout differs from this patch.');
    requireThat(data.subarray(at + 24, at + 36).every(b => b === 0), 'Unexpected secondary section metadata.');
    const buffers = addresses(layout.imageBase + section.rva);
    for (const ref of secondary.references) replaceChecked(data, offset(ref.address), instruction(ref, buffers), instruction(ref));
    data.fill(0, at, at + 40); data.writeUInt16LE(count - 1, pe + 6);
    data.writeUInt32LE(data.readUInt32LE(optional + 12) - storageBytes, optional + 12);
  }
  const remaining = layout.sections.slice(0, hasSecondary ? -1 : undefined);
  const end = Math.max(...remaining.map(s => s.rva + Math.max(s.size, s.rawSize))), alignment = data.readUInt32LE(optional + 32);
  const sizes = hasSecondary ? [Math.max(...remaining.map(s => s.rva + s.size)), align(end, alignment)] : [data.readUInt32LE(optional + 56)];
  for (const size of sizes) {
    data.writeUInt32LE(size, optional + 56);
    for (const value of [0, checksum(data, optional + 64)]) {
      data.writeUInt32LE(value, optional + 64);
      if (knownHashes.has(sha256(data))) return {data, hasPicture, hasSecondary, hasPrimaryIndices, hasFonts: font.hasFonts, hasCharacter: character.hasCharacter, hasModelTextures: textures.hasModelTextures};
    }
  }
  throw new Error('This executable does not match a supported original or a verified Silent Hill 3 Tools patch. Select a supported sh3.exe.');
}

function expandSecondary(data) {
  const {pe, optional, table, count, sections, offset, imageBase} = peLayout(data);
  const header = table + count * 40, firstRaw = Math.min(...sections.filter(s => s.rawSize).map(s => s.raw));
  range(data, header, 40);
  requireThat(header + 40 <= firstRaw && data.subarray(header, header + 40).every(b => b === 0), 'No room for the secondary mesh section header.');
  const alignment = data.readUInt32LE(optional + 32), rva = align(Math.max(...sections.map(s => s.rva + Math.max(s.size, s.rawSize))), alignment), buffers = addresses(imageBase + rva);
  requireThat(imageBase + rva + storageBytes < 0x80000000, 'Secondary storage exceeds the supported address range.');
  for (const ref of secondary.references) replaceChecked(data, offset(ref.address), instruction(ref), instruction(ref, buffers));
  data.write(sectionName, header, 8, 'ascii'); data.writeUInt32LE(storageBytes, header + 8); data.writeUInt32LE(rva, header + 12); data.writeUInt32LE(0xc0000080, header + 36);
  data.writeUInt16LE(count + 1, pe + 6); data.writeUInt32LE(data.readUInt32LE(optional + 12) + storageBytes, optional + 12);
  data.writeUInt32LE(align(rva + storageBytes, alignment), optional + 56);
  return {patch: 'sh3-secondary-buffers-v1', ...SECONDARY_LIMITS, buffers, bytes: storageBytes, instructionCount: secondary.references.length, runtimeVerified: false};
}

/** Compose authenticated morph, geometry and picture patches, preserving installed extensions. */
export function expandRuntimeBuffers(source, requirements) {
  const normalized = supportedBase(source); let data = normalized.data;
  const report = {patch: 'sh3-runtime-buffers-v6', sourceHash: sha256(source), runtimeVerified: false};
  if (requirements.requiresMorphPatch || morph.patched.some(p => p.hash === sha256(data))) {
    const expanded = expandMorphRuntime(data); data = expanded.data; report.morph = expanded.report;
  }
  if (requirements.requiresSecondaryPatch || normalized.hasSecondary) report.secondary = expandSecondary(data);
  if (requirements.requiresPrimaryIndexPatch || normalized.hasPrimaryIndices) {
    const layout = peLayout(data);
    for (const p of primary.patches) replaceChecked(data, layout.offset(p.address), Buffer.from(p.expected, 'hex'), Buffer.from(p.replacement, 'hex'));
    report.primaryIndices = {patch: primary.id, indexBits: 32, ...PRIMARY_LIMITS, instructionCount: primary.patches.length, runtimeVerified: false};
  }
  if (requirements.requiresPicturePatch || normalized.hasPicture) {
    const layout = peLayout(data);
    for (const p of picture.patches) replaceChecked(data, layout.offset(p.address), Buffer.from(p.expected, 'hex'), Buffer.from(p.replacement, 'hex'));
    report.picture = {patch: picture.id, slotBytes: picture.slotBytes, arenaBytes: picture.arenaBytes, slotCount: picture.slotCount, runtimeVerified: false};
  }
  if (requirements.requiresFontPatch || normalized.hasFonts) {const expanded = expandFontRuntime(data); data = expanded.data; report.font = expanded.report;}
  if (requirements.requiresCharacterPatch || normalized.hasCharacter) {const expanded = expandCharacterRuntime(data); data = expanded.data; report.character = expanded.report;}
  if (requirements.requiresModelTexturePatch || normalized.hasModelTextures) {const expanded = expandModelTextureRuntime(data); data = expanded.data; report.modelTextures = expanded.report;}
  const layout = peLayout(data); data.writeUInt32LE(checksum(data, layout.optional + 64), layout.optional + 64);
  report.outputHash = sha256(data); report.alreadyExpanded = report.sourceHash === report.outputHash;
  return {data, report};
}
