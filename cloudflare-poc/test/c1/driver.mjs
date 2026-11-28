// C1 test-only I/O; all provenance and capabilities are volatile.
import {canonical,record,logical,id,D,sha,refEntry,requireThat,same} from './contract.mjs';
import {vault} from './storage.mjs';
import {plan,compare,receiptStatus} from './planner.mjs';
const B=v=>Buffer.from(canonical(v));
export async function driver(fs,server){
  const v=await vault(fs),auth={owner:server.uid,server:server.base,epochId:id()},fresh=new Set(),conflicts=new Set(),sent=new Set(),live=new Map();
  const hold=reason=>({status:'RECOVERY_HOLD',reason});
  const assertAuthority=async()=>{const me=await server.send('/api/me');requireThat(me.status===200&&me.body?.user?.id===auth.owner&&server.base===auth.server);return me};
  const evidenceState=async(label,state)=>{const bytes=B(state);return {stateDigest:D(label,bytes),stateBytes:await v.evidence(bytes)}};
  async function capture(wire,ack,before){
    const me=await server.send('/api/me'),data=await server.send('/api/data'),rev=await server.send('/api/data/rev'),after=await server.send('/api/me');
    return {epochId:auth.epochId,server:auth.server,wire,ack,before:before.status===200&&me.status===200&&me.body?.user?.id===auth.owner?before:me,after,data,rev};
  }
  return {auth,v,live,fresh,
    async event(payload,kind='owned'){
      const b={eventId:id(),owner:auth.owner,server:auth.server,kind,at:Date.now(),payload};
      const source={medium:'synthetic-new-event',selector:null,raw:await v.evidence(B({eventId:b.eventId,...logical(b)}))};
      const entry=record('entry',{...b,source,logicalDigest:D('logical-entry',canonical(logical(b)))});
      await v.record(entry);fresh.add(b.eventId);return entry;
    },
    async attempt(entries,base,{stamped=true,transport,proof={active:[],media:[]},hook=async()=>{}}={}){
      let intent,ack,observation,wire;
      try{
        await assertAuthority();
        const refs=entries.map(refEntry).sort((a,b)=>a.id.localeCompare(b.id));
        const p=plan(await v.check(),auth,fresh,base,refs,{conflictEvents:conflicts});
        if(p.status!=='PLAN_ELIGIBLE')return p;
        await hook('before-intent');
        const baseRef={rev:base.rev,wid:base.state?._wid??null,...await evidenceState('base-client-state',base.state)};
        const planned=await evidenceState('planned-state',p.state);
        wire=Buffer.from(JSON.stringify({state:p.state,baseRev:base.rev,...(base.rev?{baseWid:base.state._wid}:{}),stamped}));
        intent=record('intent',{attemptId:id(),owner:auth.owner,server:auth.server,epochId:auth.epochId,entries:refs,base:baseRef,planned,wire:await v.evidence(wire),wireDigest:D('wire',wire),obligations:p.obligations,createdAt:Date.now()});
        await v.record(intent);
        for(const r of entries){fresh.delete(r.body.eventId);conflicts.delete(r.body.eventId)}
        await hook('after-intent');const before=await assertAuthority();await v.check();
        requireThat(!sent.has(intent.body.attemptId));sent.add(intent.body.attemptId);
        ack=await (transport||server.send)('/api/data','PUT',wire.toString('utf8'));
        if(ack.status===409){
          // Only actual authenticated 409 enables one fresh replan. Do not
          // enable retry from missing or malformed acknowledgement.
          await assertAuthority();await v.check();for(const r of entries)conflicts.add(r.body.eventId);
          return {status:'RECOVERY_HOLD',reason:'conflict-replan-required',intent,ack};
        }
        await hook('after-ack');observation=await capture(wire,ack,before);
        const result=compare(await v.check(),intent,observation,auth,proof);
        if(result.status!=='RECEIPT_CANDIDATE')return {...result,intent,ack,observation};
        const committed={rev:result.doc._rev,wid:result.doc._wid,...await evidenceState('committed-client-state',result.doc)};
        const disposition=[];
        for(const d of result.dispositions)disposition.push({entryId:d.entryId,logicalDigest:d.logicalDigest,decision:d.decision,evidence:await v.evidence(B({proof:d.proof,digest:D('disposition',canonical(d.proof))}))});
        const b=intent.body,receipt=record('receipt',{intent:{id:intent.id,bodyDigest:intent.bodyDigest},attemptId:b.attemptId,owner:b.owner,server:b.server,epochId:b.epochId,entries:b.entries,wireDigest:b.wireDigest,ack:result.ack,committed,disposition,localProof:proof,observedAt:Date.now()});
        await hook('before-receipt');await assertAuthority();await v.check();
        // Re-observe exact committed identity immediately before publication.
        observation=await capture(wire,ack,before);
        requireThat(compare(await v.check(),intent,observation,auth,proof).status==='RECEIPT_CANDIDATE'&&same(observation.data.body.state,result.doc));
        await v.record(receipt);
        await hook('after-receipt');
        observation=await capture(wire,ack,before);await assertAuthority();
        const inv=await v.check();live.set(receipt.id,{epochId:auth.epochId,digest:receipt.bodyDigest});
        const final=receiptStatus(inv,receipt,auth,live,observation);
        if(final.status!=='ACKNOWLEDGED_RETAINED_SCOPED')live.delete(receipt.id);
        return {...final,intent,receipt,ack,observation};
      }catch{return {...hold('driver-evidence-or-transport'),intent,ack,observation}}
    }
  }
}
