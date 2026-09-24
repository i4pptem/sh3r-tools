import {assetFormat} from './asset-format.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {requireThat, range, readRange, align, MAX_ASSET, sha256} from './binary.mjs';

export function parseCatalog(file) {
  const compressed = readRange(file, 0, fs.statSync(file).size);
  const data = gunzipSync(compressed, {maxOutputLength: 16 * 1024 * 1024});
  requireThat(data.readUInt32LE(0) === 0x20030417, 'Unsupported ARC master catalog.');
  const clusters = [], files = [];
  let expected;
  for (let offset = 16; offset < data.length;) {
    range(data, offset, 4, 'Catalog record');
    const type = data.readUInt16LE(offset), size = data.readUInt16LE(offset + 2);
    requireThat(size >= 4, 'Invalid catalog record size.'); range(data, offset, size, 'Catalog record');
    if (type === 1) {
      requireThat(size === 12 && !expected, 'Invalid catalog counts.');
      expected = [data.readUInt32LE(offset + 4), data.readUInt32LE(offset + 8)];
    } else if (type === 2 || type === 3) {
      requireThat(size >= 9, 'Invalid catalog name.');
      const name = data.subarray(offset + 8, offset + size).toString('utf8').split('\0')[0];
      if (type === 2) clusters.push({name, count: data.readUInt32LE(offset + 4), index: clusters.length});
      else files.push({index: data.readUInt16LE(offset + 4), cluster: data.readUInt16LE(offset + 6), name});
    } else throw new Error(`Unsupported catalog record ${type}.`);
    offset += size;
  }
  requireThat(expected && expected[0] === clusters.length && expected[1] === files.length, 'ARC catalog count mismatch.');
  const keys = new Set();
  for (const item of files) {
    requireThat(clusters[item.cluster] && item.index < clusters[item.cluster].count, 'Invalid catalog file reference.');
    const key = `${item.cluster}:${item.index}`;
    requireThat(!keys.has(key), 'Duplicate catalog file reference.'); keys.add(key);
  }
  return {clusters, files};
}

export function openArchive(file, names = []) {
  const stat = fs.statSync(file), header = readRange(file, 0, 16);
  const signature = header.readUInt32LE(0), count = header.readUInt32LE(4);
  requireThat(count <= 100000, 'Archive contains too many entries.');
  const format = signature === 0x20030507 ? 'ARC' : signature === 0x00534641 ? 'AFS' : null;
  requireThat(format, 'Select a Silent Hill 3 PC .arc file or an AFS archive.');
  const stride = format === 'ARC' ? 16 : 8, start = format === 'ARC' ? 16 : 8;
  requireThat(start + count * stride <= stat.size, 'Archive index is truncated.');
  const table = readRange(file, 0, start + count * stride);
  const nameMap = new Map(names.map(n => [n.index, n.name]));
  let attributes = null, attributeOffset = 0;
  if (format === 'AFS') {
    const pointerPos = start + count * stride;
    if (pointerPos + 8 <= stat.size) {
      const pointer = readRange(file, pointerPos, 8);
      attributeOffset = pointer.readUInt32LE(0);
      const length = pointer.readUInt32LE(4);
      if (attributeOffset && length >= count * 48 && attributeOffset + length <= stat.size) attributes = readRange(file, attributeOffset, count * 48);
    }
  }
  const entries = Array.from({length: count}, (_, index) => {
    const p = start + index * stride, offset = table.readUInt32LE(p);
    const size = table.readUInt32LE(p + (format === 'ARC' ? 8 : 4));
    requireThat(offset + size <= stat.size && (!size || offset >= table.length), `Entry ${index} is outside the archive.`);
    const storedName = attributes?.subarray(index * 48, index * 48 + 32).toString('utf8').split('\0')[0];
    const name = nameMap.get(index) || storedName || `entry_${String(index).padStart(5, '0')}.bin`;
    return {index, offset, size, name, fileId: format === 'ARC' ? table.readUInt32LE(p + 4) : index,
      size2: format === 'ARC' ? table.readUInt32LE(p + 12) : size,
      extension: path.extname(name).slice(1).toLowerCase(), detectedFormat: assetFormat(readRange(file, offset, Math.min(size, 32)), path.extname(name).slice(1).toLowerCase()), tableOffset: p};
  });
  const sorted = entries.filter(e => e.size).toSorted((a, b) => a.offset - b.offset);
  for (let i = 1; i < sorted.length; i++) requireThat(sorted[i].offset >= sorted[i - 1].offset + sorted[i - 1].size, 'Overlapping archive entries are unsupported.');
  return {file: path.resolve(file), name: path.basename(file), format, entries, size: stat.size, mtime: stat.mtimeMs, attributeOffset, hasAttributes: !!attributes};
}

export function entryBytes(archive, index) {
  const entry = archive.entries[index]; requireThat(entry, 'Unknown archive entry.');
  requireThat(entry.size <= MAX_ASSET, 'Asset too large for preview; export a smaller selection.');
  return readRange(archive.file, entry.offset, entry.size);
}

/** Preserve opaque data and untouched payloads; redirect changed entries to appended, aligned payloads. */
export function buildArchive(archive, replacements, output, progress = () => {}) {
  const current = fs.statSync(archive.file);
  requireThat(current.size === archive.size && current.mtimeMs === archive.mtime, `${archive.name} changed on disk. Reopen it before building.`);
  requireThat(!fs.existsSync(output), 'Build output already exists.');
  fs.copyFileSync(archive.file, output, fs.constants.COPYFILE_EXCL);
  const handle = fs.openSync(output, 'r+');
  try {
    let cursor = archive.size;
    for (const [index, replacement] of replacements) {
      const entry = archive.entries[index]; requireThat(entry, 'Unknown replacement entry.');
      requireThat(archive.format !== 'ARC' || entry.size === entry.size2, 'Compressed ARC entries cannot be replaced yet.');
      cursor = align(cursor, archive.format === 'AFS' ? 2048 : 16);
      requireThat(cursor + replacement.length <= 0xffffffff, 'Patched archive exceeds the 4 GiB format limit.');
      fs.writeSync(handle, replacement, 0, replacement.length, cursor);
      const value = Buffer.alloc(4); value.writeUInt32LE(cursor);
      fs.writeSync(handle, value, 0, 4, entry.tableOffset);
      value.writeUInt32LE(replacement.length);
      fs.writeSync(handle, value, 0, 4, entry.tableOffset + (archive.format === 'ARC' ? 8 : 4));
      if (archive.format === 'ARC') fs.writeSync(handle, value, 0, 4, entry.tableOffset + 12);
      cursor += replacement.length;
    }
    fs.fsyncSync(handle);
  } finally { fs.closeSync(handle); }
  const verified = openArchive(output, archive.entries);
  for (const original of archive.entries) {
    const expected = replacements.get(original.index) ?? entryBytes(archive, original.index);
    const actual = entryBytes(verified, original.index);
    requireThat(actual.equals(expected), `Verification failed for ${original.name}.`);
    requireThat(verified.entries[original.index].fileId === original.fileId, 'Archive file ID changed.');
    progress({message: `Verifying ${archive.name}`, done: original.index + 1, total: archive.entries.length});
  }
  return {file: output, entries: verified.entries.length, changes: [...replacements].map(([index, data]) => ({index, name: archive.entries[index].name, before: sha256(entryBytes(archive, index)), after: sha256(data)}))};
}
