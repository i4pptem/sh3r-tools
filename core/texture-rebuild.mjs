import {MODEL_TEXTURE_LIMITS} from './model-limits.mjs';
import {PNG} from 'pngjs';
import {readTextures, encodePic} from './textures.mjs';
import {requireThat, range, MAX_ASSET} from './binary.mjs';

function directRecord(data, texture, image) {
  const {layout} = texture, headerSize = layout.pixelOffset - layout.start;
  requireThat(headerSize >= 48 && headerSize - 48 <= 255, 'Unsupported native texture pixel offset.');
  const size = image.width * image.height * 4, output = Buffer.alloc(headerSize + size);
  data.copy(output, 0, layout.start, layout.pixelOffset);
  output.writeUInt16LE(image.width, 8); output.writeUInt16LE(image.height, 10);
  output[12] = layout.kind === 'bgra' ? data[layout.start + 12] : 32; output[13] = headerSize - 48;
  output.writeUInt32LE(size, 16); output.writeUInt32LE(output.length, 20);
  output[25] = 0; output[26] = 0;
  output[28] = Math.ceil(Math.log2(image.width)); output[29] = Math.ceil(Math.log2(image.height));
  for (let i = 0; i < image.width * image.height; i++) {
    const p = headerSize + i * 4;
    output[p] = image.data[i * 4 + (layout.picture ? 0 : 2)]; output[p + 1] = image.data[i * 4 + 1];
    output[p + 2] = image.data[i * 4 + (layout.picture ? 2 : 0)];
    output[p + 3] = layout.picture ? Math.round(image.data[i * 4 + 3] / 2) : image.data[i * 4 + 3];
  }
  return output;
}

function replaceRecord(data, textures, target, record, model) {
  const records = [...new Map(textures.map(t => [t.layout.start, t])).values()].sort((a, b) => a.layout.start - b.layout.start);
  const end = records.at(-1).end, batch = target.layout.batchOffset;
  if (model) {
    requireThat(batch === data.readUInt32LE(12) && batch === data.readUInt32LE(16) && end === data.length,
      'Experimental MDL texture rebuilding requires a terminal texture batch.');
  }
  const delta = record.length - (target.end - target.layout.start);
  requireThat(data.length + delta <= MAX_ASSET, 'Rebuilt texture container exceeds the 256 MiB editing limit.');
  const output = Buffer.concat([data.subarray(0, target.layout.start), record, data.subarray(target.end)]);
  if (batch !== null) {
    const oldEnd = Math.max(batch + data.readUInt32LE(batch + 12), end);
    output.writeUInt32LE(oldEnd + delta - batch, batch + 12);
  }
  return output;
}

/** Rebuild native image storage at PNG dimensions without imposing stock-game allocation limits.
 *
 * Preserves record order and unrelated bytes. Single-palette/16-bit records become
 * direct color. Shared palettes remain a structural restriction because consumers
 * address their variants independently. Runtime compatibility requires game testing.
 */
