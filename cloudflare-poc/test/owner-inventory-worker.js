// Disposable synthetic-only R2 binding harness. Run only through localRunner.
// Not imported by any application Worker. No real owner ids, credentials,
// destructive routes or remote bindings. The test supplies only tiny fixtures.
const keyOK=k=>typeof k==='string'&&/^private\/v1\/syntheticOwner0[12]\/[a-f0-9]{64}$/.test(k);
const prefixOK=p=>p==='private/v1/syntheticOwner01/'||p==='private/v1/syntheticOwner02/';
const meta=o=>({key:o.key,size:o.size,version:o.version,etag:o.etag,httpMetadata:o.httpMetadata,customMetadata:o.customMetadata});
export default {async fetch(req,env){
  const url=new URL(req.url);
  if(url.hostname!=='127.0.0.1')return new Response(null,{status:403});
  if(url.pathname==='/__poc/health'&&req.method==='GET')return Response.json({ok:true});
  if(req.method!=='POST')return new Response(null,{status:405});
  const text=await req.text();
  if(text.length>16384)return new Response(null,{status:413});
  const input=JSON.parse(text);
  if(url.pathname==='/__poc/list'&&prefixOK(input.prefix)){
    const limit=input.limit??100;
    if(!Number.isSafeInteger(limit)||limit<1||limit>100||input.cursor!=null&&typeof input.cursor!=='string')return new Response(null,{status:400});
    const page=await env.MEDIA.list({prefix:input.prefix,limit,include:['httpMetadata','customMetadata'],...(input.cursor?{cursor:input.cursor}:{})});
    return Response.json({objects:page.objects.map(meta),truncated:page.truncated,...(page.truncated?{cursor:page.cursor}:{})});
  }
  if(!keyOK(input.key))return new Response(null,{status:400});
  if(url.pathname==='/__poc/put'){
    const bytes=Uint8Array.from(atob(input.bytes),c=>c.charCodeAt(0));
    if(bytes.length<1||bytes.length>4096)return new Response(null,{status:413});
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
    if(!input.key.endsWith('/'+hash)||input.opts?.customMetadata?.sha256!==hash||input.opts?.httpMetadata?.contentType!=='image/png')return new Response(null,{status:400});
    const o=await env.MEDIA.put(input.key,bytes,{httpMetadata:{contentType:'image/png'},customMetadata:{sha256:hash}});
    return Response.json(meta(o));
  }
  if(url.pathname==='/__poc/get'){
    const o=await env.MEDIA.get(input.key);
    if(!o)return new Response('',{headers:{'x-poc-absent':'1'}});
    return new Response(o.body,{headers:{'x-poc-object':JSON.stringify(meta(o))}});
  }
  return new Response(null,{status:404});
}};
