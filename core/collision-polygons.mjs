import {Vector3} from 'three';
import {simplifyCollision,collisionSurfaceFilter} from './collision-simplify.mjs';
import {requireThat} from './binary.mjs';

const key = point => point.map(value => Object.is(value, -0) ? 0 : value).join(',');
const edgeKey = (a, b) => [key(a), key(b)].sort().join('|');
const vector = point => new Vector3(...point);

function triangles(model, names) {
  const polygons = [], seen = new Set();
  for (const name of names) {
    const mesh = model.meshes.find(item => item.name === name);
    requireThat(mesh, `Collision mesh ${name} is missing. Update the collision selection before rebuilding.`);
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const ids = mesh.indices.slice(i, i + 3), points = ids.map(index => new Vector3().fromArray(mesh.positions, index * 3));
      const normal = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0]));
      if (normal.lengthSq() === 0) continue;
      const shading = new Vector3(); for (const index of ids) shading.add(new Vector3().fromArray(mesh.normals, index * 3));
      if (normal.dot(shading) < 0) [points[1], points[2]] = [points[2], points[1]];
      // The native collision plane uses the reverse cross product of the render triangle.
      const vertices = [points[0], points[2], points[1]].map(v => [-v.x, -v.y, v.z].map(Math.fround));
      requireThat(vertices.flat().every(Number.isFinite), `${name}: collision coordinate exceeds float32.`);
      const identity = vertices.map(key).sort().join('|'); if (seen.has(identity)) continue; seen.add(identity);
      polygons.push({vertices, name});
    }
  }
  return polygons;
}

function mergedRectangle(a, b) {
  const edges = new Map();
  for (const points of [a.vertices, b.vertices]) for (let i = 0; i < points.length; i++) {
    const p = points[i], q = points[(i + 1) % points.length], id = edgeKey(p, q);
    if (edges.has(id)) {const prior = edges.get(id); if (key(prior[0]) !== key(q)) return null; edges.delete(id);} else edges.set(id, [p, q]);
  }
  if (edges.size < 4) return null;
  const remaining = [...edges.values()], points = [remaining[0][0]];
  while (remaining.length) {
    const i = remaining.findIndex(edge => key(edge[0]) === key(points.at(-1))); if (i < 0) return null;
    const [, end] = remaining.splice(i, 1)[0]; points.push(end);
  }
  if (key(points.pop()) !== key(points[0])) return null;
  let simplified = true;
  while (simplified && points.length > 4) {
    simplified = false;
    for (let i = 0; i < points.length; i++) {
      const before = vector(points[i]).sub(vector(points[(i + points.length - 1) % points.length]));
      const after = vector(points[(i + 1) % points.length]).sub(vector(points[i]));
      if (before.dot(after) > 0 && before.clone().cross(after).lengthSq() <= 1e-12 * before.lengthSq() * after.lengthSq()) {points.splice(i, 1); simplified = true; break;}
    }
  }
  if (points.length !== 4) return null;
  const heights = new Set(points.map(v => v[1])), ends = new Set(points.map(v => `${v[0]},${v[2]}`));
  if (heights.size !== 2 || ends.size !== 2 || new Set(points.map(key)).size !== 4) return null;
  // The character solver treats p0/p2 as opposite corners of a vertical rectangle.
  if (points[0][1] === points[2][1] || (points[0][0] === points[2][0] && points[0][2] === points[2][2])) return null;
  return {vertices: points, name: a.name};
}

function wallRectangles(polygons) {
  let active = polygons;
  for (;;) {
    const owners = new Map(), removed = new Set(), joined = [];
    for (let i = 0; i < active.length; i++) {
      if (removed.has(i)) continue;
      const polygon = active[i];
      for (let e = 0; e < polygon.vertices.length && !removed.has(i); e++) {
        const id = edgeKey(polygon.vertices[e], polygon.vertices[(e + 1) % polygon.vertices.length]);
        for (const j of owners.get(id) || []) {
          if (removed.has(j)) continue;
          const merged = mergedRectangle(polygon, active[j]); if (!merged) continue;
          removed.add(i); removed.add(j); joined.push(merged); break;
        }
        if (!owners.has(id)) owners.set(id, []); owners.get(id).push(i);
      }
    }
    if (!joined.length) break;
    active = active.filter((_, i) => !removed.has(i)).concat(joined);
  }
  const invalid = active.find(polygon => polygon.vertices.length !== 4);
  requireThat(!invalid, `${invalid?.name}: wall collision needs vertical rectangular surfaces. Use simple wall meshes with paired triangles; floors and ceilings accept arbitrary triangles.`);
  return active;
}

export function collisionPolygons(model, binding) {
  const names = new Set(binding.parts);
  requireThat(names.size && names.size === binding.parts.length, 'Choose distinct map meshes for collision.');
  const polygons = collisionSurfaceFilter(triangles(model, names),binding.surfaceFilter);
  requireThat(polygons.length, 'The selected meshes contain no non-degenerate collision triangles.');
  return [1, 3].includes(binding.group) ? wallRectangles(polygons) : simplifyCollision(polygons,binding.simplification);
}