export function rebuildTexture(data, index, inputPng, model = false, options = {}) {
  range(inputPng, 0, 24, 'PNG');
  requireThat(inputPng.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')), 'Choose a PNG image.');
  const width = inputPng.readUInt32BE(16), height = inputPng.readUInt32BE(20);
  requireThat(width > 0 && height > 0 && width <= 8192 && height <= 8192 && width * height <= 16777216, 'PNG exceeds the editor limit: 8192 pixels per side and 16 megapixels.');
  const textures = readTextures(data, model, options), target = textures[index]; requireThat(target, 'Unknown texture.');
  const image = PNG.sync.read(inputPng);
  if (width === target.width && height === target.height && image.data.equals(target.rgba)) return Buffer.from(data);
  requireThat(!target.layout.sharedPalette, 'This record has shared palette variants. Experimental direct-color replacement cannot discard those material bindings.');
  const output = target.layout.kind === 'pic' ? encodePic(data, image, target.layout.packets)
    : replaceRecord(data, textures, target, directRecord(data, target, image), model);
  const decoded = readTextures(output, model, options), updated = decoded[index];
  requireThat(decoded.length === textures.length && updated.width === width && updated.height === height, 'Rebuilt texture layout verification failed.');
  for (let p = 0; p < image.data.length; p++) {
    const tolerance = target.layout.picture && p % 4 === 3 ? 1 : 0;
    requireThat(Math.abs(updated.rgba[p] - image.data[p]) <= tolerance, 'Rebuilt texture pixel verification failed.');
  }
  return output;
}

/** Replace model images and append new native slots before geometry is rebuilt. */
export function rebuildModelTextures(data, replacements) {
  if (!replacements.length) return data;
  const originalCount = data.readUInt32LE(8), ordered = [...replacements].sort((a, b) => a.slot - b.slot);
  requireThat(originalCount <= MODEL_TEXTURE_LIMITS.slots && new Set(ordered.map(image => image.slot)).size === ordered.length, 'Invalid model texture slots.');
  let output = data;
  for (const {slot, png} of ordered) {
    requireThat(Number.isInteger(slot) && slot >= 0 && slot < MODEL_TEXTURE_LIMITS.slots, 'Model texture slots must be between 0 and ' + (MODEL_TEXTURE_LIMITS.slots - 1) + '.');
    const count = output.readUInt32LE(8);
    if (slot < count) {output = rebuildTexture(output, slot, png, true); continue;}
    requireThat(slot === count, 'New texture slots must be consecutive after the existing slots.');
    const images = readTextures(output, true, {decode: false}), first = images[0], start = output.readUInt32LE(12);
    requireThat(first && images.length === count && images.every(image => !image.layout.sharedPalette), 'New model slots require a native image template without shared palette variants.');
    requireThat(start === output.readUInt32LE(16) && images.at(-1).end === output.length, 'Model textures must form a terminal batch.');
    range(png, 0, 24, 'PNG image');
    requireThat(png.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')), 'Expected a PNG image.');
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
    requireThat(width && height && width <= 8192 && height <= 8192 && width * height <= 16777216, 'Unsupported model texture dimensions.');
    requireThat(output.length + width * height * 4 + 256 <= MAX_ASSET, 'Model textures exceed the editing size limit.');
    const record = directRecord(output, first, PNG.sync.read(png));
    output = Buffer.concat([output, record]); output.writeUInt32LE(count + 1, 8);
    output.writeUInt32LE(count + 1, start + 20); output.writeUInt32LE(output.length - start, start + 12);
  }
  const count = output.readUInt32LE(8);
  if (count !== originalCount) output = syncModelImageTable(output);
  requireThat(output.length <= MAX_ASSET && readTextures(output, true, {decode: false}).length === count, 'Model texture batch validation failed.');
  return output;
}

/** Keep the native identity image table aligned with the embedded batch count. */
export function syncModelImageTable(output) {
  const count = output.readUInt32LE(8);
  const base = output.readUInt32LE(20), start = output.readUInt32LE(12);
  range(output, base, 112, 'Model header');
  const oldTable = base + output.readUInt32LE(base + 52), oldCount = output.readUInt32LE(base + 48);
  range(output, oldTable, oldCount * 4, 'Model image table');
  if (oldCount === count) return output;
  requireThat(oldCount <= count && Array.from({length: oldCount}, (_, i) => output.readUInt32LE(oldTable + i * 4)).every((value, i) => value === i), 'Unsupported native model image table.');
  const table = Buffer.alloc(Math.ceil(count * 4 / 16) * 16);
  for (let i = 0; i < count; i++) table.writeUInt32LE(i, i * 4);
  output = Buffer.concat([output.subarray(0, start), table, output.subarray(start)]);
  output.writeUInt32LE(count, base + 48); output.writeUInt32LE(start - base, base + 52);
  output.writeUInt32LE(start + table.length, 12); output.writeUInt32LE(start + table.length, 16);
  return output;
}
