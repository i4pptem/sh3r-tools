import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {MAX_ASSET, requireThat, sha256} from './binary.mjs';
import {TextureLibrary} from './texture-library.mjs';
import {parseAdx, parseAix, parseSoundBank} from './audio.mjs';
import {validateBackgroundMemory} from './map-memory.mjs';

const normalize = value => value.replaceAll('\\', '/').toLowerCase();
const basename = value => normalize(value).split('/').at(-1);
const stem = value => basename(value).replace(/\.[^.]+$/, '');
const pad = (value, width) => String(value).padStart(width, '0');
const audioFormats = new Set(['wav', 'adx', 'aix', 'hd', 'bd']);
const textureFormats = new Set(['tex', 'pic', 'dat', 'tbn2', 'bmp']);
const budget = 512 * 1024 * 1024;

function inputFiles(folder) {
  const result = [];
  const visit = (directory, depth) => {
    requireThat(depth <= 32, 'Replacement folder exceeds 32 nested folders. Choose a smaller folder.');
    for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file, depth + 1);
      else result.push({file, relative: path.relative(folder, file), linked: !entry.isFile()});
      requireThat(result.length <= 10000, 'Replacement folder exceeds 10,000 files. Choose a smaller folder.');
    }
  };
  visit(folder, 0); return result;
}

function readInput(file) {
  const stat = fs.lstatSync(file);
  requireThat(stat.isFile() && stat.size > 0 && stat.size <= MAX_ASSET, 'Choose a regular file between 1 byte and 256 MiB.');
  return fs.readFileSync(file);
}

function candidate(wb) {
  const result = Object.assign(Object.create(Object.getPrototypeOf(wb)), wb, {
    changes: new Map(wb.changes), mapHistory: new Map(wb.mapHistory), mapCollisions: new Map(wb.mapCollisions)
  });
  result.textureLibrary = new TextureLibrary(result); return result;
}

function addTarget(targets, entry, mode, index, aliases, details = {}) {
  targets.push({id: entry.key + '/' + mode + '/' + index, key: entry.key, entry, mode, index,
    label: entry.archiveName + ' / ' + entry.name + (index === null ? '' : ' · ' + (mode === 'texture' ? 'Texture ' : 'Track ') + index),
    aliases: [...new Set(aliases.map(normalize))], ...details});
}

function assetAliases(wb, entry) {
  const archive = wb.archives[entry.archive], name = normalize(entry.name), short = basename(name);
  const index = pad(entry.index, 5), indexed = index + '_' + name;
  const roots = [archive.name, archive.relativePath].filter(Boolean).map(normalize);
  return {name, short, index, roots, converted: roots.map(root => root + '/' + indexed),
    native: [...roots.flatMap(root => [root + '/' + name, root + '/' + (archive.format === 'AFS' ? indexed : name)]), name, short,
      ...(archive.format === 'AFS' ? [index + '_' + short, ...roots.flatMap(root => [root + '.entries/entry_' + index + '.' + entry.extension, root + '/entry_' + index + '.' + entry.extension]), 'entry_' + index + '.' + entry.extension] : [])]};
}

function trackAliases(base, entry, index, count) {
  const file = 'track_' + pad(index, 3) + '.wav';
  return [...base.converted.map(root => root + '/' + file), base.name + '/' + file, base.short + '/' + file,
    ...base.roots.map(root => root + '/' + base.name + '/' + file), stem(entry.name) + '_' + index + '.wav',
    ...(count === 1 ? [stem(entry.name) + '.wav'] : [])];
}

