import shadowResources from './model-shadow-resources.json' with {type:'json'};
import {Box3,Matrix4,Vector3} from 'three';
import {ConvexHull} from 'three/addons/math/ConvexHull.js';
import {parseModel} from './model.mjs';
import {range,requireThat} from './binary.mjs';
import {cutscenePartVisible} from './model-visibility.mjs';

/** Read every bone-bound KG1 block; primitive sizes include their own header. */
export function shadowBlocks(data) {
  const blocks=[];let at=0;
  while(at<data.length){
    if(data.subarray(at).every(value=>value===0))break;
    range(data,at,16,'KG1 block');const start=at,count=data.readInt16LE(at+4),objects=[];
    requireThat(count>0&&count<=255,'Unsupported KG1 object count.');at+=16;
    for(let i=0;i<count;i++){
      range(data,at,96,'KG1 object');const offset=at,bone=data.readInt16LE(at+4),count=data.readInt16LE(at+6),primitives=[];at+=96;
      requireThat(bone>=0&&count>=0,'Invalid KG1 bone or primitive count.');
      for(let p=0;p<count;p++){
        range(data,at,16,'KG1 primitive');const vertices=data.readInt16LE(at),type=data.readInt16LE(at+2),size=data.readInt16LE(at+6)*16;
        requireThat([5,6].includes(type)&&vertices>=3&&size===vertices*16&&data.readUInt16LE(at+4)===2*vertices-1,'Unsupported KG1 strip layout.');range(data,at,size,'KG1 strip');
        primitives.push({offset:at,vertices,type,size});at+=size;
      }
      objects.push({bone,offset,size:at-offset,header:Buffer.from(data.subarray(offset,offset+96)),primitives});
    }
    requireThat(new Set(objects.map(o=>o.bone)).size===objects.length,'Duplicate KG1 shadow bones are not supported.');
    blocks.push({header:Buffer.from(data.subarray(start,start+16)),objects,offset:start,size:at-start});
  }
  requireThat(blocks.length,'This KG1 has no character shadow objects.');return blocks;
}

const directions=[new Vector3(1,0,0),new Vector3(-1,0,0),new Vector3(0,1,0),new Vector3(0,-1,0),new Vector3(0,0,1),new Vector3(0,0,-1),
  ...[-1,1].flatMap(x=>[-1,1].flatMap(y=>[-1,1].map(z=>new Vector3(x,y,z))))];
const int16=value=>requireThat(Number.isInteger(value)&&value>=-32768&&value<=32767,'Shadow geometry exceeds signed 16-bit bone-local coordinates.');
export function shadowSphere(points){const center=new Vector3();for(const point of points)center.add(point);center.divideScalar(points.length||1).round();
  const radius=Math.ceil(Math.max(0,...points.map(point=>point.distanceTo(center))));const values=[...center.toArray(),radius];values.forEach(int16);return values;}
const shorts=(data,at,values)=>values.forEach((value,i)=>{int16(value);data.writeInt16LE(value,at+i*2);});
function hullTriangles(points) {
  const unique=new Map();for(const point of points){point.round();point.toArray().forEach(int16);unique.set(point.toArray().join(','),point);}
  const all=[...unique.values()];if(!all.length)return [];
  const selected=[...new Set(directions.map(direction=>all.reduce((best,p)=>p.dot(direction)>best.dot(direction)?p:best)))];
  const a=selected[0],b=selected.find(p=>p.distanceToSquared(a)>0),normal=b&&selected.map(p=>b.clone().sub(a).cross(p.clone().sub(a))).find(n=>n.lengthSq()>0);
  const volume=normal&&selected.some(p=>Math.abs(p.clone().sub(a).dot(normal))>0);
  let hull=volume?new ConvexHull().setFromPoints(selected):null;
  if(!hull?.faces.length){
    const {min,max}=new Box3().setFromPoints(all);
    for(let i=0;i<3;i++)if(max.getComponent(i)===min.getComponent(i)){min.setComponent(i,min.getComponent(i)-1);max.setComponent(i,max.getComponent(i)+1);}
    const box=[min.x,max.x].flatMap(x=>[min.y,max.y].flatMap(y=>[min.z,max.z].map(z=>new Vector3(x,y,z))));box.forEach(p=>p.toArray().forEach(int16));hull=new ConvexHull().setFromPoints(box);
  }
  const triangles=hull.faces.map(face=>{const points=[];let edge=face.edge;do{points.push(edge.head().point);edge=edge.next;}while(edge!==face.edge);requireThat(points.length===3,'Shadow hull must be triangulated.');return points;});
  const edges=new Map();for(const triangle of triangles)for(let i=0;i<3;i++){const key=[triangle[i].toArray().join(','),triangle[(i+1)%3].toArray().join(',')].sort().join('|');edges.set(key,(edges.get(key)||0)+1);}
  requireThat(triangles.length>0&&[...edges.values()].every(count=>count===2),'Shadow hull is not closed after quantization.');return triangles;
}
export function shadowPrimitive(points) {
  const data=Buffer.alloc(48),normal=points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0]));
  requireThat(normal.lengthSq()>0,'Quantization collapsed a shadow face.');normal.normalize().multiplyScalar(32767).round();
  shorts(data,0,[3,6,5,3,...shadowSphere(points)]);shorts(data,16,[...points[0].toArray(),1]);shorts(data,24,[...points[1].toArray(),1]);
  shorts(data,32,[...normal.toArray(),0]);shorts(data,40,[...points[2].toArray(),1]);return data;
}
function pointClouds(model,block,alternate) {
  const supported=new Set(block.objects.map(o=>o.bone)),clouds=new Map(block.objects.map(o=>[o.bone,[]]));
  for(const bone of supported)requireThat(model.bones[bone],'KG1 uses a bone absent from this MDL.');
  const inverses=new Map([...supported].map(bone=>[bone,new Matrix4().fromArray(model.bones[bone].matrix).invert()]));
  const target=model.bones.map((_,i)=>{let bone=i;while(bone>=0&&!supported.has(bone))bone=model.bones[bone].parent;return bone;});
  for(const part of model.meshes){
    if(model.modelId===0x100&&!(alternate?cutscenePartVisible(model,part):[0,5,12,13].includes(part.visibilityId)))continue;
    for(let vertex=0;vertex<part.positions.length/3;vertex++){
      const weights=new Map();for(let slot=0;slot<4;slot++){const i=vertex*4+slot,bone=target[part.joints[i]];if(bone>=0&&part.weights[i]>0)weights.set(bone,(weights.get(bone)||0)+part.weights[i]);}
      if(!weights.size)continue;const maximum=Math.max(...weights.values()),point=new Vector3().fromArray(part.positions,vertex*3);
      for(const [bone,weight] of weights)if(weight>=.25||weight===maximum)clouds.get(bone).push(point.clone().applyMatrix4(inverses.get(bone)));
    }
  }
  return clouds;
}

