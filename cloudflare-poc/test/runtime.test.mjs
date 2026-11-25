import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { authenticator } from './auth-fixture.mjs';
import { MAX_BODY } from '../src/state.js';

test('local workerd: HTTP adapter, DO restart, conflicts, rollback, WebAuthn and large state', { timeout: 180000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'opengym-poc-'));
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const base = 'http://127.0.0.1:' + port;
  let child, log = '';
  const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true' };
  for (const k of Object.keys(env)) if (/^(CLOUDFLARE_|CF_API_|CF_ACCOUNT_)/.test(k)) delete env[k];
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(base + path, { method, ...(body === undefined ? {} : {
      headers: { 'Content-Type': 'application/json', 'X-POC': 'fixture' }, body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30000) });
    const data = await res.json();
    console.log(method, path, res.status, 'local DO wall ms:', res.headers.get('x-poc-wall-ms'));
    return { status: res.status, data, cookies: res.headers.getSetCookie() };
  };
  async function start() {
    child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js','dev','--local','--ip','127.0.0.1',
      '--port',String(port),'--persist-to',dir], { env, detached: process.platform !== 'win32', stdio: ['ignore','pipe','pipe'] });
    child.stdout.on('data', b => { log = (log + b).slice(-20000); });
    child.stderr.on('data', b => { log = (log + b).slice(-20000); });
    for (let i=0; i<120; i++) {
      if (child.exitCode !== null) break;
      try { const res = await fetch(base + '/__poc/health', { signal: AbortSignal.timeout(1000) }); if (res.ok) return; } catch {}
      await sleep(500);
    }
    throw new Error('local Worker failed to start: ' + log);
  }
  async function stop() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM'); else child.kill();
    await Promise.race([exited, sleep(5000)]);
    if (child.exitCode === null && child.signalCode === null) {
      if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL');
      await exited;
    }
  }
  try {
    await start();
    assert.equal((await call('/api/data')).status,404);
    const echo = await call('/__poc/node?q=1','POST',{ hello:'node' });
    assert.equal(echo.status,200); assert.equal(echo.data.method,'POST'); assert.equal(echo.data.url,'/__poc/node?q=1');
    assert.equal(echo.data.header,'fixture'); assert.deepEqual(JSON.parse(echo.data.data),{hello:'node'});
    assert.equal(echo.cookies.length,2);
    const first = await call('/__poc/state','PUT',{baseRev:0,stamped:true,state:{workouts:[],routines:[],notes:'first'}});
    assert.equal(first.status,200);
    const contender = n => call('/__poc/state','PUT',{baseRev:first.data.rev,baseWid:first.data.wid,stamped:true,state:{workouts:[],notes:n}});
    const results = await Promise.all([contender('a'),contender('b')]);
    assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);
    const old = await call('/__poc/state');
    assert.equal((await call('/__poc/rollback','POST',{})).status,200);
    assert.deepEqual((await call('/__poc/state')).data,old.data);
    assert.equal((await call('/__poc/rev')).data.rev,old.data.rev);

    // Signed WebAuthn fixture; real verification, not a real phone/browser ceremony.
    const device = authenticator();
    const reg = await call('/__poc/register/options','POST',{});
    assert.equal(reg.status,200);
    const att = device.register(reg.data.challenge);
    assert.equal((await call('/__poc/register/verify','POST',att)).data.verified,true);
    assert.equal((await call('/__poc/register/verify','POST',att)).status,400);
    await stop(); await start(); // same disk, new workerd
    assert.deepEqual((await call('/__poc/state')).data,old.data);
    const auth = await call('/__poc/login/options','POST',{});
    const signed = device.login(auth.data.challenge);
    assert.equal((await call('/__poc/login/verify','POST',signed)).data.verified,true);
    assert.equal((await call('/__poc/login/verify','POST',signed)).status,400);
    const bad = await call('/__poc/login/options','POST',{});
    assert.equal(bad.status,200);
    assert.equal((await call('/__poc/login/verify','POST',device.login('wrong-challenge',2))).status,400);

    // Exercise near the existing 5 MiB request envelope; storage uses 512 KiB BLOB chunks.
    const large = {baseRev:old.data.rev,baseWid:old.data.wid,stamped:true,state:{workouts:[],routines:[],notes:'x'.repeat(MAX_BODY-1024)}};
    assert.ok(Buffer.byteLength(JSON.stringify(large)) > MAX_BODY-2048);
    assert.ok(Buffer.byteLength(JSON.stringify(large)) <= MAX_BODY);
    const saved = await call('/__poc/state','PUT',large);
    assert.equal(saved.status,200);
    assert.equal((await call('/__poc/state')).data.state.notes,large.state.notes);
    assert.equal((await call('/__poc/state','PUT',{...large,state:{notes:'x'.repeat(MAX_BODY)}})).status,413);
    await stop(); await start();
    assert.equal((await call('/__poc/state')).data.state.notes,large.state.notes);
    assert.equal((await call('/__poc/rev')).data.wid,saved.data.wid);
  } finally {
    await stop(); await rm(dir,{recursive:true,force:true});
    if (log) console.log('Wrangler tail:',log);
  }
});
