import {PNG} from 'pngjs';
import {range, requireThat} from './binary.mjs';
import {resizeImage} from './image-import.mjs';

/** Read uncompressed Windows BGR/BGRX bitmaps without changing their row orientation. */
export function readBitmap(data, decode = true) {
  range(data, 0, 54, 'BMP header');
  requireThat(data.toString('ascii', 0, 2) === 'BM', 'Invalid BMP signature.');
  const dib = data.readUInt32LE(14), offset = data.readUInt32LE(10), width = data.readInt32LE(18), signedHeight = data.readInt32LE(22), bits = data.readUInt16LE(28);
  requireThat(dib >= 40 && offset >= 14 + dib && data.readUInt16LE(26) === 1, 'Unsupported BMP header.');
  requireThat(data.readUInt32LE(30) === 0 && [24, 32].includes(bits), 'Only uncompressed 24/32-bit BMP is supported.');
  const height = Math.abs(signedHeight);
  requireThat(width > 0 && height > 0 && width <= 8192 && height <= 8192 && width * height <= 16777216, 'Unsupported BMP dimensions.');
  const stride = Math.ceil(width * bits / 32) * 4, bytes = bits / 8;
  range(data, offset, stride * height, 'BMP pixels');
  const image = {index: 0, width, height, format: 'BMP ' + bits + '-bit', layout: {offset, stride, bytes, bottomUp: signedHeight > 0}};
  if (!decode) return image;
  const rgba = Buffer.alloc(width * height * 4, 255);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = offset + (signedHeight > 0 ? height - 1 - y : y) * stride + x * bytes, dest = (y * width + x) * 4;
    rgba[dest] = data[p + 2]; rgba[dest + 1] = data[p + 1]; rgba[dest + 2] = data[p];
  }
  return {...image, rgba, png: PNG.sync.write({width, height, data: rgba})};
}

/** Preserve BMP headers, reserved bytes, row padding and any opaque file suffix. */
export function replaceBitmap(data, input) {
  const original = readBitmap(data, false), image = resizeImage(PNG.sync.read(input), original.width, original.height);
  requireThat(image.data.every((value, i) => i % 4 !== 3 || value === 255), 'This BMP has no alpha channel. Use an opaque PNG.');
  const output = Buffer.from(data), {width, height, layout} = original;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = layout.offset + (layout.bottomUp ? height - 1 - y : y) * layout.stride + x * layout.bytes, src = (y * width + x) * 4;
    output[p] = image.data[src + 2]; output[p + 1] = image.data[src + 1]; output[p + 2] = image.data[src];
  }
  requireThat(readBitmap(output).rgba.equals(image.data), 'BMP encode verification failed.');
  return output;
}
