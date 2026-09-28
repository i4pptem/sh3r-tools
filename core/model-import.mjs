import fs from 'node:fs';
import path from 'node:path';
import {readGlb} from './gltf.mjs';
import {align, range, requireThat, readRange, MAX_ASSET} from './binary.mjs';
import {blenderExchange} from './blender-bridge.mjs';

export function writeGlb(doc, binary) {
  const raw = Buffer.from(JSON.stringify(doc)), json = Buffer.alloc(align(raw.length, 4), 32); raw.copy(json);
  const bin = Buffer.alloc(align(binary.length, 4)); binary.copy(bin);
  requireThat(28 + json.length + bin.length <= MAX_ASSET, 'Model exchange exceeds the 256 MiB editing limit.');
  const header = Buffer.alloc(20), binaryHeader = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + json.length + bin.length, 8);
  header.writeUInt32LE(json.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  binaryHeader.writeUInt32LE(bin.length); binaryHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, json, binaryHeader, bin]);
}
function resource(uri, folder) {
  requireThat(typeof uri === 'string', 'A glTF resource needs a URI.');
  if (uri.startsWith('data:')) {
    const match = /^data:[^,]*;base64,([a-zA-Z0-9+/]*={0,2})$/.exec(uri);
    requireThat(match && match[1].length <= Math.ceil(MAX_ASSET / 3) * 4, 'Invalid or oversized glTF data URI.');
    return Buffer.from(match[1], 'base64');
  }
  const relative = decodeURIComponent(uri);
  requireThat(!/^[a-z][a-z0-9+.-]*:/i.test(relative) && !path.isAbsolute(relative) && !relative.includes('\\') && !/[?#\0]/.test(relative), 'Use relative local glTF companion files.');
  const root = fs.realpathSync(folder), file = path.resolve(root, relative);
  requireThat(file.startsWith(root + path.sep), 'Keep glTF companion files inside the model folder.');
  requireThat(fs.existsSync(file), 'Missing glTF companion file: ' + relative);
  requireThat(fs.realpathSync(file).startsWith(root + path.sep), 'A glTF companion link leaves the model folder.');
  return readRange(file, 0, fs.statSync(file).size);
}
/** Embed local BIN/image companions without passing geometry through a DCC converter. */
export function loadGltfFile(file) {
  const raw = readRange(file, 0, fs.statSync(file).size), binaryFile = path.extname(file).toLowerCase() === '.glb';
  const parsed = binaryFile ? readGlb(raw) : {doc: JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, ''))};
  const doc = structuredClone(parsed.doc), chunks = [], offsets = [], buffers = []; let length = 0;
  requireThat(doc.asset?.version === '2.0' && Array.isArray(doc.buffers), 'Expected glTF 2.0 with geometry buffers.');
  const append = data => {
    const start = align(length, 4); requireThat(start + data.length <= MAX_ASSET, 'glTF resources exceed the editing limit.');
    if (start > length) chunks.push(Buffer.alloc(start - length)); chunks.push(data); length = start + data.length; return start;
  };
  for (const [i, buffer] of doc.buffers.entries()) {
    const data = buffer.uri !== undefined ? resource(buffer.uri, path.dirname(file)) : (i === 0 ? parsed.binary : null);
    requireThat(data && Number.isSafeInteger(buffer.byteLength) && buffer.byteLength >= 0 && buffer.byteLength <= data.length, 'Invalid or missing glTF buffer.');
    const bytes = data.subarray(0, buffer.byteLength); buffers.push(bytes); offsets.push(append(bytes));
  }
  for (const view of doc.bufferViews || []) {
    requireThat(buffers[view.buffer], 'Invalid glTF buffer reference.');
    range(buffers[view.buffer], view.byteOffset || 0, view.byteLength, 'glTF buffer view');
    view.byteOffset = offsets[view.buffer] + (view.byteOffset || 0); view.buffer = 0;
  }
  for (const image of doc.images || []) if (image.uri !== undefined) {
    const bytes = resource(image.uri, path.dirname(file)); doc.bufferViews ||= [];
    image.bufferView = doc.bufferViews.length;
    doc.bufferViews.push({buffer: 0, byteOffset: append(bytes), byteLength: bytes.length});
    delete image.uri;
  }
  doc.buffers = [{byteLength: length}];
  return writeGlb(doc, Buffer.concat(chunks));
}
export async function loadModelFile(file, cacheFolder, progress) {
  const extension = path.extname(file).toLowerCase();
  requireThat(['.glb', '.gltf', '.fbx'].includes(extension), 'Choose a GLB, GLTF or FBX model.');
  if (extension !== '.fbx') return loadGltfFile(file);
  const result = await blenderExchange({script: 'model_import', mode: 'import', input: path.resolve(file), outputType: 'glb'}, null, cacheFolder, progress);
  return result.data;
}
