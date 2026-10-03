import {Matrix4,Vector3} from 'three';
import {shadowBlocks,shadowPrimitive,shadowSphere} from './shadow-rebuild.mjs';
import {exportGlb,readGlb} from './gltf.mjs';
import {gltfHierarchy} from './gltf-rig.mjs';
import {requireThat,sha256} from './binary.mjs';

const point=(data,offset)=>new Vector3(...[0,2,4].map(k=>data.readInt16LE(offset+k)));
const identity=(model,data)=>sha256(Buffer.concat([Buffer.from(JSON.stringify(model.bones)),data])).slice(0,16);
export function shadowFaces(data,object){
 const faces=[];
 for(const p of object.primitives){const vertices=[point(data,p.offset+16),point(data,p.offset+24)];for(let j=2;j<p.vertices;j++)vertices.push(point(data,p.offset+40+(j-2)*16));for(let j=0;j<vertices.length-2;j++){const triangle=vertices.slice(j,j+3);if((j&1)^(p.type===5?1:0))[triangle[0],triangle[1]]=[triangle[1],triangle[0]];faces.push(triangle);}}
 return faces;
}
const signature=faces=>faces.map(face=>{const points=face.map(v=>v.toArray().join(','));return [points.join('|'),[points[1],points[2],points[0]].join('|'),[points[2],points[0],points[1]].join('|')].sort()[0];}).sort().join(';');
/** Validate the geometry the native engine will receive, after integer quantization. */
export function validateShadowFaces(faces){
 requireThat(faces.length>0&&faces.length<=900,'Use 1–900 triangles per edited shadow object; the complete block must also fit.');
 const edges=new Map(),vertices=new Map(),seen=new Set(),graph=faces.map(()=>new Set());
 for(const [index,face]of faces.entries()){
   requireThat(face.every(p=>p.toArray().every(v=>Number.isInteger(v)&&v>=-32768&&v<=32767)),'Shadow positions exceed signed 16-bit bone-local coordinates.');
   requireThat(face[1].clone().sub(face[0]).cross(face[2].clone().sub(face[0])).lengthSq()>0,'A shadow triangle collapsed after quantization.');
   const keys=face.map(p=>p.toArray().join(',')),key=[...keys].sort().join('|');requireThat(!seen.has(key),'Duplicate shadow triangle.');seen.add(key);
   keys.forEach(v=>{if(!vertices.has(v))vertices.set(v,new Set());vertices.get(v).add(index);});
   for(let k=0;k<3;k++){const a=keys[k],b=keys[(k+1)%3],edge=[a,b].sort().join('|');if(!edges.has(edge))edges.set(edge,[]);edges.get(edge).push({index,a,b});}
 }
 for(const uses of edges.values()){requireThat(uses.length===2,'Shadow geometry must be closed: open or non-manifold edge.');const [a,b]=uses;requireThat(a.a===b.b&&a.b===b.a,'Shadow faces have inconsistent winding. Recalculate outward normals.');graph[a.index].add(b.index);graph[b.index].add(a.index);}
 const connected=(start,allowed)=>{const visited=new Set([start]),pending=[start];while(pending.length){for(const next of graph[pending.pop()])if(allowed.has(next)&&!visited.has(next)){visited.add(next);pending.push(next);}}return visited;};
 for(const fan of vertices.values())requireThat(connected(fan.values().next().value,fan).size===fan.size,'Shadow has a non-manifold vertex fan. Separate touching components.');
 const remaining=new Set(faces.map((_,i)=>i));let components=0;
 while(remaining.size){const component=connected(remaining.values().next().value,remaining);let volume=0;for(const i of component){remaining.delete(i);const [a,b,c]=faces[i];volume+=a.dot(b.clone().cross(c))/6;}requireThat(volume>0,'A shadow component has zero or inward volume. Recalculate outward normals.');components++;}
 shadowSphere(faces.flat());return {components,triangles:faces.length};
}

export function inspectShadowProxy(model,data){
 const stamp=identity(model,data),blocks=shadowBlocks(data),objects=[],meshes=[];
 for(const [blockIndex,block]of blocks.entries())for(const object of block.objects){
   requireThat(model.bones[object.bone],'KG1 bone is absent from the selected model.');
   const faces=shadowFaces(data,object),matrix=new Matrix4().fromArray(model.bones[object.bone].matrix),name=`SH3Shadow_B${String(blockIndex).padStart(2,'0')}_Bone${String(object.bone).padStart(3,'0')}_${stamp}`,positions=faces.flatMap(face=>face.flatMap(p=>p.clone().applyMatrix4(matrix).toArray()));
   objects.push({block:blockIndex,bone:object.bone,name,triangles:faces.length,primitives:object.primitives.length});
   if(!faces.length)continue;
   meshes.push({name,positions,normals:faces.flatMap(face=>{const n=face[1].clone().sub(face[0]).cross(face[2].clone().sub(face[0])).normalize().transformDirection(matrix);return [...n.toArray(),...n.toArray(),...n.toArray()];}),uv:new Array(positions.length/3*2).fill(0),indices:Array.from({length:positions.length/3},(_,i)=>i),texture:-1,group:0,visibilityId:0,morphPositions:[],morphNormals:[],vertexCount:positions.length/3,triangleCount:faces.length});
 }
 return {objects,model:{bones:[],meshes,morphNames:[],textureCount:0,exchangeExtras:{sh3Shadow:{version:1,stamp}}},stamp};
}
export function exportShadowProxy(model,data){return exportGlb(inspectShadowProxy(model,data).model);}

