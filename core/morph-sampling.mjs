export function sampleMorphTrack(track, frame) {
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

/** Sample native steady-state facial weights. PACK ends are inclusive; the last
 * selected payload stays active. The runtime's one-update reset on payload switches
 * depends on update cadence and is not part of this stateless sample operation.
 */
export function sampleMorphAnimation(clip, frame) {
  if (!Number.isFinite(frame)) throw new Error('Morph playback frame must be finite.');
  const weights = new Array(clip.targetCount).fill(0);
  frame = Math.max(0, frame);
  const segment = clip.controlIndex !== undefined
    ? clip.segments.find(segment => Math.ceil(frame) <= segment.endFrame) || clip.segments.at(-1)
    : clip.segments[0];
  if (!segment) return weights;
  const localFrame = Math.max(0, Math.min(segment.frameCount - 1, frame - segment.startFrame));
  for (let index = 0; index < segment.tracks.length; index++) weights[index] = sampleMorphTrack(segment.tracks[index], localFrame);
  return weights;
}
