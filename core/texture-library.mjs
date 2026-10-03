import {canResizeMapTextures,rebuildMapTexture} from './map-texture.mjs';
import {readBitmap, replaceBitmap} from './bitmap.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {PNG} from 'pngjs';
import {range, requireThat, sha256, readRange, writeNew} from './binary.mjs';
import {readTextures, replaceTexture} from './textures.mjs';
import {rebuildTexture} from './texture-rebuild.mjs';
import {readFonts, replaceFont} from './fonts.mjs';
import {resizeImage} from './image-import.mjs';
import {mapTextureNames} from './map-materials.mjs';

const nativeFormats = new Set(['tex', 'pic', 'dat', 'tbn2']);
const rasterFormats = new Set(['png', 'dds', 'bmp', 'jpg', 'jpeg']);
const url = png => 'data:image/png;base64,' + png.toString('base64');
function sourceKind(entry) {
  const format = entry.detectedFormat || entry.extension;
  if (['mdl', 'mdl_'].includes(format)) return 'model';
  if (format === 'map') return 'map';
  if (format === 'bin' && /(?:^|\/)fontdata[^/]*\.bin$/i.test(entry.name)) return 'font';
  if (nativeFormats.has(format) || rasterFormats.has(format)) return 'texture';
  return null;
}
function pngImage(data, decode) {
  range(data, 0, 24, 'PNG header');
  requireThat(data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')), 'Invalid PNG signature.');
  const width = data.readUInt32BE(16), height = data.readUInt32BE(20);
  requireThat(width && height && width <= 8192 && height <= 8192 && width * height <= 16777216, 'Unsupported PNG dimensions.');
  return {index: 0, width, height, format: 'PNG', ...(decode ? {png: data, rgba: PNG.sync.read(data).data} : {})};
}
function images(data, source, decode) {
  if (source.kind === 'font') return readFonts(data);
  if (source.format === 'png') return [pngImage(data, decode)];
  if (source.format === 'bmp') return [readBitmap(data, decode)];
  requireThat(!rasterFormats.has(source.format), 'PNG exchange is not supported for .' + source.format + ' files.');
  if (source.kind === 'map' && !source.offset) return [];
  return readTextures(data.subarray(source.offset), source.kind === 'model', {...source.options, decode});
}

/** Texture slots belong to native assets; shared map companions are never duplicated. */
export class TextureLibrary {
  constructor(workbench) {this.workbench = workbench; this.sources = new Map(); this.thumbnails = new Map(); this.revision = 0;}
  reset() {this.sources.clear(); this.thumbnails.clear(); this.revision++;}
  invalidate(key) {
    this.sources.delete(key);
    for (const id of this.thumbnails.keys()) if (id.startsWith(key + '/')) this.thumbnails.delete(id);
    this.revision++;
  }
  readSource(entry) {
    const source = {key: entry.key, kind: sourceKind(entry), format: entry.detectedFormat || entry.extension, offset: 0, options: this.workbench.textureOptions(entry.key), references: [], items: []};
    try {
      const data = this.workbench.bytes(entry.key); source.hash = sha256(data);
      if (source.kind === 'map') {
        range(data, 0, 80, 'MAP header');
        requireThat(data.readUInt32LE(0) === 0xffffffff && data.readUInt32LE(12) === 80, 'Unsupported MAP header.');
        source.offset = data.readUInt32LE(16);
        if (source.offset === data.length) source.offset = 0;
        if (source.offset) {requireThat(source.offset >= 80, 'Invalid MAP texture offset.'); range(data, source.offset, 32, 'MAP textures');}
        source.references = mapTextureNames(entry.name).filter(([family, name]) => name && data.readUInt32LE(24 + family * 4)).map(([, name]) => 'data/tmp/' + name.toLowerCase());
      }
      const metadata=images(data,source,false),mapResize=source.kind==='map'&&canResizeMapTextures(data,metadata);
      source.items = metadata.map(image => ({
        id: entry.key + '/' + image.index, key: entry.key, index: image.index, name: entry.name, archiveName: entry.archiveName,
        kind: source.kind, width: image.width, height: image.height, format: image.format,
        label: source.kind === 'font' ? (image.index ? 'Small' : 'Normal') : 'Texture ' + image.index,
        fullSize: (mapResize || ['model', 'texture'].includes(source.kind)) && !rasterFormats.has(source.format) && !image.layout?.sharedPalette,
        font: source.kind === 'font'
      }));
    } catch (error) {
      if (error.syscall) throw error;
      source.error = error.message;
    }
    return source;
  }
  catalog(force = false) {
    if (force) this.reset();
    const entries = this.workbench.snapshot().entries, candidates = entries.filter(sourceKind), byName = new Map(), users = new Map();
    for (const entry of entries) {const name = entry.name.toLowerCase(); if (!byName.has(name)) byName.set(name, entry);}
    for (const [index, entry] of candidates.entries()) {
      if (!this.sources.has(entry.key)) this.sources.set(entry.key, this.readSource(entry));
      if (index % 24 === 0) this.workbench.progress({done: index, total: candidates.length, message: 'Indexing textures'});
    }
    for (const entry of candidates) {
      for (const name of this.sources.get(entry.key).references) {
        const target = byName.get(name); if (!target) continue;
        if (!users.has(target.key)) users.set(target.key, []);
        users.get(target.key).push({key: entry.key, name: entry.name});
      }
    }
    const items = [], issues = [];
    for (const entry of candidates) {
      const source = this.sources.get(entry.key), {archive, entry: native} = this.workbench.get(entry.key);
      const readOnly = archive.format === 'ARC' && native.size !== native.size2;
      items.push(...source.items.map(item => ({...item, changed: entry.changed, readOnly, usedBy: users.get(entry.key) || []})));
      if (source.error) issues.push({key: entry.key, name: entry.name, reason: source.error});
    }
    this.workbench.progress({done: candidates.length, total: candidates.length, message: 'Textures indexed'});
    return {revision: this.revision, items, issues, sources: candidates.length};
  }
  resolve(id, expectedHash) {
    requireThat(typeof id === 'string', 'Choose a texture.');
    const key = id.split('/')[0], source = this.sources.get(key), item = source?.items.find(item => item.id === id);
    requireThat(item, 'Texture catalog changed. Refresh and select the texture again.');
    const data = this.workbench.bytes(key), hash = sha256(data);
    if (hash !== source.hash) {this.invalidate(key); throw new Error('Texture source changed. Refresh and select the texture again.');}
    requireThat(!expectedHash || expectedHash === hash, 'Texture source changed. Select the texture again before importing.');
    return {source, item, data, hash};
  }
  preview(id) {
    const {source, item, data, hash} = this.resolve(id), image = images(data, source, true)[item.index];
    requireThat(image, 'Texture slot is no longer available.');
    return {id, hash, url: url(image.png), width: image.width, height: image.height};
  }
  thumbnailBatch(ids) {
    requireThat(Array.isArray(ids) && ids.length <= 32 && ids.every(id => typeof id === 'string'), 'Request up to 32 texture thumbnails.');
    const output = [], groups = new Map();
    for (const id of new Set(ids)) {
      if (this.thumbnails.has(id)) {output.push({id, url: this.thumbnails.get(id)}); continue;}
      const key = id.split('/')[0]; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(id);
    }
    for (const group of groups.values()) {
      try {
        const {source, data} = this.resolve(group[0]), decoded = images(data, source, true);
        for (const id of group) {
          const item = source.items.find(item => item.id === id), image = item && decoded[item.index];
          requireThat(image, 'Unknown texture slot.');
          const scale = Math.min(1, 192 / Math.max(image.width, image.height));
          const small = resizeImage({width: image.width, height: image.height, data: image.rgba}, Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
          const thumbnail = url(PNG.sync.write(small)); this.thumbnails.set(id, thumbnail); output.push({id, url: thumbnail});
          while (this.thumbnails.size > 128) this.thumbnails.delete(this.thumbnails.keys().next().value);
        }
      } catch (error) {
        if (error.syscall) throw error;
        output.push(...group.map(id => ({id, error: error.message})));
      }
    }
    return output;
  }
  replace(id, hash, file, mode = 'fit') {
    requireThat(['fit', 'fullSize', 'fontHires'].includes(mode), 'Unknown texture import mode.');
    const {source, item, data} = this.resolve(id, hash), input = readRange(file, 0, fs.statSync(file).size);
    requireThat(typeof hash === 'string' && hash.length === 64, 'Preview the texture before importing.');
    pngImage(input, false);
    requireThat(mode !== 'fullSize' || item.fullSize, 'Full-size import is unavailable for this texture. Use Fit to original.');
    requireThat(mode !== 'fontHires' || item.font, 'Select a font atlas.');
    let output;
    if (source.kind === 'font') output = replaceFont(data, item.index, input, {highResolution: mode === 'fontHires'});
    else if (source.format === 'bmp') output = replaceBitmap(data, input);
    else if (source.format === 'png') {pngImage(input, true); output = input;}
    else if(mode==='fullSize'&&source.kind==='map')output=rebuildMapTexture(data,item.index,input);
    else if (mode === 'fullSize') output = rebuildTexture(data, item.index, input, source.kind === 'model', source.options);
    else {
      const replaced = replaceTexture(data.subarray(source.offset), item.index, input, source.kind === 'model', {...source.options, adapt: true});
      if (source.offset) {
        requireThat(replaced.length === data.length - source.offset, 'MAP texture replacement must preserve container offsets.');
        output = Buffer.from(data); replaced.copy(output, source.offset);
      } else output = replaced;
    }
    return this.workbench.stage(source.key, output, item.label + ' PNG: ' + path.basename(file));
  }
  export(id, hash, file) {
    const {source, item, data} = this.resolve(id, hash), image = images(data, source, true)[item.index];
    requireThat(image, 'Texture slot is no longer available.');
    writeNew(file, image.png); return {file};
  }
}
