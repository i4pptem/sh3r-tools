import {Euler, Quaternion, Vector3} from 'three';

const euler = new Euler(0, 0, 0, 'ZYX'), first = new Quaternion(), second = new Quaternion();
const position = new Vector3(), parentPosition = new Vector3(), rotation = new Quaternion(), parentRotation = new Quaternion();
const flip = new Quaternion(0, 0, 1, 0);
const halfTurn = Math.fround(Math.PI), turn = Math.fround(Math.PI * 2);
function wrapped(angle) {
  angle %= turn;
  if (angle <= -halfTurn) angle += turn;
  else if (angle > halfTurn) angle -= turn;
  return angle;
}

function sample(clip, bone, a, b, mix, p, q) {
  const x = (a * clip.boneCount + bone) * 3, y = (b * clip.boneCount + bone) * 3;
  const angles = clip.eulers, points = clip.translations;
  if (mix === 0) {p.fromArray(points,x);q.setFromEuler(euler.set(angles[x],angles[x+1],angles[x+2],'ZYX'));return;}
  const px = points[y] - points[x], py = points[y + 1] - points[x + 1], pz = points[y + 2] - points[x + 2];
  const positionMix = px * px + py * py + pz * pz < 1000000 ? mix : 0;
  p.set(points[x] + px * positionMix, points[x + 1] + py * positionMix, points[x + 2] + pz * positionMix);
  const dx = angles[y] - angles[x], dy = angles[y + 1] - angles[x + 1], dz = angles[y + 2] - angles[x + 2];
  if (Math.abs(dx) + Math.abs(dz) > Math.fround(Math.PI / 2)) {
    first.setFromEuler(euler.set(angles[x], angles[x + 1], angles[x + 2], 'ZYX'));
    second.setFromEuler(euler.set(angles[y], angles[y + 1], angles[y + 2], 'ZYX'));
    const sign = first.dot(second) < 0 ? -1 : 1;
    q.set(first.x * (1 - mix) + second.x * sign * mix, first.y * (1 - mix) + second.y * sign * mix,
      first.z * (1 - mix) + second.z * sign * mix, first.w * (1 - mix) + second.w * sign * mix).normalize();
  } else q.setFromEuler(euler.set(wrapped(angles[x] + wrapped(dx) * mix), wrapped(angles[x + 1] + wrapped(dy) * mix), wrapped(angles[x + 2] + wrapped(dz) * mix), 'ZYX'));
}

/** Convert absolute native PACK poses to the viewer's parent-local skeleton. */
export function applyCutscenePose(clip, a, b, mix, bones, parents) {
  if (mix < .01) mix = 0;
  else if (b === a + 1 && clip.cuts?.[a]) {a = b; mix = 0;}
  for (let i = 0; i < bones.length; i++) {
    sample(clip, i, a, b, mix, position, rotation);
    if (parents[i] >= 0) {
      sample(clip, parents[i], a, b, mix, parentPosition, parentRotation);
      parentRotation.invert(); position.sub(parentPosition).applyQuaternion(parentRotation); rotation.premultiply(parentRotation);
    } else {position.x *= -1; position.y *= -1; rotation.premultiply(flip);}
    bones[i].position.copy(position); bones[i].quaternion.copy(rotation); bones[i].scale.set(1, 1, 1);
  }
}

/** Native cut detection at the preview's one-tick (60 Hz) update baseline. */
export function cameraSample(values) {
  const dx = values[3] - values[0], dy = values[4] - values[1], dz = values[5] - values[2];
  const halfFov = Math.atan(1.6670000553 * Math.tan(values[7] * Math.fround(Math.PI / 360)));
  return {position: values.slice(0, 3).map(v => v * 50), pitch: Math.atan2(-dy, Math.hypot(dx, dz)),
    yaw: Math.atan2(dx, dz), focus: 290.9090909091 / Math.tan(halfFov)};
}

export function cameraCut(first, second) {
  return Math.abs(second.focus - first.focus) > 50 ||
    Math.hypot(...second.position.map((v, i) => v - first.position[i])) > 100 ||
    Math.abs(second.pitch - first.pitch) > Math.fround(Math.PI / 9) ||
    Math.abs(wrapped(second.yaw - first.yaw)) * Math.cos(second.pitch) > Math.fround(Math.PI / 6);
}
