function sampleTrack(track, frame) {
  const {frames, weights} = track, count = frames.length;
  if (!count) return 0;
  if (count === 1 || frame <= frames[0]) return weights[0];
  if (frame >= frames[count - 1]) return weights[count - 1];
  let left = 0, right = count - 1;
  while (right - left > 1) {
    const middle = (left + right) >>> 1;
    if (frames[middle] <= frame) left = middle; else right = middle;
  }
  const t = (frame - frames[left]) / (frames[right] - frames[left]);
  return weights[left] + (weights[right] - weights[left]) * t;
}

/** Sample signed morph weights at a scene frame; callers own playback looping.
 * PACK segments use [startFrame, endFrame); cuts never blend between segments.
 * Empty segments clear all weights. The engine clamps each curve's last frame.
 */
export function sampleMorphAnimation(clip, frame) {
  if (!Number.isFinite(frame)) throw new Error('Morph playback frame must be finite.');
  frame = Math.max(0, Math.min(clip.frameCount - 1, frame));
  const weights = new Array(clip.targetCount).fill(0);
  const segment = clip.segments.find(segment => frame >= segment.startFrame && frame < segment.endFrame);
  if (!segment) return weights;
  const localFrame = Math.min(segment.frameCount - 1, frame - segment.startFrame);
  for (let index = 0; index < segment.tracks.length; index++) weights[index] = sampleTrack(segment.tracks[index], localFrame);
  return weights;
}
