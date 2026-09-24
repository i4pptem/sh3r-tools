import {PNG} from 'pngjs';
import {range, requireThat, MAX_ASSET} from './binary.mjs';

const MAGIC = Buffer.from('SH3FNT1\0', 'ascii');
export const FONT_DRAW_SIZE = [[20, 30], [16, 24]];

/** Split our optional coverage extension from an otherwise unchanged native font. */
export function fontSource(data) {
  range(data, 0, 16, 'Font header');
  const start = data.readUInt32LE(12);
  if (!start) return {native: data, fonts: [null, null]};
  range(data, start, 32, 'High-resolution font header');
  const extension = data.subarray(start);
  requireThat(extension.subarray(0, 8).equals(MAGIC), 'Unknown font extension.');
  requireThat(extension.readUInt32LE(8) === extension.length && extension.readUInt32LE(12) === start, 'Invalid high-resolution font length.');
  requireThat(extension.subarray(24, 32).every(value => value === 0), 'Unsupported high-resolution font metadata.');
  const native = Buffer.from(data.subarray(0, start)); native.writeUInt32LE(0, 12);
  let cursor = 32;
  const fonts = [0, 1].map(index => {
    const at = extension.readUInt32LE(16 + index * 4); if (!at) return null;
    requireThat(at === cursor, 'High-resolution font sections are not contiguous.'); range(extension, at, 16);
    const scale = extension.readUInt32LE(at), count = extension.readUInt32LE(at + 4), table = extension.readUInt32LE(at + 8), end = extension.readUInt32LE(at + 12);
    requireThat([2, 4].includes(scale) && count >= 224 && count <= 32768 && table === at + 16, 'Invalid high-resolution font descriptor.');
    range(extension, table, count * 4, 'High-resolution glyph table'); cursor = table + count * 4;
    const [width, height] = FONT_DRAW_SIZE[index], size = width * height * scale * scale, glyphs = new Map();
    for (let id = 0; id < count; id++) {
      const offset = extension.readUInt32LE(table + id * 4); if (!offset) continue;
      requireThat(offset === cursor, 'Invalid high-resolution glyph pointer.'); range(extension, offset, size, 'High-resolution glyph');
      glyphs.set(id, extension.subarray(offset, offset + size)); cursor += size;
    }
    requireThat(cursor === end, 'High-resolution font payload length differs.');
    return {scale, count, glyphs};
  });
  requireThat(cursor === extension.length && fonts.some(Boolean), 'Unexpected high-resolution font trailing data.');
  return {native, fonts};
}

/** Append coverage blocks addressed by original glyph IDs, without altering native sections. */
export function encodeFontExtension(native, fonts) {
  if (!fonts.some(Boolean)) return Buffer.from(native);
  requireThat(native.readUInt32LE(12) === 0, 'Expected the native font before appending coverage.');
  const header = Buffer.alloc(32); MAGIC.copy(header); header.writeUInt32LE(native.length, 12);
  const chunks = [header]; let cursor = 32;
  for (const [index, font] of fonts.entries()) {
    if (!font) continue;
    header.writeUInt32LE(cursor, 16 + index * 4);
    const descriptor = Buffer.alloc(16 + font.count * 4), start = cursor;
    descriptor.writeUInt32LE(font.scale); descriptor.writeUInt32LE(font.count, 4); descriptor.writeUInt32LE(start + 16, 8);
    cursor += descriptor.length; chunks.push(descriptor);
    const [width, height] = FONT_DRAW_SIZE[index], size = width * height * font.scale * font.scale;
    for (const [id, pixels] of [...font.glyphs].sort(([a], [b]) => a - b)) {
      requireThat(id >= 0 && id < font.count && pixels.length === size, 'Invalid high-resolution glyph coverage.');
      descriptor.writeUInt32LE(cursor, 16 + id * 4); chunks.push(pixels); cursor += pixels.length;
    }
    descriptor.writeUInt32LE(cursor, 12);
  }
  requireThat(native.length + cursor <= MAX_ASSET, 'High-resolution font exceeds the 256 MiB asset limit.');
  header.writeUInt32LE(cursor, 8);
  const output = Buffer.concat([native, ...chunks]); output.writeUInt32LE(native.length, 12); return output;
}

/** Convert scaled editor cells to full native drawable rectangles and 8-bit coverage. */
export function importFontCoverage(original, inputPng) {
  range(inputPng, 0, 24, 'PNG header');
  requireThat(inputPng.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')), 'Choose a PNG image.');
  const width = inputPng.readUInt32BE(16), height = inputPng.readUInt32BE(20), scale = width / original.width;
  requireThat([2, 4].includes(scale) && height === original.height * scale, `Choose a 2× or 4× atlas: ${original.width * 2} × ${original.height * 2}, or ${original.width * 4} × ${original.height * 4}. Keep the exported cell order.`);
  requireThat(width * height * 4 <= MAX_ASSET, 'Decoded font PNG exceeds the 256 MiB image limit.');
  const image = PNG.sync.read(inputPng), [logicalWidth, logicalHeight] = FONT_DRAW_SIZE[original.index];
  const glyphWidth = logicalWidth * scale, glyphHeight = logicalHeight * scale, glyphs = new Map();
  for (const glyph of original.glyphs) {
    const pixels = Buffer.alloc(glyphWidth * glyphHeight);
    for (let y = 0; y < glyphHeight; y++) for (let x = 0; x < glyphWidth; x++) {
      const at = ((glyph.y * scale + y) * width + glyph.x * scale + x) * 4;
      const gray = (image.data[at] * 2126 + image.data[at + 1] * 7152 + image.data[at + 2] * 722) / 10000;
      pixels[y * glyphWidth + x] = Math.round(gray * image.data[at + 3] / 255);
    }
    glyphs.set(glyph.id, pixels);
  }
  return {scale, count: original.layout.count, glyphs};
}

/** Render coverage in the editor's established grayscale/transparent PNG convention. */
export function hiresFontAtlas(original, font) {
  requireThat(font.count === original.layout.count && font.glyphs.size === original.glyphs.length && original.glyphs.every(glyph => font.glyphs.has(glyph.id)), 'High-resolution glyph IDs differ from the native font.');
  const width = original.width * font.scale, height = original.height * font.scale;
  requireThat(width * height * 4 <= MAX_ASSET, 'Font atlas exceeds the 256 MiB image limit.');
  const rgba = Buffer.alloc(width * height * 4), [logicalWidth, logicalHeight] = FONT_DRAW_SIZE[original.index];
  const glyphWidth = logicalWidth * font.scale, glyphHeight = logicalHeight * font.scale;
  for (const glyph of original.glyphs) {
    const pixels = font.glyphs.get(glyph.id);
    for (let y = 0; y < glyphHeight; y++) for (let x = 0; x < glyphWidth; x++) {
      const value = pixels[y * glyphWidth + x], at = ((glyph.y * font.scale + y) * width + glyph.x * font.scale + x) * 4;
      rgba[at] = rgba[at + 1] = rgba[at + 2] = value; rgba[at + 3] = value ? 255 : 0;
    }
  }
  const glyphs = original.glyphs.map(glyph => ({...glyph, x:glyph.x * font.scale, y:glyph.y * font.scale, width:glyphWidth, height:glyphHeight, advanceWidth:glyph.width}));
  return {...original, width, height, rgba, glyphs, scale: font.scale, png: PNG.sync.write({width, height, data: rgba}), format: `${original.format} · ${font.scale}× · 8-bit coverage`};
}
