import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {openWorkspace} from './workspace.mjs';
import {entryBytes} from './archives.mjs';
import {looseBytes} from './loose-files.mjs';
import {sha256, requireThat} from './binary.mjs';
import {workspaceSources, assertSources} from './source-state.mjs';

const identity = (archive, entry) => JSON.stringify([path.resolve(archive.file), archive.format,
  archive.format === 'FOLDER' ? path.resolve(entry.sourceFile) : entry.fileId]);

function entriesByIdentity(workspace) {
  const entries = new Map();
  workspace.archives.forEach((archive, i) => archive.entries.forEach(entry => {
    const id = identity(archive, entry);
    entries.set(id, entries.has(id) ? null : {archive, entry, key: `${i}:${entry.index}`});
  }));
  return entries;
}

/** Compare staged replacements against a freshly parsed workspace before committing a reload. */
export function prepareSourceReload(workbench) {
  const workspace = openWorkspace(workbench.input), sources = workspaceSources(workspace);
  const current = entriesByIdentity(workspace), previous = entriesByIdentity(workbench);
  const changes = new Map(), conflicts = [], installed = [], keyMap = {};
  for (const [id, old] of previous) {
    if (!old) continue;
    const next = current.get(id);
    if (next) keyMap[old.key] = next.key;
  }
  for (const [key, change] of workbench.changes) {
    const old = workbench.get(key), id = identity(old.archive, old.entry), next = current.get(id);
    if (!next || !previous.get(id)) {conflicts.push({key, name: old.entry.name, reason: 'The original asset is missing or its ID is ambiguous.'}); continue;}
    const data = next.archive.format === 'FOLDER' ? looseBytes(next.entry) : entryBytes(next.archive, next.entry.index);
    if (data.equals(change.data)) installed.push(old.entry.name);
    else if (sha256(data) === change.originalHash) changes.set(next.key, change);
    else conflicts.push({key, name: old.entry.name, reason: 'Both the file on disk and your staged replacement changed.'});
  }
  assertSources(sources);
  return {token: randomUUID(), workspace, sources, changes, conflicts, installed, keyMap, previousChanges: new Map(workbench.changes)};
}

export function validateSourceReload(workbench, plan, token, discardConflicts) {
  requireThat(plan?.token === token, 'Reload preview expired. Check the sources again.');
  requireThat(discardConflicts || !plan.conflicts.length, 'Review conflicting replacements before reloading.');
  requireThat(workbench.changes.size === plan.previousChanges.size && [...workbench.changes].every(([key, change]) => plan.previousChanges.get(key) === change), 'Staged replacements changed. Check the sources again.');
  assertSources(plan.sources);
}
