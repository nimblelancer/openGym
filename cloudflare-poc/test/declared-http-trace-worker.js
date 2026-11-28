// Disposable Phase 7 local diagnostic only. Same runtime and bindings as
// wrangler.web-media.jsonc, with no auth/media behavior changes.
import web,{AuthCoordinator as Base} from '../src/web-worker.js';
const probe=req=>req.method==='PUT'&&/^\/api\/media\/[a-f0-9]{64}$/.test(new URL(req.url).pathname)&&req.headers.get('content-length')==='8388609';
const mark=(layer,event,status)=>console.log('P7TRACE:'+layer+':'+event+(status===undefined?'':':'+status));
const exactControl=req=>req.method==='PUT'&&new URL(req.url).hostname==='127.0.0.1'&&req.headers.get('content-length')==='8388609';
const controlResponse=mode=>Response.json({code:'fixture-rejected'},{status:413,headers:{'x-p7-control':mode}});
async function consumeControl(req){
  let count=0;const reader=req.body.getReader();
  try{while(true){const {done,value}=await reader.read();if(done)break;count+=value.byteLength;if(count>8388609)throw Error('fixture bound');}}
  finally{reader.releaseLock();}
  return count===8388609;
}
const doModes=['do-early','do-drain','do-materialized','do-bodyless'];
export class AuthCoordinator extends Base {
  async fetch(req){
    const mode=new URL(req.url).pathname.slice('/__p7/'.length);
    if(doModes.includes(mode)&&new URL(req.url).pathname==='/__p7/'+mode&&
       new URL(req.url).hostname==='127.0.0.1'&&req.method==='PUT'&&
       (mode==='do-bodyless'?req.body===null:exactControl(req))){
      console.log('P7BRIDGE:DO:'+mode+':entry');
      if(mode==='do-drain'&&!await consumeControl(req))return new Response(null,{status:400});
      console.log('P7BRIDGE:DO:'+mode+':return:413');
      return controlResponse(mode);
    }
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
  const mode=pathname.slice('/__p7/'.length);
  if(exactControl(req)&&doModes.includes(mode)&&pathname==='/__p7/'+mode){
    console.log('P7BRIDGE:OUTER:'+mode+':entry');
    const stub=env.AUTH.get(env.AUTH.idFromName('phase7-synthetic-transport-control'));
    // All modes use the same DO binding. Only the transferred body or the
    // returned response stream differs. This is not a production request path.
    const forwarded=mode==='do-bodyless'?new Request(req.url,{method:'PUT'}):req;
    let res=await stub.fetch(forwarded);
    if(mode==='do-materialized'){
      // The fixed synthetic JSON is 27 bytes; don't buffer arbitrary responses.
      const reader=res.body.getReader(),chunks=[];let size=0;
      try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>64){await reader.cancel();throw Error('control response bound');}chunks.push(value);}}
      finally{reader.releaseLock();}
      const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
      res=new Response(bytes,{status:res.status,headers:res.headers});
    }
    console.log('P7BRIDGE:OUTER:'+mode+':return:'+res.status);
    return res;
  }
  const active=probe(req);
  if(active)mark('OUTER','entry');
  try{const res=await web.fetch(req,env);if(active)mark('OUTER','return',res.status);return res;}
  catch(e){if(active)mark('OUTER','throw');throw e;}
}};
