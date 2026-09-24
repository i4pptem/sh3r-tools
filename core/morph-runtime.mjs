import profile from './morph-runtime-profile.json' with {type: 'json'};
import {align, range, requireThat, sha256} from './binary.mjs';
import {MODEL_LIMITS} from './model-limits.mjs';

export function peLayout(data) {
  range(data, 0, 64, 'Executable');
  requireThat(data.toString('ascii', 0, 2) === 'MZ', 'Expected a Windows executable.');
  const pe = data.readUInt32LE(60); range(data, pe, 24);
  requireThat(data.readUInt32LE(pe) === 0x4550 && data.readUInt16LE(pe + 4) === 0x14c, 'Expected the 32-bit PC executable.');
  const optional = pe + 24, optionalSize = data.readUInt16LE(pe + 20), count = data.readUInt16LE(pe + 6);
  range(data, optional, optionalSize + count * 40);
  requireThat(data.readUInt16LE(optional) === 0x10b, 'Expected a PE32 executable.');
  const table = optional + optionalSize;
  const sections = Array.from({length: count}, (_, i) => {
    const at = table + i * 40;
    return {rva: data.readUInt32LE(at + 12), size: data.readUInt32LE(at + 8), rawSize: data.readUInt32LE(at + 16), raw: data.readUInt32LE(at + 20)};
  });
  const imageBase = data.readUInt32LE(optional + 28);
  const offset = address => {
    const rva = address - imageBase, section = sections.find(s => rva >= s.rva && rva < s.rva + s.rawSize);
    requireThat(section, 'A morph instruction is outside the executable code.');
    return section.raw + rva - section.rva;
  };
  return {pe, optional, table, count, sections, imageBase, offset};
}

export function checksum(data, field) {
  let sum = 0;
  for (let i = 0; i < data.length; i += 2) {
    if (i === field || i === field + 2) continue;
    sum += data[i] + ((data[i + 1] || 0) << 8);
    sum = (sum & 0xffff) + (sum >>> 16);
  }
  sum = (sum & 0xffff) + (sum >>> 16);
  return (sum + data.length) >>> 0;
}

/** Build a separate executable whose zero-initialized morph scratch fits native indices. */
export function expandMorphRuntime(source) {
  const sourceHash = sha256(source), existing = profile.patched?.find(item => item.hash === sourceHash);
  if (existing) return {data: Buffer.from(source), report: {...existing.report, sourceHash, outputHash: sourceHash, alreadyExpanded: true}};
  requireThat(profile.originalHashes.includes(sourceHash), 'This executable revision is not supported by the morph expansion patch. Select a supported original sh3.exe. No game files were changed.');
  const layout = peLayout(source), {pe, optional, table, count, sections, offset, imageBase} = layout;
  const header = table + count * 40, firstRaw = Math.min(...sections.filter(s => s.rawSize).map(s => s.raw));
  range(source, header, 40, 'New section header');
  requireThat(header + 40 <= firstRaw && source.subarray(header, header + 40).every(byte => byte === 0), 'No room for the morph section header.');
  requireThat((source.readUInt16LE(pe + 22) & 1) && !(source.readUInt16LE(optional + 70) & 0x40), 'Relocatable executables require a separate patch profile.');
  const alignment = source.readUInt32LE(optional + 32), rva = align(Math.max(...sections.map(s => s.rva + Math.max(s.size, s.rawSize))), alignment);
  const bytes = MODEL_LIMITS.morphNodes * profile.nodeStride, base = imageBase + rva;
  requireThat(base + bytes < 0x80000000, 'Expanded morph storage exceeds the supported address range.');
  const data = Buffer.from(source);
  for (const reference of profile.references) {
    const at = offset(reference.address), expected = Buffer.from(reference.bytes, 'hex'); range(source, at, expected.length);
    requireThat(source.subarray(at, at + expected.length).equals(expected), 'The morph instruction bytes do not match the patch profile.');
    data.writeUInt32LE(base + reference.delta, at + reference.operand);
  }
  data.write('.sh3mrph', header, 8, 'ascii');
  data.writeUInt32LE(bytes, header + 8); data.writeUInt32LE(rva, header + 12);
  data.writeUInt32LE(0xc0000080, header + 36);
  data.writeUInt16LE(count + 1, pe + 6);
  data.writeUInt32LE(source.readUInt32LE(optional + 12) + bytes, optional + 12);
  data.writeUInt32LE(align(rva + bytes, alignment), optional + 56);
  data.writeUInt32LE(checksum(data, optional + 64), optional + 64);
  return {data, report: {patch: 'sh3-morph-buffer-v1', capacity: MODEL_LIMITS.morphNodes, nodeStride: profile.nodeStride,
    bufferAddress: base, bufferBytes: bytes, instructionCount: profile.references.length, sourceHash, outputHash: sha256(data), runtimeVerified: false}};
}
