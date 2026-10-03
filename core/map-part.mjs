import {Box3, Matrix4, Matrix3, Vector3} from 'three';
import {parseMap} from './world-formats.mjs';
import {exportGlb, readGlb} from './gltf.mjs';
import {gltfHierarchy} from './gltf-rig.mjs';
import {requireThat} from './binary.mjs';
import {commitGeometry, updateMapVisibility} from './map-edit.mjs';
import {repackMapPart} from './map-repack.mjs';

const equal=(a,b)=>a.length===b.length && a.every((v,i)=>Math.fround(v)===Math.fround(b[i]));
const findPart=(world,name)=>{const mesh=world.model.meshes.find(m=>m.name===name);requireThat(mesh,'Select an existing MAP part.');return mesh;};

/** Export one mesh and its assigned image at the original world placement. */
export function exportMapPart(world, name) {
  const mesh=findPart(world,name), texture=world.textures?.[mesh.texture];
  return exportGlb({...world.model,sourceHash:undefined,meshes:[{...mesh,texture:texture?0:-1}],exchangeExtras:{sh3MapPart:{name,objectType:mesh.objectType,partId:mesh.partId}}},texture?[texture]:[]);
}

function replacementGeometry(glb, source) {
  const {doc,accessor}=readGlb(glb);
  requireThat(doc.meshes?.length===1 && !doc.skins?.length,'Export exactly one unskinned mesh for the selected MAP part.');
  const info=doc.asset.extras?.sh3MapPart;
  if(info) requireThat(info.name===source.name && (info.objectType===source.objectType || info.objectType===1 && source.objectType===0) && info.partId===source.partId,'This GLB was exported for a different MAP part.');
  const mesh=doc.meshes[0]; requireThat(mesh.primitives?.length===1,'Use one material slot on the replacement mesh.');
  const p=mesh.primitives[0];requireThat((p.mode??4)===4 && !p.extensions && !p.targets?.length,'Use uncompressed triangles without shape keys.');
  const nodes=(doc.nodes||[]).map((node,index)=>({node,index})).filter(({node})=>node.mesh===0);
  requireThat(nodes.length===1 && nodes[0].node.skin===undefined,'The replacement mesh must have one unskinned scene instance.');
  const matrix=gltfHierarchy(doc).world(nodes[0].index);
  requireThat(matrix.determinant()>0,'Apply mirrored transforms and correct triangle winding before export.');
  const edited={};
  for(const [key,attribute,size] of [['positions','POSITION',3],['normals','NORMAL',3],['uv','TEXCOORD_0',2]]) {
    requireThat(p.attributes?.[attribute]!==undefined,`Export ${attribute} for the replacement mesh.`);
    const values=accessor(p.attributes[attribute]); requireThat(doc.accessors[p.attributes[attribute]].type===`VEC${size}` && values.every(Number.isFinite),`Invalid ${attribute}.`); edited[key]=values;
  }
  const count=edited.positions.length/3;
  requireThat(count>=3 && count<=2000000 && edited.normals.length===count*3 && edited.uv.length===count*2,'Invalid replacement vertex attributes.');
  const normalMatrix=new Matrix3().getNormalMatrix(matrix), point=new Vector3();
  if(!matrix.equals(new Matrix4())) for(let i=0;i<count;i++) {
    point.fromArray(edited.positions,i*3).applyMatrix4(matrix).toArray(edited.positions,i*3);
    point.fromArray(edited.normals,i*3).applyMatrix3(normalMatrix).normalize().toArray(edited.normals,i*3);
  }
  requireThat(edited.normals.every((_,i)=>i%3 || Math.hypot(...edited.normals.slice(i,i+3))>0),'Replacement contains zero normals.');
  edited.indices=p.indices===undefined?Array.from({length:count},(_,i)=>i):accessor(p.indices);
  requireThat(edited.indices.length>0 && edited.indices.length%3===0 && edited.indices.every(i=>Number.isInteger(i)&&i>=0&&i<count),'Invalid triangle indices.');
  requireThat(p.attributes.COLOR_0!==undefined,'Export vertex colors (COLOR_0) to preserve the map’s baked lighting.');
  const colors=accessor(p.attributes.COLOR_0), channels=doc.accessors[p.attributes.COLOR_0].type==='VEC4'?4:3;
  requireThat(['VEC3','VEC4'].includes(doc.accessors[p.attributes.COLOR_0].type) && colors.length===count*channels && colors.every(v=>Number.isFinite(v)&&v>=0&&v<=1),'Invalid vertex colors.');
  edited.colors=Array.from({length:count*3},(_,i)=>colors[Math.floor(i/3)*channels+i%3]);
  return edited;
}

