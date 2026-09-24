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
