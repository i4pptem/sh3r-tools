/** Native source-file arena accounting. Resolver must describe the complete effective catalog.
 * Returns undefined/null only for files that do not exist; values are uncompressed native bytes.
 * This checks file storage, not D3D texture allocation or streaming visibility behavior.
 */
const PRIMARY_BYTES = 36 * 1024 * 1024;
const align = (n, a) => Math.ceil(n / a) * a;
function stageMapName(name) {
  const match = /^data\/tmp\/([a-z]{2})([0-9a-f]{2})\.map$/i.exec(name.replaceAll('\\', '/'));
  if (!match) throw new Error('A catalog MAP name data/tmp/<stage><room>.map is required.');
  return {stage:match[1].toLowerCase(),room:match[2].toLowerCase(),stem:(match[1]+match[2]).toLowerCase()};
}
function file(resolveSize,path,category) {
  const bytes = resolveSize(path);
  if (bytes === undefined || bytes === null) return null;
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Invalid effective file size: '+path);
  return {path,bytes,alignedBytes:align(bytes,2048),category};
}
function group(records) {
  return [...new Set(records.map(r=>r.category))].sort().map(category=>{
    const files=records.filter(r=>r.category===category),unalignedBytes=files.reduce((n,r)=>n+r.alignedBytes,0);
    return {category,files,alignedBytes:align(unalignedBytes,65536)};
  });
}
export function backgroundBudget(mapName,resolveSize,{primaryBytes=PRIMARY_BYTES}={}) {
  const {stage,room,stem}=stageMapName(mapName),outdoor=stage==='cc';
  const resources=[];
  const add=(name,category)=>{const entry=file(resolveSize,name,category);if(entry)resources.push(entry);};
  add(`data/tmp/${stage}GB.tex`,0);
  if(outdoor){add(`data/tmp/${stage}01TR.tex`,0);add(`data/bg/${stage}/${stage}GB.cam`,0);add(`data/bg/${stage}/${stage}GB.uni`,0);}
  else resources.push({path:'*demo',bytes:0x210000,alignedBytes:0x210000,category:0});
  if(!outdoor){add(`data/tmp/${stem}TR.tex`,1);add(`data/bg/${stage}/${stem}.ded`,1);add(`data/bg/${stage}/${stem}.uni`,1);}
  add(`data/bg/${stage}/${stem}.cld`,outdoor?4:1);
  add(`data/tmp/${stem}.map`,outdoor?3:1);
  for(const ext of ['kg2','lgt','lv'])add(`data/bg/${stage}/${stem}.${ext}`,outdoor?3:1);
  add(`data/bg/${stage}/${stem}.cam`,outdoor?2:1);
  const categories=group(resources),commonBytes=categories.find(c=>c.category===0)?.alignedBytes??0;
  const partitionCount=outdoor?4:1,partitionBytes=Math.floor((primaryBytes-commonBytes)/partitionCount/65536)*65536;
  const roomBytes=categories.filter(c=>c.category!==0).reduce((n,c)=>n+c.alignedBytes,0),remainingBytes=partitionBytes-roomBytes;
  return {mapName,stage,room,outdoor,primaryBytes,commonBytes,partitionCount,partitionBytes,roomBytes,remainingBytes,categories,withinSingleRoom:remainingBytes>=0,streamingVerified:false};
}
/** Conservative indoor transition test; no adjacency graph is assumed.
 * Pass every effective MAP in the affected stage. Two largest distinct rooms may coexist.
 * Outdoor partitions reserve both the departing and arriving tile; remapped tiles may share a source file.
 */
export function stageBackgroundBudget(mapNames,resolveSize,options={}) {
  if(!mapNames.length)throw new Error('No MAPs were supplied for stage validation.');
  const rooms=mapNames.map(name=>backgroundBudget(name,resolveSize,options));
  if(new Set(rooms.map(r=>r.stage)).size!==1)throw new Error('Expected one complete stage.');
  const largest=[...rooms].sort((a,b)=>b.roomBytes-a.roomBytes).slice(0,2),first=rooms[0],transitionBytes=first.outdoor?2*largest[0].roomBytes:largest.reduce((n,r)=>n+r.roomBytes,0);
  return {stage:first.stage,outdoor:first.outdoor,commonBytes:first.commonBytes,partitionBytes:first.partitionBytes,rooms,
    withinSingleRoom:rooms.every(r=>r.withinSingleRoom),conservativeTransitionBytes:transitionBytes,
    conservativeTransitionRemainingBytes:first.partitionBytes-transitionBytes,
    conservativeTransitionFits:transitionBytes<=first.partitionBytes,
    transitionPolicy:first.outdoor?'two-largest-tile-copies-per-partition':'two-largest-distinct-rooms',
    transitionRooms:largest.map(r=>r.mapName)};
}
