import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fixture,bodyOf,cookieOf,post} from './auth-test-helpers.mjs';
import {authenticator} from './auth-fixture.mjs';
async function findDb(root){
  for(const entry of await readdir(root,{withFileTypes:true})){
    const p=join(root,entry.name);
    if(entry.isDirectory()){const result=await findDb(p);if(result)return result;}
    else if(entry.isFile()&&entry.name.endsWith('.sqlite')){
      const db=new DatabaseSync(p);
      const found=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_version'").get();
      db.close();if(found)return p;
    }
  }
}
test('offline SQLite fault injection, expired challenges/codes, disabled account, bounded attempts',{timeout:180000},async()=>{
  const {runner,call,SETUP_CODE}=await fixture();const a=authenticator({rp:'localhost',origin:runner.origin});let counter=0;
  const proof=async()=>{const o=bodyOf(await post(call,'/api/login/options'));return {cid:o.cid,credential:a.login(o.options.challenge,++counter)};};
  const edit=async fn=>{await runner.stop();const p=await findDb(runner.dir);assert.ok(p,'auth SQLite file missing');const db=new DatabaseSync(p);try{fn(db);}finally{db.close();}await runner.start();};
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
    const fixed=Math.floor(Date.now()/60000);
    // Set the local bucket to its limit; no mass request loop or public endpoint is needed.
    await edit(db=>db.prepare("INSERT OR REPLACE INTO auth_limits VALUES('anonymous',?,60)").run(Math.floor(Date.now()/60000)));
    assert.equal((await post(call,'/api/login/options')).status,429);
    await edit(db=>db.exec('DELETE FROM auth_limits;'));
    assert.equal((await post(call,'/api/account/delete',{name:'Fault fixture',...await proof()},h)).status,200);
    await runner.stop();const p=await findDb(runner.dir),db=new DatabaseSync(p);
    try{for(const t of ['auth_users','auth_creds','auth_codes','auth_challenges','profile_state','profile_chunks','corrupt_profiles'])assert.equal(db.prepare('SELECT count(*) AS n FROM '+t).get().n,0,t);assert.equal(db.prepare('SELECT closed FROM auth_version WHERE id=1').get().closed,1);}finally{db.close();}
    console.log('PHASE3_AUTH_FAULT_ROLLBACK PASS');
  }finally{await runner.cleanup();}
});
