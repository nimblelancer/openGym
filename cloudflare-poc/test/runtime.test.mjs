import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authenticator } from './auth-fixture.mjs';
import { MAX_BODY } from '../src/state.js';
import { localRunner } from './local-runner.mjs';

test('local workerd: Fetch/DO restart, conflicts, rollback, WebAuthn and large state', { timeout: 180000 }, async () => {
  const runner = await localRunner();
  const { start, stop, call } = runner;
  try {
    await start();
    assert.equal((await call('/api/data')).status,404);
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
    await runner.cleanup();
  }
});
