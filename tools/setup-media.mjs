import fs from 'node:fs';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
import {spawnSync} from 'node:child_process';
import {media, metadata, runtime, sha256, verifyRuntime} from './media-runtime.mjs';

async function install() {
  if (process.platform !== 'win32') throw new Error('The media installer supports Windows x64.');
  const args = process.argv.slice(2).filter(arg => arg !== '--');
  if (args.length && (args.length !== 2 || args[0] !== '--archive')) {
    throw new Error('Usage: setup-media.mjs [--archive path-to-verified-zip]');
  }
  if (fs.existsSync(runtime)) {
    console.log(`Media runtime already installed: ${verifyRuntime()} verified files.`);
    return;
  }
  const downloads = path.join(media, 'downloads');
  fs.mkdirSync(downloads, {recursive: true});
  const archive = args.length ? path.resolve(args[1]) : path.join(downloads, metadata.archiveName);
  if (!fs.existsSync(archive)) {
    if (args.length) throw new Error(`Archive does not exist: ${archive}`);
    console.log(`Downloading ${metadata.version} from ${new URL(metadata.url).hostname}…`);
    const response = await fetch(metadata.url, {signal: AbortSignal.timeout(180000)});
    if (!response.ok) throw new Error(`Publisher download returned HTTP ${response.status}. See tools/media/README.md for offline installation.`);
    const partial = path.join(downloads, `${metadata.archiveName}.${process.pid}.partial`);
    try {
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(partial, {flags: 'wx'}));
      if (sha256(fs.readFileSync(partial)) !== metadata.sha256) throw new Error('Downloaded archive SHA-256 does not match this release.');
      fs.renameSync(partial, archive);
    } finally {
      if (fs.existsSync(partial)) fs.unlinkSync(partial);
    }
  }
  if (sha256(fs.readFileSync(archive)) !== metadata.sha256) throw new Error('Archive SHA-256 does not match this release.');
  const temporary = fs.mkdtempSync(path.join(downloads, 'extract-'));
  try {
    console.log('Extracting and verifying the media runtime…');
    const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(media, 'extract.ps1'), '-Archive', archive, '-Destination', temporary], {stdio: 'inherit', windowsHide: true});
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Archive extraction failed (${result.status}).`);
    const extracted = path.join(temporary, metadata.archiveDirectory);
    const count = verifyRuntime(extracted);
    fs.mkdirSync(path.dirname(runtime), {recursive: true});
    fs.renameSync(extracted, runtime);
    console.log(`Installed ${count} verified files. You can start Silent Hill 3 Tools now.`);
  } finally {
    if (!path.resolve(temporary).startsWith(path.resolve(downloads) + path.sep)) throw new Error('Unsafe temporary path.');
    fs.rmSync(temporary, {recursive: true, force: true});
  }
}

install().catch(error => { console.error(error.message); process.exitCode = 1; });
