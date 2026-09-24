import fs from 'node:fs';
import path from 'node:path';
import {parseCatalog, openArchive} from './archives.mjs';
import {looseFolder, folderFiles} from './loose-files.mjs';
import {requireThat} from './binary.mjs';

function container(file, section, dataRoot, names) {
  const archive = openArchive(file, names);
  const relativePath = dataRoot ? path.relative(dataRoot, file).replaceAll('\\', '/') : archive.name;
  return {...archive, section, relativePath, name: section === 'sound' ? relativePath.replace(/^sound\//, '') : archive.name};
}

function dataFolders(root, archives) {
  for (const section of ['movie', 'pic', 'sound']) {
    const folder = path.join(root, section);
    if (!fs.existsSync(folder)) continue;
    const files = folderFiles(folder), loose = [];
    for (const file of files) {
      if (section === 'sound' && /\.afs$/i.test(file)) {
        if (!archives.some(a => a.file === file)) archives.push(container(file, section, root));
      } else loose.push(file);
    }
    if (loose.length) archives.push(looseFolder(folder, section, loose));
  }
}

/** Discover the catalog and known media folders as one workspace. */
export function openWorkspace(input) {
  input = path.resolve(input);
  if (fs.statSync(input).isDirectory()) {
    if (fs.existsSync(path.join(input, 'arc.arc'))) input = path.join(input, 'arc.arc');
    else if (fs.existsSync(path.join(input, 'data/arc.arc'))) input = path.join(input, 'data/arc.arc');
    else {
      const section = path.basename(input).toLowerCase();
      requireThat(['movie', 'pic', 'sound'].includes(section) || folderFiles(input).some(file => /\.000$/i.test(file)), 'Choose the game data folder containing arc.arc.');
      const group = ['pic', 'sound'].includes(section) ? section : 'movie';
      return {input, catalogPath: null, dataRoot: null, archives: [looseFolder(input, group)]};
    }
  }
  if (/\.000$/i.test(input)) return {input, catalogPath: null, dataRoot: null, archives: [looseFolder(path.dirname(input), 'movie')]};
  const root = path.dirname(input), catalogPath = path.join(root, 'arc.arc');
  const catalog = fs.existsSync(catalogPath) ? parseCatalog(catalogPath) : null;
  if (path.basename(input).toLowerCase() !== 'arc.arc') {
    const cluster = catalog?.clusters.find(c => c.name.toLowerCase() === path.basename(input, '.arc').toLowerCase());
    const names = catalog?.files.filter(f => f.cluster === cluster?.index);
    return {input, catalogPath: catalog ? catalogPath : null, dataRoot: null, archives: [container(input, 'assets', null, names)]};
  }
  requireThat(catalog, 'Master catalog not found.');
  const archives = catalog.clusters.map(cluster => {
    requireThat(!/[\\/]/.test(cluster.name), 'Invalid archive name in catalog.');
    const file = path.join(root, cluster.name + '.arc');
    requireThat(fs.existsSync(file), `Missing ${cluster.name}.arc. Open the complete data folder.`);
    const archive = container(file, 'assets', root, catalog.files.filter(f => f.cluster === cluster.index));
    requireThat(archive.entries.length === cluster.count, `${cluster.name}: catalog and container counts disagree.`);
    return archive;
  });
  const sound = path.join(root, 'sound/sd.afs');
  if (fs.existsSync(sound)) archives.push(container(sound, 'sound', root));
  dataFolders(root, archives);
  return {input, catalogPath, dataRoot: root, archives};
}
