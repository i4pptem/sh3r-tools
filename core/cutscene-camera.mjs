/** Sample PACK scene channels with the same frame/cut policy as character motion. */
export function sceneSample(track, frame, cuts, discrete = false) {
  const position = Math.max(0, Math.min(track.frameCount - 1, frame));
  let a = Math.floor(position), b = Math.min(track.frameCount - 1, a + 1), mix = position - a;
  if (discrete ? mix <= .01 : mix < .01) mix = 0;
  else if (cuts?.[a]) {a = b; mix = 0;}
  if (discrete) mix = 0;
  return Array.from({length: track.stride}, (_, i) => track.values[a * track.stride + i] * (1 - mix) + track.values[b * track.stride + i] * mix);
}

export const scenePosition = values => [-50 * values[0], 50 * values[1], -50 * values[2]];

/** The PC camera stores a lens angle, not a Three.js vertical field of view. */
export function cutsceneCamera(values) {
  const halfAngle = Math.atan(Math.fround(1.667) * Math.tan(values[7] * Math.fround(Math.PI / 180) * .5));
  const projection = Math.fround(290.9090881347656) / Math.tan(halfAngle);
  return {eye: scenePosition(values), target: scenePosition(values.slice(3, 6)), roll: values[6] * Math.PI / 180,
    fov: 2 * Math.atan(224 / projection) * 180 / Math.PI};
}
