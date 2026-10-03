import {Euler,Quaternion,Vector3,Matrix4} from 'three';
const euler=new Euler(0,0,0,'ZYX'),aRotation=new Quaternion(),bRotation=new Quaternion(),position=new Vector3();
const flip=new Matrix4().makeScale(-1,-1,1),unit=new Vector3(1,1,1),turn=Math.fround(Math.PI*2),half=Math.fround(Math.PI);
function wrap(v){v%=turn;return v<=-half?v+turn:v>half?v-turn:v;}
/** Absolute native MAP-object transform; geometry has already been baked by its rest matrix. */
export function samplePropMatrix(track,frame,cuts,target=new Matrix4()) {
  const time=Math.max(0,Math.min(track.frameCount-1,frame));let a=Math.floor(time),b=Math.min(track.frameCount-1,a+1),mix=time-a;
  if(mix<.01)mix=0;else if(cuts?.[a]){a=b;mix=0;}
  const values=track.values,x=a*6,y=b*6,delta=[0,1,2].map(i=>values[y+i]-values[x+i]);
  position.set(...[3,4,5].map(i=>values[x+i]+(values[y+i]-values[x+i])*mix));
  if(mix&&Math.abs(delta[0])+Math.abs(delta[2])>Math.fround(Math.PI/4)) {
    aRotation.setFromEuler(euler.set(values[x],values[x+1],values[x+2],'ZYX'));bRotation.setFromEuler(euler.set(values[y],values[y+1],values[y+2],'ZYX'));
    const sign=aRotation.dot(bRotation)<0?-1:1;
    aRotation.set(aRotation.x*(1-mix)+bRotation.x*mix*sign,aRotation.y*(1-mix)+bRotation.y*mix*sign,aRotation.z*(1-mix)+bRotation.z*mix*sign,aRotation.w*(1-mix)+bRotation.w*mix*sign).normalize();
  }else aRotation.setFromEuler(euler.set(...[0,1,2].map(i=>mix?wrap(values[x+i]+wrap(delta[i])*mix):values[x+i]),'ZYX'));
  return target.compose(position,aRotation,unit).premultiply(flip);
}
