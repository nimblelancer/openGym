// Pure fixture planner and comparison. Unknown transformation => HOLD.
// No writes, network calls, credentials or destructive actions here.
import {canonical,parse,record,logical,refEntry,D,sha,id,same,obj,hex,requireThat,wid,keys,serverIdentity} from './contract.mjs';
import {resolveBytes,resolveEntry} from './storage.mjs';
import {transition,forClient} from '../../src/sync/transition.js';
import {mergeStates} from '../../../frontend/src/lib/sync-merge.js';
import {referencedFiles} from '../../../frontend/src/lib/media-refs.js';
const B=v=>Buffer.from(canonical(v));
const equal=(a,b)=>a!==undefined&&b!==undefined&&same(a,b);
const HOLD=reason=>({status:'RECOVERY_HOLD',reason});
export function scope(inv,auth,fresh=new Set()){
  const raw=[...inv.raw.keys()], statuses=[], seen=new Map();let complete=inv.complete;
  for(const r of inv.records.values())if(r.type==='entry'){
    try{
      resolveEntry(inv,refEntry(r));
      const b=r.body, prev=seen.get(b.eventId);if(prev&&!same(logical(prev.body),logical(b)))throw Error('event collision');seen.set(b.eventId,r);
      const attempted=[...inv.records.values()].some(x=>x.type==='intent'&&x.body.entries.some(e=>e.eventId===b.eventId));
      statuses.push({id:r.id,eventId:b.eventId,status:b.owner!==auth.owner||b.server!==auth.server?'FOREIGN':
        ['manual','legacy-unbound'].includes(b.kind)?'MANUAL_ONLY':
        fresh.has(b.eventId)&&b.source.medium==='synthetic-new-event'&&!attempted?'PLAN_ELIGIBLE':'RECOVERY_HOLD'});
    }catch{complete=false;statuses.push({id:r.id,status:'CORRUPT_OR_UNREADABLE'})}
  }
  // Any legacy or mirror source stays in raw inventory, regardless of logical status.
  if(!complete)for(const s of statuses)if(s.status==='PLAN_ELIGIBLE')s.status='RECOVERY_HOLD';
  return {raw,statuses,complete};
}
// Enumerate actual application refs plus a conservative structural scan that
// refuses malformed hash/size shapes (including unknown future refs).
export function media(state){
  const found=new Map();
  function add(h,n){requireThat(hex(h)&&Number.isSafeInteger(n)&&n>0);if(found.has(h))requireThat(found.get(h)===n);found.set(h,n)}
  function visit(v){if(!v||typeof v!=='object')return;
    if(Object.hasOwn(v,'hash'))add(v.hash,v.size);
    for(const child of Object.values(v))visit(child)
  }
  visit(state);
  // referencedFiles returns normalized originals/posters; structural walk
  // retains even rejected/device-only shapes instead of dropping them.
  for(const f of referencedFiles(state))add(f.hash,f.size);
  return [...found].sort(([a],[b])=>a.localeCompare(b)).map(([sha256,byteLength])=>({sha256,byteLength}));
}
export function rawMedia(inv){
  try{
    requireThat(inv.complete);const found=new Map();const add=s=>{for(const f of media(s)){if(found.has(f.sha256))requireThat(found.get(f.sha256)===f.byteLength);found.set(f.sha256,f.byteLength)}};
    for(const [path,b] of inv.raw){
      if(path==='gym_stash'||path==='opengym-stash.json'){const all=parse(b);for(const [k,e] of Object.entries(all)){requireThat(obj(e)&&Number.isSafeInteger(e.at)&&e.at>=0);if(e.cleared===true){requireThat(!Object.hasOwn(e,'state'));continue}requireThat(typeof e.uid==='string'&&e.uid&&k===(e.server||'')+'|'+e.uid&&obj(e.state));add(e.state)}}
      if(path==='opengym-state.json'||path==='opengym-state.next.json'){const x=parse(b);add(x.state||x)}
    }
    for(const r of inv.records.values())if(r.type==='entry'){resolveEntry(inv,refEntry(r));add(r.body.payload)}
    return {complete:true,files:[...found].map(([sha256,byteLength])=>({sha256,byteLength}))};
  }catch{return {complete:false,files:[]}}
}
export function obligations(entries){
  const active=[],files=[];
  for(const r of entries){const p=r.body.payload;
    if(p.active!=null){requireThat(obj(p.active));active.push({entryId:r.id,digest:sha(B(p.active)),required:true})}
    for(const f of media(p))files.push({entryId:r.id,...f})
  }
  return {active,media:files};
}
export function plan(inv,auth,fresh,base,refs,{conflictEvents=new Set()}={}){
  try{
    requireThat(inv.complete&&rawMedia(inv).complete&&refs.length>0);
    const view=scope(inv,auth,fresh);requireThat(view.complete);
    const entries=refs.map(e=>resolveEntry(inv,e));requireThat(new Set(entries.map(e=>e.body.eventId)).size===entries.length);
    for(const r of entries){
      const b=r.body;requireThat(b.owner===auth.owner&&b.server===auth.server&&b.kind==='owned'&&b.source.medium==='synthetic-new-event');
      requireThat(view.statuses.some(x=>x.id===r.id&&x.status==='PLAN_ELIGIBLE')||conflictEvents.has(b.eventId));
      // Unsupported reset/tombstone/held semantics cannot generate a receipt.
      requireThat(!b.payload.resetAt&&!b.payload.deleted&&!base.state?.resetAt&&!base.state?.deleted);
    }
    let state=base.state;
    for(const r of entries)state=state===null?structuredClone(r.body.payload):mergeStates(state,r.body.payload);
    requireThat(obj(state));return {status:'PLAN_ELIGIBLE',state,entries,obligations:obligations(entries)};
  }catch{return HOLD('plan')}
}
export function compare(inv,intent,observation,auth,localProof){
  try{
    requireThat(inv.complete&&rawMedia(inv).complete&&intent.type==='intent');
    const b=intent.body;requireThat(b.owner===auth.owner&&b.server===auth.server&&b.epochId===auth.epochId&&observation.epochId===auth.epochId&&observation.server===auth.server);
    const stored=inv.records.get(intent.id);requireThat(stored&&same(stored,intent));
    const es=b.entries.map(e=>resolveEntry(inv,e));
    requireThat(es.every(r=>r.body.owner===b.owner&&r.body.server===b.server&&r.body.kind==='owned'));
    const baseBytes=resolveBytes(inv,b.base.stateBytes),base=parse(baseBytes,{exact:true});
    requireThat(D('base-client-state',baseBytes)===b.base.stateDigest&&(base===null?b.base.rev===0&&b.base.wid===null:base._rev===b.base.rev&&base._wid===b.base.wid));
    const wire=resolveBytes(inv,b.wire), w=parse(wire), planned=resolveBytes(inv,b.planned.stateBytes);
    keys(w,b.base.rev===0?'state baseRev stamped':'state baseRev baseWid stamped');
    requireThat(wire.equals(observation.wire)&&D('wire',wire)===b.wireDigest&&D('planned-state',planned)===b.planned.stateDigest&&same(parse(planned,{exact:true}),w.state)&&w.baseRev===b.base.rev&&(w.baseWid??null)===b.base.wid);
    let expected=base;for(const r of es)expected=expected===null?structuredClone(r.body.payload):mergeStates(expected,r.body.payload);
    requireThat(same(expected,w.state)&&same(obligations(es),b.obligations));
    const me=x=>x?.status===200&&x.body?.user?.id===b.owner;
    requireThat(me(observation.before)&&me(observation.after)&&observation.ack?.status===200);
    const ack=observation.ack.body;requireThat(ack?.ok===true&&wid(ack.wid)&&ack.rev===b.base.rev+1);
    const data=observation.data,rev=observation.rev,doc=data?.body?.state;
    requireThat(data?.status===200&&rev?.status===200&&obj(doc)&&doc._wid===ack.wid&&rev.body.wid===ack.wid&&doc._rev===data.body.rev&&rev.body.rev===doc._rev);
    // C1 positive subset: stamped, time-independent, no hidden-state-dependent
    // transformation. Two clock evaluations must yield identical entire client state.
    if(w.stamped!==true||doc._rev!==ack.rev||w.state.deleted||w.state.resetAt||base?.deleted||base?.resetAt)return {status:'ACK_OBSERVED',reason:'unsupported-transform'};
    const x=transition(base,w,{now:1000000000000,wid:()=>ack.wid}),y=transition(base,w,{now:2000000000000,wid:()=>ack.wid});
    requireThat(x.status===200&&y.status===200&&same(forClient(x.next),forClient(y.next))&&same(forClient(x.next),doc)&&same(x.body,ack));
    const dispositions=[];
    for(const r of es){
      const comparisons=[];
      for(const [k,v] of Object.entries(r.body.payload)){
        if(k==='active'){if(v!=null)comparisons.push({field:k,decision:'local-obligation'});continue}
        // Do not silently ignore or declare supersession of differing fields.
        if(!equal(doc[k],v))return {status:'ACK_OBSERVED',reason:'unproved-disposition'};
        comparisons.push({field:k,value:v,decision:'exact'});
      }
      requireThat(comparisons.some(c=>c.decision==='exact'));
      dispositions.push({entryId:r.id,logicalDigest:r.body.logicalDigest,decision:'incorporated',proof:{comparisons}});
    }
    keys(localProof,'active media');
    requireThat(localProof.active.length===b.obligations.active.length&&localProof.media.length===b.obligations.media.length);
    for(const a of b.obligations.active){
      const p=localProof.active.find(x=>x.entryId===a.entryId&&x.digest===a.digest);requireThat(p?.resolution==='exact-owner-tagged-copy');
      const e=parse(resolveBytes(inv,p.evidence),{exact:true}), source=es.find(r=>r.id===a.entryId).body.payload.active;
      requireThat(e.owner===b.owner&&e.server===b.server&&same(e.active,source)&&sha(B(e.active))===a.digest);
      // Proof must match a currently inventoried owner-tagged synthetic mirror.
      requireThat(['opengym-state.json','opengym-state.next.json'].some(path=>inv.raw.get(path)?.equals(resolveBytes(inv,p.evidence))));
    }
    for(const f of b.obligations.media){const p=localProof.media.find(x=>x.entryId===f.entryId&&x.sha256===f.sha256&&x.byteLength===f.byteLength);requireThat(p);const bytes=resolveBytes(inv,p.evidence);requireThat(sha(bytes)===f.sha256&&bytes.length===f.byteLength)}
    return {status:'RECEIPT_CANDIDATE',ack:{rev:ack.rev,wid:ack.wid},doc,dispositions,localProof};
  }catch{return HOLD('authority-or-evidence')}
}
// A durable receipt is not independently sufficient. The driver must retain a
// live capability tying it to a verified attempt; a restart has no capability.
export function receiptStatus(inv,receipt,auth,live,observation){
  try{
    requireThat(inv.complete&&receipt.type==='receipt'&&same(inv.records.get(receipt.id),receipt));
    const b=receipt.body,cap=live.get(receipt.id);requireThat(cap&&cap.epochId===auth.epochId&&cap.digest===receipt.bodyDigest&&b.owner===auth.owner&&b.server===auth.server);
    const intent=inv.records.get(b.intent.id);requireThat(intent?.bodyDigest===b.intent.bodyDigest);
    const result=compare(inv,intent,observation,auth,b.localProof);requireThat(result.status==='RECEIPT_CANDIDATE'&&same(result.ack,b.ack)&&b.attemptId===intent.body.attemptId&&b.wireDigest===intent.body.wireDigest&&same(b.entries,intent.body.entries)&&b.epochId===intent.body.epochId);
    const bytes=resolveBytes(inv,b.committed.stateBytes);requireThat(D('committed-client-state',bytes)===b.committed.stateDigest&&same(parse(bytes,{exact:true}),result.doc)&&b.committed.rev===result.doc._rev&&b.committed.wid===result.doc._wid);
    for(const d of result.dispositions){const actual=b.disposition.find(x=>x.entryId===d.entryId);requireThat(actual&&actual.logicalDigest===d.logicalDigest&&actual.decision===d.decision);
      const proof=parse(resolveBytes(inv,actual.evidence),{exact:true});requireThat(same(proof,{proof:d.proof,digest:D('disposition',canonical(d.proof))}))}
    return {status:'ACKNOWLEDGED_RETAINED_SCOPED'};
  }catch{return HOLD('receipt-authority')}
}
