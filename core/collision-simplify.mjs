import {MeshoptSimplifier} from 'meshoptimizer/simplifier';
import {requireThat} from './binary.mjs';
await MeshoptSimplifier.ready;

/** Weld render seams and simplify collision topology without pruning disconnected obstacles. */
export function simplifyCollision(polygons,options) {
  if(!options)return polygons;
  requireThat(Number.isInteger(options.target)&&options.target>=1&&options.target<=100000&&Number.isFinite(options.error)&&options.error>=0&&options.error<=1000,'Invalid collision simplification settings.');
  const vertices=[],lookup=new Map(),indices=[];
  for(const polygon of polygons)for(const point of polygon.vertices){const key=point.map(v=>Object.is(v,-0)?0:v).join(',');if(!lookup.has(key)){lookup.set(key,vertices.length/3);vertices.push(...point);}indices.push(lookup.get(key));}
  const positions=new Float32Array(vertices),input=new Uint32Array(indices);
  // Preserve topology and folds; omit Prune/Sloppy, which can remove small solid components and openings.
  const [output]=MeshoptSimplifier.simplify(input,positions,3,Math.min(input.length,options.target*3),options.error,['ErrorAbsolute','PreserveFolds']);
  return Array.from({length:output.length/3},(_,i)=>({name:'Selected collision meshes',vertices:Array.from({length:3},(_,k)=>Array.from(positions.subarray(output[i*3+k]*3,output[i*3+k]*3+3)))}));
}

export function collisionSurfaceFilter(polygons,filter) {
  requireThat(!filter||['all','walkable'].includes(filter),'Unknown collision surface filter.');
  if(filter!=='walkable')return polygons;
  return polygons.filter(({vertices:[a,b,c]})=>{
    const x=[c[0]-a[0],c[1]-a[1],c[2]-a[2]],y=[b[0]-a[0],b[1]-a[1],b[2]-a[2]];
    const n=[x[1]*y[2]-x[2]*y[1],x[2]*y[0]-x[0]*y[2],x[0]*y[1]-x[1]*y[0]];
    return -n[1]>=Math.hypot(...n)*.5;
  });
}
