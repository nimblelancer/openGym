// Disposable Phase 7 local diagnostic only. Same runtime and bindings as
// wrangler.web-media.jsonc, with no auth/media behavior changes.
import web,{AuthCoordinator as Base} from '../src/web-worker.js';
const probe=req=>req.method==='PUT'&&/^\/api\/media\/[a-f0-9]{64}$/.test(new URL(req.url).pathname)&&req.headers.get('content-length')==='8388609';
const mark=(layer,event,status)=>console.log('P7TRACE:'+layer+':'+event+(status===undefined?'':':'+status));
export class AuthCoordinator extends Base {
  async fetch(req){
    const active=probe(req);
    if(active)mark('DO','entry');
    try{const res=await super.fetch(req);if(active)mark('DO','return',res.status);return res;}
    catch(e){if(active)mark('DO','throw');throw e;}
  }
}
export default {async fetch(req,env){
  const active=probe(req);
  if(active)mark('OUTER','entry');
  try{const res=await web.fetch(req,env);if(active)mark('OUTER','return',res.status);return res;}
  catch(e){if(active)mark('OUTER','throw');throw e;}
}};
