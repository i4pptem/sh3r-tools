import {fontSource, encodeFontExtension, importFontCoverage, hiresFontAtlas} from './font-hires.mjs';
import {PNG} from 'pngjs';
import {requireThat, range, align} from './binary.mjs';

const shades = [0, 95, 127, 159, 191, 223, 255];
const HEADER_SIZE = 240, CELL = 32, COLUMNS = 32;

function fontLayout(data, index) {
  range(data, 0, 16, 'Font file header');
  requireThat(data.readUInt32LE(0) === 16, 'Not an SH3 fontdata BIN file.');
  const start = data.readUInt32LE(index * 4), end = data.readUInt32LE(index * 4 + 4);
  requireThat(start >= 16 && end > start && end <= data.length, 'Invalid font section offsets.');
  range(data, start, HEADER_SIZE + 448, 'Font tables');
  const pages = Array.from({length: 8}, (_, page) => data.readUInt16LE(start + page * 2));
  const offsetFor = id => {
    const stored = data.readUInt16LE(start + HEADER_SIZE + id * 2);
    const page = pages.reduce((value, threshold, index) => threshold !== 0 && threshold <= id ? index + 1 : value, 0);
    return stored ? stored * 4 + page * 0x40000 : 0;
  };
  const firstOffsets = Array.from({length: 224}, (_, id) => offsetFor(id)).filter(Boolean);
  requireThat(firstOffsets.length > 0, 'Font has no Latin glyph table.');
  const dataStart = Math.min(...firstOffsets), count = (dataStart - HEADER_SIZE) / 2;
  requireThat(Number.isInteger(count) && count >= 224 && count <= 32768, 'Invalid font glyph count.');
  range(data, start + HEADER_SIZE, count * 2, 'Font glyph offsets');
  const height = index === 0 ? 30 : 24, glyphs = [];
  for (let id = 0; id < count; id++) {
    const offset = offsetFor(id); if (!offset) continue;
    requireThat(offset >= dataStart && start + offset < end, 'Font glyph points outside its section.');
    const width = id < 224 ? data[start + 16 + id] : index === 0 ? 20 : 16;
    requireThat(width > 0 && width <= 32, 'Unsupported font glyph width.');
    requireThat(!glyphs.length || offset >= glyphs.at(-1).offset, 'Font glyph offsets are not ordered.');
    glyphs.push({id, offset, width, height});
  }
  for (const [i, glyph] of glyphs.entries()) glyph.end = glyphs[i + 1]?.offset ?? end - start;
  return {index, start, end, count, dataStart, glyphs, height};
}

function decodeGlyph(data, layout, glyph) {
  let bit = 0;
  const bits = () => {
    const offset = layout.start + glyph.offset + (bit >> 3), shift = bit & 7;
    requireThat(offset < layout.start + glyph.end, `Truncated font glyph ${glyph.id} bitstream (${glyph.offset}..${glyph.end}).`);
    const high = shift > 5 ? (requireThat(offset + 1 < layout.start + glyph.end, `Truncated font glyph ${glyph.id} bits (${glyph.offset}..${glyph.end}).`), data[offset + 1]) : 0;
    const value = ((data[offset] | high << 8) >> shift) & 7; bit += 3; return value;
  };
  const pixels = Buffer.alloc(glyph.width * glyph.height); let cursor = 0;
  while (cursor < pixels.length) {
    const value = bits();
    if (value < 7) {pixels[cursor++] = value; continue;}
    let run = bits();
    if (run === 0) {
      run = bits();
      if (run !== 0) run += 7;
      else {
        run = bits();
        if (run !== 0) run += 14;
        else {
          run = bits() | bits() << 3;
          if (run !== 0) run += 21;
          else run = 84 + (bits() | bits() << 3 | bits() << 6);
        }
      }
    }
    run++;
    requireThat(cursor + run <= pixels.length, 'Font blank run exceeds glyph bounds.'); cursor += run;
  }
  return pixels;
}

function encodeGlyph(pixels) {
  const values = []; let cursor = 0;
  while (cursor < pixels.length) {
    if (pixels[cursor] !== 0 || pixels[cursor + 1] !== 0) {values.push(pixels[cursor++]); continue;}
    let length = 0; while (cursor + length < pixels.length && pixels[cursor + length] === 0 && length < 596) length++;
    cursor += length; const n = length - 1; values.push(7);
    if (n <= 7) values.push(n);
    else if (n <= 14) values.push(0, n - 7);
    else if (n <= 21) values.push(0, 0, n - 14);
    else if (n <= 84) values.push(0, 0, 0, (n - 21) & 7, (n - 21) >> 3);
    else values.push(0, 0, 0, 0, 0, (n - 84) & 7, ((n - 84) >> 3) & 7, (n - 84) >> 6);
  }
  const output = Buffer.alloc(align(Math.ceil(values.length * 3 / 8), 4));
  for (const [i, value] of values.entries()) {
    const bit = i * 3, offset = bit >> 3, shift = bit & 7; output[offset] |= value << shift;
    if (shift > 5) output[offset + 1] |= value >> (8 - shift);
  }
  return output;
}

