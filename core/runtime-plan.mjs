import mapGeometry from './map-geometry-runtime-profile.json' with {type:'json'};
import morph from './morph-runtime-profile.json' with {type: 'json'};
import secondary from './secondary-runtime-profile.json' with {type: 'json'};
import primary from './primary-index-runtime-profile.json' with {type: 'json'};
import picture from './picture-runtime-profile.json' with {type: 'json'};
import font from './font-runtime-profile.json' with {type: 'json'};
import character from './character-runtime-profile.json' with {type: 'json'};
import background from './background-runtime-profile.json' with {type:'json'};
import textures from './model-texture-runtime-profile.json' with {type: 'json'};
import {expandRuntimeBuffers} from './runtime-buffers.mjs';
import {peLayout} from './morph-runtime.mjs';
import {requireThat, sha256} from './binary.mjs';

const GAME = 0xffffffff;
const words = (...values) => {const bytes = Buffer.alloc(values.length * 4); values.forEach((v, i) => bytes.writeUInt32LE(v >>> 0, i * 4)); return bytes;};

/** Describe the existing authenticated patches with relocatable runtime storage. */
export function runtimePlan(source, requirements) {
  const sourceHash = sha256(source);
  requireThat(morph.originalHashes.includes(sourceHash), 'ASI overlay requires a supported original sh3.exe. Choose an unmodified executable; restore that same original in the game before using this mod.');
  const original = peLayout(source), expanded = expandRuntimeBuffers(source, requirements), layout = peLayout(expanded.data);
  const regions = layout.sections.slice(original.count).map((section, i) => ({
    name: expanded.data.toString('ascii', layout.table + (i + original.count) * 40, layout.table + (i + original.count) * 40 + 8).replaceAll('\0', ''),
    address: layout.imageBase + section.rva, size: section.size,
    executable: !!(expanded.data.readUInt32LE(layout.table + (i + original.count) * 40 + 36) & 0x20000000),
    data: section.rawSize ? Buffer.from(expanded.data.subarray(section.raw, section.raw + section.size)) : Buffer.alloc(0), relocations: [],
  }));
  const region = name => {const index = regions.findIndex(r => r.name === name); requireThat(index >= 0, `Missing runtime region ${name}.`); return {index, ...regions[index]};};
  const target = address => {
    const index = regions.findIndex(r => address >= r.address && address < r.address + r.size);
    requireThat(index >= 0 || (address >= original.imageBase && address < original.imageBase + source.readUInt32LE(original.optional + 56)), 'Runtime relocation points outside verified game and extension regions.');
    return index < 0 ? {target: GAME, addend: address} : {target: index, addend: address - regions[index].address};
  };
  const writes = [], add = patch => {
    const length = patch.expected.length / 2, expected = Buffer.from(patch.expected, 'hex'), at = layout.offset(patch.address);
    requireThat(source.subarray(original.offset(patch.address), original.offset(patch.address) + length).equals(expected), 'Original instruction differs from runtime profile.');
    const write = {address: patch.address, expected, data: Buffer.from(expanded.data.subarray(at, at + length)), relocations: []};
    writes.push(write); return write;
  };
  const relocate = (record, offset, address, relative = false) => record.relocations.push({offset, ...target(address), relative});
  const jump = patch => {const w = add(patch); relocate(w, 1, w.address + 5 + w.data.readInt32LE(1), true);};
  if (expanded.report.morph) for (const ref of morph.references) {
    const w = add({address: ref.address, expected: ref.bytes}); relocate(w, ref.operand, w.data.readUInt32LE(ref.operand));
  }
  if (expanded.report.secondary) for (const ref of secondary.references) {
    const w = add({address: ref.address, expected: ref.bytes}); relocate(w, ref.operand, w.data.readUInt32LE(ref.operand));
  }
  if (expanded.report.primaryIndices) primary.patches.forEach(add);
  if (expanded.report.picture) picture.patches.forEach(add);
  if (expanded.report.font) {
    font.patches.forEach(add); jump(font.decoder);
    const r = region('.sh3font');
    for (const offset of font.code.relocations) relocate(r, 32 + offset, r.data.readUInt32LE(32 + offset));
  }
  if (expanded.report.character) {
    character.patches.forEach(jump); const r = region('.sh3char');
    for (const offset of character.arenaPointerRelocations) relocate(r, 112 + offset, r.data.readUInt32LE(112 + offset));
    for (const offset of character.externalRelativeBranches) relocate(r, 112 + offset, r.address + 112 + offset + 4 + r.data.readInt32LE(112 + offset), true);
  }
  if (expanded.report.modelTextures) {
    textures.patches.forEach(jump); const r = region('.sh3tex1');
    for (const ref of textures.code.relocations) relocate(r, 112 + ref.offset, r.data.readUInt32LE(112 + ref.offset));
  }
  if(expanded.report.background){background.patches.forEach(jump);const r=region('.sh3bg01');
    for(const offset of background.arenaPointerRelocations)relocate(r,112+offset,r.data.readUInt32LE(112+offset));
    for(const offset of background.externalRelativeBranches)relocate(r,112+offset,r.address+112+offset+4+r.data.readInt32LE(112+offset),true);
  }
  if(expanded.report.mapGeometry){mapGeometry.patches.forEach(jump);const r=region('.sh3tr01');
    for(const offset of mapGeometry.externalRelativeBranches)relocate(r,72+offset,r.address+72+offset+4+r.data.readInt32LE(72+offset),true);
  }
  writes.sort((a, b) => a.address - b.address);
  for (let i = 1; i < writes.length; i++) requireThat(writes[i-1].address + writes[i-1].data.length <= writes[i].address, 'Runtime patch instructions overlap.');
  // Every original-section change must be covered by a profile instruction.
  for (const section of original.sections) for (let i = 0; i < section.rawSize; i++) {
    if (source[section.raw+i] === expanded.data[section.raw+i]) continue;
    const address = original.imageBase + section.rva + i;
    requireThat(writes.some(w => address >= w.address && address < w.address + w.data.length), 'Runtime plan omitted an executable change.');
  }
  return {imageBase: original.imageBase, imageSize: source.readUInt32LE(original.optional + 56), sourceHash, regions, writes, report: {...expanded.report, delivery: 'asi', requirements}};
}

