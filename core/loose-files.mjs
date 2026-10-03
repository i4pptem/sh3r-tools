import fs from 'node:fs';
import {assertSources} from './source-state.mjs';
import path from 'node:path';
import {readRange, fileHash, requireThat, writeNew, safeOutput, sha256} from './binary.mjs';

/** Enumerate only regular files; do not follow directory links outside the selected tree. */
export function folderFiles(folder) {
  return fs.readdirSync(folder, {withFileTypes: true}).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).flatMap(entry => {
    const file = path.join(folder, entry.name);
    return entry.isDirectory() ? folderFiles(file) : entry.isFile() ? [file] : [];
  });
}

export function looseFolder(folder, section, files = folderFiles(folder)) {
  folder = path.resolve(folder);
  const entries = files.map((sourceFile, index) => {
    const relative = path.relative(folder, sourceFile).replaceAll('\\', '/'), stat = fs.statSync(sourceFile);
    return {index, chunkTableOffset: index, name: 'data/' + section + '/' + relative, extension: path.extname(relative).slice(1).toLowerCase(), sourceFile, size: stat.size, size2: stat.size, mtime: stat.mtimeMs, ctime: stat.ctimeMs, offset: 0};
  });
  return {format: 'FOLDER', section, name: section, file: folder, entries, size: entries.reduce((n, e) => n + e.size, 0)};
}

const sourceName = (archive, entry) => path.relative(archive.file, entry.sourceFile).replaceAll('\\', '/');
export function looseBytes(entry) {assertSources([{...entry, file: entry.sourceFile}]); return readRange(entry.sourceFile, 0, entry.size);}
export function sourceRecord(archive) {
  if (archive.format !== 'FOLDER') return {file: archive.file, hash: fileHash(archive.file)};
  return {file: archive.file, kind: 'folder', files: archive.entries.map(e => ({name: sourceName(archive, e), hash: fileHash(e.sourceFile)}))};
}
export function verifySource(archive, record) {
  requireThat(path.resolve(record.file) === archive.file, 'Project source path changed.');
  if (archive.format !== 'FOLDER') requireThat(fileHash(record.file) === record.hash, 'An original archive changed since this project was saved.');
  else {
    requireThat(record.kind === 'folder' && record.files?.length === archive.entries.length, 'Folder source set changed.');
    for (const [i, entry] of archive.entries.entries()) requireThat(sourceName(archive, entry) === record.files[i].name && fileHash(entry.sourceFile) === record.files[i].hash, 'An original folder file changed since this project was saved.');
  }
}
export function buildLoose(archive, changes, folder) {
  const files = [];
  for (const [index, data] of changes) {
    const entry = archive.entries[index];
    assertSources([{...entry, file: entry.sourceFile}]);
    const file = safeOutput(folder, entry.name); writeNew(file, data);
    const hash = sha256(data); requireThat(fileHash(file) === hash, 'Loose file output hash verification failed.');
    files.push({file, source: entry.sourceFile, sourceHash: fileHash(entry.sourceFile), outputHash: hash, size: data.length});
  }
  return {format: 'FOLDER', source: archive.file, verified: true, files};
}
