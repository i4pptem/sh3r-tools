import test from 'node:test';
import assert from 'node:assert/strict';
import {cameraRecords} from '../core/world-records.mjs';
import {cameraFixture} from './helpers/camera-fixture.mjs';
import {normalizedCamera, cameraZoneContains, cameraZoneCenter, cameraStudy, cameraDirection} from '../core/camera-study.mjs';

const record = () => cameraRecords(cameraFixture()).records[0];

test('CAM normalization matches native startup constants without rewriting source records', () => {
  const source = record(); source.projection = [0, 10001, 10002]; source.movementParameters = [10000, 2, 3, 4]; source.kindId = 65535;
  const original = structuredClone(source), result = normalizedCamera(source);
  assert.equal(result.kindId, -1); assert.equal(result.watchHeightOffset, -300); assert.equal(result.traceBottomHeight, -300);
  assert.deepEqual(result.projection, [448, 10001, 10002]); assert.equal(result.movementParameters[0], -500);
  source.cameraMovementType = 2; assert.equal(normalizedCamera(source).movementParameters[0], Math.fround(-Math.PI / 6));
  source.cameraMovementType = original.cameraMovementType; assert.deepEqual(source, original);
});

test('activation membership handles rotated regions, inverted native Y and zero-area zones', () => {
  const source = record(); source.activeGroundPoints = [[0, 0], [100, 100], [0, 200]];
  assert.deepEqual(cameraZoneCenter(source), [0, 50, 100]);
  assert.equal(cameraZoneContains(source, [0, 0, 100]), true);
  assert.equal(cameraZoneContains(source, [99, 0, 199]), false);
  assert.equal(cameraZoneContains(source, [0, 51, 100]), false);
  source.activeGroundPoints = [[0, 0], [0, 0], [0, 200]];
  assert.equal(cameraZoneContains(source, [0, 0, 100]), false);
});

test('fixed direction agrees with native pitch/yaw axes and ignores roll for the sight ray', () => {
  const close = (actual, expected) => actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-10));
  close(cameraDirection(0, 0), [0, 0, 1]); close(cameraDirection(0, Math.PI / 2), [1, 0, 0]);
  close(cameraDirection(Math.PI / 2, 0), [0, -1, 0]);
});

test('anchored mode 7 keeps camera position and angles independent of the reference character', () => {
  const source = record(); source.cameraMovementType = 7;
  source.constraintGroundPoints = [[15, 25], [15, 25], [15, 25]]; source.constraintHeights = [-500, -500];
  source.movementParameters = [0, 0, .3, 9999];
  const first = cameraStudy(source, [0, 0, 0], 0), second = cameraStudy(source, [500, 0, 500], Math.PI / 2);
  assert.deepEqual(first.position, [15, -500, 25]); assert.deepEqual(first.target, [15, -500, 2025]);
  assert.deepEqual(second, first); assert.equal(first.roll, .3);
});

test('unverified camera modes report unsupported instead of fabricating a camera', () => {
  const source = record(); source.cameraMovementType = 14;
  const result = cameraStudy(source, [0, 0, 0], 0); assert.equal(result.supported, false); assert.match(result.note, /not.*preview/i);
});
