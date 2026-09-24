import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const MAX_ASSET = 256 * 1024 * 1024;
export function requireThat(condition, message) { if (!condition) throw new Error(message); }
export function range(buffer, offset, length, label = 'Data') {
  requireThat(Number.isSafeInteger(offset) && Number.isSafeInteger(length) && offset >= 0 && length >= 0 && offset + length <= buffer.length, `${label} is outside the file.`);
}
export function readRange(file, offset, size) {
  requireThat(size <= MAX_ASSET, 'This asset exceeds the 256 MiB editing limit.');
  const handle = fs.openSync(file, 'r');
  try {
    const result = Buffer.alloc(size);
    let done = 0;
    while (done < size) {
      const read = fs.readSync(handle, result, done, size - done, offset + done);
      requireThat(read > 0, `Unexpected end of ${path.basename(file)}.`);
      done += read;
    }
    return result;
  } finally { fs.closeSync(handle); }
}
export const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
export function fileHash(file) {
  const handle = fs.openSync(file, 'r'), block = Buffer.alloc(1024 * 1024), hash = crypto.createHash('sha256');
  try { let read; while ((read = fs.readSync(handle, block)) > 0) hash.update(block.subarray(0, read)); }
  finally { fs.closeSync(handle); }
  return hash.digest('hex');
}
export const align = (value, boundary) => Math.ceil(value / boundary) * boundary;
export function safeOutput(root, virtualPath) {
  requireThat(typeof virtualPath === 'string' && !/[\x00-\x1f:]/.test(virtualPath), 'Invalid archive filename.');
  const parts = virtualPath.replaceAll('\\', '/').split('/');
  requireThat(parts.every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part)), 'Unsafe archive filename.');
  const resolved = path.resolve(root, ...parts);
  requireThat(resolved.startsWith(path.resolve(root) + path.sep), 'Archive path escapes the export folder.');
  return resolved;
}
export function writeNew(file, data) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, data, {flag: 'wx'});
}
export function floats(buffer, offset, count) {
  range(buffer, offset, count * 4);
  return Array.from({length: count}, (_, i) => { const n = buffer.readFloatLE(offset + i * 4); requireThat(Number.isFinite(n), 'Non-finite model data.'); return n; });
}
