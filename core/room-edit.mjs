import {requireThat,sha256} from './binary.mjs';
import {editMap} from './map-edit.mjs';
import {editCameras} from './camera-edit.mjs';
import {editCollision} from './collision-edit.mjs';
import {stageWorld} from './map-collision.mjs';
import {rebuildCollision} from './collision-rebuild.mjs';

/** Validate a complete room transaction before staging any of its assets. */
export function editRoom(workbench,key,hash,edits,references) {
  requireThat(workbench.format(key)==='map'&&sha256(workbench.bytes(key))===hash,'Map changed. Reload it before applying room edits.');
  requireThat(Array.isArray(edits)&&edits.length<=50000&&Array.isArray(references)&&references.length<=1000,'Invalid room edit list.');
  let map=workbench.bytes(key);const reference=workbench.mapReference(key),updates=[],seen=new Set();
  for(const edit of edits)map=editMap(map,edit,reference);
  if(edits.length)updates.push({key,data:map});
  const current=workbench.mapCollisions.get(key);let binding=current?{...current}:undefined;
  if(current)requireThat(sha256(workbench.bytes(current.target))===current.outputHash,'The bound CLD changed separately. Undo that replacement first.');
  for(const ref of references) {
    const format=workbench.format(ref.target);
    requireThat(['cld','cam'].includes(format)&&format===ref.kind&&!seen.has(ref.target),'Choose a unique CLD or CAM reference.');seen.add(ref.target);
    requireThat(sha256(workbench.bytes(ref.target))===ref.hash,'Reference file changed. Discard its preview edits and reload it.');
    if(format==='cam')updates.push({key:ref.target,data:editCameras(workbench.bytes(ref.target),ref.records)});
    else {
      const owner=[...workbench.mapCollisions].find(([,plan])=>plan.target===ref.target);
      requireThat(!owner||owner[0]===key,'This CLD is bound to another map. Edit it from that map.');
      requireThat(!current||current.target!==ref.target||!ref.records.some(record=>current.bindings.some(b=>b.group===record.group)),'This collision group is generated from map meshes. Edit those meshes or disconnect its binding first.');
      if(current?.target===ref.target)binding.base=editCollision(current.base,ref.records);
      else updates.push({key:ref.target,data:editCollision(workbench.bytes(ref.target),ref.records)});
    }
  }
  if(binding&&(edits.length||seen.has(binding.target))) {
    const data=rebuildCollision(binding.base,map,binding.bindings,binding.mode);binding.outputHash=sha256(data);updates.push({key:binding.target,data});
  } else binding=undefined;
  return stageWorld(workbench,key,updates,'Room geometry / collision / camera edits',binding);
}
