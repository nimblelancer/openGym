// AGPL-3.0-or-later. Synthetic test harness, not an openGym server.
import { DurableObject } from 'cloudflare:workers';
import { generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { MAX_BODY, encodeChunks, decodeChunks, makeNext } from './state.js';

const RP_ID = 'poc.invalid';
const ORIGIN = 'https://poc.invalid'; // synthetic authenticator only
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const allowed = new Set(['GET /__poc/health','GET /__poc/state','PUT /__poc/state',
  'GET /__poc/rev','POST /__poc/rollback','POST /__poc/register/options','POST /__poc/register/verify',
  'POST /__poc/login/options','POST /__poc/login/verify']);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // No app routes, public deploy or real data. Wrangler binds loopback only.
    if (!['localhost','127.0.0.1'].includes(url.hostname)) return json({ error: 'local only' }, 403);
    const key = request.method + ' ' + url.pathname;
    if (!allowed.has(key)) return json({ error: 'not found' }, 404);
    // Do not parse state or run expensive cryptography in the thin Worker.
    return env.POC.get(env.POC.idFromName('synthetic-v1')).fetch(request);
  }
};

async function boundedJson(request, limit) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('missing body');
  const parts = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new RangeError('body too large'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const p of parts) { bytes.set(p, offset); offset += p.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
export class PocStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.storage = ctx.storage;
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS chunks (idx INTEGER PRIMARY KEY, bytes BLOB NOT NULL)');
  }
  get(key) {
    const row = this.sql.exec('SELECT value FROM meta WHERE key = ?', key).toArray()[0];
    return row ? JSON.parse(row.value) : null;
  }
  put(key, value) {
    this.sql.exec('INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)', key, JSON.stringify(value));
  }
  readState() {
    const rows = this.sql.exec('SELECT bytes FROM chunks ORDER BY idx').toArray();
    return rows.length ? decodeChunks(rows.map(r => r.bytes)) : null;
  }
  saveState(next) {
    this.sql.exec('DELETE FROM chunks');
    encodeChunks(next).forEach((bytes, i) => this.sql.exec('INSERT INTO chunks(idx,bytes) VALUES (?,?)', i, bytes));
    this.put('revision', { rev: next._rev, wid: next._wid });
  }
  async fetch(request) {
    const key = request.method + ' ' + new URL(request.url).pathname;
    const start = performance.now();
    const timed = (body, status = 200) => {
      const res = json(body, status);
      res.headers.set('X-POC-Wall-Ms', String(performance.now() - start));
      return res;
    };
    try {
      if (key === 'GET /__poc/health') return timed({ ok: true, synthetic: true });
      if (key === 'GET /__poc/rev') return timed(this.get('revision') || { rev: 0 });
      if (key === 'GET /__poc/state') return timed({ state: this.readState(), ...(this.get('revision') || { rev: 0 }) });
      if (key === 'PUT /__poc/state') {
        let body;
        try { body = await boundedJson(request, MAX_BODY); }
        catch (e) { return timed({ error: 'invalid body' }, e instanceof RangeError ? 413 : 400); }
        const result = this.storage.transactionSync(() => {
          const result = makeNext(this.readState(), body, crypto.randomUUID());
          if (result.next) this.saveState(result.next);
          return result;
        });
        return timed(result.body, result.status);
      }
      if (key === 'POST /__poc/rollback') {
        try {
          this.storage.transactionSync(() => {
            this.sql.exec('DELETE FROM chunks');
            this.put('revision', { rev: -1 });
            throw new Error('synthetic rollback');
          });
        } catch (e) { if (e.message !== 'synthetic rollback') throw e; }
        return timed({ rolledBack: true });
      }
      if (key === 'POST /__poc/register/options') {
        const options = await generateRegistrationOptions({ rpName: 'Synthetic POC', rpID: RP_ID,
          userName: 'synthetic', userID: new Uint8Array([1]), attestationType: 'none',
          supportedAlgorithmIDs: [-7], authenticatorSelection: { userVerification: 'required' } });
        this.put('regChallenge', options.challenge);
        return timed(options);
      }
      if (key === 'POST /__poc/login/options') {
        const credential = this.get('credential');
        if (!credential) return timed({ error: 'no fixture credential' }, 409);
        const options = await generateAuthenticationOptions({ rpID: RP_ID, userVerification: 'required',
          allowCredentials: [{ id: credential.id }] });
        this.put('loginChallenge', options.challenge);
        return timed(options);
      }
      if (key === 'POST /__poc/register/verify' || key === 'POST /__poc/login/verify') {
        const response = await boundedJson(request, 64 * 1024);
        const registration = key.includes('/register/');
        const name = registration ? 'regChallenge' : 'loginChallenge';
        const challenge = this.storage.transactionSync(() => {
          const value = this.get(name);
          this.sql.exec('DELETE FROM meta WHERE key = ?', name);
          return value;
        });
        if (!challenge) return timed({ verified: false }, 400);
        try {
          if (registration) {
            const result = await verifyRegistrationResponse({ response, expectedChallenge: challenge,
              expectedOrigin: ORIGIN, expectedRPID: RP_ID, requireUserVerification: true });
            if (!result.verified) return timed({ verified: false }, 400);
            const c = result.registrationInfo.credential;
            this.put('credential', { id: c.id, publicKey: Array.from(c.publicKey), counter: c.counter });
          } else {
            const c = this.get('credential');
            const result = await verifyAuthenticationResponse({ response, expectedChallenge: challenge,
              expectedOrigin: ORIGIN, expectedRPID: RP_ID, requireUserVerification: true,
              credential: { ...c, publicKey: new Uint8Array(c.publicKey) } });
            if (!result.verified) return timed({ verified: false }, 400);
            this.put('credential', { ...c, counter: result.authenticationInfo.newCounter });
          }
          return timed({ verified: true });
        } catch { return timed({ verified: false }, 400); }
      }
      return timed({ error: 'not found' }, 404);
    } catch (e) {
      console.error('POC failure', e.name, e.message);
      return timed({ error: 'poc failure' }, 500);
    }
  }
}
