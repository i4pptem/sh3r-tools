import {requireThat,writeNew} from './binary.mjs';
import {sourceRecord} from './loose-files.mjs';
import {saveCollisionBindings} from './map-collision.mjs';
import {editRoom} from './room-edit.mjs';
import {TextureLibrary} from './texture-library.mjs';

/** Validate every pending room on an isolated state; publish only after the project is written. */
export function saveProject(workbench,file,drafts=[]) {
  workbench.assertSources();
  requireThat(Array.isArray(drafts)&&drafts.length<=10000,'Invalid pending room list.');
  const candidate=Object.assign(Object.create(Object.getPrototypeOf(workbench)),workbench,{changes:new Map(workbench.changes),mapCollisions:new Map(workbench.mapCollisions),mapHistory:new Map(workbench.mapHistory)});
  candidate.textureLibrary=new TextureLibrary(candidate);
  const seen=new Set();
  for(const room of drafts) {
    requireThat(room&&typeof room.key==='string'&&!seen.has(room.key),'Duplicate or invalid pending room.');seen.add(room.key);
    try{editRoom(candidate,room.key,room.hash,room.edits,room.references);}
    catch(error){throw new Error(`${candidate.get(room.key).entry.name}: ${error.message} Project was not saved; your previews are still open.`);}
  }
  const doc={format:'sh3tools-project-v2',source:candidate.input,sources:candidate.archives.map(sourceRecord),collisionBindings:saveCollisionBindings(candidate),
    changes:[...candidate.changes].map(([key,c])=>({key,label:c.label,originalHash:c.originalHash,rebuildReport:c.rebuildReport,animationReport:c.animationReport,data:c.data.toString('base64')}))};
  writeNew(file,JSON.stringify(doc));
  if(drafts.length){workbench.changes=candidate.changes;workbench.mapCollisions=candidate.mapCollisions;workbench.mapHistory=candidate.mapHistory;workbench.textureLibrary.reset();}
  return {file,appliedDrafts:[...seen],snapshot:drafts.length?workbench.snapshot():undefined};
}
