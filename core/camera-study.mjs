/** Native CAM startup constants, applied to a copy so export retains source bytes. */
export function normalizedCamera(record) {
  const result = structuredClone(record), parameters = result.movementParameters;
  result.kindId = (result.kindId << 16) >> 16;
  result.watchHeightOffset = ({10000: -300, 10001: -375, 10002: -600})[result.watchHeightOffset] ?? result.watchHeightOffset;
  result.traceBottomHeight = ({10000: -300, 10001: -150, 10002: 150})[result.traceBottomHeight] ?? result.traceBottomHeight;
  result.projection[0] = ({0: 448, 10001: 384})[result.projection[0]] ?? result.projection[0];
  if (result.cameraMovementType === 0) parameters[0] = ({10000: -500, 10001: -125})[parameters[0]] ?? parameters[0];
  if (result.cameraMovementType === 2 && parameters[0] === 10000) parameters[0] = Math.fround(-Math.PI / 6);
  return result;
}

export function cameraZoneCenter(record) {
  const [a, , c] = record.activeGroundPoints;
  return [(a[0] + c[0]) / 2, Math.max(...record.activeHeights), (a[1] + c[1]) / 2];
}

function zoneCoordinates(ground, point) {
  const [a, b, c] = ground, u = [b[0] - a[0], b[1] - a[1]], v = [c[0] - b[0], c[1] - b[1]], delta = [point[0] - a[0], point[2] - a[1]];
  const determinant = u[0] * v[1] - u[1] * v[0];
  if (!determinant) return null;
  return [(delta[0] * v[1] - delta[1] * v[0]) / determinant, (u[0] * delta[1] - u[1] * delta[0]) / determinant];
}

/** Geometric activation membership, independent of the game's priority/hysteresis. */
export function cameraZoneContains(record, point) {
  const uv = zoneCoordinates(record.activeGroundPoints, point);
  return !!uv && uv.every(value => value >= 0 && value <= 1) && point[1] >= Math.min(...record.activeHeights) && point[1] <= Math.max(...record.activeHeights);
}

export const CAMERA_MODES = {0: 'Follow', 1: 'Follow (alternate height)', 2: 'Fixed angle', 3: 'Self view', 4: 'Circle', 6: 'Anchored tracking', 7: 'Anchored fixed angle', 8: 'Mode 8', 9: 'Mode 9', 10: 'Mode 10', 14: 'Stage camera', 15: 'Transition'};
const clamp = (value, low, high) => Math.max(Math.min(low, high), Math.min(Math.max(low, high), value));
const add = (a, b, scale = 1) => a.map((value, i) => value + b[i] * scale);

/** Direction matches the native PC camera-vector helper (roll does not affect it). */
export function cameraDirection(pitch, yaw) {
  return [Math.cos(pitch) * Math.sin(yaw), -Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)];
}

function nearestConstraint(record, point, margin = 0) {
  let [a, b, c] = record.constraintGroundPoints;
  if (margin) {
    const u = b.map((value, i) => value - a[i]), v = c.map((value, i) => value - b[i]);
    const uLength = Math.hypot(...u), vLength = Math.hypot(...v), su = uLength ? Math.min(.5, margin / uLength) : 0, sv = vLength ? Math.min(.5, margin / vLength) : 0;
    a = a.map((value, i) => value + u[i] * su + v[i] * sv);
    b = a.map((value, i) => value + u[i] * (1 - 2 * su)); c = b.map((value, i) => value + v[i] * (1 - 2 * sv));
  }
  const d = [a[0] + c[0] - b[0], a[1] + c[1] - b[1]], uv = zoneCoordinates([a, b, c], point);
  if (uv?.every(value => value >= 0 && value <= 1)) return [...point];
  const corners = [a, b, c, d]; let nearest, distance = Infinity;
  for (let i = 0; i < 4; i++) {
    const start = corners[i], end = corners[(i + 1) % 4], x = end[0] - start[0], z = end[1] - start[1];
    const length = x * x + z * z, t = length ? clamp(((point[0] - start[0]) * x + (point[2] - start[1]) * z) / length, 0, 1) : 0;
    const candidate = [start[0] + t * x, point[1], start[1] + t * z], squared = (candidate[0] - point[0]) ** 2 + (candidate[2] - point[2]) ** 2;
    if (squared < distance) {distance = squared; nearest = candidate;}
  }
  return nearest;
}

