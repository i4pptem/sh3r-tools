import test from 'node:test';
import assert from 'node:assert/strict';
import {safeOutput} from '../core/binary.mjs';
test('Reject path traversal', () => assert.throws(() => safeOutput('C:/output', '../escape')));