/** Serialize a bounded plan; only authored extensions and changed instructions are included. */
export function encodeRuntimePlan(plan) {
  const chunks = [Buffer.from('SH3ASI1\0'), words(1, plan.imageBase, plan.imageSize, plan.regions.length, plan.writes.length), Buffer.from(plan.sourceHash, 'hex')];
  const relocations = record => record.relocations.map(r => words(r.offset, r.target, r.addend, r.relative ? 1 : 0));
  for (const r of plan.regions) chunks.push(words(r.size, r.executable ? 1 : 0, r.data.length, r.relocations.length), r.data, ...relocations(r));
  for (const w of plan.writes) chunks.push(words(w.address - plan.imageBase, w.data.length, w.relocations.length), w.expected, w.data, ...relocations(w));
  const body = Buffer.concat(chunks); return Buffer.concat([body, Buffer.from(sha256(body), 'hex')]);
}

/** Materialize a plan at chosen addresses for exact disk/runtime parity verification. */
export function materializeRuntimePlan(plan, addresses) {
  requireThat(addresses.length === plan.regions.length, 'Runtime address count differs.');
  const render = (record, base) => {
    const data = Buffer.from(record.data);
    for (const r of record.relocations) {
      const address = (r.target === GAME ? 0 : addresses[r.target]) + r.addend;
      data.writeUInt32LE((r.relative ? address - base - r.offset - 4 : address) >>> 0, r.offset);
    }
    return data;
  };
  return {regions: plan.regions.map((r, i) => render(r, addresses[i])), writes: plan.writes.map(w => render(w, w.address))};
}

