import {requireThat} from './binary.mjs';
import {parseCollision} from './world-formats.mjs';
import {indexCollisionRecords, writeCollisionGroups} from './collision-rebuild.mjs';

/** Edit existing CLD records and rebuild the affected native spatial lists. */
export function editCollision(data, edits) {
  const source=parseCollision(data), groups=new Map(), seen=new Set();
  const mode=source.groups.some(g=>g.spatialCells.slice(1).some(list=>list.length))?'grid':'room';
  requireThat(Array.isArray(edits) && edits.length<=100000,'Invalid collision edit list.');
  for(const edit of edits) {
    const {group,index}=edit, label=`Collision group ${group}, record ${index}`;
    requireThat(Number.isInteger(group)&&group>=0&&group<5&&Number.isInteger(index)&&index>=0&&index<source.groups[group].count&&!seen.has(`${group}:${index}`),`${label}: invalid or repeated record.`);
    seen.add(`${group}:${index}`);
    const stride=group===4?48:80, offset=data.readUInt32LE(0x160+group*4);
    if(!groups.has(group))groups.set(group,{records:Array.from({length:source.groups[group].count},(_,i)=>Buffer.from(data.subarray(offset+i*stride,offset+(i+1)*stride)))});
    const record=groups.get(group).records[index], original=source.groups[group].records[index];
    const put=(value,at)=>{requireThat(Number.isFinite(value)&&Number.isFinite(Math.fround(value)),`${label}: enter finite coordinates.`);if(value!==record.readFloatLE(at))record.writeFloatLE(value,at);};
    requireThat(Number.isInteger(edit.material)&&edit.material>=0&&edit.material<=0xffffffff,`${label}: invalid material ID.`);record.writeUInt32LE(edit.material,8);
    if(group<4) {
      requireThat(Array.isArray(edit.vertices)&&edit.vertices.length===original.vertices.length&&edit.vertices.every(p=>Array.isArray(p)&&p.length===3),`${label}: preserve polygon shape.`);
      if([1,3].includes(group)) {
        const p=edit.vertices, sameXZ=(a,b)=>a[0]===b[0]&&a[2]===b[2];
        requireThat(p.length===4&&p[0][1]!==p[2][1]&&((sameXZ(p[0],p[1])&&sameXZ(p[2],p[3])&&p[0][1]===p[3][1]&&p[1][1]===p[2][1])||(sameXZ(p[0],p[3])&&sameXZ(p[1],p[2])&&p[0][1]===p[1][1]&&p[2][1]===p[3][1])),`${label}: native walls must stay vertical rectangles.`);
      }
      edit.vertices.forEach((p,i)=>p.forEach((v,k)=>put(v,16+i*16+k*4)));
      if(edit.vertices.length===3)record.copy(record,64,16,32);
    } else {
      requireThat(Array.isArray(edit.position)&&edit.position.length===3&&edit.radius>0,`${label}: cylinder radius must be positive.`);
      edit.position.forEach((v,k)=>put(v,16+k*4));put(edit.topY,36);put(edit.radius,44);
    }
  }
  for(const [group,replacement] of groups)replacement.cells=indexCollisionRecords(replacement.records,mode,source.origin,group===4);
  return writeCollisionGroups(data,source,groups,mode);
}