function atlas(data, index) {
  const layout = fontLayout(data, index), width = CELL * COLUMNS, height = CELL * Math.ceil(layout.glyphs.length / COLUMNS);
  requireThat(height <= 8192, 'Font atlas exceeds supported image height.');
  const rgba = Buffer.alloc(width * height * 4);
  const glyphs = layout.glyphs.map((glyph, i) => {
    const pixels = decodeGlyph(data, layout, glyph), x = i % COLUMNS * CELL, y = Math.floor(i / COLUMNS) * CELL;
    for (let row = 0; row < glyph.height; row++) for (let column = 0; column < glyph.width; column++) {
      const value = shades[pixels[row * glyph.width + column]], dest = ((y + row) * width + x + column) * 4;
      rgba[dest] = rgba[dest + 1] = rgba[dest + 2] = value; rgba[dest + 3] = value ? 255 : 0;
    }
    return {...glyph, x, y};
  });
  return {index, width, height, rgba, png: PNG.sync.write({width, height, data: rgba}), format: `Font atlas · ${index ? 'Small' : 'Normal'}`, editable: true, glyphCount: glyphs.length, glyphs, layout};
}

/** Read normal and small atlases; occupied cells retain their original game glyph IDs. */
export function readFonts(data) {
  const source = fontSource(data);
  return [0, 1].map(index => {const original = atlas(source.native, index); return source.fonts[index] ? hiresFontAtlas(original, source.fonts[index]) : {...original, scale: 1};});
}

/** Replace one native or high-resolution atlas, preserving the other font and its metadata. */
export function replaceFont(data, index, inputPng, {highResolution = false} = {}) {
  requireThat(index === 0 || index === 1, 'Choose the normal or small font atlas.');
  const source = fontSource(data);
  if (highResolution || source.fonts[index]) {
    source.fonts[index] = importFontCoverage(atlas(source.native, index), inputPng);
    return encodeFontExtension(source.native, source.fonts);
  }
  return encodeFontExtension(replaceNativeFont(source.native, index, inputPng), source.fonts);
}

function replaceNativeFont(data, index, inputPng) {
  requireThat(index === 0 || index === 1, 'Choose the normal or small font atlas.');
  const original = atlas(data, index);
  range(inputPng, 0, 24, 'PNG header');
  requireThat(inputPng.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')), 'Choose a PNG image.');
  requireThat(inputPng.readUInt32BE(16) === original.width && inputPng.readUInt32BE(20) === original.height, `Keep atlas dimensions ${original.width} × ${original.height}.`);
  const image = PNG.sync.read(inputPng); if (image.data.equals(original.rgba)) return Buffer.from(data);
  const {layout} = original, chunks = [], header = Buffer.from(data.subarray(layout.start, layout.start + layout.dataStart));
  header.fill(0, 0, 16); header.fill(0, HEADER_SIZE); let cursor = layout.dataStart;
  const occupied = new Uint8Array(original.width * original.height), offsets = [];
  for (const glyph of original.glyphs) {
    const pixels = Buffer.alloc(glyph.width * glyph.height);
    for (let y = 0; y < glyph.height; y++) for (let x = 0; x < glyph.width; x++) {
      const pixel = (glyph.y + y) * original.width + glyph.x + x, offset = pixel * 4; occupied[pixel] = 1;
      const [r, g, b, a] = image.data.subarray(offset, offset + 4);
      requireThat(a === 0 || (a === 255 && r > 0 && r === g && g === b && shades.includes(r)), 'Fonts use transparent pixels or opaque gray values 95, 127, 159, 191, 223, 255. Quantize the PNG to this palette first.');
      pixels[y * glyph.width + x] = a === 0 ? 0 : shades.indexOf(r);
    }
    const source = decodeGlyph(data, layout, glyph);
    const encoded = pixels.equals(source) ? data.subarray(layout.start + glyph.offset, layout.start + glyph.end) : encodeGlyph(pixels);
    requireThat(cursor % 4 === 0 && cursor < 0x240000, 'Font glyph pointer limit exceeded.');
    if (cursor % 0x40000 === 0) {chunks.push(Buffer.alloc(4)); cursor += 4;}
    offsets.push({id: glyph.id, offset: cursor});
    header.writeUInt16LE((cursor % 0x40000) / 4, HEADER_SIZE + glyph.id * 2);
    chunks.push(encoded); cursor += encoded.length;
  }
  for (let i = 0; i < occupied.length; i++) requireThat(occupied[i] || image.data[i * 4 + 3] === 0, 'Keep empty atlas cells and padding transparent. Glyph dimensions and IDs remain fixed.');
  for (let page = 1; page <= 8; page++) {
    const first = offsets.find(glyph => glyph.offset >= page * 0x40000);
    if (first) header.writeUInt16LE(first.id, (page - 1) * 2);
  }
  const section = Buffer.concat([header, ...chunks]);
  const output = Buffer.concat([data.subarray(0, layout.start), section, data.subarray(layout.end)]), difference = section.length - (layout.end - layout.start);
  for (let pointer = index + 1; pointer <= 2; pointer++) output.writeUInt32LE(data.readUInt32LE(pointer * 4) + difference, pointer * 4);
  const decoded = atlas(output, index);
  for (let i = 0; i < image.data.length; i += 4) if (image.data[i + 3]) requireThat(decoded.rgba.subarray(i, i + 4).equals(image.data.subarray(i, i + 4)), 'Font encode verification failed.');
  return output;
}
