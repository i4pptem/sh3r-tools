import {mapTransforms, mapPartTransform} from './map-transforms.mjs';
import {Matrix4, Matrix3, Vector3} from 'three';
import {range, requireThat, sha256} from './binary.mjs';
import {cameraRecords, drawEnvironmentRecords, soundDatabaseRecords} from './world-records.mjs';

const floats = (data, offset, count) => {range(data, offset, count * 4); const result = Array.from({length: count}, (_, i) => data.readFloatLE(offset + i * 4)); requireThat(result.every(Number.isFinite), 'Non-finite world coordinate.'); return result;};
const displayPoint = point => [-point[0], -point[1], point[2]];
const mesh = (name, positions, normals, uv, indices, extra = {}) => ({name, positions, normals, uv, indices, joints: [], weights: [], morphPositions: [], morphNormals: [],
  vertexCount: positions.length / 3, triangleCount: indices.length / 3, texture: -1, group: 0, ...extra});
const model = (data, meshes) => ({bones: [], meshes, morphNames: [], textureCount: 0, vertexCount: meshes.reduce((s, m) => s + m.vertexCount, 0), triangleCount: meshes.reduce((s, m) => s + m.triangleCount, 0), sourceHash: sha256(data), world: true});

function polygonMesh(name, polygons) {
  const positions = [], normals = [], indices = [], uv = [];
  for (const polygon of polygons) {
    const start = positions.length / 3, points = polygon.map(displayPoint);
    const a = new Vector3().fromArray(points[0]), b = new Vector3().fromArray(points[1]), c = new Vector3().fromArray(points[2]);
    const normal = b.sub(a).cross(c.sub(a)).normalize().toArray();
    for (const point of points) {positions.push(...point); normals.push(...normal); uv.push(0, 0);}
    for (let i = 1; i + 1 < points.length; i++) indices.push(start, start + i, start + i + 1);
  }
  return mesh(name, positions, normals, uv, indices);
}

export function parseCollision(data) {
  range(data, 0, 0x174, 'CLD header');
  const origin = floats(data, 0, 2), groups = [], meshes = [];
  const names = ['Floor', 'Walls', 'Group 2', 'Furniture', 'Cylinders'];
  for (let group = 0; group < 5; group++) {
    const length = data.readUInt32LE(8 + group * 4), offset = data.readUInt32LE(0x160 + group * 4), stride = group === 4 ? 48 : 80;
    requireThat(length >= stride && length % stride === 0, 'Invalid CLD group size.'); range(data, offset, length, 'CLD group');
    const records = [], polygons = [];
    for (let p = offset; p < offset + length; p += stride) {
      const flags = data.readUInt32LE(p), type = data.readUInt32LE(p + 4), material = data.readUInt32LE(p + 8);
      if (flags === 0 && type === 0 && material === 0) break;
      if (group < 4) {
        const points = Array.from({length: flags & 0x100 ? 4 : 3}, (_, i) => floats(data, p + 16 + i * 16, 3));
        records.push({flags, type, material, vertices: points}); polygons.push(points);
      } else {
        const position = floats(data, p + 16, 3), height = floats(data, p + 32, 3), radius = data.readFloatLE(p + 44);
        requireThat(Number.isFinite(radius) && radius >= 0, 'Invalid CLD cylinder radius.');
        records.push({flags, type, material, position, height, radius});
        for (let i = 0; i < 20; i++) {
          const angle = i * Math.PI / 10, next = (i + 1) * Math.PI / 10;
          const a = [position[0] + Math.cos(angle) * radius, position[1], position[2] + Math.sin(angle) * radius];
          const b = [position[0] + Math.cos(next) * radius, position[1], position[2] + Math.sin(next) * radius];
          polygons.push([a, b, b.map((v, k) => v + height[k]), a.map((v, k) => v + height[k])]);
        }
      }
    }
    const lists = [];
    for (let cell = 0; cell < 16; cell++) {
      let p = data.readUInt32LE(0x20 + (group * 16 + cell) * 4); const list = [];
      for (;;) {range(data, p, 4, 'CLD spatial index'); const index = data.readInt32LE(p); p += 4; if (index === -1) break;
        requireThat(index >= 0 && index < records.length && list.length <= records.length, 'Invalid CLD face index.'); list.push(index);}
      lists.push(list);
    }
    groups.push({name: names[group], count: records.length, records, spatialCells: lists});
    if (polygons.length) meshes.push(polygonMesh(names[group], polygons));
  }
  return {format: 'SH3 collision geometry', origin, groups, model: model(data, meshes)};
}

function zonePolygons(ground, heights) {
  const [a,b,c]=ground,d=[a[0]+c[0]-b[0],a[1]+c[1]-b[1]];
  const area=(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);
  if(area===0||heights[0]===heights[1])return [];
  const floor=[a,b,c,d].map(([x,z])=>[x,heights[0],z]),ceiling=[a,b,c,d].map(([x,z])=>[x,heights[1],z]);
  return [floor,[...ceiling].reverse(),...floor.map((point,i)=>[point,floor[(i+1)%4],ceiling[(i+1)%4],ceiling[i]])];
}