/** Rebuild closed low-detail volumes while preserving native shadow-bone ownership. */
export function rebuildShadow(source,modelData) {
  const blocks=shadowBlocks(source),model=parseModel(modelData),outputs=[],reports=[];
  for(const [index,block] of blocks.entries()){
    const clouds=pointClouds(model,block,blocks.length===1?block.objects.some(o=>o.bone===18):index>0),parts=[],header=Buffer.from(block.header);let triangles=0,empty=0;
    for(const object of block.objects){
      const faces=hullTriangles(clouds.get(object.bone)),entry=Buffer.from(object.header);triangles+=faces.length;if(!faces.length)empty++;
      entry.writeInt16LE(faces.length,6);shorts(entry,24,shadowSphere(faces.flat()));parts.push(entry,...faces.map(shadowPrimitive));
    }
    requireThat(5*block.objects.length+2*triangles<=2047&&triangles<=900,'Generated shadow exceeds the native scratch/geometry budget.');
    for(const offset of [0,6,8,10,12,14])header.writeInt16LE(0,offset);
    outputs.push(header,...parts);reports.push({objects:block.objects.length,triangles,empty});
  }
  const data=Buffer.concat(outputs);shadowBlocks(data);
  return {data,report:{blocks:reports,approximation:'Closed convex volumes per original bone; no skin blending or animated morph deformation.'}};
}

/** Resolve the resource selected by native actor/costume tables, including explicit no-shadow entries. */
export function shadowBinding(wb,key) {
  const {archive,entry}=wb.get(key),source=entry.name.replaceAll('\\','/').toLowerCase();
  const name=shadowResources.bindings[source];
  if(!name)return null;
  const companion=archive.entries.find(e=>e.name.replaceAll('\\','/').toLowerCase()===name);
  if(!companion)return null;
  return {key:`${key.split(':')[0]}:${companion.index}`,name,
    sharedModels:Object.entries(shadowResources.bindings).filter(([model,shadow])=>shadow===name&&model!==source).map(([model])=>model)};
}

export function shadowCompanion(wb,key) {return shadowBinding(wb,key)?.key||null;}

function validateSharedShadow(wb,key,binding,generated) {
  for(const [other,change] of wb.changes) {
    if(other===key||!binding.sharedModels.includes(wb.get(other).entry.name.toLowerCase()))continue;
    const {archive,entry}=wb.get(other);
    if(sameShadowGeometry(wb.originalBytes(archive,entry),change.data))continue;
    const candidate=rebuildShadow(wb.bytes(binding.key),change.data);
    requireThat(candidate.data.equals(generated),`${wb.get(key).entry.name} and ${entry.name} share ${binding.name} but need different shadow shapes. Disable automatic shadows for this import, then explicitly Rebuild KG1 shadows from the model that should own the shared resource.`);
  }
}

function sameShadowGeometry(left,right) {
  if(left.equals(right))return true;
  const a=parseModel(left),b=parseModel(right);
  const geometry=model=>JSON.stringify({id:model.modelId,bones:model.bones.map(b=>[b.parent,b.matrix]),
    meshes:model.meshes.map(m=>[m.visibilityId,Array.from(m.positions),Array.from(m.joints),Array.from(m.weights)])});
  return geometry(a)===geometry(b);
}

/** Prepare both files before committing, so a failed shadow build cannot stage half a model. */
export function stageModelWithShadow(wb,key,data,label,enabled=true,force=false) {
  const binding=enabled?shadowBinding(wb,key):null,companion=binding?.key;
  if(companion&&!force&&sameShadowGeometry(wb.bytes(key),data))return wb.stage(key,data,label);
  if(!companion)return wb.stage(key,data,label);
  const shadow=companion?rebuildShadow(wb.bytes(companion),data):null;
  if(!force)validateSharedShadow(wb,key,binding,shadow.data);
  const updates=[[key,data,label],...(shadow?[[companion,shadow.data,'Rebuilt model shadow volumes']]:[])];
  const prepared=updates.map(([target,bytes,description])=>[target,wb.prepareChange(target,bytes,description)]);
  for(const [target,change] of prepared)if(change)wb.changes.set(target,change);else wb.changes.delete(target);
  wb.textureLibrary.reset();wb.modelPlan=null;wb.animationPlan=null;
  return {...wb.snapshot(),shadowReport:{...shadow.report,resource:binding.name,sharedModels:binding.sharedModels}};
}
