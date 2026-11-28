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
  const pathname=new URL(req.url).pathname;
  // Test-only control: isolate unread-body transport without auth, DO, R2 or
  // app state. The drain variant is bounded to this exact synthetic fixture;
  // never use it as a production oversized upload policy.
  if(req.method==='PUT'&&new URL(req.url).hostname==='127.0.0.1'&&req.headers.get('content-length')==='8388609'&&['/__p7/early','/__p7/drain'].includes(pathname)){
    const mode=pathname.endsWith('drain')?'drain':'early';
    if(mode==='drain'){
      let count=0;const reader=req.body.getReader();
      try{while(true){const {done,value}=await reader.read();if(done)break;count+=value.byteLength;if(count>8388609)throw Error('fixture bound');}}
      finally{reader.releaseLock();}
      if(count!==8388609)return new Response(null,{status:400});
    }
    console.log('P7CONTROL:'+mode+':return:413');
    return Response.json({code:'fixture-rejected'},{status:413,headers:{'x-p7-control':mode}});
  }
  const active=probe(req);
  if(active)mark('OUTER','entry');
  try{const res=await web.fetch(req,env);if(active)mark('OUTER','return',res.status);return res;}
  catch(e){if(active)mark('OUTER','throw');throw e;}
}};
