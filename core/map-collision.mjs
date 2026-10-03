import {validateBackgroundMemory} from './map-memory.mjs';
import path from 'node:path';
import {requireThat, sha256} from './binary.mjs';
import {parseCollision} from './world-formats.mjs';
import {rebuildCollision} from './collision-rebuild.mjs';

export function collisionOptions(workbench, key) {
  const {archive, entry} = workbench.get(key), stem = path.posix.basename(entry.name.replaceAll('\\', '/'), '.map').toLowerCase();
  const candidates = archive.entries.filter(e => e.extension === 'cld').map(e => ({key: `${key.split(':')[0]}:${e.index}`, name: e.name}));
  const plan = workbench.mapCollisions.get(key), matched = candidates.find(e => path.posix.basename(e.name, '.cld').toLowerCase() === stem);
  const selected = plan?.target || matched?.key;
  const data = selected ? workbench.bytes(selected) : null, collision = data ? parseCollision(plan?.base || data) : null, current=data?parseCollision(data):null;
  return {candidates, selected, configured: !!plan, mode: plan?.mode || (collision?.groups.some(g => g.spatialCells.slice(1).some(list => list.length)) ? 'grid' : 'room'),
    bindings: plan?.bindings || [], groups: collision?.groups.slice(0, 4).map((g,i) => ({name: g.name, count: g.count, currentCount:current.groups[i].count, materials: [...new Set(g.records.map(r => r.material))]})) || []};
}

export function collisionPlan(workbench, key, options) {
  const previous = workbench.mapCollisions.get(key);
  if (previous) requireThat(sha256(workbench.bytes(previous.target)) === previous.outputHash, 'The bound CLD changed separately. Undo that replacement before updating the map collision.');
  if(options?.disconnect===true)return {plan:null,update:null};
  if (options === null) return {plan: null, update: previous ? {key: previous.target, data: previous.base} : null};
  requireThat(options && Array.isArray(options.parts) && options.parts.length<=50000,'Invalid collision mesh binding.');
  requireThat(collisionOptions(workbench, key).candidates.some(candidate => candidate.key === options.target), 'Choose a CLD from the same room archive.');
  requireThat(!previous || previous.target === options.target, 'Restore and disconnect the current collision binding before choosing a different CLD.');
  requireThat(![...workbench.mapCollisions].some(([owner, p]) => owner !== key && p.target === options.target), 'This CLD is already bound to another map.');
  const base = previous?.base || Buffer.from(workbench.bytes(options.target));
  const bindings = [...(previous?.bindings || []).filter(binding => binding.group !== options.group)];
  if (options.parts.length) bindings.push({group: options.group, parts: [...options.parts], template: options.template, material: options.material, surfaceFilter:options.surfaceFilter||'all', simplification:options.simplification||null});
  if (!bindings.length) return {plan: null, update: {key: options.target, data: base}};
  const data = rebuildCollision(base, workbench.bytes(key), bindings, options.mode);
  return {plan: {target: options.target, base, bindings, mode: options.mode, outputHash: sha256(data)}, update: {key: options.target, data}};
}

export function updateBoundCollision(workbench, key, data) {
  const current = workbench.mapCollisions.get(key); if (!current) return null;
  requireThat(sha256(workbench.bytes(current.target)) === current.outputHash, 'The bound CLD changed separately. Undo that replacement before rebuilding the map.');
  const output = rebuildCollision(current.base, data, current.bindings, current.mode);
  return {plan: {...current, outputHash: sha256(output)}, update: {key: current.target, data: output}};
}

/** Journal geometry and collision as one action after validating every payload. */
export function stageWorld(workbench, key, updates, label, binding = undefined) {
  validateBackgroundMemory(workbench,updates);
  requireThat(new Set(updates.map(update => update.key)).size === updates.length, 'Duplicate world edit target.');
  const prepared = updates.map(update => ({...update, change: workbench.prepareChange(update.key, update.data, label)}));
  const previous = prepared.filter(update => !update.data.equals(workbench.bytes(update.key))).map(update => ({key: update.key, data: Buffer.from(workbench.bytes(update.key)), afterHash: sha256(update.data)}));
  const oldBinding = workbench.mapCollisions.get(key) || null;
  if (!previous.length && binding === undefined) return workbench.snapshot();
  const history = [...(workbench.mapHistory.get(key) || []), {updates: previous, binding: oldBinding, afterBinding: binding === undefined ? oldBinding : binding}];
  const size = edit => edit.updates.reduce((n, update) => n + update.data.length, 0);
  while (history.length > 20 || (history.length > 1 && history.reduce((n, edit) => n + size(edit), 0) > 64 * 1024 * 1024)) history.shift();
  for (const update of prepared) {
    if (update.change) workbench.changes.set(update.key, update.change); else workbench.changes.delete(update.key);
    workbench.textureLibrary.invalidate(update.key);
  }
  if (binding !== undefined) {if (binding) workbench.mapCollisions.set(key, binding); else workbench.mapCollisions.delete(key);}
  workbench.mapHistory.set(key, history); return workbench.snapshot();
}

export function undoWorld(workbench, key) {
  const history = [...(workbench.mapHistory.get(key) || [])]; requireThat(history.length, 'No map edits to undo in this session.');
  const previous = history.pop();
  for (const update of previous.updates) requireThat(sha256(workbench.bytes(update.key)) === update.afterHash, 'A linked asset changed outside the editor. Undo its later edits first.');
  requireThat((workbench.mapCollisions.get(key) || null) === previous.afterBinding, 'Collision bindings changed after this action.');
  const prepared = previous.updates.map(update => ({key: update.key, change: workbench.prepareChange(update.key, update.data, 'World edit')}));
  for (const update of prepared) {
    if (update.change) workbench.changes.set(update.key, update.change); else workbench.changes.delete(update.key);
    workbench.textureLibrary.invalidate(update.key);
  }
  if (previous.binding) workbench.mapCollisions.set(key, previous.binding); else workbench.mapCollisions.delete(key);
  workbench.mapHistory.set(key, history); return workbench.snapshot();
}

export function saveCollisionBindings(workbench) {
  return [...workbench.mapCollisions].map(([key, plan]) => ({key, ...plan, base: plan.base.toString('base64')}));
}

export function loadCollisionBindings(workbench, entries, remap) {
  requireThat(Array.isArray(entries) && entries.length <= 10000, 'Invalid project collision bindings.');
  for (const entry of entries) {
    const key = remap(entry.key), target = remap(entry.target), base = Buffer.from(entry.base, 'base64');
    requireThat(workbench.format(key) === 'map' && workbench.format(target) === 'cld' && !workbench.mapCollisions.has(key), 'Invalid collision binding asset.');
    requireThat(collisionOptions(workbench, key).candidates.some(candidate => candidate.key === target), 'Collision binding must reference the same archive.');
    requireThat(![...workbench.mapCollisions.values()].some(plan => plan.target === target), 'Duplicate CLD binding.');
    const output = rebuildCollision(base, workbench.bytes(key), entry.bindings, entry.mode);
    requireThat(output.equals(workbench.bytes(target)), 'Saved collision binding does not match its staged MAP and CLD.');
    workbench.mapCollisions.set(key, {target, base, bindings: entry.bindings, mode: entry.mode, outputHash: sha256(output)});
  }
}
