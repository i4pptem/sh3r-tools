import {Box3, Matrix3, Matrix4, Vector3, Quaternion, Euler} from 'three';
import {parseMap} from './world-formats.mjs';
import {readGlb} from './gltf.mjs';
import {gltfHierarchy} from './gltf-rig.mjs';
import {requireThat} from './binary.mjs';

const bounds = positions => new Box3().setFromArray(positions);
const equal = (a,b) => a.length === b.length && a.every((v,i) => Math.fround(v) === Math.fround(b[i]));
const finite = (values, count, label) => requireThat(Array.isArray(values) && values.length === count && values.every(Number.isFinite), `Invalid ${label}.`);

export function updateMapVisibility(output, edited, reference, world) {
  if(edited.objectType===0)return;
  const envelope = bounds(reference.positions);
  if (reference.objectType !== 1) {
    for (const mesh of world.model.meshes.filter(m => m.layout.transformOffset === reference.layout.transformOffset)) envelope.union(bounds(mesh.positions));
    const record = world.transforms.find(t => t.offset === reference.layout.transformOffset);
    for (const p of record.box) if (p.every(Number.isFinite)) envelope.expandByPoint(new Vector3(-p[0],-p[1],p[2]));
  }
  const point = new Vector3();
  const contained=edited.positions.every((_,i)=>i%3 || envelope.containsPoint(point.fromArray(edited.positions,i)));
  if(contained)return;
  if(edited.objectType===1&&reference.objectType===1){output.writeUInt32LE(0,edited.layout.offset+20);return;}
  requireThat(false,`${reference.name}: event-controlled or movable geometry leaves its preserved visibility bounds. Keep its native object ownership and bounds.`);
}

function writeAttributes(output, source, edited) {
  const inverse = new Matrix4().fromArray(source.layout.matrix).invert(), normal = new Matrix3().getNormalMatrix(inverse), point = new Vector3();
  for (const [name,size,byteOffset] of [['positions',3,0],['normals',3,12],['uv',2,24]]) {
    const values = edited[name]; finite(values, source.vertexCount*size, name);
    for(let i=0;i<source.vertexCount;i++) {
      const value=values.slice(i*size,(i+1)*size); if(equal(value,source[name].slice(i*size,(i+1)*size))) continue;
      const raw=size===2?value:(name==='positions'?point.fromArray(value).applyMatrix4(inverse):point.fromArray(value).applyMatrix3(normal).normalize()).toArray();
      requireThat(raw.every(v=>Number.isFinite(Math.fround(v))), 'MAP coordinate exceeds float32 range.');
      raw.forEach((v,k)=>output.writeFloatLE(v,source.layout.vertices+i*36+byteOffset+k*4));
    }
  }
}

function preserveStripSeparators(source, output, meshes) {
  for(const mesh of meshes) {
    const records=new Map();
    for(let i=0;i<mesh.vertexCount;i++) {
      const at=mesh.layout.vertices+i*36,key=source.subarray(at,at+36).toString('hex'),previous=records.get(key);
      if(previous!==undefined) requireThat(output.subarray(at,at+36).equals(output.subarray(previous,previous+36)), `${mesh.name}: repeated triangle-strip vertices must retain matching attributes.`);
      else records.set(key,at);
    }
  }
}

export function commitGeometry(data, changes, referenceData) {
  const output=Buffer.from(data), reference=parseMap(referenceData);
  for(const {source,edited} of changes) {
    writeAttributes(output,source,edited);
    if(edited.colors) {
      finite(edited.colors,source.vertexCount*3,'vertex colors');
      for(let i=0;i<source.vertexCount;i++) for(let k=0;k<3;k++) {
        const value=edited.colors[i*3+k]; requireThat(value>=0 && value<=1,'Invalid vertex color.');
        output[source.layout.vertices+i*36+34-k]=Math.round(value*255);
      }
    }
  }
  preserveStripSeparators(data,output,changes.map(c=>c.source));
  const decoded=parseMap(output);
  for(const {source} of changes) {
    const actual=decoded.model.meshes.find(m=>m.name===source.name), original=reference.model.meshes.find(m=>m.name===source.name);
    requireThat(original && actual.vertexCount===source.vertexCount, 'MAP source topology changed.');
    if (!equal(actual.positions, source.positions)) updateMapVisibility(output,actual,original,reference);
    requireThat(equal(actual.indices,source.indices),'MAP edit changed native strip topology.');
  }
  return output;
}

