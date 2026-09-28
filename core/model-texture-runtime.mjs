import profile from './model-texture-runtime-profile.json' with {type: 'json'};
import {peLayout} from './morph-runtime.mjs';
import {align, range, requireThat} from './binary.mjs';

const CODE_SECTION = '.sh3tex1', BUFFER_SECTION = '.sh3tbuf';
const HEADER = 112, MAGIC = Buffer.from('SH3TXT1\0');

function codeAt(address, storage) {
  const code = Buffer.from(profile.code.bytes, 'hex');
  for (const relocation of profile.code.relocations) {
    const base = relocation.target === 'code' ? address : storage;
    code.writeUInt32LE(base + relocation.relative, relocation.offset);
  }
  return code;
}

function jump(address, entry, size) {
  const bytes = Buffer.alloc(size, 0x90); bytes[0] = 0xe9;
  bytes.writeInt32LE(entry - address - 5, 1); return bytes;
}
function replace(data, layout, patch, expected, replacement) {
  const at = layout.offset(patch.address);
  range(data, at, expected.length);
  requireThat(data.subarray(at, at + expected.length).equals(expected), `Model texture runtime instruction differs at 0x${patch.address.toString(16)}.`);
  replacement.copy(data, at);
}

/** Restore the exact model texture extension before whole-executable authentication. */
export function restoreModelTextureRuntime(source) {
  const layout = peLayout(source), name = i => source.toString('ascii', layout.table + i * 40, layout.table + i * 40 + 8);
  const index = layout.sections.findIndex((_, i) => name(i) === CODE_SECTION);
  const bufferIndex = layout.sections.findIndex((_, i) => name(i) === BUFFER_SECTION);
  if (index < 0 && bufferIndex < 0) return {data: source, hasModelTextures: false};
  requireThat(index === layout.count - 2 && bufferIndex === layout.count - 1, 'Model texture runtime section order differs.');
  const section = layout.sections[index], buffer = layout.sections[bufferIndex], codeAddress = layout.imageBase + section.rva + HEADER;
  const arena = layout.imageBase + buffer.rva, code = codeAt(codeAddress, arena);
  const rawSize = align(HEADER + code.length, source.readUInt32LE(layout.optional + 36));
  requireThat(section.size === HEADER + code.length && section.rawSize === rawSize && section.raw + rawSize === source.length, 'Model texture runtime code section differs.');
  requireThat(buffer.size === profile.storageBytes && buffer.raw === 0 && buffer.rawSize === 0 && arena % 16 === 0, 'Model texture runtime arena differs.');
  for (const [i, flags] of [[index, 0x60000020], [bufferIndex, 0xc0000080]]) {
    const at = layout.table + i * 40;
    requireThat(source.readUInt32LE(at + 36) === flags && source.subarray(at + 24, at + 36).every(b => b === 0), 'Unexpected model texture section metadata.');
  }
  range(source, section.raw, rawSize);
  const header = source.subarray(section.raw, section.raw + HEADER), originalLength = header.readUInt32LE(8);
  requireThat(header.subarray(0, 8).equals(MAGIC) && header.subarray(24, 32).every(b => b === 0), 'Unknown Model texture runtime metadata.');
  const rawEnd = Math.max(...layout.sections.slice(0, index).map(s => s.raw + s.rawSize));
  requireThat(originalLength >= rawEnd && originalLength <= section.raw && align(originalLength, source.readUInt32LE(layout.optional + 36)) === section.raw, 'Invalid Model texture runtime source length.');
  requireThat(source.subarray(originalLength, section.raw).every(b => b === 0) && source.subarray(section.raw + HEADER + code.length).every(b => b === 0), 'Unexpected Model texture runtime padding.');
  requireThat(source.subarray(section.raw + HEADER, section.raw + HEADER + code.length).equals(code), 'Model texture runtime code differs from the supported patch.');
  const data = Buffer.from(source.subarray(0, originalLength));
  for (const patch of profile.patches) replace(data, layout, patch, jump(patch.address, codeAddress + patch.entry, patch.expected.length / 2), Buffer.from(patch.expected, 'hex'));
  header.subarray(32, 112).copy(data, layout.table + index * 40);
  data.writeUInt16LE(index, layout.pe + 6);
  data.writeUInt32LE(header.readUInt32LE(12), layout.optional + 4);
  data.writeUInt32LE(header.readUInt32LE(16), layout.optional + 12);
  data.writeUInt32LE(header.readUInt32LE(20), layout.optional + 56);
  return {data, hasModelTextures: true};
}

