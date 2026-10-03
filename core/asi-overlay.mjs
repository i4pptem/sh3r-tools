import fs from 'node:fs';
import path from 'node:path';
import {inflateRawSync} from 'node:zlib';
import profile from './asi-runtime-profile.json' with {type: 'json'};
import {runtimePlan, encodeRuntimePlan} from './runtime-plan.mjs';
import {requireThat, sha256, writeNew} from './binary.mjs';

export const ASI_LOADER = {
  version: '9.7.0', url: 'https://github.com/ThirteenAG/Ultimate-ASI-Loader/releases/download/v9.7.0/Ultimate-ASI-Loader.zip',
  archiveHash: '768d3ad612b8bbf16189c8dddd9626bb8d26eb7626a90339703ae0adb2c71390',
  dllHash: 'ad5d8d449ce305caf62cb17d8698ebf17e94f9120ee993d0dd85211dfe14f8dd',
};

/** Extract the one authenticated publisher DLL without writing arbitrary ZIP paths. */
export function loaderFromArchive(archive) {
  requireThat(sha256(archive) === ASI_LOADER.archiveHash, 'ASI Loader download checksum differs from version 9.7.0.');
  for (let at = archive.length - 22; at >= Math.max(0, archive.length - 65557); at--) {
    if (archive.readUInt32LE(at) !== 0x06054b50) continue;
    let cursor = archive.readUInt32LE(at + 16);
    for (let i = 0; i < archive.readUInt16LE(at + 10); i++) {
      requireThat(archive.readUInt32LE(cursor) === 0x02014b50, 'Invalid ASI Loader ZIP directory.');
      const nameLength = archive.readUInt16LE(cursor + 28), name = archive.toString('utf8', cursor + 46, cursor + 46 + nameLength);
      if (name === 'dinput8.dll') {
        const local = archive.readUInt32LE(cursor + 42), start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
        const compressed = archive.subarray(start, start + archive.readUInt32LE(cursor + 20)), method = archive.readUInt16LE(cursor + 10);
        requireThat(method === 0 || method === 8, 'Unsupported ASI Loader compression.');
        const dll = method === 0 ? compressed : inflateRawSync(compressed, {maxOutputLength: 4 * 1024 * 1024});
        requireThat(sha256(dll) === ASI_LOADER.dllHash, 'ASI Loader DLL checksum differs.'); return dll;
      }
      cursor += 46 + nameLength + archive.readUInt16LE(cursor + 30) + archive.readUInt16LE(cursor + 32);
    }
    break;
  }
  throw new Error('ASI Loader archive does not contain the expected 32-bit DLL.');
}

/** Fetch a pinned loader once; all subsequent builds can use the verified local cache. */
export async function prepareAsiLoader(cacheFolder) {
  const file = path.join(cacheFolder, 'asi-loader-9.7.0-dinput8.dll');
  if (fs.existsSync(file)) {const bytes = fs.readFileSync(file); requireThat(sha256(bytes) === ASI_LOADER.dllHash, 'Cached ASI Loader checksum differs. Remove the cached DLL and retry.'); return bytes;}
  const response = await fetch(ASI_LOADER.url, {signal: AbortSignal.timeout(120000)});
  requireThat(response.ok, `ASI Loader download failed (HTTP ${response.status}). You can build without the loader and install it separately.`);
  const parts = []; let length = 0;
  for await (const part of response.body) {length += part.length; requireThat(length <= 8 * 1024 * 1024, 'ASI Loader download exceeds its expected size.'); parts.push(part);}
  const bytes = loaderFromArchive(Buffer.concat(parts)); writeNew(file, bytes); return bytes;
}

