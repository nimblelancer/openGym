import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeChunks, decodeChunks, makeNext, CHUNK_BYTES } from '../src/state.js';
test('UTF-8 chunk boundaries and large fixture', () => {
  const state = { notes: '語🏋️'.repeat(500000) };
  const chunks = encodeChunks(state);
  assert.ok(chunks.length > 2);
  assert.ok(chunks.every(c => c.byteLength <= CHUNK_BYTES));
  assert.deepEqual(decodeChunks(chunks.map(c => c.buffer)), state);
});
test('revision and write-id guards, active omitted, empty rejected', () => {
  const first = makeNext(null, { baseRev: 0, state: { workouts: [], active: { test: true } }, stamped: true }, 'a');
  assert.equal(first.status, 200);
  assert.equal(first.next._rev, 1);
  assert.equal(first.next.active, undefined);
  assert.equal(makeNext(first.next, { baseRev: 0, state: { workouts: [] } }, 'b').status, 409);
  assert.equal(makeNext(first.next, { baseRev: 1, baseWid: 'wrong', state: { workouts: [] } }, 'b').status, 409);
  assert.equal(makeNext(first.next, { baseRev: 1, baseWid: 'a', state: {} }, 'b').status, 400);
});