/** Add authenticated model texture tables and native resource storage in separate RX/RW sections. */
export function expandModelTextureRuntime(source) {
  const layout = peLayout(source), at = layout.table + layout.count * 40;
  const firstRaw = Math.min(...layout.sections.filter(s => s.rawSize).map(s => s.raw));
  requireThat(at + 80 <= firstRaw && at + 80 <= source.readUInt32LE(layout.optional + 60), 'No room for the Model texture runtime section headers.');
  requireThat((source.readUInt16LE(layout.pe + 22) & 1) && !(source.readUInt16LE(layout.optional + 70) & 0x40), 'Relocatable executables require a separate model texture patch profile.');
  const sectionAlignment = source.readUInt32LE(layout.optional + 32), fileAlignment = source.readUInt32LE(layout.optional + 36);
  const rva = align(Math.max(...layout.sections.map(s => s.rva + Math.max(s.size, s.rawSize))), sectionAlignment);
  const codeAddress = layout.imageBase + rva + HEADER, codeSize = profile.code.bytes.length / 2;
  const bufferRva = align(rva + HEADER + codeSize, Math.max(sectionAlignment, 16));
  const arena = layout.imageBase + bufferRva;
  requireThat(arena % 16 === 0 && arena + profile.storageBytes < 0x80000000, 'Model texture storage exceeds the supported address range.');
  const code = codeAt(codeAddress, arena), raw = align(source.length, fileAlignment), rawSize = align(HEADER + code.length, fileAlignment);
  const data = Buffer.alloc(raw + rawSize); source.copy(data); MAGIC.copy(data, raw);
  data.writeUInt32LE(source.length, raw + 8);
  data.writeUInt32LE(source.readUInt32LE(layout.optional + 4), raw + 12);
  data.writeUInt32LE(source.readUInt32LE(layout.optional + 12), raw + 16);
  data.writeUInt32LE(source.readUInt32LE(layout.optional + 56), raw + 20);
  source.subarray(at, at + 80).copy(data, raw + 32);
  code.copy(data, raw + HEADER);
  for (const patch of profile.patches) replace(data, layout, patch, Buffer.from(patch.expected, 'hex'), jump(patch.address, codeAddress + patch.entry, patch.expected.length / 2));
  data.fill(0, at, at + 80);
  data.write(CODE_SECTION, at, 8, 'ascii'); data.writeUInt32LE(HEADER + code.length, at + 8); data.writeUInt32LE(rva, at + 12);
  data.writeUInt32LE(rawSize, at + 16); data.writeUInt32LE(raw, at + 20); data.writeUInt32LE(0x60000020, at + 36);
  data.write(BUFFER_SECTION, at + 40, 8, 'ascii'); data.writeUInt32LE(profile.storageBytes, at + 48); data.writeUInt32LE(bufferRva, at + 52); data.writeUInt32LE(0xc0000080, at + 76);
  data.writeUInt16LE(layout.count + 2, layout.pe + 6);
  data.writeUInt32LE(source.readUInt32LE(layout.optional + 4) + rawSize, layout.optional + 4);
  data.writeUInt32LE(source.readUInt32LE(layout.optional + 12) + profile.storageBytes, layout.optional + 12);
  data.writeUInt32LE(align(bufferRva + profile.storageBytes, sectionAlignment), layout.optional + 56);
  return {data, report: {patch: profile.id, slots: profile.slots, primaryRuns: profile.primaryRuns, secondaryRuns: profile.secondaryRuns, storageAddress: arena, storageBytes: profile.storageBytes, resourceCapacity: profile.resourceCapacity, runtimeVerified: false}};
}
