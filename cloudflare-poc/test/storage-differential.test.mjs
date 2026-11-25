import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac,randomBytes } from 'node:crypto';
import { mkdtemp,writeFile,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { boundPort } from '../../api/test/helpers.mjs';
import { localRunner } from './local-runner.mjs';
import { mergeStates, stampChange, resetIdsOf } from '../../frontend/src/lib/sync-merge.js';
const fixed=1800000000000, uid='fixture_alpha';
test('actual pinned Node backend vs Phase 2 Worker: wire and stored state differential',{timeout:180000},async()=>{
  const dir=await mkdtemp(join(tmpdir(),'opengym-diff-')),secret=randomBytes(32).toString('hex');
  const runner=await localRunner('wrangler.storage.jsonc');let child;
  try{
    await writeFile(join(dir,'secret'),secret,{mode:0o600});
    await writeFile(join(dir,'db.json'),JSON.stringify({users:[{id:uid,name:'Synthetic',created:new Date(fixed).toISOString()}],creds:[],subs:[],invites:[]}));
    const preload=join(dir,'clock.mjs');await writeFile(preload,'Date.now=()=>1800000000000;');
    child=spawn(process.execPath,['--import',preload,'server.js'],{cwd:resolve('../api'),env:{...process.env,PORT:'0',DATA_DIR:dir,ORIGIN:'http://localhost:8080',RP_ID:'localhost'},stdio:['ignore','pipe','pipe']});
    let log='';child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);
    const origin='http://127.0.0.1:'+await boundPort(child,()=>log);
    const p=uid+':'+(fixed+86400000)+':0',cookie='gymsid='+p+'.'+createHmac('sha256',secret).update(p).digest('base64url');
    const callNode=async(path,method='GET',body)=>{const r=await fetch(origin+path,{method,headers:{cookie,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});return {status:r.status,data:await r.json()};};
    await runner.start();
    const cf=(op='state',method='GET',body)=>runner.call('/__storage/alpha/'+op,method,body);
    const strip=r=>({status:r.status,data:r.data});
    const ids=new Map();const normalize=v=>{
      if(typeof v==='string')return ids.get(v)||v;
      if(Array.isArray(v))return v.map(normalize);
      if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,normalize(x)]));
      return v;
    };
    const check=async()=>{
      const node=await callNode('/api/data'),worker=await cf();
      assert.deepEqual(normalize(strip(node)),strip(worker));
      assert.deepEqual(normalize(strip(await callNode('/api/data/rev'))),strip(await cf('rev')));
      if(node.data.state){const disk=JSON.parse(await readFile(join(dir,'state-'+uid+'.json'),'utf8'));
        assert.deepEqual(normalize(disk),(await cf('inspect')).data.state);}
    };
    await check();
    const fixtures=[
      {baseRev:0,state:{_ts:100,workouts:[{id:'w1',d:'2026-09-01'},null,1],routines:[],active:{id:'local'},extra:'legacy'}},
      {baseRev:0,state:{workouts:[]}},
      {baseRev:1,baseWid:'wrong',state:{workouts:[]}},
      {state:{_ts:200,workouts:[{id:'w2',d:'2026-09-02'}],routines:[],resetAt:5000,resetIds:{workouts:['w1']}}},
      {baseRev:2,state:{_ts:300,workouts:[],routines:[],resetAt:10}},
      {baseRev:null,state:{_ts:400,workouts:[],routines:[],newField:'new'}},
      {baseRev:'4',state:{workouts:[]}},
      {state:{}},{state:[]},{state:{workouts:'bad'}},{state:{_rev:2,_ts:3}},
      {state:{workouts:[],routines:[],edited:{restSec:1},restSec:100}},
      {state:{workouts:[],routines:[],restSec:120},stamped:true}
    ];
    for(const body of fixtures){
      const a=await callNode('/api/data','PUT',body),b=await cf('state','PUT',normalize(body));
      if(a.status===200){assert.match(a.data.wid,/^[a-f0-9]{16}$/);assert.match(b.data.wid,/^[a-f0-9]{16}$/);ids.set(a.data.wid,b.data.wid);}
      assert.deepEqual(normalize(strip(a)),strip(b));await check();
    }
    // A legacy writer over the current revision omits a retained unknown field. Compare actual
    // stored/returned revision rather than assuming both advance by one.
    const seeded={state:{_ts:450,workouts:[],routines:[],futureStorageField:{kept:true}},stamped:true};
    const seedNode=await callNode('/api/data','PUT',seeded),seedWorker=await cf('state','PUT',seeded);
    assert.equal(seedNode.status,200);assert.equal(seedWorker.status,200);ids.set(seedNode.data.wid,seedWorker.data.wid);await check();
    const cur=await callNode('/api/data');const rev=cur.data.rev;
    const body={baseRev:rev,baseWid:cur.data.state._wid,state:{_ts:500,workouts:[],routines:[]}};
    const a=await callNode('/api/data','PUT',body),b=await cf('state','PUT',normalize(body));
    assert.equal(a.status,200);assert.equal(b.status,200);ids.set(a.data.wid,b.data.wid);
    assert.deepEqual(normalize(strip(a)),strip(b));await check();
    const stored=await callNode('/api/data/rev');assert.equal(stored.data.rev,a.data.rev+1);
    assert.deepEqual((await cf()).data.state.futureStorageField,{kept:true});
    console.log('PHASE2_DIFFERENTIAL_REV',a.data.rev,stored.data.rev);

    // Use the real client merge against both stores, asserting wire and full disk parity at
    // every accepted or rejected write. No mocked merge and no actual account data.
    const read=async()=> (await callNode('/api/data')).data;
    const send=async (body,status=200)=>{
      const n=await callNode('/api/data','PUT',body),w=await cf('state','PUT',normalize(body));
      assert.equal(n.status,status);assert.equal(w.status,status);
      if(status===200){assert.match(n.data.wid,/^[a-f0-9]{16}$/);assert.match(w.data.wid,/^[a-f0-9]{16}$/);ids.set(n.data.wid,w.data.wid);}
      assert.deepEqual(normalize(strip(n)),strip(w));await check();return n;
    };
    const putCurrent=(copy,state)=>send({baseRev:copy.rev,baseWid:copy.state._wid,stamped:true,state});
    const change=(s,at,fn)=>{const next=structuredClone(s);fn(next);next._ts=stampChange(s,next,at);return next;};
    const workout=(id,at)=>({id,d:'2026-09-01',start:at-10,end:at,entries:[]});
    const day='2026-09-01',t=fixed+10000;
    const prior=await read();
    await putCurrent(prior,{...prior.state,unit:'kg',workouts:[workout('delete-w',t)],routines:[{id:'delete-r',name:'Synthetic',ex:[],_ts:t}],bodyweight:[{d:day,w:80,t}],measurements:[{d:day,waist:80,t}],favEx:['0025'],_ts:t});
    const common=await read();
    const removal=change(common.state,t+100, s=>{s.workouts=[];s.routines=[];s.bodyweight=[];s.measurements=[];s.favEx=[];});
    const offline=change(common.state,t+200,s=>{s.restSec=137;s.workouts.push(workout('offline-new',t+200));});
    await putCurrent(common,removal);
    const deleted=await read();
    for(const [field,key] of [['workouts','delete-w'],['routines','delete-r'],['bodyweight',day],['measurements',day],['favEx','0025']])assert.ok(deleted.state.deleted[field][key]>0,field);
    const reject=await send({baseRev:common.rev,baseWid:common.state._wid,stamped:true,state:offline},409);
    assert.equal(reject.data.rev,deleted.rev);
    assert.equal(Object.hasOwn(reject.data.state,'_unstamped'),false);assert.equal(Object.hasOwn(reject.data.state,'_prior'),false);
    const merged=mergeStates(offline,reject.data.state);
    await putCurrent(deleted,merged);
    const settled=await read();
    assert.deepEqual(settled.state.workouts.map(w=>w.id),['offline-new']);
    for(const field of ['routines','bodyweight','measurements','favEx'])assert.deepEqual(settled.state[field]||[],[],field);
    assert.equal(settled.state.restSec,137);
    // Intentional add-back must not be undone by a stale deletion record.
    const addback=change(settled.state,t+300,s=>{s.workouts.push(workout('delete-w',t));s.routines.push({id:'delete-r',name:'Restored',ex:[]});});
    await putCurrent(settled,addback);
    const added=await read();
    assert.ok(added.state.deleted.workouts['delete-w']<0);assert.ok(added.state.deleted.routines['delete-r']<0);
    const addbackMerged=mergeStates(added.state,deleted.state);
    assert.ok(addbackMerged.workouts.some(w=>w.id==='delete-w'));assert.ok(addbackMerged.routines.some(w=>w.id==='delete-r'));
    // Persist a named reset, then reconcile a stale phone with a new, backdated workout.
    const resetAt=t+400,resetIds=resetIdsOf(added.state);
    await putCurrent(added,{unit:'kg',workouts:[],routines:[],bodyweight:[],measurements:[],favEx:[],resetAt,resetIds,_ts:resetAt});
    const reset=await read();assert.equal(reset.state.resetAt,resetAt);assert.deepEqual(reset.state.resetIds,resetIds);
    const stale={...structuredClone(added.state),_ts:resetAt+50};stale.workouts.push(workout('post-reset-skewed',t-500));
    const staleResult=await send({baseRev:added.rev,baseWid:added.state._wid,stamped:true,state:stale},409);
    const afterReset=mergeStates(stale,staleResult.data.state);
    await putCurrent(reset,afterReset);
    const after=await read();assert.deepEqual(after.state.workouts.map(w=>w.id),['post-reset-skewed']);assert.deepEqual(after.state.routines||[],[]);
    assert.equal(after.state.resetAt,resetAt);assert.deepEqual(after.state.resetIds,resetIds);
    // A legacy replacement without a reset stamp must not roll it back; newer reset wins.
    const legacy=structuredClone(after.state);delete legacy.resetAt;delete legacy.resetIds;
    await send({state:legacy});const held=await read();assert.equal(held.state.resetAt,resetAt);assert.deepEqual(held.state.resetIds,resetIds);
    await putCurrent(held,{unit:'kg',workouts:[],routines:[],resetAt:resetAt+100,resetIds:resetIdsOf(held.state),_ts:resetAt+100});
    const final=await read();assert.equal(final.state.resetAt,resetAt+100);assert.deepEqual(final.state.workouts,[]);
    // Reopen local persistent storage; compare the same full document and revision to Node.
    await runner.stop();await runner.start();await check();
    console.log('PHASE2_DELETION_RESET_PARITY PASS');

  }finally{await runner.cleanup();if(child&&child.exitCode===null){const done=once(child,'exit');child.kill('SIGKILL');await done;}await rm(dir,{recursive:true,force:true});}
});
