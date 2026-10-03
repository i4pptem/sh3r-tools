import path from 'node:path';
import {requireThat, sha256} from './binary.mjs';
import {inspectWorld} from './world-formats.mjs';

const stem = name => path.posix.parse(name.replaceAll('\\', '/')).name.toLowerCase();

/** Suggest only unambiguous room companions; other open files remain selectable. */
export function worldReferences(workbench, key) {
  const {archive, entry} = workbench.get(key), result = {};
  for (const extension of ['cld', 'cam']) {
    const candidates = workbench.archives.flatMap((source, a) => source.entries
      .filter(item => item.extension === extension)
      .map(item => ({key: `${a}:${item.index}`, name: item.name, archive: source.name, sameArchive: source === archive})));
    candidates.sort((a, b) => Number(b.sameArchive) - Number(a.sameArchive) || a.name.localeCompare(b.name));
    const matching = candidates.filter(item => stem(item.name) === stem(entry.name));
    const local = matching.filter(item => item.sameArchive), matches = local.length ? local : matching;
    const bound = extension === 'cld' ? workbench.mapCollisions.get(key)?.target : null;
    result[extension] = {candidates, selected: bound || (matches.length === 1 ? matches[0].key : null)};
  }
  return result;
}

/** Return staged reference geometry without merging it into the editable MAP. */
export function worldReference(workbench, key, target) {
  requireThat(workbench.format(key) === 'map', 'Select a MAP before loading reference layers.');
  const {entry} = workbench.get(target);
  requireThat(['cld', 'cam'].includes(entry.extension), 'Reference layers must be CLD or CAM assets.');
  const data = workbench.bytes(target), world = inspectWorld(data, entry.extension);
  const binding=[...workbench.mapCollisions].find(([,plan])=>plan.target===target);
  return {key:target,name:entry.name,hash:sha256(data),boundGroups:binding?.[1].bindings.map(b=>b.group)||[],boundOwner:binding?.[0],...world};
}
