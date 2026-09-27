import {resizeImage, indexedImage as quantizeImage} from './image-import.mjs';
import {PNG} from 'pngjs';
import {requireThat, range} from './binary.mjs';
import {indexed4Address} from './ps2-texture-address.mjs';

function dimensions(width, height) {requireThat(width > 0 && height > 0 && width <= 8192 && height <= 8192 && width * height <= 16777216, 'Unsupported texture dimensions.');}
const png = (width, height, data) => PNG.sync.write({width, height, data});
function indexAddress(x, y, width) {
  if (width <= 96) return y * width + x;
  const block = (y & ~15) * width + (x & ~15) * 2;
  const swap = (((y + 2) >> 2) & 1) * 4;
  const posY = (((y & ~3) >> 1) + (y & 1)) & 7;
  return block + posY * width * 2 + ((x + swap) & 7) * 4 + ((y >> 1) & 1) + ((x >> 2) & 2);
}
function paletteAddress(start, index, bank = 0) {
  start += (bank >> 2) * 4096 + (bank & 3) * 64;
  const raw = (index & 0xe7) | ((index & 8) << 1) | ((index & 16) >> 1);
  return start + (raw >> 4) * 256 + (raw & 15) * 4;
}
function parsePic(data, decode = true) {
  range(data, 0, 108, 'PIC header');
  requireThat(data.toString('ascii', 88, 92) === 'PICT', 'Invalid Softimage PIC header.');
  const width = data.readUInt16BE(92), height = data.readUInt16BE(94); dimensions(width, height);
  let cursor = 104, chained = 1; const packets = [];
  while (chained) {
    range(data, cursor, 4); requireThat(packets.length < 4, 'Too many PIC channel packets.');
    chained = data[cursor]; const bits = data[cursor + 1], type = data[cursor + 2], mask = data[cursor + 3]; cursor += 4;
    requireThat(bits === 8 && type <= 2 && mask && !(mask & 15), 'Unsupported PIC packet.');
    packets.push({type, mask, channels: [0, 1, 2, 3].filter(c => mask & (0x80 >> c))});
  }
  if (!decode) return {width, height, format: 'Softimage PIC', editable: true, layout: {kind: 'pic', packets}};
  const rgba = Buffer.alloc(width * height * 4, 255);
  const pixel = channels => {range(data, cursor, channels.length, 'PIC pixel'); const result = data.subarray(cursor, cursor + channels.length); cursor += channels.length; return result;};
  for (let y = 0; y < height; y++) for (const packet of packets) {
    let x = 0;
    while (x < width) {
      let count = 1, repeat = false;
      if (packet.type) {
        range(data, cursor, 1); const c = data[cursor++];
        if (packet.type === 1) {count = c; repeat = true;}
        else if (c < 128) count = c + 1;
        else {repeat = true; if (c === 128) {range(data, cursor, 2); count = data.readUInt16BE(cursor); cursor += 2;} else count = c - 127;}
      }
      requireThat(count > 0 && x + count <= width, 'PIC run exceeds scanline.');
      const value = repeat ? pixel(packet.channels) : null;
      for (let i = 0; i < count; i++) {const bytes = value || pixel(packet.channels); packet.channels.forEach((channel, j) => {rgba[(y * width + x) * 4 + channel] = bytes[j];}); x++;}
    }
  }
  requireThat(cursor === data.length, 'Unexpected trailing PIC data.');
  return {width, height, rgba, format: 'Softimage PIC', editable: true, layout: {kind: 'pic', packets}};
}


