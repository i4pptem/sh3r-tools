import {Box3, Vector3, Matrix4, Quaternion, Euler} from 'three';

export const displayPoint = point => [-point[0], -point[1], point[2]];

export function collisionRecordPolygons(record) {
  if (record.vertices) return [record.vertices];
  const {position: p, topY, radius} = record;
  return Array.from({length: 20}, (_, i) => {
    const a = i * Math.PI / 10, b = (i + 1) * Math.PI / 10;
    const first = [p[0] + Math.cos(a) * radius, p[1], p[2] + Math.sin(a) * radius];
    const next = [p[0] + Math.cos(b) * radius, p[1], p[2] + Math.sin(b) * radius];
    return [first, next, [next[0], topY, next[2]], [first[0], topY, first[2]]];
  });
}

export function zonePolygons(ground, heights) {
  const [a,b,c] = ground, d = [a[0]+c[0]-b[0], a[1]+c[1]-b[1]];
  const area = (b[0]-a[0])*(c[1]-b[1]) - (b[1]-a[1])*(c[0]-b[0]);
  if (!area || heights[0] === heights[1]) return [];
  const floor = [a,b,c,d].map(([x,z]) => [x,heights[0],z]), ceiling = [a,b,c,d].map(([x,z]) => [x,heights[1],z]);
  return [floor, [...ceiling].reverse(), ...floor.map((p,i) => [p,floor[(i+1)%4],ceiling[(i+1)%4],ceiling[i]])];
}

export function recordCenter(record, region) {
  let points;
  if (region) {
    const ground = record[`${region}GroundPoints`], heights = record[`${region}Heights`];
    if (region === 'constraint' && [6,7].includes(record.cameraMovementType)) return displayPoint([ground[0][0], heights[0], ground[0][1]]);
    const [a,b,c] = ground, corners = [...ground, [a[0]+c[0]-b[0], a[1]+c[1]-b[1]]];
    points = heights.flatMap(y => corners.map(([x,z]) => [x,y,z]));
  } else points = collisionRecordPolygons(record).flat();
  return new Box3().setFromPoints(points.map(p => new Vector3(...displayPoint(p)))).getCenter(new Vector3()).toArray();
}

/** Apply an editor transform without changing native record identity or behavior. */
export function transformWorldRecord(record, region, transform) {
  const center = recordCenter(record, region), out = structuredClone(record);
  const matrix = new Matrix4().makeTranslation(...transform.position)
    .multiply(new Matrix4().compose(new Vector3(), new Quaternion().setFromEuler(new Euler(0, transform.rotation[1], 0)), new Vector3(...transform.scale)))
    .multiply(new Matrix4().makeTranslation(...center.map(v => -v)));
  const point = p => displayPoint(new Vector3(...displayPoint(p)).applyMatrix4(matrix).toArray()).map(Math.fround);
  if (region) {
    out[`${region}GroundPoints`] = record[`${region}GroundPoints`].map(([x,z]) => {const p = point([x,0,z]); return [p[0],p[2]];});
    out[`${region}Heights`] = record[`${region}Heights`].map(y => point([0,y,0])[1]);
  } else if (record.vertices) out.vertices = record.vertices.map(point);
  else {
    out.position = point(record.position); out.topY = point([0,record.topY,0])[1];
    out.radius = Math.fround(record.radius * transform.scale[0]);
  }
  return out;
}

export function referenceMeshes(world, kind) {
  const entries = kind === 'cld'
    ? world.groups.flatMap((group,g) => group.records.map((record,index) => ({name:`Collision_${g}_${index}`, group:g, index, groupName:group.name, polygons:collisionRecordPolygons(record)})))
    : world.records.flatMap(record => ['active','constraint'].flatMap(region => {
      if (region === 'constraint' && [6,7].includes(record.cameraMovementType)) return [];
      return [{name:`Zone_${record.index}_${region === 'active' ? 'Activation' : 'Constraint'}`, index:record.index, region, polygons:zonePolygons(record[`${region}GroundPoints`],record[`${region}Heights`])}];
    }));
  return entries.filter(entry => entry.polygons.length).map(({polygons,...entry}) => {
    const positions = [], indices = [];
    for (const polygon of polygons) {const start = positions.length/3; positions.push(...polygon.flatMap(displayPoint)); for (let i=1;i+1<polygon.length;i++) indices.push(start,start+i,start+i+1);}
    return {...entry,positions,indices};
  });
}