export function prepareOverlay(source, requirements, loader) {
  const plan = runtimePlan(source, requirements), asi = Buffer.from(profile.bytes, 'base64');
  requireThat(sha256(asi) === profile.sha256, 'Bundled ASI runtime is damaged. Reinstall Silent Hill 3 Tools.');
  if (loader) requireThat(sha256(loader) === ASI_LOADER.dllHash, 'Unknown ASI Loader binary.');
  const omit = new Set(['outputHash', 'alreadyExpanded', 'bufferAddress', 'arenaAddress', 'storageAddress', 'buffers']);
  const report = JSON.parse(JSON.stringify(plan.report, (key, value) => omit.has(key) ? undefined : value));
  return {plan: encodeRuntimePlan(plan), asi, loader, report: {...report, runtimeRegions: plan.regions.length, instructionCount: plan.writes.length, originalExecutableHash: plan.sourceHash, loaderVersion: ASI_LOADER.version}};
}

export function writeOverlay(folder, overlay) {
  const plugins = path.join(folder, 'plugins'), mod = path.join(plugins, 'SH3Tools');
  const bootstrap = Buffer.from(profile.bootstrap.bytes, 'base64');
  requireThat(sha256(bootstrap) === profile.bootstrap.sha256, 'Bundled DLL loader is damaged. Reinstall Silent Hill 3 Tools.');
  writeNew(path.join(plugins, 'SH3Tools.dll'), overlay.asi);
  writeNew(path.join(plugins, 'SH3ToolsLoader.asi'), bootstrap);
  writeNew(path.join(plugins, 'global.ini'), '[FileLoader]\r\nOverloadFromFolder=plugins\\SH3Tools\r\n');
  writeNew(path.join(mod, 'SH3Tools.patch'), overlay.plan);
  writeNew(path.join(mod, 'runtime-buffers.json'), JSON.stringify(overlay.report, null, 2));
  if (overlay.loader) {
    writeNew(path.join(folder, 'dinput8.dll'), overlay.loader);
    writeNew(path.join(folder, 'LICENSE-Ultimate-ASI-Loader.txt'), fs.readFileSync(new URL('../tools/native/ual-license.txt', import.meta.url)));
  }
  writeNew(path.join(folder, 'INSTALL.txt'),
    'Silent Hill 3 Tools - DLL overlay mod\r\n\r\n' +
    '1. Close the game. Use the original supported sh3.exe used to build this mod.\r\n' +
    '2. Copy the plugins folder next to sh3.exe. Keep the original data folder untouched.\r\n' +
    (overlay.loader ? '3. If no ASI loader is installed, copy dinput8.dll next to sh3.exe. Keep an existing compatible loader.\r\n' : '3. Install Ultimate ASI Loader 9.7.0 or newer (Win32).\r\n') +
    '4. Included plugins/global.ini selects [FileLoader] OverloadFromFolder=plugins\\SH3Tools. If you already have global.ini or a loader-specific INI, merge this setting into your active configuration, preserving other settings. The small SH3ToolsLoader.asi initializes SH3Tools.dll.\r\n' +
    '5. Remove the previous SH3Tools files from update before migrating; do not keep two SH3Tools loaders or active builds. Preserve files belonging to other mods.\r\n' +
    '6. Start the game. plugins/SH3Tools/SH3Tools.log reports activation and conflicting patches.\r\n\r\n' +
    'Changed ARC entries use their native paths below plugins/SH3Tools/data. Changed AFS entries are in data/<archive>.afs.entries. Original archives provide unchanged bytes and are verified against SH3Tools.assets. Loose movie, pic and sound replacements also use this data folder.\r\n' +
    'Required executable extensions apply only in memory. Do not combine compact replacements with a full overlay for the same archive; merge mods in SH3 Tools first.\r\n' +
    'To uninstall, remove this build\'s files and its loader configuration entry. Preserve shared loaders and other mods. Restart the game after changing the mod.\r\n\r\n' +
    `Required original sh3.exe SHA-256: ${overlay.report.originalExecutableHash}\r\n` +
    'Ultimate ASI Loader: https://github.com/ThirteenAG/Ultimate-ASI-Loader/releases/tag/v9.7.0\r\n');
}