function indexedValue(data, layout, x, y, width) {
  if (layout.kind === 'indexed8') return data[layout.pixelOffset + indexAddress(x, y, width)];
  const nibble = indexed4Address(x, y, width);
  return (data[layout.pixelOffset + (nibble >> 1)] >> ((nibble & 1) * 4)) & 15;
}
function colorAddress(layout, index) {
  return paletteAddress(layout.palette, index + (layout.kind === 'indexed4' ? (layout.paletteBank & 15) * 16 : 0), layout.kind === 'indexed4' ? layout.paletteBank >> 4 : layout.paletteBank);
}
function indexedImage(data, texture, bank, decode = true) {
  const {width, height} = texture, layout = {...texture.layout, paletteBank: bank}, rgba = decode ? Buffer.alloc(width * height * 4) : undefined;
  if (decode) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = colorAddress(layout, indexedValue(data, layout, x, y, width)), dest = (y * width + x) * 4;
    data.copy(rgba, dest, p, p + 3); rgba[dest + 3] = Math.min(255, data[p + 3] * 2);
  }
  return {...texture, layout, rgba, format: (layout.kind === 'indexed4' ? 'Indexed 4-bit' : 'Indexed 8-bit') + (texture.paletteBanks.length > 1 ? ' · palette ' + (bank + 1) : '')};
}
function readRecord(data, start, picture = false, decode = true) {
  range(data, start, 32, 'Texture header');
  requireThat(data.readUInt32LE(start) === 0xffffffff && data.readUInt16LE(start + 30) === 0x9999, 'Unsupported texture record.');
  const width = data.readUInt16LE(start + 8), height = data.readUInt16LE(start + 10), size = data.readUInt32LE(start + 16), total = data.readUInt32LE(start + 20);
  dimensions(width, height); requireThat(total >= size + 32, 'Invalid texture record size.'); range(data, start, total, 'Texture pixels');
  const pixelOffset = start + total - size, rgba = decode ? Buffer.alloc(width * height * 4) : undefined; let end = start + total;
  const layout = {kind: 'bgra', pixelOffset, start, picture}; let format = picture ? 'RGBA32 · picture alpha' : 'BGRA32';
  if (size === width * height * 4) {
    if (decode) for (let i = 0; i < width * height; i++) {const p = pixelOffset + i * 4; rgba[i * 4] = data[p + (picture ? 0 : 2)]; rgba[i * 4 + 1] = data[p + 1]; rgba[i * 4 + 2] = data[p + (picture ? 2 : 0)]; rgba[i * 4 + 3] = picture ? Math.min(255, data[p + 3] * 2) : data[p + 3];}
  } else if (size === width * height * 2 && data[start + 12] === 16) {
    layout.kind = 'rgba5551'; format = 'RGBA5551';
    if (decode) for (let i = 0; i < width * height; i++) {
      const value = data.readUInt16LE(pixelOffset + i * 2);
      for (let channel = 0; channel < 3; channel++) rgba[i * 4 + channel] = Math.round(((value >> (channel * 5)) & 31) * 255 / 31);
      rgba[i * 4 + 3] = value & 0x8000 ? 255 : 0;
    }
  } else {
    const bits = size === width * height ? 8 : size * 2 === width * height ? 4 : 0;
    requireThat(bits, 'Unknown indexed texture payload size.');
    requireThat(bits === 8 ? width <= 96 || (width % 16 === 0 && height % 16 === 0) : width % 128 === 0 && height % 128 === 0, 'Unsupported swizzled texture dimensions.');
    range(data, end, 48, 'Palette header'); const paletteSize = data.readUInt32LE(end), banks = data[end + 12];
    requireThat([4, 8, 16].includes(banks) && paletteSize === banks * 1024 && data[end + 14] === 64, 'Unsupported palette layout.');
    const palette = end + 48; range(data, palette, paletteSize, 'Palette');
    if (decode) {
      const addresses = new Uint8Array(width * height);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const address = bits === 8 ? indexAddress(x, y, width) : indexed4Address(x, y, width);
        requireThat(address < addresses.length && !addresses[address], 'Invalid texture swizzle.'); addresses[address] = 1;
      }
    }
    Object.assign(layout, {kind: bits === 8 ? 'indexed8' : 'indexed4', palette, paletteBank: 0, colorCount: 1 << bits});
    const paletteBanks = [];
    for (let bank = 0; bank < banks * (bits === 4 ? 16 : 1); bank++) {
      const candidate = {...layout, paletteBank: bank};
      if (bank === 0 || Array.from({length: layout.colorCount}, (_, index) => data[colorAddress(candidate, index) + 3]).some(Boolean)) paletteBanks.push(bank);
    }
    layout.sharedPalette = paletteBanks.length > 1; end = palette + paletteSize; format = 'Indexed ' + bits + '-bit';
    const texture = {width, height, format, editable: true, layout, end, paletteBanks};
    return indexedImage(data, texture, 0, decode);
  }
  return {width, height, rgba, format, editable: true, layout, end, paletteBanks: [0]};
}

