import fs from 'node:fs';

export class SourceChangedError extends Error {
  constructor(files) {
    super(`${files.map(file => file.name).join(', ')} changed on disk. Reload the sources to continue.`);
    this.code = 'SOURCE_CHANGED'; this.files = files;
  }
}

export function fileStamp(file) {
  const stat = fs.statSync(file, {throwIfNoEntry: false});
  return stat ? {size: stat.size, mtime: stat.mtimeMs, ctime: stat.ctimeMs} : null;
}

export function changedSources(sources) {
  return sources.flatMap(source => {
    const now = fileStamp(source.file);
    const changed = !now || now.size !== source.size || now.mtime !== source.mtime || (source.ctime !== undefined && now.ctime !== source.ctime);
    return changed ? [{file: source.file, name: source.name, current: now}] : [];
  });
}

export function assertSources(sources) {
  const changed = changedSources(sources);
  if (changed.length) throw new SourceChangedError(changed);
}

export function workspaceSources(workspace) {
  const sources = workspace.archives.flatMap(archive => archive.format === 'FOLDER'
    ? archive.entries.map(entry => ({...entry, file: entry.sourceFile})) : [archive]);
  if (workspace.catalogPath) sources.push(workspace.catalogSource || {file: workspace.catalogPath, name: 'arc.arc', ...fileStamp(workspace.catalogPath)});
  return sources.map(({file, name, size, mtime, ctime}) => ({file, name, size, mtime, ctime}));
}
