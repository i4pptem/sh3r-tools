import {requireThat, range} from './binary.mjs';
import {packSections} from './pack.mjs';

const CLUSTER_IDS = new Set([0x29843918, 0x29853918]);

function cluster(buffer, offset, size) {
  range(buffer, offset, size, 'Morph animation');
  requireThat(size >= 16, 'Morph animation header is truncated.');
  const data = buffer.subarray(offset, offset + size);
  requireThat(CLUSTER_IDS.has(data.readUInt32LE(0)), 'Unsupported morph animation signature.');
  requireThat(data.readUInt16LE(4) === 1, 'Only revision 1 morph curves are supported.');
  const targetCount = data.readUInt16LE(8), frameCount = data.readUInt16LE(12);
  requireThat(frameCount > 0, 'Morph animation has no frames.');
  range(data, 16, targetCount * 4, 'Morph track offsets');
  const tracks = Array.from({length: targetCount}, (_, index) => {
    const start = data.readUInt32LE(16 + index * 4);
    requireThat(start >= 16 + targetCount * 4, 'Morph track overlaps its header.');
    range(data, start, 2, 'Morph key count');
    const count = data.readUInt16LE(start);
    range(data, start + 2, count * 4, 'Morph keys');
    const frames = [], weights = [];
    for (let key = 0; key < count; key++) {
      const p = start + 2 + key * 4, frame = data.readUInt16LE(p);
      requireThat(frame < frameCount && (!key || frame > frames[key - 1]), 'Morph key frames must increase within the clip.');
      frames.push(frame); weights.push(data.readInt16LE(p + 2) / 4096);
    }
    requireThat(count < 2 || (frames[0] === 0 && frames[count - 1] === frameCount - 1), 'Morph curves must cover the first and last frame.');
    return {frames, weights};
  });
  return {offset, frameCount, targetCount, tracks};
}

function control(buffer, offset, size, controlIndex) {
  range(buffer, offset, size, 'PACK morph control');
  const data = buffer.subarray(offset, offset + size);
  range(data, 0, 12, 'PACK morph control header');
  const modelId = data.readUInt32LE(0), count = data.readUInt32LE(8);
  range(data, 12, count * 16, 'PACK morph segments');
  const segments = [];
  let targetCount = null, frameCount = 0;
  for (let index = 0; index < count; index++) {
    const p = 12 + index * 16;
    const startFrame = data.readUInt32LE(p), endFrame = data.readUInt32LE(p + 4);
    const length = data.readUInt32LE(p + 8), relativeOffset = data.readUInt32LE(p + 12);
    requireThat(endFrame >= startFrame && (!index || startFrame >= segments[index - 1].endFrame), 'PACK morph segments overlap or have invalid ranges.');
    let curve = null;
    if (length) {
      requireThat(relativeOffset >= 12 + count * 16, 'PACK morph data overlaps its segment table.');
      range(data, relativeOffset, length, 'PACK morph segment');
      curve = cluster(buffer, offset + relativeOffset, length);
      requireThat(targetCount === null || targetCount === curve.targetCount, 'PACK morph target count changes between segments.');
      targetCount = curve.targetCount;
    }
    segments.push({startFrame, endFrame, frameCount: curve?.frameCount ?? endFrame - startFrame,
      offset: curve?.offset ?? null, tracks: curve?.tracks ?? []});
    frameCount = endFrame + 1;
  }
  if (targetCount === null || !targetCount) return null;
  const last=segments.at(-1);frameCount=Math.max(frameCount,last.startFrame+last.frameCount);
  return {type: 'morph', modelId, name: `Character 0x${modelId.toString(16).toUpperCase()} · morphs`,
    offset, controlIndex, frameCount, targetCount, segments, fps: 30, fpsSource: 'preview-default',
    tracks: segments.length === 1 ? segments[0].tracks : []};
}

/** Read native cluster curves or the morph-control sections of a SH3 PACK.
 *
 * Unknown root formats return an empty list. Recognized but malformed formats
 * throw, so a damaged clip cannot silently become an empty animation.
 */
export function parseMorphAnimations(buffer) {
  if (buffer.length < 4) return [];
  const id = buffer.readUInt32LE(0);
  if (CLUSTER_IDS.has(id)) {
    const curve = cluster(buffer, 0, buffer.length);
    return [{type: 'morph', modelId: null, name: 'Morph animation', ...curve,
      fps: 30, fpsSource: 'preview-default',
      segments: [{startFrame: 0, endFrame: curve.frameCount, ...curve}]}];
  }
  const clips = [];
  for (const {index, offset, type, size} of packSections(buffer)) {
    if (type === 1) {
      const clip = control(buffer, offset, size, index);
      if (clip) clips.push(clip);
    }
  }
  return clips;
}