export function readTextures(data, model = false, {picture = false, decode = true} = {}) {
  range(data, 0, 4);
  if (!model && data.readUInt32BE(0) === 0x5380f634) {
    const image = parsePic(data, decode); return [{...image, index: 0, ...(decode ? {png: png(image.width, image.height, image.rgba)} : {})}];
  }
  let start = 0, count = 1, batchOffset = null;
  if (model) {range(data, 0, 16); start = data.readUInt32LE(12); count = data.readUInt32LE(8); if (!count) return [];}
  else if (data.length >= 64 && data.readUInt32LE(0) === 0 && (data.readUInt32LE(12) === 0xa7a7a7a7 || data.subarray(0, 64).every(value => value === 0))) {
    start = 64; if (data.length === 64) return [];
  }
  range(data, start, 32, 'Texture container');
  if (data.readUInt32LE(start) === 0xffffffff && data.readUInt32LE(start + 8) === 32) {
    batchOffset = start; count = data.readUInt32LE(start + 20); range(data, start, data.readUInt32LE(start + 12), 'Texture batch'); start += 32;
  } else requireThat(!model, 'Invalid model texture batch.');
  if (!model && count === 0 && start + 32 <= data.length && data.readUInt32LE(start) === 0xffffffff && data.readUInt16LE(start + 30) === 0x9999) count = 1;
  requireThat(count <= 1024, 'Too many textures.'); const records = [], variants = [];
  for (let index = 0; index < count; index++) {
    const texture = readRecord(data, start, picture, decode); start = texture.end; records.push(texture);
    for (const bank of texture.paletteBanks.slice(1)) variants.push(indexedImage(data, texture, bank, decode));
    if (!model && index + 1 === count && start + 32 <= data.length && data.readUInt32LE(start) === 0xffffffff && data.readUInt16LE(start + 30) === 0x9999) {requireThat(count < 1024, 'Too many textures.'); count++;}
  }
  return [...records, ...variants].map((texture, index) => ({...texture, layout: {...texture.layout, batchOffset}, index, ...(decode ? {png: png(texture.width, texture.height, texture.rgba)} : {})}));
}