/** Missing nodes preserve current objects; disable and original are explicit decisions. */
export function importShadowProxy(model,current,original,glb,decisions=[]){
 const blocks=shadowBlocks(current),originalBlocks=shadowBlocks(original),stamp=identity(model,current),replacements=new Map();
 if(glb){const {doc,accessor}=readGlb(glb),hierarchy=gltfHierarchy(doc);requireThat(!doc.skins?.length&&!doc.animations?.length,'Shadow proxy exchange accepts static unskinned meshes.');
   if(doc.asset.extras?.sh3Shadow)requireThat(doc.asset.extras.sh3Shadow.stamp===stamp,'This proxy was exported from another model or an older KG1. Export it again.');
   for(const [index,node]of doc.nodes.entries())if(node.mesh!==undefined){const mesh=doc.meshes[node.mesh],match=/^SH3Shadow_B(\d+)_Bone(\d+)_([0-9a-f]{16})$/.exec(node.name||mesh.name||'');requireThat(match&&match[3]===stamp,`Unrecognized or stale shadow object: ${node.name||mesh.name}. Keep the exported names.`);
     const block=Number(match[1]),bone=Number(match[2]),key=block+':'+bone;requireThat(blocks[block]?.objects.some(o=>o.bone===bone)&&!replacements.has(key),'Unknown or duplicate shadow bone object. Join its components in Blender.');
     const world=hierarchy.world(index),matrix=new Matrix4().fromArray(model.bones[bone].matrix).invert().multiply(world);requireThat(matrix.determinant()>0,'Apply mirrored transforms and fix shadow winding before importing.');
     const faces=[];for(const p of mesh.primitives){requireThat((p.mode??4)===4&&!p.targets?.length&&p.attributes?.POSITION!==undefined,'Use triangulated shadow meshes without shape keys.');const positions=accessor(p.attributes.POSITION);requireThat(doc.accessors[p.attributes.POSITION].type==='VEC3'&&positions.every(Number.isFinite),'Invalid shadow positions.');const count=positions.length/3,indices=p.indices===undefined?Array.from({length:count},(_,i)=>i):accessor(p.indices);requireThat(indices.length%3===0&&indices.every(i=>Number.isInteger(i)&&i>=0&&i<count),'Invalid shadow triangle indices.');for(let i=0;i<indices.length;i+=3)faces.push(indices.slice(i,i+3).map(v=>new Vector3().fromArray(positions,v*3).applyMatrix4(matrix).round()));}replacements.set(key,faces);
   }
 }
 const choices=new Map();for(const decision of decisions){const key=decision.block+':'+decision.bone;requireThat(['current','original','disable'].includes(decision.mode)&&blocks[decision.block]?.objects.some(o=>o.bone===decision.bone)&&!choices.has(key),'Invalid shadow object decision.');choices.set(key,decision.mode);}
 const outputs=[],report=[];let changed=false;
 for(const [index,block]of blocks.entries()){
   const header=Buffer.from(block.header),parts=[];let triangles=0,primitives=0;
   for(const object of block.objects){const key=index+':'+object.bone,mode=choices.get(key)||'current',source=mode==='original'?original:current,baseline=mode==='original'?originalBlocks[index]?.objects.find(o=>o.bone===object.bone):object;requireThat(baseline,'Original shadow ownership differs.');let bytes=source.subarray(baseline.offset,baseline.offset+baseline.size),faces=shadowFaces(source,baseline),count=baseline.primitives.length;
     if(mode==='disable'){bytes=Buffer.from(object.header);bytes.writeInt16LE(0,6);bytes.fill(0,24,32);faces=[];count=0;}
     else if(mode==='current'&&replacements.has(key)&&signature(replacements.get(key))!==signature(faces)){faces=replacements.get(key);validateShadowFaces(faces);const h=Buffer.from(object.header);h.writeInt16LE(faces.length,6);shadowSphere(faces.flat()).forEach((v,i)=>h.writeInt16LE(v,24+i*2));bytes=Buffer.concat([h,...faces.map(shadowPrimitive)]);count=faces.length;}
     changed||=!bytes.equals(current.subarray(object.offset,object.offset+object.size));parts.push(bytes);triangles+=faces.length;primitives+=count;
   }
   requireThat(5*block.objects.length+2*primitives<=2047&&triangles<=900,`KG1 block ${index} exceeds the supported scratch/triangle budget. Simplify shadow meshes.`);
   for(const offset of [0,6,8,10,12,14])header.writeInt16LE(0,offset);outputs.push(header,...parts);report.push({objects:block.objects.length,triangles,primitives});
 }
 const data=changed?Buffer.concat(outputs):Buffer.from(current);shadowBlocks(data);return {data,report:{blocks:report,note:'Rigid bone proxy. Surface self-intersections and game lighting still require visual testing.'}};
}
