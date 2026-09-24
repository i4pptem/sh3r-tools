import profile from './font-runtime-profile.json' with {type:'json'};
import {peLayout} from './morph-runtime.mjs';
import {align, range, requireThat} from './binary.mjs';

const SECTION = '.sh3font', HEADER = 32, MAGIC = Buffer.from('SH3FRT1\0');
function body(address) {
  const data = Buffer.from(profile.code.bytes, 'hex');
  for (const offset of profile.code.relocations) data.writeUInt32LE(data.readUInt32LE(offset) + address - profile.code.base, offset);
  return data;
}
function patches(address) {
  const jump = Buffer.alloc(5); jump[0] = 0xe9; jump.writeInt32LE(address + profile.code.entry - profile.decoder.address - 5, 1);
  return [...profile.patches, {...profile.decoder, replacement:jump.toString('hex')}];
}
function replace(data, layout, address, original, replacement) {
  const at = layout.offset(address), expected = Buffer.from(original, 'hex');
  requireThat(data.subarray(at, at + expected.length).equals(expected), `Font runtime instruction differs at 0x${address.toString(16)}.`);
  Buffer.from(replacement, 'hex').copy(data, at);
}

/** Reverse only the exact known font section; the caller authenticates the restored whole EXE. */
export function restoreFontRuntime(source) {
  const layout = peLayout(source), index = layout.sections.findIndex((_, i) => source.toString('ascii', layout.table + i * 40, layout.table + i * 40 + 8) === SECTION);
  if (index < 0) return {data:source, hasFonts:false};
  const section = layout.sections[index], at = layout.table + index * 40, codeAddress = layout.imageBase + section.rva + HEADER;
  const code = body(codeAddress), rawSize = align(HEADER + code.length, source.readUInt32LE(layout.optional + 36));
  requireThat(index === layout.count - 1 && section.size === HEADER + code.length && section.rawSize === rawSize && section.raw + rawSize === source.length, 'Font runtime section layout differs.');
  range(source, section.raw, rawSize);
  requireThat(source.readUInt32LE(at + 36) === 0x60000020 && source.subarray(at + 24, at + 36).every(value => value === 0), 'Unexpected font runtime section metadata.');
  const header = source.subarray(section.raw, section.raw + HEADER), originalLength = header.readUInt32LE(8);
  requireThat(header.subarray(0, 8).equals(MAGIC) && header.subarray(20).every(value => value === 0), 'Unknown font runtime metadata.');
  const preceding = layout.sections.slice(0, -1), rawEnd = Math.max(...preceding.map(s => s.raw + s.rawSize));
  requireThat(originalLength >= rawEnd && originalLength <= section.raw && align(originalLength, source.readUInt32LE(layout.optional + 36)) === section.raw, 'Invalid original executable length.');
  requireThat(source.subarray(originalLength, section.raw).every(value => value === 0) && source.subarray(section.raw + HEADER + code.length).every(value => value === 0), 'Unexpected font runtime padding.');
  requireThat(source.subarray(section.raw + HEADER, section.raw + HEADER + code.length).equals(code), 'Font runtime code differs from the supported patch.');
  const data = Buffer.from(source.subarray(0, originalLength));
  for (const patch of patches(codeAddress)) replace(data, layout, patch.address, patch.replacement, patch.expected);
  data.fill(0, at, at + 40); data.writeUInt16LE(layout.count - 1, layout.pe + 6);
  data.writeUInt32LE(header.readUInt32LE(12), layout.optional + 4); data.writeUInt32LE(header.readUInt32LE(16), layout.optional + 56);
  return {data, hasFonts:true};
}

/** Add an import-free x86 uploader and a 4× glyph cache to an authenticated executable copy. */
export function expandFontRuntime(source) {
  const layout = peLayout(source), at = layout.table + layout.count * 40;
  const firstRaw = Math.min(...layout.sections.filter(s => s.rawSize).map(s => s.raw));
  requireThat(at + 40 <= firstRaw && source.subarray(at, at + 40).every(value => value === 0), 'No room for the font runtime section header.');
  const sectionAlignment = source.readUInt32LE(layout.optional + 32), fileAlignment = source.readUInt32LE(layout.optional + 36);
  const rva = align(Math.max(...layout.sections.map(s => s.rva + Math.max(s.size, s.rawSize))), sectionAlignment);
  const codeAddress = layout.imageBase + rva + HEADER, code = body(codeAddress), raw = align(source.length, fileAlignment), rawSize = align(HEADER + code.length, fileAlignment);
  requireThat(codeAddress + code.length < 0x80000000, 'Font runtime code exceeds the supported address range.');
  const data = Buffer.alloc(raw + rawSize); source.copy(data); MAGIC.copy(data, raw);
  data.writeUInt32LE(source.length, raw + 8); data.writeUInt32LE(source.readUInt32LE(layout.optional + 4), raw + 12); data.writeUInt32LE(source.readUInt32LE(layout.optional + 56), raw + 16);
  code.copy(data, raw + HEADER);
  for (const patch of patches(codeAddress)) replace(data, layout, patch.address, patch.expected, patch.replacement);
  data.write(SECTION, at, 8, 'ascii'); data.writeUInt32LE(HEADER + code.length, at + 8); data.writeUInt32LE(rva, at + 12);
  data.writeUInt32LE(rawSize, at + 16); data.writeUInt32LE(raw, at + 20); data.writeUInt32LE(0x60000020, at + 36);
  data.writeUInt16LE(layout.count + 1, layout.pe + 6); data.writeUInt32LE(source.readUInt32LE(layout.optional + 4) + rawSize, layout.optional + 4);
  data.writeUInt32LE(align(rva + HEADER + code.length, sectionAlignment), layout.optional + 56);
  return {data, report:{patch:profile.id, scale:profile.scale, textureSize:profile.textureSize, slots:384, coverageBits:8, runtimeVerified:false}};
}