function collectTargets(wb, kind, archiveId) {
  const entries = wb.snapshot().entries.filter(entry => archiveId === null || entry.archive === archiveId), targets = [], issues = [];
  for (const [position, entry] of entries.entries()) {
    if (position % 24 === 0) wb.progress({done: position, total: entries.length, message: 'Indexing replacement targets'});
    const format = wb.format(entry.key), base = assetAliases(wb, entry);
    if (kind === 'textures') {
      if (textureFormats.has(format)) addTarget(targets, entry, 'native', null, base.native, {format});
      if (!['mdl', 'mdl_', 'map', 'tex', 'pic', 'dat', 'tbn2', 'png', 'bmp'].includes(format) && !/fontdata[^/]*\.bin$/i.test(entry.name)) continue;
      const source = wb.textureLibrary.readSource({...entry, detectedFormat: format});
      if (source.error) {issues.push(entry.name + ': ' + source.error); continue;}
      for (const item of source.items) {
        const file = (item.font ? 'font_' + item.index : 'texture_' + pad(item.index, 3)) + '.png';
        const names = [stem(entry.name) + '_' + item.index + '.png', ...(source.items.length === 1 ? [stem(entry.name) + '.png'] : [])];
        addTarget(targets, entry, 'texture', item.index, [
          ...base.converted.map(root => root + '/' + file), base.name + '/' + file, base.short + '/' + file,
          ...base.roots.map(root => root + '/' + base.name + '/' + file), ...names,
          ...base.roots.flatMap(root => names.map(name => root + '/' + name)),
          ...(['png', 'bmp'].includes(format) ? base.converted.map(root => root + '/asset.png') : [])
        ], {format});
      }
    } else if (audioFormats.has(format)) {
      if (['wav', 'adx', 'aix'].includes(format)) {
        addTarget(targets, entry, 'native', null, [...base.native, ...base.converted.map(root => root + '/asset.' + format), ...(wb.archives[entry.archive].format === 'AFS' ? ['entry_' + base.index + '.' + format, ...base.roots.flatMap(root => [root + '.entries/entry_' + base.index + '.' + format, root + '/entry_' + base.index + '.' + format])] : [])], {format});
      }
      try {
        if (format === 'adx') addTarget(targets, entry, 'unsupported', 0, trackAliases(base, entry, 0, 1), {format});
        if (format === 'aix') {
          const count = parseAix(wb.bytes(entry.key)).layers.length;
          for (let index = 0; index < count; index++) addTarget(targets, entry, 'audio', index, trackAliases(base, entry, index, count), {format});
        }
        if (['hd', 'bd'].includes(format)) {
          const bankStem = entry.name.slice(0, -3).toLowerCase(), members = wb.archives[entry.archive].entries;
          const hd = members.find(e => e.name.toLowerCase() === bankStem + '.hd'), bd = members.find(e => e.name.toLowerCase() === bankStem + '.bd');
          requireThat(hd && bd, 'Both matching HD and BD files must be open.');
          const bdKey = entry.archive + ':' + bd.index, info = parseSoundBank(wb.bytes(entry.archive + ':' + hd.index), wb.bytes(bdKey));
          for (let index = 0; index < info.samples.length; index++) {
            const aliases = trackAliases(base, entry, index, info.samples.length), id = bdKey + '/audio/' + index;
            const existing = targets.find(target => target.id === id);
            if (existing) existing.aliases.push(...aliases.map(normalize));
            else addTarget(targets, {...entry, key: bdKey, name: bd.name}, 'audio', index, aliases, {format: 'bd'});
          }
        }
      } catch (error) {issues.push(entry.name + ': ' + error.message);}
    }
  }
  return {targets, issues};
}

function matcher(targets) {
  const aliases = new Map();
  for (const target of targets) for (const alias of target.aliases) {
    if (!aliases.has(alias)) aliases.set(alias, new Map());
    aliases.get(alias).set(target.id, target);
  }
  return relative => {
    const parts = normalize(relative).split('/');
    const owner = parts.find(part => /\.(arc|afs)(\.entries)?$/.test(part))?.replace(/\.entries$/, '');
    for (let offset = 0; offset < parts.length; offset++) {
      const matches = [...(aliases.get(parts.slice(offset).join('/'))?.values() || [])];
      const scoped = owner ? matches.filter(target => basename(target.entry.archiveName) === owner) : matches;
      if (scoped.length) return scoped;
    }
    return [];
  };
}

