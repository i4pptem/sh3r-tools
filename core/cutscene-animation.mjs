import {requireThat, range} from './binary.mjs';
import {packSections} from './pack.mjs';
import {cameraSample, cameraCut} from './cutscene-sampling.mjs';

export function motionSection(buffer, section) {
  const data = buffer.subarray(section.offset, section.offset + section.size);
  range(data, 0, 4, 'PACK motion header');
  const count = data.readUInt32LE(0), dataOffset = 4 + count * 20;
  range(data, 4, count * 20, 'PACK motion tracks');
  let payloadSize = 0;
  const tracks = Array.from({length: count}, (_, index) => {
    const p = 4 + index * 20, identity = data.readUInt32LE(p + 4);
    const track = {type: data.readUInt32LE(p), modelId: identity >>> 16, index: identity & 65535,
      width: data.readUInt32LE(p + 8), frameCount: data.readUInt32LE(p + 12)};
    payloadSize += track.width * track.frameCount;
    requireThat(Number.isSafeInteger(payloadSize) && payloadSize <= data.length, 'PACK motion payload exceeds its section.');
    return track;
  });
  requireThat(dataOffset + payloadSize === data.length, 'PACK motion sizes do not match its section.');
  return {data, dataOffset, tracks};
}

function characters(section, tracks) {
  const groups = new Map();
  for (const track of tracks) if (track.type === 1 && track.index > 0) {
    if (!groups.has(track.modelId)) groups.set(track.modelId, []);
    groups.get(track.modelId).push(track);
  }
  return [...groups].map(([modelId, bones]) => {
    const boneCount = Math.max(...bones.map(track => track.index));
    requireThat(boneCount <= 256 && bones.length === boneCount && new Set(bones.map(track => track.index)).size === boneCount,
      `PACK character 0x${modelId.toString(16)} has an incomplete or duplicate bone track table.`);
    requireThat(bones.every(track => track.width === 24 && track.frameCount > 0), 'Unsupported PACK character sample layout.');
    const frameCount = Math.max(...bones.map(track => track.frameCount));
    requireThat(frameCount * boneCount <= 4000000, 'Cutscene exceeds preview limits.');
    return {type: 'skeletal', sourceFormat: 'pack', sectionIndex: section.index, modelId, boneCount, frameCount,
      name: `Character 0x${modelId.toString(16).toUpperCase()} · cutscene`, fps: 30, fpsSource: 'cutscene-clock'};
  });
}

/** List character performances without expanding their per-frame pose data. */
export function cutsceneAnimations(buffer) {
  return packSections(buffer).filter(section => section.type === 2).flatMap(section => {
    const {tracks} = motionSection(buffer, section);
    return characters(section, tracks);
  });
}

/** Decode absolute native character poses; index zero is a separate scene track. */
export function parseCutsceneAnimation(buffer, sectionIndex, modelId, parents) {
  const section = packSections(buffer).find(section => section.index === sectionIndex && section.type === 2);
  requireThat(section, 'Cutscene motion section is no longer available.');
  const {data, dataOffset, tracks} = motionSection(buffer, section);
  const clip = characters(section, tracks).find(clip => clip.modelId === modelId);
  requireThat(clip && clip.boneCount === parents.length, 'Cutscene skeleton does not match the selected model.');
  const {boneCount, frameCount} = clip;
  const eulers = new Float32Array(frameCount * boneCount * 3), translations = new Float32Array(eulers.length);
  const selected = tracks.filter(track => track.type === 1 && track.modelId === modelId && track.index > 0);
  const cameraTrack = tracks.find(track => track.type !== 0 && track.modelId === 0 && track.index === 0);
  const camera = cameraTrack?.type === 3 && cameraTrack.width === 32 ? cameraTrack : null;
  const cuts = new Uint8Array(frameCount);
  let offset = dataOffset, previousCamera;
  for (let frame = 0; frame < frameCount; frame++) {
    for (const track of tracks) {
      if (frame >= track.frameCount) continue;
      if (track.type === 1 && track.modelId === modelId && track.index > 0) {
        const dest = (frame * boneCount + track.index - 1) * 3;
        for (let axis = 0; axis < 3; axis++) {
          const angle = data.readFloatLE(offset + axis * 4), position = data.readFloatLE(offset + 12 + axis * 4);
          requireThat(Number.isFinite(angle) && Number.isFinite(position), `Cutscene bone${String(track.index - 1).padStart(3, '0')}, frame ${frame}: non-finite transform.`);
          eulers[dest + axis] = angle; translations[dest + axis] = position;
        }
      }
      if (track === camera) {
        const values = Array.from({length: 8}, (_, i) => data.readFloatLE(offset + i * 4));
        requireThat(values.every(Number.isFinite), `Cutscene camera, frame ${frame}: non-finite transform.`);
        const current = cameraSample(values);
        if (previousCamera) cuts[frame - 1] = Number(cameraCut(previousCamera, current));
        previousCamera = current;
      }
      offset += track.width;
    }
  }
  for (const track of selected) for (let frame = track.frameCount; frame < frameCount; frame++) {
    const source = ((track.frameCount - 1) * boneCount + track.index - 1) * 3, dest = (frame * boneCount + track.index - 1) * 3;
    eulers.set(eulers.subarray(source, source + 3), dest); translations.set(translations.subarray(source, source + 3), dest);
  }
  return {...clip, eulers, translations, cuts, cameraCuts: camera ? 'native-one-tick' : 'unavailable'};
}