function trackingTarget(record, position, point, heading) {
  const area = record.areaSizeType, full = [0, 4].includes(record.cameraMovementType), radius = [400, 600, 1000, 1250][area] * (full ? 1 : .5);
  const x = point[0] - position[0], z = point[2] - position[2], distance = Math.hypot(x, z), forward = full ? Math.max(0, [1400, 1800, 2800, 3200][area] + radius - distance) : 0;
  return [point[0] + (distance ? x / distance * forward : 0) + Math.sin(heading) * radius, point[1] + record.watchHeightOffset,
    point[2] + (distance ? z / distance * forward : 0) + Math.cos(heading) * radius];
}

/** Static camera composition; runtime selection, previous camera state and collisions are omitted. */
export function cameraStudy(source, point, heading, height = 835) {
  if (![...point, heading, height].every(Number.isFinite) || point.length !== 3 || height <= 0) throw new Error('Enter a finite reference position, facing and positive height.');
  const record = normalizedCamera(source), mode = record.cameraMovementType, modeName = CAMERA_MODES[mode] || `Mode ${mode}`;
  const unavailable = note => ({supported: false, zone: record.index, mode: modeName, note});
  if (![0, 2, 6, 7].includes(mode)) return unavailable(`${modeName} is not reconstructed for camera preview. Its reference geometry remains available.`);
  if (!(record.projection[0] > 0)) return unavailable('This focal length cannot produce a camera preview.');
  if (mode !== 7 && ![0, 1, 2, 3].includes(record.areaSizeType)) return unavailable('This camera area type is not reconstructed for preview.');
  const p = record.movementParameters;
  let position, target, roll = 0, note;
  if (mode === 6 || mode === 7) {
    position = [record.constraintGroundPoints[0][0], record.constraintHeights[0], record.constraintGroundPoints[0][1]];
    if (mode === 7) {target = add(position, cameraDirection(p[0], p[1]), 2000); roll = p[2]; note = 'Stored camera position and sight direction; baseline projection.' + (roll ? ' Native roll is excluded from this preview.' : '');}
    else {target = trackingTarget(record, position, point, heading); note = 'Stored camera position; approximate tracking target.';}
  } else {
    const nearest = nearestConstraint(record, point), outside = Math.hypot(nearest[0] - point[0], nearest[2] - point[2]);
    if (mode === 0) {
      const area = record.areaSizeType, base = [600, 800, 1000, 1250][area], near = [400, 600, 800, 1000][area], far = [1200, 1600, 2400, 2800][area];
      const radius = base + (200 - base) * clamp((outside - near) / (far - near), 0, 1);
      position = nearestConstraint(record, add(point, cameraDirection(0, heading + Math.PI), radius), 400);
      position[1] = clamp(point[1] - height - 187.5 + p[0], ...record.constraintHeights);
      target = trackingTarget(record, position, point, heading);
      note = 'Approximate follow composition: default height and 400-unit road margin, without previous-camera state or stage overrides.';
    } else {
      if (!(p[3] > 0)) return unavailable('Fixed-angle camera distance must be positive for preview.');
      position = nearestConstraint(record, add(point, cameraDirection(0, p[1] + Math.PI), 1000 + outside / 2), 400);
      position[1] = clamp(point[1] - height - 187.5, ...record.constraintHeights);
      target = add(position, cameraDirection(p[0], p[1]), p[3]);
      note = 'Approximate fixed-angle composition: representative height, zero previous-camera front bias.';
    }
  }
  return {supported: true, zone: record.index, mode: modeName, position, target, roll, fov: 2 * Math.atan(224 / record.projection[0]) * 180 / Math.PI, note};
}