/** Apply an atomic part transform / UV transform / existing material assignment. */
export function editMap(data, edit, referenceData=data) {
  const world=parseMap(data), source=world.model.meshes.find(m=>m.name===edit.part); requireThat(source,'Select an existing MAP part.');
  for(const [key,count] of [['translation',3],['rotation',3],['scale',3],['uvOffset',2],['uvScale',2]]) finite(edit[key],count,key);
  requireThat(edit.scale.every(v=>v>0),'MAP scale must be positive to preserve triangle winding.');
  const center=bounds(source.positions).getCenter(new Vector3()), rotation=new Quaternion().setFromEuler(new Euler(...edit.rotation.map(v=>v*Math.PI/180)));
  const matrix=new Matrix4().makeTranslation(...edit.translation).multiply(new Matrix4().makeTranslation(center)).multiply(new Matrix4().compose(new Vector3(),rotation,new Vector3(...edit.scale))).multiply(new Matrix4().makeTranslation(center.clone().negate()));
  const normal=new Matrix3().getNormalMatrix(matrix), point=new Vector3();
  const transform=(values,normals=false)=>values.map((_,i)=>i).filter(i=>i%3===0).flatMap(i=>(normals?point.fromArray(values,i).applyMatrix3(normal).normalize():point.fromArray(values,i).applyMatrix4(matrix)).toArray());
  const identity=edit.translation.every(v=>v===0)&&edit.rotation.every(v=>v===0)&&edit.scale.every(v=>v===1);
  const edited={positions:identity?source.positions:transform(source.positions),normals:identity?source.normals:transform(source.normals,true),uv:source.uv.map((v,i)=>v*edit.uvScale[i%2]+edit.uvOffset[i%2])};
  const output=commitGeometry(data,[{source,edited}],referenceData);
  if(edit.materialGroup!==null && edit.materialGroup!==undefined) {
    const material=world.groups.find(g=>g.index===edit.materialGroup);
    requireThat(material && material.textureSource===source.textureSource,'Choose a material from the same native texture family.');
    output.writeUInt32LE(material.textureIndex,source.layout.groupOffset+20);
  }
  parseMap(output); return output;
}

/** Import attributes and applied object transforms while preserving the native MAP hierarchy. */
export function importMapGlb(data, glb, referenceData=data) {
  const world=parseMap(data), {doc,accessor}=readGlb(glb), hierarchy=gltfHierarchy(doc), changes=[];
  if(doc.asset.extras?.sh3SourceHash) requireThat(doc.asset.extras.sh3SourceHash===world.model.sourceHash,'GLB belongs to a different MAP revision. Export this map again.');
  requireThat(doc.meshes?.length===world.model.meshes.length && !(doc.skins?.length),'Keep the original MAP parts and unskinned geometry.');
  for(const source of world.model.meshes) {
    const mesh=doc.meshes.find(m=>m.name===source.name), meshIndex=doc.meshes.indexOf(mesh);
    requireThat(mesh?.primitives.length===1,`Keep ${source.name} and its single primitive.`);
    const p=mesh.primitives[0];requireThat((p.mode??4)===4 && !p.extensions && equal(accessor(p.indices),source.indices),`${source.name}: keep the original triangle and vertex order.`);
    const nodes=doc.nodes.map((n,i)=>({n,i})).filter(({n})=>n.mesh===meshIndex);requireThat(nodes.length===1,'Each MAP part must have one scene node.');
    const matrix=hierarchy.world(nodes[0].i);requireThat(matrix.determinant()>0,'MAP object transforms must preserve triangle winding.');
    const normal=new Matrix3().getNormalMatrix(matrix), point=new Vector3(), edited={uv:accessor(p.attributes.TEXCOORD_0)};
    for(const [key,attr] of [['positions','POSITION'],['normals','NORMAL']]) {
      const values=accessor(p.attributes[attr]);finite(values,source.vertexCount*3,attr);
      if(matrix.equals(new Matrix4())) {edited[key]=values; continue;}
      edited[key]=Array.from({length:source.vertexCount},(_,i)=>(key==='positions'?point.fromArray(values,i*3).applyMatrix4(matrix):point.fromArray(values,i*3).applyMatrix3(normal).normalize()).toArray()).flat();
    }
    changes.push({source,edited});
  }
  return commitGeometry(data,changes,referenceData);
}
