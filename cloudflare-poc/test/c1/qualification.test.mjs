import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {adapter,vault,inventory,publish,recordPath,bounded,rawMatches,unionInventories} from './storage.mjs';
import {canonical,record,logical,id,D,sha,refEntry,parse,same,LIMIT} from './contract.mjs';
import {scope,rawMedia,receiptStatus,compare,plan,validGraph} from './planner.mjs';
import {driver} from './driver.mjs';
import {server,disconnectTransport} from './auth-fixture.mjs';
const B=v=>Buffer.from(canonical(v)), run=promisify(execFile),childPath=fileURLToPath(new URL('./publisher.mjs',import.meta.url));
const state=(extra={})=>({workouts:[],routines:[],note:'synthetic',...extra});
const auth={owner:'fixture-owner',server:'https://fixture.invalid/sub',epochId:id()};
async function root(t){const p=await mkdtemp(join(tmpdir(),'opengym-c1-'));t.after(()=>rm(p,{recursive:true,force:true}));return p}
async function source(v,a,payload,kind='owned',eventId=id()){
  const b={eventId,owner:a.owner,server:a.server,kind,at:1,payload};
  const raw=await v.evidence(B({eventId,...logical(b)}));
  return record('entry',{...b,source:{medium:'synthetic-new-event',raw,selector:null},logicalDigest:D('logical-entry',canonical(logical(b)))});
}
async function child(p,r){
  const {stdout}=await run(process.execPath,[childPath,p,'publish',B(r).toString('base64')],{timeout:15000});
  const out=JSON.parse(stdout);assert.notEqual(out.pid,process.pid);assert.equal(out.writes,1);assert.equal(out.recordOnly,true);return out.pid
}
const legacy=(a,payload,at=1)=>B({[a.server+'|'+a.owner]:{server:a.server,uid:a.owner,name:'Synthetic',at,state:payload}});
const legacyFiles=['gym_stash','opengym-stash.json'];
async function seed(p,a){const copies=[legacy(a,state({note:'original browser'})),legacy(a,state({note:'original native'}),2)];for(let i=0;i<2;i++)await writeFile(join(p,legacyFiles[i]),copies[i]);return copies}
async function verifyLegacy(p,bytes){for(let i=0;i<2;i++)assert.ok((await readFile(join(p,legacyFiles[i]))).equals(bytes[i]))}
function watch(fs,onWrite=async()=>{},onRead=async()=>{}){
  const writes=[],forbidden=[];const refuse=name=>async()=>{forbidden.push(name);throw Error('forbidden destructive fixture operation')};return {writes,forbidden,fs:{...fs,deleteFile:refuse('deleteFile'),rename:refuse('rename'),setItem:refuse('setItem'),removeItem:refuse('removeItem'),async writeFile(o){writes.push(o.path);assert.match(o.path,/^p7-c1-(records|evidence)\//);await onWrite(o);return fs.writeFile(o)},async readFile(o){await onRead(o);return fs.readFile(o)}}}
}
test('Q2 independent real child writers, exact raw preservation, no shared index and cold inventory',async t=>{
  const p=await root(t),original=await seed(p,auth),a=adapter(p),v=await vault(a);
  const old=await source(v,auth,state());await v.record(old);
  const newer=await source(v,auth,state({note:'newer'})),foreign=await source(v,{...auth,owner:'foreign'},state({note:'foreign'}));
  const pids=await Promise.all([child(p,newer),child(p,foreign)]);assert.notEqual(pids[0],pids[1]);
  await assert.rejects(v.check);const i=await inventory(a);assert.equal(i.complete,true);assert.equal(i.records.size,3);
  for(const r of [old,newer,foreign])assert.ok(i.raw.get(recordPath(r.id)).equals(B(r)));
  await verifyLegacy(p,original);const {stdout}=await run(process.execPath,[childPath,p,'inventory'],{timeout:15000});const restart=JSON.parse(stdout);
  assert.notEqual(restart.pid,process.pid);assert.equal(restart.complete,true);assert.equal(restart.count,3);
  const view=scope(i,auth);assert.equal(view.statuses.filter(s=>s.status==='RECOVERY_HOLD').length,2);assert.equal(view.statuses.filter(s=>s.status==='FOREIGN').length,1);
});
test('Q2 refusal, silent/partial write, readback orphan, unreadable inventory and bounds',async t=>{
  for(const fault of [{refuse:true},{silent:true},{partial:'throw'},{partial:true}]){
    const p=await root(t),a=adapter(p),v=await vault(a),entry=await source(v,auth,state());
    await assert.rejects(()=>publish(adapter(p,fault),recordPath(entry.id),B(entry)));
    const i=await inventory(a);
    if(fault.partial){assert.equal(i.complete,false);assert.ok(i.raw.has(recordPath(entry.id)))}else assert.equal(i.records.size,0)
  }
  const p=await root(t),a=adapter(p),v=await vault(a),entry=await source(v,auth,state());
  await assert.rejects(()=>publish(adapter(p,{read:true}),recordPath(entry.id),B(entry)));
  const i=await inventory(a);assert.equal(i.complete,true);assert.equal(scope(i,auth).statuses[0].status,'RECOVERY_HOLD');
  assert.equal((await inventory(adapter(p,{list:'p7-c1-records'}))).complete,false);
  assert.equal((await inventory(adapter(p,{read:true}))).complete,false);
  await assert.rejects(()=>publish(a,recordPath(entry.id),B(entry)));
  const oversized=await root(t);await writeFile(join(oversized,'gym_stash'),Buffer.alloc(LIMIT.bytes+1));
  assert.equal((await inventory(adapter(oversized))).complete,false);
  const tooMany=await root(t);await mkdir(join(tooMany,'p7-c1-evidence'));
  await Promise.all(Array.from({length:LIMIT.names+1},()=>writeFile(join(tooMany,'p7-c1-evidence',id()+'.bin'),'')));
  assert.equal((await inventory(adapter(tooMany))).complete,false);
  await assert.rejects(()=>bounded(()=>new Promise(()=>{}),5),/deadline/);
  const total=await root(t);await mkdir(join(total,'p7-c1-evidence'));for(let i=0;i<17;i++)await writeFile(join(total,'p7-c1-evidence',id()+'.bin'),Buffer.alloc(LIMIT.bytes));
  const ti=await inventory(adapter(total));assert.equal(ti.complete,false);assert.equal(ti.bytes,LIMIT.total);
});
test('Q2 same-path unconditional overwrite is a negative capability control',async t=>{
  const p=await root(t),a=adapter(p),v=await vault(a),entry=await source(v,auth,state());await v.record(entry);
  await a.writeFile({path:recordPath(entry.id),directory:'DATA',data:Buffer.from('{}').toString('base64')});
  assert.equal((await inventory(a)).complete,false);
  assert.ok(!(await readFile(join(p,recordPath(entry.id)))).equals(B(entry)));
  console.log('C1_NEGATIVE_CONTROL unconditional same-path overwrite observed; no CAS claimed');
});
test('Q3 actual authenticated Worker intent, exact disposition, receipt and restart hold', {timeout:180000},async t=>{
  const s=await server(t,'C1 exact receipt owner'),p=await root(t),original=await seed(p,{owner:s.uid,server:s.base}),w=watch(adapter(p)),d=await driver(w.fs,s);
  const e=await d.event(state({fixtureFuture:'keep unknown field'})),base=await d.readBase();
  const out=await d.attempt([e],base);
  assert.equal(out.status,'ACKNOWLEDGED_RETAINED_SCOPED',out.reason);
  assert.equal(out.receipt.body.disposition[0].decision,'incorporated');
  assert.equal(out.receipt.body.ack.rev,1);
  const i=await inventory(w.fs);assert.ok(i.raw.get(recordPath(e.id)).equals(B(e)));assert.ok(i.raw.get(recordPath(out.intent.id)).equals(B(out.intent)));assert.ok(i.raw.get(recordPath(out.receipt.id)).equals(B(out.receipt)));
  assert.equal(receiptStatus(i,out.receipt,d.auth,d.live,out.observation).status,'ACKNOWLEDGED_RETAINED_SCOPED');
  assert.equal(receiptStatus(i,out.receipt,d.auth,new Map(),out.observation).status,'RECOVERY_HOLD');
  assert.equal(receiptStatus(i,out.receipt,{...d.auth,epochId:id()},d.live,out.observation).status,'RECOVERY_HOLD');
  const restarted=await driver(w.fs,s);assert.equal((await restarted.attempt([e],await restarted.readBase())).status,'RECOVERY_HOLD');
  assert.equal((await s.get()).rev,1);await verifyLegacy(p,original);
  assert.ok(w.writes.every(path=>!legacyFiles.includes(path)));assert.equal(w.forbidden.length,0);
  // Corrupt references and altered receipt must not acquire a capability.
  assert.equal(receiptStatus(i,{...out.receipt,bodyDigest:id()},d.auth,d.live,out.observation).status,'RECOVERY_HOLD');
  const missing={...i,raw:new Map(i.raw)};missing.raw.delete('p7-c1-evidence/'+out.intent.body.wire.id+'.bin');
  assert.equal(receiptStatus(missing,out.receipt,d.auth,d.live,out.observation).status,'RECOVERY_HOLD');
  for(const ack of [{status:200,body:{ok:true,rev:1}},{status:200,body:null},{status:200,body:{ok:true,rev:'1',wid:out.receipt.body.ack.wid}}]){
    assert.equal(compare(i,out.intent,{...out.observation,ack},d.auth,{active:[],media:[]}).status,'RECOVERY_HOLD')
  }
  assert.equal(compare(i,out.intent,{...out.observation,wire:Buffer.from('{}')},d.auth,{active:[],media:[]}).status,'RECOVERY_HOLD');
  assert.equal(compare(i,out.intent,{...out.observation,server:'https://different.invalid'},d.auth,{active:[],media:[]}).status,'RECOVERY_HOLD');
  assert.equal(compare(i,out.intent,{...out.observation,after:{status:401}},d.auth,{active:[],media:[]}).status,'RECOVERY_HOLD');
  assert.equal(compare(i,out.intent,{...out.observation,after:{status:200,body:{user:{id:'foreign'}}}},d.auth,{active:[],media:[]}).status,'RECOVERY_HOLD');
  const changed=await s.send('/api/data','PUT',JSON.stringify({state:state({note:'later'}),baseRev:1,baseWid:out.receipt.body.ack.wid,stamped:true}));assert.equal(changed.status,200);
  const data=await s.send('/api/data'),rev=await s.send('/api/data/rev');
  assert.equal(receiptStatus(i,out.receipt,d.auth,d.live,{...out.observation,data,rev}).status,'RECOVERY_HOLD');
  assert.equal((await s.revoke()).status,200);assert.equal((await s.send('/api/me')).status,401);
  console.log('C1_Q3 scoped exact receipt, no legacy cleanup, restart and authority holds');
});
test('Q3 real HTTP conflict and new intent with actual merge; unjustified gap holds', {timeout:180000},async t=>{
  const s=await server(t,'C1 conflict owner'),p=await root(t),d=await driver(adapter(p),s);
  const base=await d.readBase(),entry=await d.event(state());
  const competing=await s.send('/api/data','PUT',JSON.stringify({state:state({_ts:2,fixtureOther:'intervening'}),baseRev:0,stamped:true}));assert.equal(competing.status,200);
  const stale=await d.attempt([entry],base);assert.equal(stale.ack?.status,409);assert.equal(stale.status,'RECOVERY_HOLD');assert.equal(stale.receipt,undefined);
  const next=await d.attempt([entry],await d.readBase());assert.equal(next.status,'ACKNOWLEDGED_RETAINED_SCOPED',next.reason);
  assert.notEqual(next.intent.id,stale.intent.id);assert.notEqual(next.intent.body.attemptId,stale.intent.body.attemptId);assert.notEqual(next.intent.body.wireDigest,stale.intent.body.wireDigest);
  assert.equal((await s.get()).state.fixtureOther,'intervening');
  const gapEntry=await d.event(state({_ts:3,note:'legacy change'}));
  const gap=await d.attempt([gapEntry],await d.readBase(),{stamped:false});
  assert.equal(gap.ack?.status,200);assert.notEqual(gap.status,'ACKNOWLEDGED_RETAINED_SCOPED');assert.equal(gap.receipt,undefined);
});
test('Q3 actual local HTTP disconnect before dispatch and after committed PUT; no replay', {timeout:180000},async t=>{
  const s=await server(t,'C1 transport owner');
  for(const when of ['before','after']){
    const p=await root(t),d=await driver(adapter(p),s),base=await d.readBase(),entry=await d.event(state({note:'lost '+when}));
    const loss=await disconnectTransport(t,s,when);const out=await d.attempt([entry],base,{transport:loss.transport});
    assert.equal(out.status,'RECOVERY_HOLD');assert.ok(out.intent);assert.equal(out.ack,undefined);assert.equal(out.receipt,undefined);
    const o=loss.observation();assert.ok(o.received>0);assert.equal(o.bodyMatched,true);assert.equal(o.forwarded,when==='after'?1:0);assert.equal(o.upstreamStatus,when==='after'?200:null);
    const current=await s.get();assert.equal(current.rev,base.rev+(when==='after'?1:0));
    assert.equal((await d.attempt([entry],await d.readBase())).status,'RECOVERY_HOLD');
    assert.equal((await s.get()).rev,current.rev);
    const i=await inventory(adapter(p));assert.equal([...i.records.values()].filter(r=>r.type==='receipt').length,0);
    assert.ok(i.raw.get(recordPath(entry.id)).equals(B(entry)));
  }
  console.log('C1_Q3 actual client disconnect pre-dispatch and post-commit; no response ACK, no replay');
});
test('Q2/Q3 independent child publication at intent, ACK, receipt and receipt readback boundaries', {timeout:180000},async t=>{
  const s=await server(t,'C1 interleaving owner');
  for(const phase of ['before-intent','after-ack','before-receipt','receipt-write','receipt-readback','after-receipt']){
    const p=await root(t),original=await seed(p,{owner:s.uid,server:s.base}),a=adapter(p);
    let foreign,newer,triggered=0,receiptPath;
    async function trigger(){if(!triggered++){const pids=await Promise.all([child(p,foreign),child(p,newer)]);assert.notEqual(pids[0],pids[1])}}
    const w=watch(a,async o=>{if(o.path.startsWith('p7-c1-records/')){
      const r=parse(Buffer.from(o.data,'base64'),{exact:true});if(r.type==='receipt'){receiptPath=o.path;if(phase==='receipt-write')await trigger()}
    }},async o=>{if(phase==='receipt-readback'&&o.path===receiptPath&&!triggered)await trigger()});
    const d=await driver(w.fs,s),base=await d.readBase();
    const entry=await d.event(base.state?state({note:'synthetic'}):state());
    foreign=await source(d.v,{owner:'foreign',server:s.base},state({note:'must not enter server'}));newer=await source(d.v,{owner:s.uid,server:s.base},state({note:'independent newer must not enter server'}));
    const out=await d.attempt([entry],base,{hook:async at=>{if(phase===at)await trigger()}});
    assert.equal(triggered,1,phase+': child must really run');assert.equal(out.status,'RECOVERY_HOLD',phase);
    const i=await inventory(a);assert.equal(i.complete,true);assert.ok(i.raw.get(recordPath(foreign.id)).equals(B(foreign)));assert.ok(i.raw.get(recordPath(newer.id)).equals(B(newer)));assert.ok(i.raw.get(recordPath(entry.id)).equals(B(entry)));
    await verifyLegacy(p,original);assert.ok(w.writes.every(path=>!legacyFiles.includes(path)));assert.equal(w.forbidden.length,0);
    const current=await s.get();assert.notEqual(current.state?.note,'must not enter server');assert.notEqual(current.state?.note,'independent newer must not enter server');
    assert.equal(current.rev,base.rev+(phase==='before-intent'?0:1));
  }
});
test('Q4 raw union across legacy/native mirrors/new records, exact active and media obligations', {timeout:180000},async t=>{
  const s=await server(t,'C1 local obligation owner'),p=await root(t),a=adapter(p);
  const bytes=Buffer.from('synthetic original'),poster=Buffer.from('synthetic poster'),old=Buffer.from('older media'),mirror=Buffer.from('mirror media');
  const m=(b)=>({hash:sha(b),size:b.length}),aOwner={owner:s.uid,server:s.base},active={start:123,note:'active synthetic'};
  const mirrorBytes=B({...aOwner,active,fixtureMedia:m(mirror)});
  await writeFile(join(p,'gym_stash'),legacy(aOwner,state({fixtureMedia:m(old)})));
  await writeFile(join(p,'opengym-stash.json'),legacy({...aOwner,owner:'foreign'},state({fixtureMedia:m(poster)})));
  await writeFile(join(p,'opengym-state.json'),mirrorBytes);
  await writeFile(join(p,'opengym-state.next.json'),B({...aOwner,owner:'foreign',active:{start:999},fixtureMedia:m(old)}));
  const d=await driver(a,s),e=await d.event(state({active,fixtureMedia:{...m(bytes),poster:m(poster),local:true,pending:true}}));
  const proof={active:[{entryId:e.id,digest:sha(B(active)),resolution:'exact-owner-tagged-copy',evidence:await d.v.evidence(mirrorBytes)}],media:[]};
  for(const b of [bytes,poster])proof.media.push({entryId:e.id,sha256:sha(b),byteLength:b.length,evidence:await d.v.evidence(b)});
  const result=await d.attempt([e],await d.readBase(),{proof});assert.equal(result.status,'ACKNOWLEDGED_RETAINED_SCOPED',result.reason);
  assert.equal(Object.hasOwn((await s.get()).state,'active'),false);
  const inv=await inventory(a),union=rawMedia(inv);assert.equal(union.complete,true);
  assert.deepEqual(new Set(union.files.map(x=>x.sha256)),new Set([bytes,poster,old,mirror].map(sha)));
  assert.equal(compare(inv,result.intent,result.observation,d.auth,{active:[],media:proof.media}).status,'RECOVERY_HOLD');
  assert.equal(compare(inv,result.intent,result.observation,d.auth,{active:proof.active,media:[]}).status,'RECOVERY_HOLD');
  const bad={...proof,active:[{...proof.active[0],digest:id()}]};assert.equal(compare(inv,result.intent,result.observation,d.auth,bad).status,'RECOVERY_HOLD');
  const stale={...inv,raw:new Map(inv.raw)};stale.raw.set('opengym-state.json',B({...aOwner,active:{start:456}}));
  assert.equal(compare(stale,result.intent,result.observation,d.auth,proof).status,'RECOVERY_HOLD');
  const divergent={...inv,raw:new Map(inv.raw)};divergent.raw.set('opengym-state.next.json',B({...aOwner,active:{start:999}}));assert.equal(compare(divergent,result.intent,result.observation,d.auth,proof).status,'RECOVERY_HOLD');
  const unknown={...inv,raw:new Map(inv.raw)};unknown.raw.set('opengym-state.next.json',B({fixtureMedia:{hash:'bad',size:1}}));
  assert.equal(rawMedia(unknown).complete,false);
  assert.equal(receiptStatus(inv,result.receipt,{...d.auth,epochId:id()},d.live,result.observation).status,'RECOVERY_HOLD');
  const activeOnly=await d.event(state({active:{start:999}}),'active-only');const before=(await s.get()).rev;
  assert.equal((await d.attempt([activeOnly],await d.readBase())).status,'RECOVERY_HOLD');assert.equal((await s.get()).rev,before);
  const reset=await d.event(state({resetAt:1}));assert.equal((await d.attempt([reset],await d.readBase())).status,'RECOVERY_HOLD');
});
test('Q4 metadata loss, conflicting event and unverified legacy never become eligible',async t=>{
  const p=await root(t),a=adapter(p),v=await vault(a),entry=await source(v,auth,state());await v.record(entry);
  const i=await inventory(a);assert.equal(scope(i,auth).statuses[0].status,'RECOVERY_HOLD');
  assert.equal(plan(i,auth,new Set(),{rev:0,state:null},[refEntry(entry)]).status,'RECOVERY_HOLD');
  const divergent=await source(v,auth,state({note:'different'}),'owned',entry.body.eventId);await v.record(divergent);
  const j=await inventory(a);assert.equal(scope(j,auth,new Set([entry.body.eventId])).complete,false);
  const missing={...i,raw:new Map(i.raw)};missing.raw.delete('p7-c1-evidence/'+entry.body.source.raw.id+'.bin');
  assert.equal(scope(missing,auth).complete,false);
});

test('Q2 independent synthetic media, one/both refusal and divergent raw copies hold',async t=>{
  const p=await root(t),q=await root(t),a=adapter(p),b=adapter(q),av=await vault(a),bv=await vault(b),eventId=id();
  const first=await source(av,auth,state(),'owned',eventId),second=await source(bv,auth,state(),'owned',eventId);
  const ai=()=>inventory(a),bi=()=>inventory(b);
  await av.record(first);await assert.rejects(()=>publish(adapter(q,{refuse:true}),recordPath(second.id),B(second)));
  let union=unionInventories([{medium:'native',inventory:await ai()},{medium:'browser-fixture',inventory:await bi()}]);
  assert.equal(union.complete,true);assert.equal(union.records.size,1);assert.ok(union.raw.get(recordPath(first.id)).equals(B(first)));
  assert.equal(scope(union,auth).statuses[0].status,'RECOVERY_HOLD');
  await bv.record(second);union=unionInventories([{medium:'native',inventory:await ai()},{medium:'browser-fixture',inventory:await bi()}]);
  assert.equal(union.complete,true);assert.equal(union.records.size,2);assert.equal(validGraph(union),true);assert.equal(first.body.logicalDigest,second.body.logicalDigest);
  assert.equal(union.copies.filter(x=>x.path.startsWith('p7-c1-records/')).length,2);
  const refusedA=await source(av,auth,state({note:'both refuse'})),refusedB=await source(bv,auth,state({note:'both refuse'}));
  await assert.rejects(()=>publish(adapter(p,{refuse:true}),recordPath(refusedA.id),B(refusedA)));await assert.rejects(()=>publish(adapter(q,{refuse:true}),recordPath(refusedB.id),B(refusedB)));
  assert.equal((await ai()).records.size,1);assert.equal((await bi()).records.size,1);
  const unavailable=unionInventories([{medium:'native',inventory:await ai()},{medium:'browser-fixture',inventory:await inventory(adapter(q,{list:''}))}]);
  assert.equal(unavailable.complete,false);
});
test('Q2/Q3 actual intent and receipt refusal/partial/silent faults never replay', {timeout:180000},async t=>{
  const s=await server(t,'C1 durable boundary owner');
  for(const type of ['intent','receipt'])for(const mode of ['refuse','partial','silent']){
    const p=await root(t),original=await seed(p,{owner:s.uid,server:s.base}),a=adapter(p);let faultCount=0;
    const fs={...a,async writeFile(o){if(o.path.startsWith('p7-c1-records/')){
      const r=parse(Buffer.from(o.data,'base64'),{exact:true});if(r.type===type){faultCount++;return adapter(p,{[mode]:mode==='partial'?'throw':true}).writeFile(o)}
    }return a.writeFile(o)}};
    const d=await driver(fs,s),entry=await d.event(state()),base=await d.readBase(),out=await d.attempt([entry],base);
    assert.equal(faultCount,1);assert.equal(out.status,'RECOVERY_HOLD');assert.equal(out.receipt,undefined);
    const current=await s.get();assert.equal(current.rev,base.rev+(type==='receipt'?1:0));
    const inv=await inventory(a);assert.ok(inv.raw.get(recordPath(entry.id)).equals(B(entry)));assert.equal([...inv.records.values()].filter(r=>r.type==='receipt').length,0);
    assert.equal(inv.complete,mode!=='partial');await verifyLegacy(p,original);
    if(inv.complete){const restart=await driver(a,s);assert.equal((await restart.attempt([entry],await restart.readBase())).status,'RECOVERY_HOLD')}
    else await assert.rejects(()=>driver(a,s));
    assert.equal((await s.get()).rev,current.rev);
  }
});
test('Q3 actual Worker restart with identical state and independent authority/same-rev-different-wid holds', {timeout:180000},async t=>{
  const s=await server(t,'C1 generation owner'),p=await root(t),d=await driver(adapter(p),s);
  const e=await d.event(state()),out=await d.attempt([e],await d.readBase());assert.equal(out.status,'ACKNOWLEDGED_RETAINED_SCOPED');
  assert.equal((await d.verify(out.receipt,out.observation)).status,'ACKNOWLEDGED_RETAINED_SCOPED');
  const other=await server(t,'C1 independent owner');assert.notEqual(other.uid,s.uid);
  assert.equal((await other.send('/api/data','PUT',JSON.stringify({state:state(),baseRev:0,stamped:true}))).status,200);
  const data=await other.send('/api/data'),rev=await other.send('/api/data/rev'),me=await other.send('/api/me'),inv=await inventory(adapter(p));
  assert.equal(data.body.rev,out.receipt.body.committed.rev);assert.notEqual(data.body.state._wid,out.receipt.body.committed.wid);
  assert.equal(compare(inv,out.intent,{...out.observation,data,rev},d.auth,{active:[],media:[]}).status,'RECOVERY_HOLD');
  assert.equal(compare(inv,out.intent,{...out.observation,before:me,after:me},d.auth,{active:[],media:[]}).status,'RECOVERY_HOLD');
  const before=await s.get();await s.restart();const after=await s.get();assert.equal(same(before,after),true);
  assert.equal((await d.verify(out.receipt,out.observation)).status,'RECOVERY_HOLD');
  const restart=await driver(adapter(p),s);assert.equal((await restart.attempt([e],await restart.readBase())).status,'RECOVERY_HOLD');
  assert.equal((await s.get()).rev,before.rev);
  console.log('C1_Q3 actual disposable Worker restart, identical document, continuity HOLD');
});
test('Q4 missing historical graph references block fresh planning; metadata loss cannot create provenance',async t=>{
  const p=await root(t),a=adapter(p),v=await vault(a),e=await source(v,auth,state()),f=await source(v,auth,state({note:'fresh'}));await v.record(e);await v.record(f);
  const inv=await inventory(a),broken={...inv,raw:new Map(inv.raw)};broken.raw.delete('p7-c1-evidence/'+e.body.source.raw.id+'.bin');
  assert.equal(validGraph(broken),false);assert.equal(plan(broken,auth,new Set([f.body.eventId]),{rev:0,state:null},[refEntry(f)]).status,'RECOVERY_HOLD');
});
