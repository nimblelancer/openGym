// C0 actual loopback HTTP evidence. No receipts or live store adoption.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {localRunner} from '../local-runner.mjs';
import {authenticator} from '../auth-fixture.mjs';
import {canonical,digest} from './records.mjs';
const secret=()=>randomBytes(32).toString('hex');
const sha=(tag,s)=>digest(tag,s);
const validWid=x=>typeof x==='string'&&/^[a-f0-9]{16}$/.test(x);
async function server(t,name){
  const AUTH_SECRET=secret(),SETUP_CODE=secret();
  const runner=await localRunner('wrangler.api.jsonc',{health:'/api/health',privateLogs:true,vars:origin=>({AUTH_SECRET,SETUP_CODE,API_ORIGIN:origin,RP_ID:'localhost'})});
  t.after(()=>runner.cleanup());
  await runner.start();
  const dev=authenticator({rp:'localhost',origin:runner.origin});
  let cookie,token;
  const send=async(path,method='GET',wire,auth='bearer')=>{
    const headers={origin:auth==='bearer'?'capacitor://localhost':runner.origin};
    if(auth==='owner'&&cookie)headers.cookie=cookie;
    if(auth==='bearer'&&token)headers.authorization='Bearer '+token;
    if(wire!==undefined)headers['content-type']='application/json';
    const res=await fetch(runner.base+path,{method,headers,body:wire,redirect:'error',signal:AbortSignal.timeout(30000)});
    const raw=await res.text();
    let body;try{body=JSON.parse(raw)}catch{body=null}
    return {status:res.status,body,cookie:res.headers.getSetCookie()[0]?.split(';')[0]};
  };
  const post=async(path,value,auth='owner')=>send(path,'POST',JSON.stringify(value),auth);
  const opt=await post('/api/register/options',{name,code:SETUP_CODE});
  assert.equal(opt.status,200);
  const reg=await post('/api/register/verify',{cid:opt.body.cid,credential:dev.register(opt.body.options.challenge)});
  assert.equal(reg.status,200);cookie=reg.cookie;assert.ok(cookie);
  const login=await post('/api/login/options',{});
  assert.equal(login.status,200);
  const pair=await post('/api/pair/create',{cid:login.body.cid,credential:dev.login(login.body.options.challenge,1)});
  assert.equal(pair.status,200);
  const redeem=await post('/api/pair/redeem',{code:pair.body.code},'none');
  assert.equal(redeem.status,200);token=redeem.body.token;assert.ok(token);
  assert.equal(redeem.body.user.id===reg.body.user.id,true);
  const me=await send('/api/me');assert.equal(me.status,200);assert.equal(me.body.user.id===reg.body.user.id,true);
  return {base:runner.base,uid:reg.body.user.id,send,revoke:()=>post('/api/logout/all',{}),async get(){const r=await send('/api/data');assert.equal(r.status,200);return r.body}};
}
async function attempt(s, state, base, stamped=true){
  const me=await s.send('/api/me');assert.equal(me.status,200);assert.equal(me.body.user.id===s.uid,true);
  const wire=JSON.stringify({state,baseRev:base.rev,baseWid:base.state?._wid,stamped});
  const result=await s.send('/api/data','PUT',wire);
  return {base:s.base,owner:s.uid,wire,wireDigest:sha('submitted-wire',wire),baseRev:base.rev,result};
}
// Scoped evidence only. Complete disposition, active/media durability and server
// generation are NOT established by this check; no automatic adoption decision.
async function inspect(s,a,result=a.result){
  if(!a||s.base!==a.base||s.uid!==a.owner||sha('submitted-wire',a.wire)!==a.wireDigest)return {hold:'authority-or-wire'};
  if(result?.status!==200||result.body?.ok!==true||!validWid(result.body.wid)||
     !Number.isSafeInteger(result.body.rev)||result.body.rev!==a.baseRev+1)return {hold:'ack'};
  const before=await s.send('/api/me');
  if(before.status!==200||before.body?.user?.id!==a.owner)return {hold:'authority'};
  const read=await s.send('/api/data'),rev=await s.send('/api/data/rev'),after=await s.send('/api/me');
  if(after.status!==200||after.body?.user?.id!==a.owner)return {hold:'authority'};
  const doc=read.body?.state, ack=result.body;
  if(read.status!==200||rev.status!==200||doc?._wid!==ack.wid||rev.body?.wid!==ack.wid||
     doc._rev!==read.body.rev||rev.body.rev!==doc._rev||![ack.rev,ack.rev+1].includes(doc._rev))return {hold:'readback'};
  return {wireDigest:a.wireDigest,committedDigest:sha('committed-client-state',canonical(doc)),rev:doc._rev,wid:ack.wid,doc};
}
const data=(note,extra={})=>({workouts:[],routines:[],note,...extra});
test('NR-03 real authenticated Worker ACK, normal/gap/409, missing/malformed/lost ACK and authority holds',{timeout:240000},async t=>{
  const s=await server(t,'Synthetic C0 owner');
  const empty=await s.get();assert.deepEqual(empty,{state:null,rev:0});
  const first=await attempt(s,data('seed',{fixtureFuture:'preserve'}),empty);
  const normal=await inspect(s,first);
  assert.equal(normal.hold,undefined);assert.equal(normal.rev,1);
  assert.equal(normal.doc.note,'seed');assert.equal(normal.doc.fixtureFuture,'preserve');
  assert.notEqual(normal.wireDigest,normal.committedDigest);
  assert.equal(normal.committedDigest,sha('committed-client-state',canonical((await s.get()).state)));
  // A legacy unstamped client omits a field. Actual stampPut keeps it,
  // changes committed content and advances stored revision one extra step.
  const prev=await s.get(), gap=await attempt(s,data('legacy edit'),prev,false), g=await inspect(s,gap);
  assert.equal(g.hold,undefined);assert.equal(gap.result.body.rev,prev.rev+1);assert.equal(g.rev,prev.rev+2);
  assert.equal(g.doc.fixtureFuture,'preserve');assert.equal(g.doc.note,'legacy edit');
  assert.equal(g.committedDigest,sha('committed-client-state',canonical((await s.get()).state)));
  const beforeOther=await s.get(), other=await attempt(s,{...beforeOther.state,note:'intervening'},beforeOther);
  assert.equal(other.result.status,200);
  const stale=await attempt(s,data('conflicted'),beforeOther);
  assert.equal(stale.result.status,409);
  assert.deepEqual(await inspect(s,stale),{hold:'ack'});
  assert.deepEqual(stale.result.body.state,(await s.get()).state);
  const fresh=await s.get(), reconciled=await attempt(s,{...fresh.state,fixtureReconciled:true},fresh);
  assert.notEqual(reconciled.wireDigest,stale.wireDigest);
  const verified=await inspect(s,reconciled);
  assert.equal(verified.hold,undefined);assert.equal(verified.doc.note,'intervening');assert.equal(verified.doc.fixtureReconciled,true);
  assert.equal(verified.doc.fixtureFuture,'preserve');
  for(const result of [{status:200,body:{ok:true,rev:reconciled.result.body.rev}},{status:200,body:null},{status:200,body:{ok:false,rev:1,wid:verified.wid}},{status:200,body:{ok:true,rev:'1',wid:verified.wid}},{status:0,body:null}]){
    assert.deepEqual(await inspect(s,reconciled,result),{hold:'ack'});
  }
  assert.deepEqual(await inspect(s,{...reconciled,wire:reconciled.wire+' '}),{hold:'authority-or-wire'});
  const later=await attempt(s,{...(await s.get()).state,note:'later'},await s.get());
  assert.equal(later.result.status,200);
  assert.deepEqual(await inspect(s,reconciled),{hold:'readback'});
  const otherOwner=await server(t,'Synthetic C0 different owner');
  assert.notEqual(otherOwner.uid===s.uid,true);
  assert.deepEqual(await inspect(otherOwner,later),{hold:'authority-or-wire'});
  // Changed owner authority even if caller's expected owner/server metadata is stale:
  // authenticate independently to the second server, then compare its actual /me.
  const changed=await otherOwner.send('/api/me');assert.equal(changed.status,200);assert.equal(changed.body.user.id===s.uid,false);
  const staleAuthority={...s,send:otherOwner.send};
  assert.deepEqual(await inspect(staleAuthority,later),{hold:'authority'});
  assert.equal((await s.revoke()).status,200);
  assert.equal((await s.send('/api/me')).status,401);
  assert.equal((await s.send('/api/data')).status,401);
  assert.deepEqual(await inspect(s,later),{hold:'authority'});
  console.log('C0_NR03 real HTTP normal/gap/409/replan/revoke/owner; injected ACK faults held; no receipt or adoption');
});
