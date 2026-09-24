import {packager} from '@electron/packager';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
await import('./check-repository.mjs');
if (process.exitCode) throw new Error('Source checks failed.');
await import('./build.mjs');
const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const stagingRoot = path.join(root, 'build-staging');
fs.mkdirSync(stagingRoot, {recursive: true});
const stage = fs.mkdtempSync(path.join(stagingRoot, 'production-'));
try {
  for (const folder of ['app', 'core', 'docs', '.github/images']) {
    fs.cpSync(path.join(root, folder), path.join(stage, folder), {recursive: true});
  }
  for (const file of ['README.md', 'LICENSE', 'CREDITS.md', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md']) {
    fs.copyFileSync(path.join(root, file), path.join(stage, file));
  }
  for (const folder of ['tools/blender', 'tools/native']) {
    fs.cpSync(path.join(root, folder), path.join(stage, folder), {recursive: true, filter: source => !source.includes('__pycache__')});
  }
  fs.mkdirSync(path.join(stage, 'tools/media'), {recursive: true});
  for (const file of ['setup-media.mjs', 'media-runtime.mjs']) fs.copyFileSync(path.join(root, 'tools', file), path.join(stage, 'tools', file));
  for (const file of ['download.json', 'runtime-manifest.json', 'README.md', 'LICENSE-GPLv3.txt', 'extract.ps1']) {
    fs.copyFileSync(path.join(root, 'tools/media', file), path.join(stage, 'tools/media', file));
  }
  const production = {name: manifest.name, version: manifest.version, description: manifest.description, author: manifest.author,
    license: manifest.license, repository: manifest.repository, private: true, type: 'module', main: manifest.main, dependencies: manifest.dependencies};
  fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(production, null, 2));
  for (const name of Object.keys(manifest.dependencies)) {
    fs.cpSync(fs.realpathSync(path.join(root, 'node_modules', name)), path.join(stage, 'node_modules', name), {recursive: true, dereference: true});
  }
  const outputs = await packager({dir: stage, name: 'Silent Hill 3 Tools', platform: 'win32', arch: 'x64',
    electronVersion: manifest.devDependencies.electron, out: path.join(root, 'dist', manifest.version), overwrite: false, prune: false, asar: false,
    icon: path.join(root, 'app/ui/logo.ico'), appCopyright: 'Copyright (C) 2026 i4pptem', executableName: 'Silent Hill 3 Tools'});
  for (const output of outputs) {
    fs.copyFileSync(path.join(root, 'LICENSE'), path.join(output, 'LICENSE-SH3-TOOLS.txt'));
    fs.writeFileSync(path.join(output, 'START HERE.txt'),
      `Silent Hill 3 Tools ${manifest.version}\r\nDeveloped by i4pptem. GPL-3.0-only.\r\n\r\n` +
      'Run Silent Hill 3 Tools.exe. Keep all files together.\r\n' +
      'For media conversion, close the app and run Install media.cmd once (internet required).\r\n' +
      'For FBX and morph workspaces, install Blender 4.2+ separately.\r\n\r\n' +
      'Documentation: resources/app/README.md and resources/app/docs/\r\n' +
      'Source and releases: https://github.com/i4pptem/sh3r-tools\r\n' +
      'Back up game files before installing a built mod. No game files are included.\r\n');
    fs.copyFileSync(path.join(root, 'tools/media/install-portable.cmd'), path.join(output, 'Install media.cmd'));
  }
  console.log(outputs.join('\n'));
} finally {
  const resolved = path.resolve(stage);
  if (!resolved.startsWith(path.resolve(stagingRoot) + path.sep)) throw new Error('Unsafe staging cleanup path.');
  fs.rmSync(resolved, {recursive: true, force: true});
}