function vertexStrip(source, edited, data) {
  const inverse=new Matrix4().fromArray(source.layout.matrix).invert(), normal=new Matrix3().getNormalMatrix(inverse), point=new Vector3();
  const count=edited.positions.length/3, records=Buffer.alloc(count*36);
  const box=new Box3().setFromArray(source.positions), borders=[box.min.toArray(),box.max.toArray()];
  // Restore exact native boundary coordinates when GLB contains their float32 representation.
  const exchangePosition=i=>edited.positions.slice(i*3,i*3+3).map((value,k)=>{
    const matches=borders.map(b=>b[k]).filter(bound=>Math.fround(bound)===Math.fround(value));
    return matches.length?matches.reduce((a,b)=>Math.abs(a-value)<=Math.abs(b-value)?a:b):value;
  });
  const vectorKey=(values,i)=>values.slice(i*3,i*3+3).map(Math.fround).join(','), originalPositions=new Map(), originalNormals=new Map();
  for(let i=0;i<source.vertexCount;i++) {
    originalPositions.set(vectorKey(source.positions,i),data.subarray(source.layout.vertices+i*36,source.layout.vertices+i*36+12));
    originalNormals.set(vectorKey(source.normals,i),data.subarray(source.layout.vertices+i*36+12,source.layout.vertices+i*36+24));
    requireThat(data[source.layout.vertices+i*36+35]===data[source.layout.vertices+35],'This part has varying native alpha. New topology requires preserving that native channel explicitly.');
  }
  for(let i=0;i<count;i++) {
    const values=[...point.fromArray(exchangePosition(i)).applyMatrix4(inverse).toArray(),...point.fromArray(edited.normals,i*3).applyMatrix3(normal).normalize().toArray(),...edited.uv.slice(i*2,i*2+2)];
    requireThat(values.every(v=>Number.isFinite(Math.fround(v))),'MAP coordinate exceeds float32 range.');
    values.forEach((v,k)=>records.writeFloatLE(v,i*36+k*4));
    originalPositions.get(vectorKey(edited.positions,i))?.copy(records,i*36);
    originalNormals.get(vectorKey(edited.normals,i))?.copy(records,i*36+12);
    for(let k=0;k<3;k++) records[i*36+32+k]=Math.round(edited.colors[i*3+2-k]*255);
    records[i*36+35]=data[source.layout.vertices+35];
  }
  const order=[];
  for(let i=0;i<edited.indices.length;i+=3) {
    const [a,b,c]=edited.indices.slice(i,i+3);
    const samePosition=(x,y)=>records.subarray(x*36,x*36+12).equals(records.subarray(y*36,y*36+12));
    requireThat(!samePosition(a,b)&&!samePosition(b,c)&&!samePosition(a,c),'Replacement contains a collapsed triangle. Remove degenerate faces before export.');
    if(order.length) {if(order.length%2) order.push(order.at(-1)); order.push(order.at(-1),a);}
    order.push(a,b,c);
  }
  requireThat(order.length<=2000000,'Replacement needs more than two million native strip vertices.');
  const strip=Buffer.alloc(order.length*36);order.forEach((v,i)=>records.copy(strip,i*36,v*36,v*36+36));
  return strip;
}

/** Import one arbitrary triangle mesh without modifying sibling parts or material bindings. */
export function importMapPart(data, name, glb, referenceData=data) {
  const world=parseMap(data), source=findPart(world,name), edited=replacementGeometry(glb,source);
  if(edited.positions.length===source.positions.length && equal(edited.indices,source.indices)) return commitGeometry(data,[{source,edited}],referenceData);
  const reference=parseMap(referenceData), original=findPart(reference,name);
  const output=repackMapPart(data,source,vertexStrip(source,edited,data));
  const actual=findPart(parseMap(output),name);
  requireThat(actual.indices.length===edited.indices.length,'Rebuilt strip triangle count differs from the imported mesh.');
  updateMapVisibility(output,actual,original,reference);
  return output;
}
