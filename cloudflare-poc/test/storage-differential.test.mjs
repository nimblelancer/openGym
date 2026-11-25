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
    const cur=await callNode('/api/data');const rev=cur.data.rev;
    const body={baseRev:rev,baseWid:cur.data.state._wid,state:{_ts:500,workouts:[],routines:[]}};
    const a=await callNode('/api/data','PUT',body),b=await cf('state','PUT',normalize(body));
    assert.equal(a.status,200);assert.equal(b.status,200);ids.set(a.data.wid,b.data.wid);
    assert.deepEqual(normalize(strip(a)),strip(b));await check();
    console.log('PHASE2_DIFFERENTIAL_REV',a.data.rev,(await callNode('/api/data/rev')).data.rev);
  }finally{await runner.cleanup();if(child&&child.exitCode===null){const done=once(child,'exit');child.kill('SIGKILL');await done;}await rm(dir,{recursive:true,force:true});}
});
