import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fixture,bodyOf,cookieOf,post,secret} from './auth-test-helpers.mjs';
import {authenticator} from './auth-fixture.mjs';
async function findDb(root){
  for(const entry of await readdir(root,{withFileTypes:true})){
    const p=join(root,entry.name);
    if(entry.isDirectory()){const result=await findDb(p);if(result)return result;}
    else if(entry.isFile()&&entry.name.endsWith('.sqlite')){
      const db=new DatabaseSync(p,{timeout:5000});
      try{const found=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_version'").get();if(found)return p;}finally{db.close();}
    }
  }
}
test('offline SQLite fault injection, expired challenges/codes, disabled account, bounded attempts',{timeout:180000},async()=>{
  const {runner,call,SETUP_CODE}=await fixture();const a=authenticator({rp:'localhost',origin:runner.origin});let counter=0;
  const proof=async()=>{const o=bodyOf(await post(call,'/api/login/options'));return {cid:o.cid,credential:a.login(o.options.challenge,++counter)};};
  const edit=async fn=>{await runner.stop();const p=await findDb(runner.dir);assert.ok(p,'auth SQLite file missing');const db=new DatabaseSync(p,{timeout:5000});try{fn(db);}finally{db.close();}await runner.start();};
  try{
    await runner.start();const o=bodyOf(await post(call,'/api/register/options',{name:'Fault fixture',code:SETUP_CODE}));
    const h=cookieOf(await post(call,'/api/register/verify',{cid:o.cid,credential:a.register(o.options.challenge)}));
    const initial=bodyOf(await call('/api/data','PUT',{baseRev:0,state:{workouts:[],routines:[],notes:'before'},stamped:true},h));
    const pair=bodyOf(await post(call,'/api/pair/create',await proof(),h)),expiring=await proof();
    await edit(db=>{db.exec('UPDATE auth_codes SET exp=0; UPDATE auth_challenges SET exp=0;');});
    assert.equal((await post(call,'/api/pair/redeem',{code:pair.code})).data.code,'pair-invalid');
    assert.equal((await post(call,'/api/login/verify',expiring)).data.code,'challenge-expired');
    await edit(db=>db.exec("CREATE TRIGGER test_fail_write BEFORE INSERT ON profile_state BEGIN SELECT RAISE(ABORT,'synthetic failure'); END; CREATE TRIGGER test_fail_delete BEFORE DELETE ON auth_users BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;"));
    assert.equal((await call('/api/data','PUT',{baseRev:initial.rev,baseWid:initial.wid,state:{workouts:[],notes:'after'}},h)).status,503);
    assert.equal((await call('/api/data','GET',undefined,h)).data.state.notes,'before');
    assert.equal((await post(call,'/api/account/delete',{name:'Fault fixture',...await proof()},h)).status,503);
    assert.equal((await call('/api/me','GET',undefined,h)).status,200);
    assert.equal((await call('/api/data','GET',undefined,h)).data.state.notes,'before');
    await edit(db=>db.exec('DROP TRIGGER test_fail_write; DROP TRIGGER test_fail_delete; UPDATE auth_users SET disabled=1;'));
    assert.equal((await call('/api/me','GET',undefined,h)).status,401);
    assert.equal((await post(call,'/api/login/verify',await proof())).status,403);
    await edit(db=>db.exec('UPDATE auth_users SET disabled=0; DELETE FROM auth_limits;'));
    // Set the local bucket to its limit; no mass request loop or public endpoint is needed.
    // The limiter resets at minute boundaries. Seed and restart can straddle
    // one; a response in another window is not evidence about the seeded bucket.
    // Retry only an observed window transition, never a same-window mismatch.
    // CI 46130587524 observed a restart rollover, then the seeded-window
    // 429 assertion passed. Keep this boundary guard, not a generic retry.
    let checked=false;
    for(let attempt=0;attempt<3;attempt++){
      let seeded;
      await edit(db=>{
        seeded=Math.floor(Date.now()/60000);
        db.prepare("INSERT OR REPLACE INTO auth_limits VALUES('anonymous',?,60)").run(seeded);
      });
      const before=Math.floor(Date.now()/60000);
      if(before!==seeded){console.log('PHASE7_AUTH_LIMIT_WINDOW_TRANSITION restart');continue;}
      const response=await post(call,'/api/login/options');
      const after=Math.floor(Date.now()/60000);
      if(after!==seeded){console.log('PHASE7_AUTH_LIMIT_WINDOW_TRANSITION request');continue;}
      assert.equal(response.status,429);
      checked=true;break;
    }
    assert.ok(checked,'could not qualify rate limit in the seeded minute window');
    console.log('PHASE7_AUTH_LIMIT_SEEDED_WINDOW PASS');
    await edit(db=>{
      db.exec('DELETE FROM auth_limits; DELETE FROM auth_challenges;');
      const insert=db.prepare('INSERT INTO auth_challenges VALUES(?,?,?)');
      for(let i=0;i<256;i++)insert.run('synthetic-'+i,'{}',Date.now()+300000);
    });
    assert.equal((await post(call,'/api/login/options')).status,429);
    await edit(db=>{
      assert.equal(db.prepare('SELECT count(*) AS n FROM auth_challenges').get().n,256);
      assert.deepEqual(db.prepare('SELECT name FROM pragma_table_info(\'auth_audit\') ORDER BY cid').all().map(x=>x.name),['id','event','at']);
      assert.ok(db.prepare('SELECT count(*) AS n FROM auth_audit').get().n<=256);
      assert.ok(db.prepare('SELECT event FROM auth_audit').all().every(x=>/^[a-z-]+$/.test(x.event)));
      db.exec('DELETE FROM auth_challenges; DELETE FROM auth_limits;');
    });
    assert.equal((await post(call,'/api/account/delete',{name:'Fault fixture',...await proof()},h)).status,200);
    await runner.stop();const p=await findDb(runner.dir);assert.ok(p);const db=new DatabaseSync(p,{timeout:5000});
    try{for(const t of ['auth_users','auth_creds','auth_codes','auth_challenges','profile_state','profile_chunks','corrupt_profiles'])assert.equal(db.prepare('SELECT count(*) AS n FROM '+t).get().n,0,t);assert.equal(db.prepare('SELECT closed FROM auth_version WHERE id=1').get().closed,1);}finally{db.close();}
    console.log('PHASE3_AUTH_FAULT_ROLLBACK PASS');
  }finally{await runner.cleanup();}
});

test('auth schema rejection and signing-key rotation preserve state, invalidate proofs and sessions',{timeout:180000},async()=>{
  let signing=secret();const setup=secret();
  const {runner,call}=await fixture({allowUnavailable:true,vars:()=>({AUTH_SECRET:signing,SETUP_CODE:setup})});
  const dev=authenticator({rp:'localhost',origin:runner.origin});let counter=0;
  const proof=async()=>{const o=bodyOf(await post(call,'/api/login/options'));return {cid:o.cid,credential:dev.login(o.options.challenge,++counter)};};
  const edit=async fn=>{await runner.stop();const p=await findDb(runner.dir);assert.ok(p);const db=new DatabaseSync(p,{timeout:5000});try{fn(db);}finally{db.close();}};
  try{
    await runner.start();
    const opts=bodyOf(await post(call,'/api/register/options',{name:'Rotation fixture',code:setup}));
    let h=cookieOf(await post(call,'/api/register/verify',{cid:opts.cid,credential:dev.register(opts.options.challenge)}));
    const state={workouts:[],routines:[],notes:'survives rotation'};
    const saved=bodyOf(await call('/api/data','PUT',{baseRev:0,state,stamped:true},h));
    const pair=bodyOf(await post(call,'/api/pair/create',await proof(),h));
    const link=bodyOf(await post(call,'/api/account/device-link',await proof(),h));
    const pending=await proof();
    await runner.stop();signing=secret();await runner.start();
    assert.equal((await call('/api/me','GET',undefined,h)).status,401);
    assert.equal((await post(call,'/api/login/verify',pending)).data.code,'challenge-expired');
    assert.equal((await post(call,'/api/pair/redeem',{code:pair.code})).data.code,'pair-invalid');
    assert.equal((await post(call,'/api/device-link/options',{code:link.code})).data.code,'link-invalid');
    h=cookieOf(await post(call,'/api/login/verify',await proof()));
    assert.equal(bodyOf(await call('/api/data','GET',undefined,h)).state.notes,state.notes);
    assert.equal(bodyOf(await call('/api/data/rev','GET',undefined,h)).wid,saved.wid);
    await edit(db=>db.exec('UPDATE auth_version SET version=99'));await runner.start();
    assert.equal((await call('/api/health')).status,503);assert.equal((await call('/api/data','GET',undefined,h)).status,503);
    await edit(db=>{assert.equal(db.prepare('SELECT version FROM auth_version').get().version,99);db.exec('UPDATE auth_version SET version=1');});
    await runner.start();assert.equal(bodyOf(await call('/api/data','GET',undefined,h)).state.notes,state.notes);
    console.log('PHASE3_AUTH_ROTATION_SCHEMA PASS');
  }finally{await runner.cleanup();}
});
