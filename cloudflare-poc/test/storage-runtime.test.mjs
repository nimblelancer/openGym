import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { localRunner } from './local-runner.mjs';
import { MAX_BODY } from '../src/storage/codec.js';
import { mergeStates, stampChange } from '../../frontend/src/lib/sync-merge.js';
const workout=id=>({id,d:'2026-09-01',start:1,entries:[]});
const base={unit:'kg',restSec:90,lang:'en',workouts:[],routines:[],bodyweight:[],customEx:[],favEx:[],exWeights:{},exNotes:{},week:{},_ts:1};
test('Phase 2 local DO: transactions, actual client merge, corruption, schema, import and restart',{timeout:180000},async()=>{
  const runner=await localRunner('wrangler.storage.jsonc');const {call,start,stop}=runner;
  const route=(id,op='state')=>'/__storage/'+id+'/'+op;
  const get=(id,op='state')=>call(route(id,op));
  const put=(id,body)=>call(route(id),'PUT',body);
  const rev=id=>get(id,'rev');
  try{
    await start();
    assert.equal((await call('/api/data')).status,404);
    assert.equal((await get('not-a-fixture')).status,404);
    assert.deepEqual((await get('alpha')).data,{state:null,rev:0});
    assert.deepEqual((await rev('alpha')).data,{rev:0});
    assert.equal((await call(route('schema','schema'),'POST',{})).data.rejected,true);
    let first=await put('alpha',{baseRev:0,stamped:true,state:base});assert.equal(first.status,200);assert.match(first.data.wid,/^[0-9a-f]{16}$/);
    const cur=(await get('alpha')).data.state;
    const a={...structuredClone(cur),workouts:[workout('a')]};
    const b={...structuredClone(cur),workouts:[workout('b')]};
    a._ts=stampChange(cur,a,1800000000001); b._ts=stampChange(cur,b,1800000000002);
    // stampChange mutates state and returns its timestamp; use actual upstream merge.
    const results=await Promise.all([a,b].map(state=>put('alpha',{baseRev:1,baseWid:first.data.wid,stamped:true,state})));
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    const loser=results.findIndex(r=>r.status===409),conflict=results[loser].data;
    const merged=mergeStates([a,b][loser],conflict.state);
    const retry=await put('alpha',{baseRev:conflict.rev,baseWid:conflict.state._wid,stamped:true,state:merged});assert.equal(retry.status,200);
    const old=(await get('alpha')).data;
    assert.deepEqual(old.state.workouts.map(w=>w.id).sort(),['a','b']);
    assert.equal((await put('alpha',{baseRev:old.rev,baseWid:'stale',state:base})).status,409);
    for(const state of [{},[],{workouts:'x'},{_ts:4}] )assert.equal((await put('alpha',{state})).status,400);
    for(const fault of ['chunk','metadata']){
      assert.equal((await call(route('alpha','fault'),'POST',{fault,body:{baseRev:old.rev,baseWid:old.state._wid,state:{...base,notes:'x'}}})).status,503);
      assert.deepEqual((await get('alpha')).data,old);
    }
    const m0=(await get('alpha','metrics')).data;
    assert.equal((await rev('alpha')).data.rev,old.rev);
    const m1=(await get('alpha','metrics')).data;assert.equal(m1.chunkQueries,m0.chunkQueries);assert.ok(m1.metaQueries>m0.metaQueries);
    assert.deepEqual((await get('beta')).data,{state:null,rev:0});
    assert.equal((await put('beta',{state:{...base,notes:'private beta'}})).status,200);
    assert.deepEqual((await get('alpha')).data,old);
    const big={baseRev:old.rev,baseWid:old.state._wid,stamped:true,state:{...base,notes:'x'.repeat(MAX_BODY-2048)}};
    assert.ok(Buffer.byteLength(JSON.stringify(big))>MAX_BODY-4096);
    const large=await put('alpha',big);assert.equal(large.status,200);
    assert.equal((await get('alpha')).data.state.notes,big.state.notes);
    assert.equal((await put('alpha',{state:{notes:'x'.repeat(MAX_BODY)}})).status,413);
    console.log('PHASE2_STORAGE_METRICS_BEFORE_RESTART',JSON.stringify((await get('alpha','metrics')).data));
    await stop();await start();
    assert.equal((await get('alpha')).data.state.notes,big.state.notes);
    assert.equal((await rev('alpha')).data.wid,large.data.wid);
    assert.equal((await put('alpha',{state:{...base,notes:'short'},stamped:true})).status,200);
    assert.equal((await get('alpha')).data.state.notes,'short'); // decode verifies no stale chunks
    for(const id of ['corrupt','meta']){
      assert.equal((await put(id,{state:base})).status,200);
      assert.equal((await call(route(id,'damage'),'POST',{})).status,200);
      assert.equal((await get(id)).status,503);
      assert.equal((await rev(id)).status,503);
      assert.equal((await put(id,{state:base})).status,503);
    }
    // Upstream legacy stamping can expand two individually valid writes beyond the storage cap.
    const bigLegacy={...base,legacyHuge:'x'.repeat(5*1024*1024-2048)};
    const betaWrite=await put('beta',{state:bigLegacy,stamped:true});assert.equal(betaWrite.status,200);
    const betaRev=await rev('beta');
    const expanded=await put('beta',{baseRev:betaRev.data.rev,baseWid:betaRev.data.wid,state:{...base,newHuge:'x'.repeat(4*1024*1024)}});
    assert.equal(expanded.status,413);
    assert.deepEqual((await rev('beta')).data,betaRev.data);
    assert.equal((await get('beta')).data.state.legacyHuge,bigLegacy.legacyHuge);
    const state={...base,_rev:9,_wid:'1234567890abcdef',_wids:['0000000000000001'],resetAt:12,resetIds:{workouts:['old']},deleted:{workouts:{old:12}}};
    const digest=createHash('sha256').update(JSON.stringify(state)).digest('hex');
    const snapshot={schema:1,profile:'seed',state,digest};
    const imp=(mode,s=snapshot,fault)=>call(route('seed','import'),'POST',{mode,snapshot:s,fault});
    assert.equal((await imp('seed-dry-run')).data.dryRun,true);
    assert.deepEqual((await get('seed')).data,{state:null,rev:0});
    assert.equal((await imp('seed',{...snapshot,digest:'0'.repeat(64)})).status,400);
    assert.equal((await imp('seed',{...snapshot,profile:'alpha'})).status,400);
    assert.equal((await imp('seed',snapshot,'chunk')).status,503);
    assert.deepEqual((await get('seed')).data,{state:null,rev:0});
    assert.equal((await imp('seed')).status,200);
    assert.deepEqual((await get('seed','inspect')).data.state,state);
    assert.equal((await imp('seed')).data.identical,true);
    assert.deepEqual((await get('seed','export')).data,snapshot);
    assert.equal((await get('schema','export')).status,404);
    assert.equal((await get('corrupt','export')).status,503);
    const newer={...state,_rev:10};const changed={...snapshot,state:newer,digest:createHash('sha256').update(JSON.stringify(newer)).digest('hex')};
    assert.equal((await imp('seed',changed)).status,409);
    assert.equal((await imp('restore',changed)).status,400);
    await stop();await start();
    assert.deepEqual((await get('seed','inspect')).data.state,state);
    assert.equal((await get('corrupt')).status,503);
    assert.equal((await rev('meta')).status,503);
    console.log('PHASE2_STORAGE_METRICS',JSON.stringify((await get('alpha','metrics')).data));
  }finally{await runner.cleanup();}
});
