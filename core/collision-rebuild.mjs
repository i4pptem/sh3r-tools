import {collisionPolygons} from './collision-polygons.mjs';
import {align, range, requireThat} from './binary.mjs';
import {parseCollision, parseMap} from './world-formats.mjs';

function splitGridWall(vertices,origin) {
  const a=vertices[0],b=vertices.find(p=>p[0]!==a[0] || p[2]!==a[2]),cuts=[0,1];
  for(const [axis,base] of [[0,origin[0]],[2,origin[1]]])if(a[axis]!==b[axis])for(let i=1;i<4;i++) {
    const t=(base+i*5000-a[axis])/(b[axis]-a[axis]);if(t>0 && t<1)cuts.push(t);
  }
  const sorted=[...new Set(cuts)].sort((x,y)=>x-y);
  return sorted.slice(1).map((end,i)=>vertices.map(p=>{
    const t=p[0]===a[0]&&p[2]===a[2]?sorted[i]:end;
    return [Math.fround(a[0]+(b[0]-a[0])*t),p[1],Math.fround(a[2]+(b[2]-a[2])*t)];
  }));
}

function polygonRecords(model, binding, template, mode, origin) {
  const polygons=collisionPolygons(model,binding).flatMap(({vertices})=>mode==='grid' && [1,3].includes(binding.group)?splitGridWall(vertices,origin):[vertices]);
  return polygons.map(vertices => {
    const record=Buffer.from(template); record[1]=vertices.length===4?1:0; record.fill(0,16); record.writeUInt32LE(binding.material,8);
    vertices.forEach((point,i)=>{point.forEach((v,k)=>record.writeFloatLE(v,16+i*16+k*4));record.writeFloatLE(1,28+i*16);});
    if(vertices.length===3)record.copy(record,64,16,32);
    return record;
  });
}

function overlapsCell(points,low) {
  const axes=[[1,0],[0,1],...points.map((p,i)=>{const q=points[(i+1)%points.length];return [p[1]-q[1],q[0]-p[0]];})];
  return axes.every(axis=>{
    const values=points.map(p=>p[0]*axis[0]+p[1]*axis[1]),center=(low[0]+2500)*axis[0]+(low[1]+2500)*axis[1],radius=2500*(Math.abs(axis[0])+Math.abs(axis[1]));
    return Math.min(...values)<=center+radius && Math.max(...values)>=center-radius;
  });
}

export function indexCollisionRecords(records, mode, origin, cylinder = false) {
  const cells = Array.from({length: 16}, () => []);
  records.forEach((record, index) => {
    if (mode === 'room') {cells[0].push(index); return;}
    const radius=cylinder?record.readFloatLE(44):0, x=record.readFloatLE(16), z=record.readFloatLE(24);
    const points = cylinder ? [[x-radius,z-radius],[x+radius,z-radius],[x+radius,z+radius],[x-radius,z+radius]] : Array.from({length: record[1] === 1 ? 4 : 3}, (_, i) => [record.readFloatLE(16 + i * 16), record.readFloatLE(24 + i * 16)]);
    const min = [0, 1].map(k => Math.min(...points.map(v => v[k]))), max = [0, 1].map(k => Math.max(...points.map(v => v[k])));
    requireThat(min.every((v, k) => v >= origin[k]) && max.every((v, k) => v <= origin[k] + 20000), 'Collision leaves the native 20,000-unit outdoor grid. Keep geometry inside the original region.');
    for (let z = 0; z < 4; z++) for (let x = 0; x < 4; x++) {
      const low = [origin[0] + x * 5000, origin[1] + z * 5000];
      if (overlapsCell(points,low)) cells[x + z * 4].push(index);
    }
  });
  return cells;
}

/** Replace only explicitly bound polygon groups, retaining all other native records and indices. */
export function rebuildCollision(base, mapData, bindings, mode) {
  requireThat(Array.isArray(bindings) && bindings.length<=4,'Invalid collision group bindings.');
  requireThat(['room', 'grid'].includes(mode), 'Choose room or outdoor grid collision indexing.');
  const source = parseCollision(base), model = parseMap(mapData).model, groups = new Map();
  for (const binding of bindings) {
    requireThat(Number.isInteger(binding.group) && binding.group >= 0 && binding.group < 4 && !groups.has(binding.group), 'Invalid or repeated collision polygon group.');
    requireThat(Array.isArray(binding.parts) && Number.isInteger(binding.material) && binding.material >= 0 && binding.material <= 0xffffffff, 'Invalid collision mesh selection or material.');
    const count = source.groups[binding.group].count;
    requireThat(Number.isInteger(binding.template) && (count ? binding.template >= 0 && binding.template < count : binding.template === -1), 'Choose an existing collision polygon as the behavior template.');
    const offset = base.readUInt32LE(0x160 + binding.group * 4) + binding.template * 80;
    const template = count ? base.subarray(offset, offset + 80) : Buffer.alloc(80);
    if(!count) {template[0]=1;template.writeUInt32LE(4,4);}
    const records = polygonRecords(model, binding, template, mode, source.origin);
    groups.set(binding.group, {records, cells: indexCollisionRecords(records, mode, source.origin)});
  }
  return writeCollisionGroups(base,source,groups,mode);
}

export function writeCollisionGroups(base, source, groups, mode) {
  if (!groups.size) return Buffer.from(base);
  const header = Buffer.from(base.subarray(0, 0x174)), chunks = [header]; let size = header.length;
  const append = (data, boundary = 4) => {
    const offset = align(size, boundary); if (offset > size) chunks.push(Buffer.alloc(offset - size));
    chunks.push(data); size = offset + data.length; return offset;
  };
  let sourceEnd = 0x174;
  for (let g = 0; g < 5; g++) {
    const native = source.groups[g], replacement = groups.get(g);
    for (let cell = 0; cell < 16; cell++) {
      const originalOffset = base.readUInt32LE(0x20 + (g * 16 + cell) * 4);
      sourceEnd = Math.max(sourceEnd, originalOffset + (native.spatialCells[cell].length + 1) * 4);
      const list = replacement ? replacement.cells[cell] : native.spatialCells[cell], encoded = Buffer.alloc((list.length + 1) * 4);
      list.forEach((value, i) => encoded.writeInt32LE(value, i * 4)); encoded.writeInt32LE(-1, list.length * 4);
      header.writeUInt32LE(append(encoded), 0x20 + (g * 16 + cell) * 4);
    }
  }
  for (let g = 0; g < 5; g++) {
    const length = base.readUInt32LE(8 + g * 4), offset = base.readUInt32LE(0x160 + g * 4), replacement = groups.get(g);
    range(base, offset, length); sourceEnd = Math.max(sourceEnd, offset + length);
    const records = replacement ? Buffer.concat([...replacement.records, Buffer.alloc(g===4?48:80)]) : base.subarray(offset, offset + length);
    header.writeUInt32LE(records.length, 8 + g * 4); header.writeUInt32LE(append(records, 16), 0x160 + g * 4);
  }
  append(base.subarray(sourceEnd), 1);
  requireThat(size < (mode==='grid'?9:36)*1024*1024,'This CLD alone exceeds the native shared world-memory budget. Simplify the collision meshes.');
  const output = Buffer.concat(chunks); parseCollision(output); return output;
}
