// C1 test-only I/O; all provenance and capabilities are volatile.
import {canonical,record,logical,id,D,sha,refEntry,requireThat,same,LIMIT} from './contract.mjs';
import {vault,bounded} from './storage.mjs';
import {plan,compare,receiptStatus} from './planner.mjs';
const B=v=>Buffer.from(canonical(v));
export async function driver(fs,server){
  const v=await vault(fs),auth={owner:server.uid,server:server.base,epochId:id(),fixtureGeneration:server.fixtureGeneration},fresh=new Set(),conflicts=new Set(),sent=new Set(),live=new Map(),observedBases=new Set();
  const hold=reason=>({status:'RECOVERY_HOLD',reason});
  const timeLeft=until=>{const left=until-Date.now();requireThat(left>0);return Math.min(left,LIMIT.io)};
  const request=(until,...args)=>bounded(()=>server.send(...args),timeLeft(until));
  const assertAuthority=async(until=Date.now()+LIMIT.operation)=>{try{const me=await request(until,'/api/me');requireThat(me.status===200&&me.body?.user?.id===auth.owner&&server.base===auth.server&&server.fixtureGeneration===auth.fixtureGeneration);return me}catch(e){live.clear();throw e}};
  const evidenceState=async(label,state,until)=>{const bytes=B(state);return {stateDigest:D(label,bytes),stateBytes:await v.evidence(bytes,until)}};
  async function capture(wire,ack,before,until){
    const me=await request(until,'/api/me'),data=await request(until,'/api/data'),rev=await request(until,'/api/data/rev'),after=await request(until,'/api/me');
    return {epochId:auth.epochId,fixtureGeneration:server.fixtureGeneration,server:auth.server,wire,ack,before:before.status===200&&me.status===200&&me.body?.user?.id===auth.owner?before:me,after,data,rev};
  }
  async function readBase(until=Date.now()+LIMIT.operation){await assertAuthority(until);const read=await request(until,'/api/data'),base=read.body,rev=await request(until,'/api/data/rev');await assertAuthority(until);requireThat(read.status===200&&rev.status===200&&rev.body?.rev===base.rev&&(rev.body?.wid??null)===(base.state?._wid??null));observedBases.add(canonical(base));return base}
  return {auth,v,live,fresh,readBase,
    async verify(receipt,old){const until=Date.now()+LIMIT.operation;try{const before=await assertAuthority(until),observation=await capture(old.wire,old.ack,before,until),inv=await v.check(until);const result=receiptStatus(inv,receipt,auth,live,observation);if(result.status!=='ACKNOWLEDGED_RETAINED_SCOPED')live.delete(receipt.id);return result}catch{live.delete(receipt.id);return hold('receipt-authority')}},
    async event(payload,kind='owned'){
      const b={eventId:id(),owner:auth.owner,server:auth.server,kind,at:Date.now(),payload};
      const source={medium:'synthetic-new-event',selector:null,raw:await v.evidence(B({eventId:b.eventId,...logical(b)}))};
      const entry=record('entry',{...b,source,logicalDigest:D('logical-entry',canonical(logical(b)))});
      await v.record(entry);fresh.add(b.eventId);return entry;
    },
    async attempt(entries,base,{stamped=true,transport,proof={active:[],media:[]},hook=async()=>{}}={}){
      let intent,ack,observation,wire;const until=Date.now()+LIMIT.operation;const guard=()=>timeLeft(until);
      try{
        guard();await assertAuthority(until);requireThat(observedBases.has(canonical(base)));
        if(entries.some(r=>conflicts.has(r.body.eventId)))requireThat(same(base,await readBase(until)));
        const refs=entries.map(refEntry).sort((a,b)=>a.id.localeCompare(b.id));
        const p=plan(await v.check(until),auth,fresh,base,refs,{conflictEvents:conflicts});
        if(p.status!=='PLAN_ELIGIBLE')return p;
        await bounded(()=>hook('before-intent'),timeLeft(until));guard();
        const baseRef={rev:base.rev,wid:base.state?._wid??null,...await evidenceState('base-client-state',base.state,until)};
        const planned=await evidenceState('planned-state',p.state,until);
        wire=Buffer.from(JSON.stringify({state:p.state,baseRev:base.rev,...(base.rev?{baseWid:base.state._wid}:{}),stamped}));
        intent=record('intent',{attemptId:id(),owner:auth.owner,server:auth.server,epochId:auth.epochId,entries:refs,base:baseRef,planned,wire:await v.evidence(wire,until),wireDigest:D('wire',wire),obligations:p.obligations,createdAt:Date.now()});
        guard();await v.record(intent,until);
        for(const r of entries){fresh.delete(r.body.eventId);conflicts.delete(r.body.eventId)}
        await bounded(()=>hook('after-intent'),timeLeft(until));guard();const before=await assertAuthority(until);await v.check(until);
        requireThat(!sent.has(intent.body.attemptId));sent.add(intent.body.attemptId);
        guard();if(transport){await bounded(()=>transport('/api/data','PUT',wire.toString('utf8')),timeLeft(until));return hold('fault-transport-not-authoritative')}
        ack=await request(until,'/api/data','PUT',wire.toString('utf8'));
        if(ack.status===409){
          // Only actual authenticated 409 enables one fresh replan. Do not
          // enable retry from missing or malformed acknowledgement.
          await assertAuthority(until);await v.check(until);for(const r of entries)conflicts.add(r.body.eventId);
          return {status:'RECOVERY_HOLD',reason:'conflict-replan-required',intent,ack};
        }
        await bounded(()=>hook('after-ack'),timeLeft(until));guard();observation=await capture(wire,ack,before,until);
        const result=compare(await v.check(until),intent,observation,auth,proof);
        if(result.status!=='RECEIPT_CANDIDATE')return {...result,intent,ack,observation};
        const committed={rev:result.doc._rev,wid:result.doc._wid,...await evidenceState('committed-client-state',result.doc,until)};
        const disposition=[];
        for(const d of result.dispositions)disposition.push({entryId:d.entryId,logicalDigest:d.logicalDigest,decision:d.decision,evidence:await v.evidence(B({proof:d.proof,digest:D('disposition',canonical(d.proof))}),until)});
        const b=intent.body,receipt=record('receipt',{intent:{id:intent.id,bodyDigest:intent.bodyDigest},attemptId:b.attemptId,owner:b.owner,server:b.server,epochId:b.epochId,entries:b.entries,wireDigest:b.wireDigest,ack:result.ack,committed,disposition,localProof:proof,observedAt:Date.now()});
        await bounded(()=>hook('before-receipt'),timeLeft(until));guard();await assertAuthority(until);await v.check();
        // Re-observe exact committed identity immediately before publication.
        observation=await capture(wire,ack,before,until);
        requireThat(compare(await v.check(until),intent,observation,auth,proof).status==='RECEIPT_CANDIDATE'&&same(observation.data.body.state,result.doc));
        guard();await v.record(receipt,until);
        await bounded(()=>hook('after-receipt'),timeLeft(until));guard();
        observation=await capture(wire,ack,before,until);await assertAuthority(until);
        const inv=await v.check(until);live.set(receipt.id,{epochId:auth.epochId,digest:receipt.bodyDigest});
        const final=receiptStatus(inv,receipt,auth,live,observation);
        if(final.status!=='ACKNOWLEDGED_RETAINED_SCOPED')live.delete(receipt.id);
        return {...final,intent,receipt,ack,observation};
      }catch{return {...hold('driver-evidence-or-transport'),intent,ack,observation}}
    }
  }
}
