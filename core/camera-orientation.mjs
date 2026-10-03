import {Euler,Quaternion} from 'three';
import {normalizedCamera} from './camera-study.mjs';

export const hasFixedDirection=record=>[2,7].includes(record.cameraMovementType);

/** Editor +Z points along the native sight ray after conversion to display coordinates. */
export function cameraEditorRotation(record) {
  const p=normalizedCamera(record).movementParameters;
  return [-p[0],-p[1],0];
}

/** Change pitch/yaw only; mode-specific offset, distance and native roll remain intact. */
export function orientCamera(record,quaternion) {
  if(!hasFixedDirection(record))throw new Error('This camera follows its subject. Select a fixed-angle camera (mode 2 or 7) to edit its sight direction.');
  const rotation=new Euler().setFromQuaternion(new Quaternion(...quaternion),'YXZ'),out=structuredClone(record);
  const previous=normalizedCamera(record).movementParameters[1],yaw=-rotation.y;
  out.movementParameters[0]=Math.fround(-rotation.x);
  out.movementParameters[1]=Math.fround(yaw+Math.round((previous-yaw)/(2*Math.PI))*2*Math.PI);
  return out;
}
