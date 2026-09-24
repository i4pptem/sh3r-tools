/** Identify unnamed payloads without changing their archive identity or native filename. */
export function assetFormat(header, extension = '') {
  if (extension && extension !== 'bin') return extension;
  if (header.length >= 12 && header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WAVE') return 'wav';
  if (header.length >= 20 && header.readUInt16BE(0) === 0x8000 && header[4] === 3 && header[5] === 18 && header[6] === 4 && header[7] > 0 && header[7] <= 8) return 'adx';
  if (header.length >= 4) {
    const magic = header.readUInt32LE(0);
    if (magic === 0x12345678) return 'pack';
    if ([0x29843918, 0x29853918].includes(magic)) return 'cluster';
    if (header.toString('ascii', 0, 4) === 'AIXF') return 'aix';
  }
  return extension || 'bin';
}