function validateWave(data) {
  requireThat(data.length >= 44 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WAVE', 'Expected a RIFF WAV file.');
  const end = data.readUInt32LE(4) + 8; requireThat(end <= data.length, 'WAV is truncated.');
  let format, length;
  for (let offset = 12; offset + 8 <= end;) {
    const size = data.readUInt32LE(offset + 4), start = offset + 8;
    requireThat(start + size <= end, 'WAV chunk is truncated.');
    const tag = data.toString('ascii', offset, offset + 4);
    if (tag === 'fmt ') {
      requireThat(!format && size >= 16, 'Invalid WAV format chunk.');
      format = {codec: data.readUInt16LE(start), channels: data.readUInt16LE(start + 2), rate: data.readUInt32LE(start + 4), bytes: data.readUInt32LE(start + 8), block: data.readUInt16LE(start + 12), bits: data.readUInt16LE(start + 14)};
    }
    if (tag === 'data') {requireThat(length === undefined, 'Multiple WAV data chunks are unsupported.'); length = size;}
    offset = start + size + (size & 1);
  }
  requireThat(format?.codec === 1 && [8, 16].includes(format.bits) && [1, 2].includes(format.channels), 'Use PCM 8-bit or 16-bit WAV, mono or stereo. Float/compressed WAV must be converted first.');
  requireThat(format.rate >= 4000 && format.rate <= 96000 && format.block === format.channels * format.bits / 8 && format.bytes === format.rate * format.block && length > 0 && length % format.block === 0, 'Invalid WAV rate, sample size or alignment.');
}

async function replaceOne(wb, target, file, input, mode) {
  if (target.mode === 'unsupported') throw new Error('WAV-to-ADX import is not supported. Encode a native .adx and keep the original entry name/index.');
  if (target.mode === 'texture') {
    const source = wb.textureLibrary.readSource({...target.entry, detectedFormat: target.format});
    requireThat(!source.error, source.error); wb.textureLibrary.sources.set(target.key, source);
    wb.replaceLibraryTexture(target.key + '/' + target.index, source.hash, file, mode);
  } else if (target.mode === 'audio') await wb.replace(target.key, file, 'audio', target.index);
  else {
    if (target.format === 'wav') validateWave(input);
    if (target.format === 'adx') parseAdx(input);
    if (target.format === 'aix') parseAix(input);
    if (textureFormats.has(target.format)) {
      const probe = candidate(wb); probe.changes.set(target.key, {data: input});
      const source = probe.textureLibrary.readSource({...target.entry, detectedFormat: target.format});
      requireThat(!source.error && source.items.length > 0, source.error || 'Native texture has no supported images.');
    }
    wb.stage(target.key, input, 'Batch: ' + path.basename(file));
  }
}

function markConflicts(rows) {
  const groups = new Map();
  for (const row of rows.filter(row => row.target)) {
    if (!groups.has(row.target.key)) groups.set(row.target.key, []);
    groups.get(row.target.key).push(row);
  }
  for (const group of groups.values()) for (const row of group) {
    if (group.some(other => other !== row && (other.target.id === row.target.id || other.target.mode === 'native' || row.target.mode === 'native'))) {
      row.status = 'conflict'; row.detail = 'Multiple files replace this asset/slot. Keep one version in the folder and scan again.';
    }
  }
}

/** Review matches and conversions without changing the current project. */
export async function prepareBatchReplace(wb, folder, options = {}) {
  wb.batchPlan = null; wb.assertSources();
  const {kind = 'textures', archive = null, mode = 'fit'} = options;
  requireThat(['textures', 'audio'].includes(kind) && ['fit', 'fullSize'].includes(mode), 'Invalid batch replacement options.');
  requireThat(archive === null || Number.isInteger(archive) && wb.archives[archive], 'Choose an open archive.');
  folder = path.resolve(folder); requireThat(fs.statSync(folder).isDirectory(), 'Choose a replacement folder.');
  const {targets, issues} = collectTargets(wb, kind, archive), match = matcher(targets);
  const rows = inputFiles(folder).map(({file, relative, linked}, index) => {
    const matches = linked ? [] : match(path.basename(folder) + '/' + relative);
    return {id: String(index), file, name: relative, target: matches.length === 1 ? matches[0] : null,
      status: linked ? 'skipped' : matches.length === 1 ? 'pending' : matches.length ? 'ambiguous' : 'unmatched',
      detail: linked ? 'Links and special files are not followed.' : matches.length > 1 ? 'Matches multiple assets. Use an archive subfolder or choose a single archive.' : matches.length ? '' : 'No matching supported asset. Check the filename and archive.',
      candidates: matches.map(target => target.label)};
  });
  markConflicts(rows); let totalBytes = 0;
  for (const [index, row] of rows.entries()) {
    wb.progress({done: index, total: rows.length, message: 'Checking replacements', detail: row.name});
    if (row.status !== 'pending') continue;
    try {
      const input = readInput(row.file); totalBytes += input.length;
      requireThat(totalBytes <= budget, 'Batch inputs exceed 512 MiB. Choose a smaller folder.');
      row.hash = sha256(input);
      const trial = candidate(wb), before = wb.bytes(row.target.key);
      await replaceOne(trial, row.target, row.file, input, mode);
      requireThat(sha256(readInput(row.file)) === row.hash, 'Input changed during conversion. Scan again.');
      const after = trial.bytes(row.target.key); row.size = after.length;
      row.status = before.equals(after) ? 'unchanged' : 'ready';
      row.detail = row.status === 'unchanged' ? 'Identical to the current project.' : (wb.changes.has(row.target.key) ? 'Updates an already staged asset.' : 'Validated and ready to stage.');
    } catch (error) {row.status = 'error'; row.detail = error.message;}
  }
  const plan = {token: randomUUID(), archives: wb.archives, changes: new Map(wb.changes), rows, mode}; wb.batchPlan = plan;
  wb.progress({done: rows.length, total: rows.length, message: 'Replacement review ready'});
  return {token: plan.token, folder, kind, mode, issues, rows: rows.map(({id, name, status, detail, target, candidates, size}) => ({id, name, status, detail, target: target?.label, candidates, size}))};
}

/** Stage the selected batch atomically; changed inputs or stale projects abort it. */
export async function applyBatchReplace(wb, token, ids) {
  wb.assertSources(); const plan = wb.batchPlan;
  requireThat(plan && plan.token === token && plan.archives === wb.archives && plan.changes.size === wb.changes.size && [...plan.changes].every(([key, value]) => wb.changes.get(key) === value), 'Batch review is stale. Scan the folder again.');
  requireThat(Array.isArray(ids) && ids.length > 0 && ids.length <= plan.rows.length && new Set(ids).size === ids.length, 'Select at least one validated replacement.');
  const selected = ids.map(id => {const row = plan.rows.find(row => row.id === id); requireThat(row?.status === 'ready', 'Select only validated replacements.'); return row;});
  const trial = candidate(wb), keys = new Set();
  for (const [index, row] of selected.entries()) {
    wb.progress({done: index, total: selected.length, message: 'Preparing batch', detail: row.name});
    const input = readInput(row.file); requireThat(sha256(input) === row.hash, row.name + ': input changed since review. Scan again.');
    await replaceOne(trial, row.target, row.file, input, plan.mode); keys.add(row.target.key);
    const bytes = [...keys].reduce((sum, key) => sum + trial.bytes(key).length, 0);
    requireThat(bytes <= budget, 'Combined replacement assets exceed 512 MiB. Select a smaller batch.');
  }
  for (const row of selected) requireThat(sha256(readInput(row.file)) === row.hash, row.name + ': input changed during conversion. Scan again.');
  wb.assertSources(); validateBackgroundMemory(trial, [...keys].map(key => ({key, data: trial.bytes(key)})));
  for (const key of keys) {
    const change = trial.changes.get(key), report = wb.changes.get(key)?.rebuildReport;
    if (change && report && selected.filter(row => row.target.key === key).every(row => row.target.mode === 'texture')) change.rebuildReport = report;
  }
  wb.changes = trial.changes; wb.mapHistory = trial.mapHistory;
  for (const key of keys) wb.textureLibrary.invalidate(key);
  wb.modelPlan = null; wb.animationPlan = null; wb.batchPlan = null;
  wb.progress({done: selected.length, total: selected.length, message: 'Batch staged'});
  return {...wb.snapshot(), batchReport: {files: selected.length, assets: keys.size}};
}
