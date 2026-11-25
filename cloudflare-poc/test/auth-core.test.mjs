import {test} from 'node:test';
import assert from 'node:assert/strict';
import {authenticator} from './auth-fixture.mjs';
import {Presence} from '../src/auth/presence.js';
import {config,issue,parse,cookies,TTL,mac} from '../src/auth/session.js';
import {secret,fixture,bodyOf,cookieOf,post} from './auth-test-helpers.mjs';
test('session primitives: secret validation, expiry, kind, MAC, HTTPS cookies',()=>{
  assert.throws(()=>config({}));
  const c=config({AUTH_SECRET:secret(),SETUP_CODE:secret(),API_ORIGIN:'https://localhost',RP_ID:'localhost'}),u={id:'abcdefghijklmnop',sv:2};
  const t=issue(c,u,'b',1000);assert.deepEqual(parse(c,t,1001),{uid:u.id,exp:1000+TTL,sv:2,kind:'b'});
  assert.equal(parse(c,t,1000+TTL),null);assert.equal(parse(c,t+'x',1001),null);
  const legacy=u.id+':'+(1000+TTL)+':2';assert.equal(parse(c,legacy+'.'+mac(c.secret,legacy),1001),null);
  assert.equal(parse({...c,secret:secret()},t,1001),null);
  assert.match(cookies(c,t)[0],/^__Host-gymsid=.*Path=\/; HttpOnly; Secure; SameSite=Lax$/);
  assert.equal(cookies(c,null).length,2);
});
test('presence: heartbeat, hidden grace, expiry, navigate and revoke cleanup',()=>{
  const p=new Presence();p.update('u',{active:true,name:'x',setsDone:1},1000);assert.equal(p.current('u',1001).setsDone,1);
  p.update('u',{active:false,reason:'hidden'},2000);p.update('u',{active:false,reason:'hidden'},3000);assert.equal(p.current('u',46999).hiddenAt,2000);assert.equal(p.current('u',47000),null);
  p.update('u',{active:true},50000);assert.equal(p.current('other',50001),null);assert.equal(p.current('u',120000),null);
  p.update('u',{active:true},121000);p.update('u',{active:false,reason:'navigated'},122000);assert.equal(p.current('u',122001),null);
  p.update('u',{active:true},123000);p.clear('u');assert.equal(p.current('u',123001),null);
});
test('missing secret fails closed',{timeout:90000},async()=>{
  const {runner,call}=await fixture({allowUnavailable:true,vars:()=>({AUTH_SECRET:''})});
  try{await runner.start();const h=await call('/api/health');assert.equal(h.status,503);assert.deepEqual(h.data,{ok:false,writable:false});assert.equal((await post(call,'/api/login/options')).status,503);}finally{await runner.cleanup();}
});
test('local signed WebAuthn: bootstrap race, management, pairing, revocation and authenticated storage',{timeout:180000},async()=>{
  const {runner,call,SETUP_CODE,c}=await fixture();
  const dev=()=>authenticator({rp:'localhost',origin:runner.origin});
  const a=dev(),b=dev(),d=dev();let count=0;
  const options=()=>post(call,'/api/login/options');
  const register=()=>post(call,'/api/register/options',{name:'Synthetic Owner',code:SETUP_CODE});
  try{
    await runner.start();
    const health=await call('/api/health');assert.deepEqual(bodyOf(health),{ok:true,users:0,writable:true});
    assert.equal(health.headers.get('cache-control'),'no-store');assert.match(health.headers.get('content-type'),/application\/json/);assert.equal(health.headers.get('x-content-type-options'),'nosniff');assert.equal(health.headers.get('vary'),'Origin');
    assert.equal((await post(call,'/api/login/options',{pad:'x'.repeat(65536)})).status,413);
    assert.deepEqual(bodyOf(await call('/api/config')),{invite_only:true,allow_guest:false,signed_in:false});
    assert.equal((await call('/api/data')).status,401);
    assert.equal((await call('/__storage/alpha/state')).status,404);
    assert.equal((await call('/__poc/health')).status,404);
    assert.equal((await post(call,'/api/login/password')).status,404);
    assert.equal((await post(call,'/api/register/options',{name:'Synthetic',code:'wrong'})).status,403);
    assert.equal((await post(call,'/api/login/options',{}, {origin:'https://hostile.invalid'})).status,403);
    const noUV=authenticator({rp:'localhost',origin:runner.origin,uv:false});
    const no=bodyOf(await register());
    assert.equal((await post(call,'/api/register/verify',{cid:no.cid,credential:noUV.register(no.options.challenge)})).status,400);
    const r1=bodyOf(await register()),r2=bodyOf(await register());
    const race=await Promise.all([post(call,'/api/register/verify',{cid:r1.cid,credential:a.register(r1.options.challenge)}),post(call,'/api/register/verify',{cid:r2.cid,credential:b.register(r2.options.challenge)})]);
    assert.deepEqual(race.map(x=>x.status).sort(),[200,403]);
    // Winner can be either. Select its authenticator and derive proof function from actual winner.
    const winner=race.findIndex(x=>x.status===200),owner=winner===0?a:b;
    const ownerProof=async()=>{const o=bodyOf(await options());return {cid:o.cid,credential:owner.login(o.options.challenge,++count)};};
    let h=cookieOf(race[winner]),uid=race[winner].data.user.id;
    assert.equal((await call('/api/health')).data.users,1);
    assert.equal((await register()).status,403);
    assert.equal((await post(call,'/api/register/verify',{cid:r1.cid,credential:a.register(r1.options.challenge)})).data.code,'challenge-expired');
    assert.equal((await call('/api/config','GET',undefined,h)).data.signed_in,true);
    assert.deepEqual((await call('/api/data','GET',undefined,h)).data,{state:null,rev:0});
    assert.equal((await call('/api/me','GET',undefined,{cookie:h.cookie+'; '+h.cookie})).status,401);
    assert.equal((await call('/api/me','GET',undefined,{...h,authorization:'Bearer '+h.cookie.split('=')[1]})).status,401);
    assert.equal((await call('/api/me','GET',undefined,{authorization:'Bearer '+h.cookie.split('=')[1]+'x'})).status,401);
    const wrongOrigin=authenticator({rp:'localhost',origin:'http://wrong.invalid'});
    const lo=bodyOf(await options());
    assert.equal((await post(call,'/api/login/verify',{cid:lo.cid,credential:wrongOrigin.login(lo.options.challenge)})).status,404);
    for(const overrides of [{origin:'http://wrong.invalid'},{rp:'wrong.invalid'},{uv:false}]){
      const o=bodyOf(await options());const invalid=await post(call,'/api/login/verify',{cid:o.cid,credential:owner.login(o.options.challenge,++count,overrides)});assert.equal(invalid.status,400);if(overrides.origin||overrides.rp){assert.equal(invalid.data.code,'origin-mismatch');assert.equal(invalid.data.expected,runner.origin);}
    }
    const sig=bodyOf(await options()),invalidSig=owner.login(sig.options.challenge,++count);invalidSig.response.signature=Buffer.alloc(64).toString('base64url');
    assert.equal((await post(call,'/api/login/verify',{cid:sig.cid,credential:invalidSig})).status,400);
    const bad=bodyOf(await options());
    assert.equal((await post(call,'/api/login/verify',{cid:bad.cid,credential:owner.login('wrong',++count)})).status,400);
    assert.equal((await post(call,'/api/login/verify',{cid:bad.cid,credential:owner.login(bad.options.challenge,++count)})).data.code,'challenge-expired');
    const login=await ownerProof();h=cookieOf(await post(call,'/api/login/verify',login));
    assert.equal((await post(call,'/api/login/verify',login)).status,400);
    const sameCounter=count+1;count=sameCounter;
    // Generate two independent assertions with the same nonzero counter; only one may commit.
    const l1=bodyOf(await options()),l2=bodyOf(await options());
    const logins=await Promise.all([l1,l2].map(o=>post(call,'/api/login/verify',{cid:o.cid,credential:owner.login(o.options.challenge,sameCounter)})));
    assert.deepEqual(logins.map(x=>x.status).sort(),[200,400]);
    const list=bodyOf(await call('/api/account/passkeys','GET',undefined,h));assert.equal(list.lastWayIn,true);assert.equal(list.passkeys.length,1);assert.equal(Object.hasOwn(list.passkeys[0],'publicKey'),false);
    assert.equal((await call('/api/account/passkeys?id='+list.passkeys[0].id,'DELETE',{},h)).data.code,'last-way-in');
    // A registration challenge must never become a login or step-up assertion.
    const wrongPurpose=bodyOf(await post(call,'/api/account/passkeys/options',await ownerProof(),h));
    const wrong=await post(call,'/api/login/verify',{cid:wrongPurpose.cid,credential:owner.login(wrongPurpose.options.challenge,++count)});
    assert.equal(wrong.data.code,'challenge-expired');
    assert.equal((await post(call,'/api/account/passkeys/verify',{cid:wrongPurpose.cid,credential:d.register(wrongPurpose.options.challenge)},h)).data.code,'challenge-expired');
    const loginPurpose=bodyOf(await options());
    assert.equal((await post(call,'/api/account/passkeys/verify',{cid:loginPurpose.cid,credential:d.register(loginPurpose.options.challenge)},h)).data.code,'challenge-expired');
    const add=bodyOf(await post(call,'/api/account/passkeys/options',await ownerProof(),h));
    const added=bodyOf(await post(call,'/api/account/passkeys/verify',{cid:add.cid,credential:d.register(add.options.challenge),name:'Spare'},h));assert.equal(added.passkeys.length,2);
    const spare=added.passkeys.find(x=>x.id!==list.passkeys[0].id);
    assert.equal((await post(call,'/api/account/passkeys/rename',{id:spare.id,name:'Renamed'},h)).status,200);
    const link=bodyOf(await post(call,'/api/account/device-link',await ownerProof(),h));
    const linkOpts=bodyOf(await post(call,'/api/device-link/options',{code:link.code}));
    const another=dev();
    assert.equal((await post(call,'/api/device-link/verify',{cid:linkOpts.cid,code:link.code,credential:another.register(linkOpts.options.challenge)})).status,200);
    assert.equal((await post(call,'/api/device-link/options',{code:link.code})).data.code,'link-invalid');
    assert.equal((await call('/api/account/passkeys?id='+spare.id,'DELETE',await ownerProof(),h)).status,200);
    assert.equal((await post(call,'/api/pair/create',{},h)).data.code,'passkey-required');
    const first=bodyOf(await post(call,'/api/pair/create',await ownerProof(),h));
    const second=bodyOf(await post(call,'/api/pair/create',await ownerProof(),h));assert.match(second.code,/^[A-Z2-9]{8}$/);
    assert.equal((await post(call,'/api/pair/redeem',{code:first.code})).data.code,'pair-invalid');
    const redeemed=await Promise.all([1,2].map(()=>post(call,'/api/pair/redeem',{code:second.code.toLowerCase()})));
    assert.deepEqual(redeemed.map(x=>x.status).sort(),[200,400]);
    const token=redeemed.find(x=>x.status===200).data.token,phone={authorization:'Bearer '+token,origin:'capacitor://localhost'};
    assert.equal((await call('/api/me','GET',undefined,phone)).data.user.id,uid);
    const old=issue(c,{id:uid,sv:0},'b',Date.now()-TTL*.75),oldC=issue(c,{id:uid,sv:0},'c',Date.now()-TTL*.75);
    assert.ok((await call('/api/me','GET',undefined,{authorization:'Bearer '+old})).data.token);
    assert.equal((await call('/api/me','GET',undefined,{authorization:'Bearer '+oldC})).data.token,undefined);
    assert.equal((await post(call,'/api/account/delete',{name:'Synthetic Owner'},{authorization:'Bearer '+oldC})).data.code,'passkey-required');
    const pre=await call('/api/data','OPTIONS',undefined,{origin:'capacitor://localhost','access-control-request-private-network':'true'});
    assert.equal(pre.status,204);assert.equal(pre.headers.get('access-control-allow-credentials'),null);assert.equal(pre.headers.get('access-control-allow-private-network'),'true');
    assert.equal((await call('/api/data','OPTIONS',undefined,{origin:'https://hostile.invalid'})).status,403);
    assert.equal((await post(call,'/api/activity',{active:true})).status,401);
    assert.equal((await post(call,'/api/activity',{active:true,name:'Fixture',setsDone:1},phone)).status,200);
    assert.equal((await post(call,'/api/activity',{active:false,reason:'hidden'},phone)).status,200);
    // Encoded routes are refused; standard URL dot normalization may occur before the Worker.
    for(const path of ['/api/%64ata','/api/data%2frev','/api//data','/api/data/','/api/data%5crev','/api/%252e%252e/data']){
      assert.equal((await call(path,'GET',undefined,h)).status,404,path);
    }
    for(const path of ['/api/other/../data','/api/%2e/data']){
      assert.equal((await call(path)).status,401,path);
      assert.equal((await call(path,'PUT',{state:{workouts:[]}},{...h,origin:'https://hostile.invalid'})).status,403,path);
    }
    const state={workouts:[{id:'w',d:'2026-09-01'}],routines:[],_ts:1};
    assert.equal((await call('/api/data','PUT',{baseRev:0,state},{...h,origin:'https://sibling.invalid','sec-fetch-site':'same-site'})).status,403);
    const saved=bodyOf(await call('/api/data','PUT',{baseRev:0,profile:'attacker',state,stamped:true},phone));
    assert.equal((await call('/api/data/rev','GET',undefined,h)).data.wid,saved.wid);
    assert.equal((await call('/api/data','PUT',{baseRev:0,state},phone)).status,409);
    assert.equal((await call('/api/nudge-check?date=2026-09-01','GET',undefined,phone)).data.done,true);
    assert.equal((await call('/api/nudge-check?date=bad','GET',undefined,phone)).status,400);
    await runner.stop();await runner.start();
    assert.equal((await call('/api/data','GET',undefined,phone)).data.state.workouts[0].id,'w');
    const pending=bodyOf(await post(call,'/api/pair/create',await ownerProof(),h));
    const pendingLink=bodyOf(await post(call,'/api/account/device-link',await ownerProof(),h));
    const pendingProof=await ownerProof();
    const latest=bodyOf(await call('/api/data/rev','GET',undefined,phone));
    const [write,logout]=await Promise.all([call('/api/data','PUT',{baseRev:latest.rev,baseWid:latest.wid,state:{...state,notes:'race'},stamped:true},phone),post(call,'/api/logout/all',{},h)]);
    assert.ok([200,401].includes(write.status));assert.equal(logout.status,200);
    assert.equal((await call('/api/data','PUT',{state},phone)).status,401);
    assert.equal((await call('/api/me','GET',undefined,h)).status,401);
    assert.equal((await post(call,'/api/login/verify',pendingProof)).data.code,'challenge-expired');
    assert.equal((await post(call,'/api/pair/redeem',{code:pending.code})).data.code,'pair-invalid');
    assert.equal((await post(call,'/api/device-link/options',{code:pendingLink.code})).data.code,'link-invalid');
    h=cookieOf(await post(call,'/api/login/verify',await ownerProof()));
    assert.equal((await post(call,'/api/account/delete',{name:'wrong'},h)).data.code,'confirm-name');
    assert.equal((await post(call,'/api/account/delete',{name:'Synthetic Owner'},h)).data.code,'passkey-required');
    const p=bodyOf(await post(call,'/api/pair/create',await ownerProof(),h));
    const t=bodyOf(await post(call,'/api/pair/redeem',{code:p.code})).token;
    assert.equal((await post(call,'/api/account/delete',{name:'Synthetic Owner'},{authorization:'Bearer '+t})).status,200);
    assert.equal((await call('/api/me','GET',undefined,{authorization:'Bearer '+t})).status,401);
    assert.equal((await call('/api/data','GET',undefined,h)).status,401);
    assert.equal((await register()).status,403);
    await runner.stop();await runner.start();assert.equal((await call('/api/health')).data.users,0);assert.equal((await register()).status,403);
    console.log('PHASE3_AUTH_CORE PASS');
  }finally{await runner.cleanup();}
});
