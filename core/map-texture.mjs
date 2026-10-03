import {requireThat} from './binary.mjs';
import {readTextures} from './textures.mjs';
import {rebuildTexture} from './texture-rebuild.mjs';
import {parseMap} from './world-formats.mjs';

export function canResizeMapTextures(data,images) {
  const offset=data.readUInt32LE(16);
  return offset>0&&offset===data.readUInt32LE(48)&&images.length>0&&images.at(-1).end+offset===data.length;
}

/** Resize a terminal MAP batch without relocating geometry or material bindings. */
export function rebuildMapTexture(data,index,png) {
  const offset=data.readUInt32LE(16),images=readTextures(data.subarray(offset),false,{decode:false});
  requireThat(canResizeMapTextures(data,images),'Full-size MAP import requires a terminal texture batch. Use Fit to original for this custom container.');
  const batch=rebuildTexture(data.subarray(offset),index,png),output=Buffer.concat([data.subarray(0,offset),batch]);
  parseMap(output);requireThat(readTextures(batch,false,{decode:false}).length===images.length,'MAP texture count changed.');return output;
}
