import {Box3,Vector3,Matrix4,Quaternion,Euler} from 'three';
import {collisionRecordPolygons,displayPoint} from './world-shapes.mjs';

export function collisionSelectionCenter(records) {
  const box=new Box3();
  for(const record of records)for(const polygon of collisionRecordPolygons(record))for(const point of polygon)box.expandByPoint(new Vector3(...displayPoint(point)));
  return box.getCenter(new Vector3()).toArray();
}

export const collisionRotationAxes=records=>records.some(r=>[1,3,4].includes(r.group))?'Y':'XYZ';

/** Transform a whole selection around its shared pivot while retaining native wall/cylinder shapes. */
export function transformCollisionSelection(records,transform) {
  if(!records.length)return [];
  const {position,rotation}=transform,scale=[...transform.scale];
  if(![...position,...rotation,...scale].every(Number.isFinite)||!scale.every(v=>v>0))throw new Error('Enter finite transforms and positive scale values.');
  if(collisionRotationAxes(records)==='Y'&&(rotation[0]!==0||rotation[2]!==0))throw new Error('Walls and cylinders must stay upright. Rotate this selection around Y.');
  if(records.some(r=>r.group===4)){const radiusScale=scale[0]!==1?scale[0]:scale[2];scale[0]=scale[2]=radiusScale;}
  const center=collisionSelectionCenter(records),matrix=new Matrix4().makeTranslation(...position)
    .multiply(new Matrix4().compose(new Vector3(),new Quaternion().setFromEuler(new Euler(...rotation,'YXZ')),new Vector3(...scale)))
    .multiply(new Matrix4().makeTranslation(...center.map(v=>-v)));
  const point=p=>displayPoint(new Vector3(...displayPoint(p)).applyMatrix4(matrix).toArray()).map(Math.fround);
  return records.map(record=>{
    const next=structuredClone(record);
    if(record.vertices)next.vertices=record.vertices.map(point);
    else {next.position=point(record.position);next.topY=point([record.position[0],record.topY,record.position[2]])[1];next.radius=Math.fround(record.radius*scale[0]);}
    if((next.vertices?.flat()||[...next.position,next.topY,next.radius]).some(v=>!Number.isFinite(v)))throw new Error('Collision coordinates exceed the native numeric range.');
    return next;
  });
}
