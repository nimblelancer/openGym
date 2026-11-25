// Phase 1 experiment only. Not the production state API.
import { stampPut } from '../../api/sync-stamps.js';

export const MAX_BODY = 5 * 1024 * 1024;
export const CHUNK_BYTES = 512 * 1024;
export function encodeChunks(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const chunks = [];
  for (let i = 0; i < bytes.length; i += CHUNK_BYTES) chunks.push(bytes.slice(i, i + CHUNK_BYTES));
  return chunks;
}
export function decodeChunks(chunks) {
  const size = chunks.reduce((n, b) => n + b.byteLength, 0);
  const all = new Uint8Array(size);
  let offset = 0;
  for (const b of chunks) { all.set(new Uint8Array(b.buffer ?? b, b.byteOffset ?? 0, b.byteLength), offset); offset += b.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(all));
}
export function makeNext(cur, body, wid) {
  const state = body?.state;
  if (!state || typeof state !== 'object' || Array.isArray(state) ||
      !Object.keys(state).some(k => k !== '_rev' && k !== '_ts') ||
      ['workouts','routines'].some(k => state[k] != null && !Array.isArray(state[k]))) {
    return { status: 400, body: { error: 'invalid state' } };
  }
  const rev = cur?._rev || 0;
  if (body.baseRev !== rev || (cur?._wid && body.baseWid !== cur._wid)) {
    return { status: 409, body: { error: 'conflict', rev, state: cur } };
  }
  const next = structuredClone(state);
  delete next.active;
  const report = {};
  stampPut(cur, next, { overRead: true, stamped: body.stamped === true, report });
  next._rev = rev + (report.changed ? 2 : 1);
  next._wid = wid;
  next._wids = [...(cur?._wids || []), ...(cur?._wid ? [cur._wid] : [])].slice(-50);
  return { status: 200, body: { ok: true, rev: rev + 1, wid }, next };
}
