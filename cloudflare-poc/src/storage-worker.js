// Local-only test harness. No production API routes or actual authentication.
import { DurableObject } from 'cloudflare:workers';
import { StateStore,stateResponse,revisionResponse } from './storage/store.js';
import { readBody,HttpInputError,MAX_STORED } from './storage/codec.js';
const allowed=new Set(['alpha','beta','seed','corrupt','meta','schema']);
const FIXED=1800000000000;
const out=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export default {async fetch(req,env){
  const u=new URL(req.url);
  if(!['localhost','127.0.0.1'].includes(u.hostname))return out({error:'local only'},403);
  if(req.method==='GET'&&u.pathname==='/__poc/health')return out({ok:true});
  const m=u.pathname.match(/^\/__storage\/(alpha|beta|seed|corrupt|meta|schema)\/(state|rev|import|export|metrics|fault|inspect|damage|schema)$/);
  if(!m||!allowed.has(m[1]))return out({error:'not found'},404);
  return env.STORE.get(env.STORE.idFromName('phase2-synthetic')).fetch(req);
}};
export class StorageFixture extends DurableObject{
  constructor(ctx,env){super(ctx,env);this.storage=ctx.storage;this.store=new StateStore(ctx.storage);}
  async fetch(req){
    const [, , id,op]=new URL(req.url).pathname.split('/');
    if(!allowed.has(id))return out({error:'not found'},404);
    const start=performance.now();
    let r;
    try{
      if(op==='state'&&req.method==='GET')r=stateResponse(await this.store.read(id));
      else if(op==='rev'&&req.method==='GET')r=revisionResponse(await this.store.revision(id));
      else if(op==='state'&&req.method==='PUT')r=await this.store.compareAndWrite(id,await readBody(req),{now:FIXED});
      else if(op==='export'&&req.method==='GET')r=await this.store.exportSnapshot(id);
      else if(op==='import'&&req.method==='POST'){const b=await readBody(req,MAX_STORED+1024*1024);r=await this.store.importSnapshot(id,b.snapshot,b.mode,{now:FIXED,fault:b.fault});}
      else if(op==='fault'&&req.method==='POST'){const b=await readBody(req);r=await this.store.compareAndWrite(id,b.body,{now:FIXED,fault:b.fault});}
      else if(op==='metrics'&&req.method==='GET')r={status:200,body:{...this.store.metrics}};
      else if(op==='inspect'&&req.method==='GET'){const s=await this.store.read(id);r={status:200,body:s};}
      else if(op==='damage'&&req.method==='POST'&&['corrupt','meta'].includes(id)){
        if(id==='corrupt')this.store.sql.exec('UPDATE profile_chunks SET bytes=? WHERE profile_id=? AND idx=0',new Uint8Array([1,2]),id);
        else this.store.sql.exec('UPDATE profile_state SET rev=999 WHERE profile_id=?',id);
        r={status:200,body:{ok:true}};
      }else if(op==='schema'&&req.method==='POST'&&id==='schema'){
        // Synthetic schema probe only; restore version even if assertion fails.
        let rejected=false;
        this.store.sql.exec('UPDATE schema_version SET version=99');
        try{new StateStore(this.storage);}catch(e){rejected=e.message==='unsupported schema';}
        finally{this.store.sql.exec('UPDATE schema_version SET version=1');}
        r={status:200,body:{rejected}};
      }else r={status:404,body:{error:'not found'}};
    }catch(e){r={status:e instanceof HttpInputError?e.status:503,body:{error:e instanceof HttpInputError?e.message:'state unreadable'}};}
    const res=out(r.body,r.status);res.headers.set('X-POC-Wall-Ms',String(performance.now()-start));return res;
  }
}