export function parseCameras(data) {
  const details=cameraRecords(data),meshes=[];
  for(const record of details.records) {
    for(const [name,ground,heights] of [['Activation',record.activeGroundPoints,record.activeHeights],['Constraint',record.constraintGroundPoints,record.constraintHeights]]) {
      const polygons=zonePolygons(ground,heights);
      if(polygons.length)meshes.push(polygonMesh(`Zone_${record.index}_${name}`,polygons));
    }
  }
  return {...details,model:model(data,meshes)};
}
function linkedRecords(data, start, minimum, visit) {
  const seen = new Set(); let offset = start;
  while (offset) {
    requireThat(!seen.has(offset) && seen.size < 100000, 'Cyclic or oversized MAP record chain.'); seen.add(offset); range(data, offset, minimum, 'MAP record');
    const next = data.readUInt32LE(offset), header = data.readUInt32LE(offset + 4), length = data.readUInt32LE(offset + 8);
    requireThat(header >= minimum && header <= length, 'Invalid MAP record header.'); range(data, offset, length, 'MAP record data');
    visit(offset, header, length); offset = next;
  }
}

export function parseMap(data) {
  range(data, 0, 80, 'MAP header'); requireThat(data.readInt32LE(0) === -1 && data.readUInt32LE(12) === 80, 'Unsupported MAP header.');
  const transforms = mapTransforms(data);
  const starts = [28, 32, 36].map(p => data.readUInt32LE(p)).filter(Boolean), meshes = [], groups = [];
  requireThat(starts.length > 0, 'MAP contains no mesh groups.');
  linkedRecords(data, Math.min(...starts), 48, (groupOffset, groupHeader) => {
    const textureSource = data.readUInt32LE(groupOffset + 16), textureIndex = data.readUInt32LE(groupOffset + 20), group = groups.length;
    groups.push({index: group, textureSource, textureIndex, offset: groupOffset});
    linkedRecords(data, groupOffset + groupHeader, 48, (subOffset, subHeader) => {
      linkedRecords(data, subOffset + subHeader, 48, (shapeOffset, shapeHeader) => {
        linkedRecords(data, shapeOffset + shapeHeader, 64, (partOffset, partHeader, partLength) => {
          const count = data.readUInt32LE(partOffset + 16), objectType = data.readUInt32LE(partOffset + 20), partId = data.readUInt32LE(partOffset + 24);
          requireThat(count <= 2000000 && meshes.length < 50000, 'MAP geometry exceeds the preview limit.');
          requireThat(partHeader + count * 36 <= partLength, 'MAP vertices exceed their mesh record.'); range(data, partOffset + partHeader, count * 36, 'MAP vertices');
          const {record, matrix: global} = mapPartTransform(transforms, objectType, partId), normalMatrix = new Matrix3().getNormalMatrix(global);
          const positions = [], normals = [], uv = [], colors = [], indices = [], point = new Vector3();
          for (let i = 0; i < count; i++) {
            const p = partOffset + partHeader + i * 36;
            positions.push(...point.fromArray(floats(data, p, 3)).applyMatrix4(global).toArray());
            normals.push(...point.fromArray(floats(data, p + 12, 3)).applyMatrix3(normalMatrix).normalize().toArray()); uv.push(...floats(data, p + 24, 2)); colors.push(data[p + 34] / 255, data[p + 33] / 255, data[p + 32] / 255);
            if (i >= 2) {
              const equal = (a, b) => [0, 1, 2].every(k => positions[a * 3 + k] === positions[b * 3 + k]);
              if (!equal(i - 2, i - 1) && !equal(i - 1, i) && !equal(i - 2, i)) indices.push(...(i & 1 ? [i, i - 1, i - 2] : [i - 2, i - 1, i]));
            }
          }
          meshes.push(mesh(`Map_${group}_${meshes.length}`, positions, normals, uv, indices, {layout: {offset: partOffset, vertices: partOffset + partHeader, groupOffset, subOffset, shapeOffset, header: partHeader, length: partLength, transformOffset: record.offset, matrix: global.toArray()}, group, textureSource, textureIndex, objectType, partId, colors, transparency: data.readUInt16LE(subOffset + 22), illumination: data.readUInt32LE(shapeOffset + 16)}));
        });
      });
    });
  });
  return {format: 'SH3 PC map geometry', editable: true, transforms, groups, textureOffset: data.readUInt32LE(16), localTextureCount: data.readUInt16LE(68), globalTextureGroupCount: data.readUInt16LE(66), transparentTextureGroupCount: data.readUInt16LE(70),
    note: 'MAP geometry and object transforms. Native lighting is not reproduced. Static geometry edits preserve the original visibility bounds.', model: {...model(data, meshes), editable: true}};
}

export function inspectWorld(data, extension) {
  if (extension === 'map') return parseMap(data);
  if (extension === 'cld') return parseCollision(data);
  if (extension === 'cam') return parseCameras(data);
  if (extension === 'ded') return drawEnvironmentRecords(data);
  if (extension === 'sdb') return soundDatabaseRecords(data);
  if (extension === 'sbd') return {format:'Unidentified SBD file',size:data.length,note:'No matching .sbd samples were found in the supplied game. Native export and replacement are available.'};
  throw new Error('Unknown world format.');
}
