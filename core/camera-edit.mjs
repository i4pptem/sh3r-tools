import {requireThat} from './binary.mjs';
import {cameraRecords} from './world-records.mjs';

const fields = {
  activeGroundPoints: [0, 'points', 3], activeHeights: [24, 'float', 2],
  constraintGroundPoints: [32, 'points', 3], constraintHeights: [56, 'float', 2],
  kindId: [64, 'int'], flags: [68, 'uint'], areaSizeType: [72, 'int'], roadType: [76, 'int'],
  verticalMovementType: [80, 'int'], watchHeightOffset: [84, 'float'], traceBottomHeight: [88, 'float'],
  roadDirectionType: [92, 'int'], projection: [96, 'float', 3], cameraMovementType: [108, 'int'],
  movementParameters: [112, 'float', 4],
};

/** Rebuild camera records while retaining native ordering, end marker and unknown bytes. */
export function editCameras(data, edits) {
  const original = cameraRecords(data), output = Buffer.from(data), seen = new Set();
  requireThat(Array.isArray(edits) && edits.length <= original.count, 'Choose existing CAM zones to edit.');
  for (const edit of edits) {
    requireThat(Number.isInteger(edit.index) && edit.index >= 0 && edit.index < original.count && !seen.has(edit.index), 'CAM zone index is invalid or repeated.');
    seen.add(edit.index);
    for (const [name, [offset, type, count]] of Object.entries(fields)) {
      if (edit[name] === undefined) continue;
      let values = count ? edit[name] : [edit[name]];
      requireThat(Array.isArray(values) && values.length === (count || 1), `Zone ${edit.index} · ${name}: incorrect component count.`);
      if (type === 'points') {
        requireThat(values.every(v => Array.isArray(v) && v.length === 2), `Zone ${edit.index} · ${name}: provide three X/Z points.`);
        values = values.flat();
      }
      for (const [i, value] of values.entries()) {
        const label = `Zone ${edit.index} · ${name} ${i + 1}`, at = edit.index * 128 + offset + i * 4;
        requireThat(typeof value === 'number' && Number.isFinite(value), `${label}: enter a finite number.`);
        if (type === 'int' || type === 'uint') {
          requireThat(Number.isInteger(value) && value >= (type === 'uint' ? 0 : -2147483648) && value <= (type === 'uint' ? 4294967295 : 2147483647), `${label}: outside the native integer range.`);
          requireThat(name !== 'flags' || !(value & 1), `${label}: flag 1 is reserved for the CAM end marker.`);
          output[type === 'uint' ? 'writeUInt32LE' : 'writeInt32LE'](value, at);
        } else {
          requireThat(Number.isFinite(Math.fround(value)), `${label}: outside the native float range.`);
          if (value !== data.readFloatLE(at)) output.writeFloatLE(value, at);
        }
      }
    }
  }
  requireThat(cameraRecords(output).count === original.count, 'CAM zone ordering changed unexpectedly.');
  return output;
}

export function importCameras(data, document) {
  requireThat(document?.format === 'SH3 camera zones' && Array.isArray(document.records), 'Import a camera structure JSON exported from a CAM asset.');
  requireThat(document.records.length === cameraRecords(data).count, 'Keep the original CAM zone count and indices.');
  return editCameras(data, document.records);
}
