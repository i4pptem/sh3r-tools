import fs from 'node:fs';
import {align, readRange, requireThat} from './binary.mjs';

/** Native SD effects share a fixed sector-read scratch buffer. */
export function validateAfsReplacement(archive, index, data) {
  if (archive.format === 'AFS' && archive.name.toLowerCase() === 'sd.afs' && archive.entries[index]?.detectedFormat === 'wav') {
    requireThat(align(data.length, 2048) <= 0xee800,
      'This sd.afs WAV exceeds the game sound-effect buffer (976896 bytes, including sector padding). Use a shorter sample or a lower sample rate.');
  }
}

/** SH3 derives entry positions from the first sector and rounded entry lengths. */
export function planAfsLayout(archive, replacements) {
  requireThat(archive.format === 'AFS' && archive.entries.length > 0, 'Select a nonempty AFS archive.');
  for (const [index, data] of replacements) {
    requireThat(archive.entries[index], 'Unknown replacement entry.');
    validateAfsReplacement(archive, index, data);
  }
  const tableEnd = 8 + archive.entries.length * 8, headerSize = tableEnd + 8;
  const populated = archive.entries.filter(entry => entry.size);
  const prefixSize = populated.length ? Math.min(...populated.map(entry => entry.offset)) : Math.min(headerSize, archive.size);
  const bodyEnd = Math.max(prefixSize, ...populated.map(entry => entry.offset + entry.size));
  const attributeSize = archive.hasAttributes ? readRange(archive.file, tableEnd + 4, 4).readUInt32LE(0) : 0;
  const tailSource = Math.min(align(bodyEnd, 2048), archive.size,
    archive.hasAttributes && archive.attributeOffset >= bodyEnd ? archive.attributeOffset : Infinity);
  const header = Buffer.alloc(headerSize);
  readRange(archive.file, 0, Math.min(headerSize, prefixSize)).copy(header);
  header.writeUInt32LE(0x00534641, 0); header.writeUInt32LE(archive.entries.length, 4);
  const extents = prefixSize ? [{offset: 0, sourceOffset: 0, size: prefixSize}] : [];
  let cursor = align(Math.max(prefixSize, headerSize), 2048);
  requireThat(cursor / 2048 <= 0xffff, 'AFS first sector exceeds the game directory limit.');
  const entries = archive.entries.map(entry => {
    const size = replacements.get(entry.index)?.length ?? entry.size, offset = cursor;
    requireThat(Number.isSafeInteger(size) && size >= 0 && Math.ceil(size / 2048) <= 0xffff,
      `AFS entry ${entry.index} exceeds the game directory limit of 65535 sectors.`);
    cursor += align(size, 2048);
    requireThat(cursor <= 0xffffffff, 'Rebuilt AFS exceeds the 4 GiB format limit.');
    header.writeUInt32LE(offset, entry.tableOffset); header.writeUInt32LE(size, entry.tableOffset + 4);
    if (!replacements.has(entry.index) && size) extents.push({offset, sourceOffset: entry.offset, size});
    return {index: entry.index, offset, size};
  });
  const tailOffset = cursor, tailSize = archive.size - tailSource;
  if (tailSize) extents.push({offset: tailOffset, sourceOffset: tailSource, size: tailSize});
  cursor += tailSize;
  if (archive.hasAttributes) {
    let attributeOffset;
    if (archive.attributeOffset + attributeSize <= prefixSize) attributeOffset = archive.attributeOffset;
    else if (archive.attributeOffset >= tailSource) attributeOffset = tailOffset + archive.attributeOffset - tailSource;
    else {
      attributeOffset = align(cursor, 2048);
      extents.push({offset: attributeOffset, sourceOffset: archive.attributeOffset, size: attributeSize});
      cursor = attributeOffset + attributeSize;
    }
    requireThat(attributeOffset + attributeSize <= 0xffffffff, 'AFS attributes exceed the format limit.');
    header.writeUInt32LE(attributeOffset, tableEnd); header.writeUInt32LE(attributeSize, tableEnd + 4);
  } else header.fill(0, tableEnd);
  const size = align(cursor, 2048);
  requireThat(size <= 0xffffffff, 'Rebuilt AFS exceeds the 4 GiB format limit.');
  return {header, extents, entries, size};
}

/** Materialize the same sector layout used by the compact overlay, using bounded I/O. */
export function writeAfsLayout(archive, replacements, output) {
  const layout = planAfsLayout(archive, replacements), source = fs.openSync(archive.file, 'r');
  try {
    const target = fs.openSync(output, 'wx');
    try {
      fs.ftruncateSync(target, layout.size);
      const block = Buffer.alloc(1024 * 1024);
      for (const extent of layout.extents) {
        for (let done = 0; done < extent.size;) {
          const length = Math.min(block.length, extent.size - done);
          const read = fs.readSync(source, block, 0, length, extent.sourceOffset + done);
          requireThat(read === length, 'AFS source changed during rebuilding.');
          fs.writeSync(target, block, 0, length, extent.offset + done); done += length;
        }
      }
      fs.writeSync(target, layout.header, 0, layout.header.length, 0);
      for (const [index, data] of replacements) fs.writeSync(target, data, 0, data.length, layout.entries[index].offset);
      fs.fsyncSync(target);
    } finally { fs.closeSync(target); }
  } finally { fs.closeSync(source); }
}
