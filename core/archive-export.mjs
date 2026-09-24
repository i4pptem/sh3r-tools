import fs from 'node:fs';
import path from 'node:path';
import {requireThat, safeOutput, writeNew} from './binary.mjs';
import {readTextures} from './textures.mjs';
import {readFonts} from './fonts.mjs';
import {parseModel} from './model.mjs';
import {exportGlb} from './gltf.mjs';
import {readMessages} from './messages.mjs';
import {parseMorphAnimations} from './morph-animation.mjs';
import {decodeMovie} from './media.mjs';
import {waveFile} from './audio.mjs';

const json = value => Buffer.from(JSON.stringify(value, null, 2));

function convertedFiles(workbench, key) {
  const {entry} = workbench.get(key), data = workbench.bytes(key), format = workbench.format(key);
  const file = (name, data) => ({name, data});
  if (['mdl', 'mdl_'].includes(format)) return [file('model.glb', exportGlb(parseModel(data), readTextures(data, true)))];
  if (['tex', 'pic', 'dat', 'tbn2'].includes(format)) {
    const textures = workbench.textureAsset(key); requireThat(textures.length, 'Container has no decoded images.');
    return textures.map((t, i) => file(`texture_${String(i).padStart(3, '0')}.png`, t.png));
  }
  if (format === 'bin' && /font/i.test(entry.name)) return readFonts(data).map((t, i) => file(`font_${i}.png`, t.png));
  if (format === '000') return [file('movie.mpg', decodeMovie(data))];
  if (format === 'mes') return [file('messages.json', json(readMessages(data)))];
  if (['pack', 'cluster'].includes(format)) {
    const clips = parseMorphAnimations(data);
    return [file('morph-clips.json', json({format: 'sh3tools-morph-clips-v1', clips, note: 'Only morph controls are decoded; the native file retains all other cutscene sections.'})), file(path.basename(entry.name), data)];
  }
  if (['map', 'cld', 'cam', 'ded', 'sdb'].includes(format)) {
    const {model, textures = [], ...details} = workbench.worldAsset(key), files = [file('structure.json', json(details))];
    if (model?.meshes.length) files.push(file('scene.glb', exportGlb(model, textures)));
    return files;
  }
  if (['adx', 'aix', 'bd', 'hd'].includes(format)) {
    const audio = workbench.audioAsset(key);
    return audio.items.map((_, index) => {
      const decoded = index === 0 ? audio.decoded : workbench.audioAsset(key, index).decoded;
      return file(`track_${String(index).padStart(3, '0')}.wav`, waveFile(decoded.pcm, decoded.sampleRate, decoded.channels));
    });
  }
  if (['wav', 'png', 'jpg', 'jpeg', 'bmp', 'dds', 'ogg', 'mp3', 'flac', 'txt'].includes(format)) return [file('asset.' + format, data)];
  return null;
}

/** Export every entry of one source, including staged edits, with a per-entry conversion report. */
export function exportArchive(workbench, archiveId, folder, mode = 'native') {
  requireThat(Number.isInteger(archiveId) && workbench.archives[archiveId], 'Select an archive to export.');
  requireThat(['native', 'converted'].includes(mode), 'Unknown archive export mode.');
  return exportSources(workbench, [archiveId], folder, mode);
}

/** Export all opened sources independently of section, search or selection. */
export function exportAllArchives(workbench, folder, mode = 'native') {
  requireThat(workbench.archives.length > 0, 'Open a workspace to export.');
  requireThat(['native', 'converted'].includes(mode), 'Unknown archive export mode.');
  return exportSources(workbench, workbench.archives.map((_, i) => i), folder, mode);
}

function exportSources(workbench, ids, folder, mode) {
  const entries = ids.flatMap(id => workbench.archives[id].entries.map(entry => ({archive: workbench.archives[id], entry, key: id + ':' + entry.index})));
  const keys = entries.map(e => e.key);
  if (mode === 'native') return workbench.extract(keys, folder);
  requireThat(!fs.existsSync(folder), 'Choose a new export folder.');
  const roots = entries.map(({archive, entry: e}) => safeOutput(folder, `${archive.name}/${String(e.index).padStart(5, '0')}_${e.name}`));
  requireThat(new Set(roots.map(root => root.toLowerCase())).size === roots.length, 'Source names collide in the export folder.');
  const report = {format: 'sh3tools-archive-export-v1', sources: ids.map(id => workbench.archives[id].file), mode, converted: 0, native: 0, failed: 0, entries: []};
  fs.mkdirSync(folder, {recursive: true});
  for (const [index, {archive, entry, key}] of entries.entries()) {
    const record = {source: archive.name, index: entry.index, name: entry.name, format: workbench.format(key), staged: workbench.changes.has(key), status: 'converted', files: []};
    let files;
    try {files = convertedFiles(workbench, key);}
    catch (error) {if (error.syscall) throw error; record.status = 'failed'; record.reason = error.message;}
    if (!files?.length) {
      if (record.status !== 'failed') {record.status = 'native'; record.reason = 'No common-format converter for this asset; original payload preserved.';}
      files = [{name: path.basename(entry.name), data: workbench.bytes(key)}];
    }
    for (const output of files) {
      const destination = safeOutput(roots[index], output.name); writeNew(destination, output.data);
      record.files.push(path.relative(folder, destination).replaceAll('\\', '/'));
    }
    report[record.status]++; report.entries.push(record);
    workbench.progress({message: `Converting ${archive.name}`, done: index + 1, total: keys.length});
  }
  writeNew(path.join(folder, 'export-report.json'), json(report));
  return {folder, count: keys.length, converted: report.converted, native: report.native, failed: report.failed};
}
