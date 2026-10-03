import {parseAnimation} from './animation.mjs';
/** Masks are read from the bank; absent channels remain owned by the game. */
export function animationChannels(model,data){
 const clip=parseAnimation(data,model.bones.map(bone=>bone.parent));
 return {format:'anm',frames:clip.frameCount,bones:model.bones.map((bone,index)=>({name:bone.name,index,parent:bone.parent,rotation:Number.isFinite(clip.rotations[index*4]),translation:Number.isFinite(clip.translations[index*3]),scale:false}))};
}