export function replaceTexture(data, index, inputPng, model = false, options = {}) {
  const original = readTextures(data, model, options)[index]; requireThat(original, 'Unknown texture.');
  range(inputPng, 0, 24, 'PNG'); requireThat(inputPng.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')), 'Choose a PNG image.');
  dimensions(inputPng.readUInt32BE(16), inputPng.readUInt32BE(20));
  let image = PNG.sync.read(inputPng);
  if (options.adapt) image = resizeImage(image, original.width, original.height);
  requireThat(image.width === original.width && image.height === original.height, `Keep texture dimensions ${original.width} × ${original.height}.`);
  if (original.rgba.equals(image.data)) return Buffer.from(data);
  const {width, height, layout} = original;
  if (options.adapt && layout.kind.startsWith('indexed') && !layout.sharedPalette) image = quantizeImage(image, layout.colorCount);
  if (options.adapt && layout.kind === 'rgba5551') for (let i = 3; i < image.data.length; i += 4) image.data[i] = image.data[i] >= 128 ? 255 : 0;
  if (layout.kind === 'pic') return encodePic(data, image, layout.packets);
  const output = Buffer.from(data);
  if (layout.kind === 'bgra') {
    for (let i = 0; i < width * height; i++) {const p = layout.pixelOffset + i * 4; output[p] = image.data[i * 4 + (layout.picture ? 0 : 2)]; output[p + 1] = image.data[i * 4 + 1]; output[p + 2] = image.data[i * 4 + (layout.picture ? 2 : 0)]; output[p + 3] = layout.picture ? Math.round(image.data[i * 4 + 3] / 2) : image.data[i * 4 + 3];}
  } else if (layout.kind === 'rgba5551') {
    for (let i = 0; i < width * height; i++) {
      requireThat(image.data[i * 4 + 3] === 0 || image.data[i * 4 + 3] === 255, 'RGBA5551 supports transparent or fully opaque alpha only.');
      const value = Math.round(image.data[i * 4] * 31 / 255) | Math.round(image.data[i * 4 + 1] * 31 / 255) << 5 | Math.round(image.data[i * 4 + 2] * 31 / 255) << 10 | (image.data[i * 4 + 3] ? 0x8000 : 0);
      output.writeUInt16LE(value, layout.pixelOffset + i * 2);
    }
  } else {
    const colors = new Map(), fixedColors = new Map(), indices = new Uint8Array(width * height);
    for (let i = 0; i < indices.length; i++) {
      const bytes = [image.data[i * 4], image.data[i * 4 + 1], image.data[i * 4 + 2], Math.round(image.data[i * 4 + 3] / 2)];
      const key = bytes.join(','); let color;
      if (layout.sharedPalette) {
        color = indexedValue(data, layout, i % width, Math.floor(i / width), width);
        requireThat(!fixedColors.has(color) || fixedColors.get(color) === key, 'This texture shares indices between palettes. Recolor existing indexed colors consistently, or replace the native asset.');
        fixedColors.set(color, key);
      } else {
        if (!colors.has(key)) {requireThat(colors.size < layout.colorCount, 'Indexed import supports up to ' + layout.colorCount + ' colors. Quantize the PNG first.'); colors.set(key, colors.size);}
        color = colors.get(key);
      }
      bytes.forEach((value, channel) => {output[colorAddress(layout, color) + channel] = value;}); indices[i] = color;
    }
    if (!layout.sharedPalette) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (layout.kind === 'indexed8') output[layout.pixelOffset + indexAddress(x, y, width)] = indices[y * width + x];
      else {
        const nibble = indexed4Address(x, y, width), offset = layout.pixelOffset + (nibble >> 1), shift = (nibble & 1) * 4;
        output[offset] = (output[offset] & ~(15 << shift)) | indices[y * width + x] << shift;
      }
    }
  }
  const record = readRecord(output, layout.start, layout.picture);
  const decoded = layout.kind.startsWith('indexed') ? indexedImage(output, record, layout.paletteBank) : record;
  for (let i = 0; i < image.data.length; i++) {
    const error = layout.kind === 'rgba5551' && i % 4 !== 3 ? 4 : (layout.kind.startsWith('indexed') || layout.picture) && i % 4 === 3 ? 1 : 0;
    requireThat(Math.abs(decoded.rgba[i] - image.data[i]) <= error, 'Texture encode verification failed.');
  }
  return output;
}

/** Encode PIC channel packets at the supplied image dimensions. */
export function encodePic(data, image, packets) {
  const {width, height} = image, hasAlpha = packets.some(p => p.channels.includes(3));
  requireThat(hasAlpha || image.data.every((v, i) => i % 4 !== 3 || v === 255), 'This PIC has no alpha channel.');
  const output = Buffer.alloc(104 + packets.length * 4 + width * height * packets.reduce((n, p) => n + p.channels.length, 0));
  data.copy(output, 0, 0, 104); output.writeUInt16BE(width, 92); output.writeUInt16BE(height, 94); let cursor = 104;
  packets.forEach((p, i) => {output[cursor++] = i + 1 < packets.length ? 1 : 0; output[cursor++] = 8; output[cursor++] = 0; output[cursor++] = p.mask;});
  for (let y = 0; y < height; y++) for (const p of packets) for (let x = 0; x < width; x++) for (const channel of p.channels) output[cursor++] = image.data[(y * width + x) * 4 + channel];
  requireThat(parsePic(output).rgba.equals(image.data), 'PIC encode verification failed.'); return output;
}
