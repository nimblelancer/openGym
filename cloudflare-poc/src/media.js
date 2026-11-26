// Phase 5 local-only candidate; no remote bucket. No automatic destructive GC yet.
import { createHash } from 'node:crypto';
import { sniffKind,imageDims,inspectGif,inspectMp4,inspectWebm } from '../../frontend/src/lib/media-sniff.js';
import { MEDIA_MIMES,HASH_RE } from '../../frontend/src/lib/media-refs.js';
import { HttpInputError } from './storage/codec.js';
const MB=1024*1024;
export const MEDIA_CONFIG={imageMB:2,gifMB:8,videoMB:8,videoSec:60,audioMB:2,quotaMB:200,workouts:true,days:true,sets:true,sounds:true,avatar:true,builtin:true};
const LIMIT=8*MB, QUOTA=200*MB, COUNT=500;
const error=(status,code,message=code,extra={})=>Response.json({error:message,code,...extra},{status});
const json=(b,status=200)=>Response.json(b,{status});
const missing=()=>error(404,'media-missing','no such file');
const denied=()=>error(401,'not-signed-in','not signed in');
const cap=k=>k==='image'||k==='audio'?2*MB:k==='gif'||k==='video'?LIMIT:0;
const prefix=uid=>'private/v1/'+uid+'/';
const path=(uid,h)=>prefix(uid)+h;
export const mediaRoute=(method,p)=>method==='POST'&&['/api/media/missing','/api/media/sweep'].includes(p)||['GET','PUT','HEAD'].includes(method)&&/^\/api\/media\/[a-f0-9]{64}$/.test(p);
export async function inventory(bucket,uid){
  const r=await bucket.list({prefix:prefix(uid),limit:COUNT+1,include:['httpMetadata','customMetadata']});
  if(r.truncated||r.objects.length>COUNT||r.objects.some(o=>!HASH_RE.test(o.key.slice(prefix(uid).length))))throw Error('media inventory invalid');
  return {objects:r.objects,usage:{bytes:r.objects.reduce((n,o)=>n+o.size,0),count:r.objects.length,quotaBytes:QUOTA}};
}
// Cap the whole request as well as each read. A slow trickle cannot hold admission
// indefinitely, and tiny chunks cannot create an unbounded array of buffers.
export async function boundedBytes(req,max,{idleMs=15000,totalMs=45000}={}){
  const declared=req.headers.get('content-length');
  if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>max))return null;
  if(!req.body){if(Number(declared)>0)throw new HttpInputError(400,'incomplete body');return Buffer.alloc(0);}
  const reader=req.body.getReader(),buf=Buffer.allocUnsafe(declared===null?max:Number(declared));
  const deadline=Date.now()+totalMs;let n=0;
  const cancel=()=>{try{reader.cancel().catch(()=>{});}catch{}};
  try{
    while(true){
      const remaining=deadline-Date.now();
      if(remaining<=0)throw new HttpInputError(408,'upload deadline exceeded');
      let timer;
      const {done,value}=await Promise.race([reader.read(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new HttpInputError(408,'upload stalled or deadline exceeded')),Math.min(idleMs,remaining));})]).finally(()=>clearTimeout(timer));
      if(done)break;
      if(n+value.byteLength>max){cancel();return null;}
      if(n+value.byteLength>buf.length)throw new HttpInputError(400,'content-length mismatch');
      buf.set(value,n);n+=value.byteLength;
    }
    if(declared!==null&&Number(declared)!==n)throw new HttpInputError(400,'incomplete body');
    return buf.subarray(0,n);
  }catch(e){cancel();throw e;}finally{reader.releaseLock();}
}
// JSON media operations hold the same admission lock; bound their time as well.
export async function readMediaJson(req,max){
  const bytes=await boundedBytes(req,max);
  if(!bytes)throw new HttpInputError(413,'body too large');
  if(!bytes.length)return {};
  if(!/^application\/json\s*(;|$)/i.test(req.headers.get('content-type')||''))throw new HttpInputError(415,'content-type must be application/json');
  let data;try{data=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new HttpInputError(400,'invalid json');}
  if(!data||typeof data!=='object'||Array.isArray(data))throw new HttpInputError(400,'invalid json');
  return data;
}
// Canonical WAV emitted by pinned sound-ingest.js: no extra chunks/tags,
 // 16-bit mono PCM at 22050 Hz, at most 30 seconds.
function canonicalWav(bytes){
  if(bytes.length<46)return false;
  const b=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength),n=b.length-44;
  return b.toString('ascii',0,4)==='RIFF'&&b.readUInt32LE(4)===b.length-8&&
    b.toString('ascii',8,16)==='WAVEfmt '&&b.readUInt32LE(16)===16&&
    b.readUInt16LE(20)===1&&b.readUInt16LE(22)===1&&b.readUInt32LE(24)===22050&&
    b.readUInt32LE(28)===44100&&b.readUInt16LE(32)===2&&b.readUInt16LE(34)===16&&
    b.toString('ascii',36,40)==='data'&&b.readUInt32LE(40)===n&&n%2===0&&n<=30*44100;
}
export function inspect(bytes,declared){
  const sn=sniffKind(bytes.subarray(0,64)),type=MEDIA_MIMES[declared];
  if(!sn||sn.input||!type||!cap(sn.kind)||sn.category!==type.category)return {status:415,code:'media-type'};
  if(bytes.length>cap(sn.kind))return {status:413,code:'media-too-large'};
  if(sn.kind==='image'||sn.kind==='gif'){
    const d=imageDims(bytes);
    if(!d||d.width*d.height>52_000_000)return {status:415,code:'media-invalid'};
    if(sn.kind==='gif'&&!inspectGif(bytes))return {status:415,code:'media-invalid'};
  }else if(sn.kind==='audio'){
    if(!canonicalWav(bytes))return {status:415,code:'media-invalid'};
  }else{
    const info=sn.mime==='video/webm'?inspectWebm(bytes):inspectMp4(bytes);
    if(!info||!Number.isFinite(info.durationSec)||info.durationSec<=0||!info.width||!info.height)return {status:415,code:'media-invalid'};
    if(info.durationSec>61)return {status:413,code:'media-too-long'};
  }
  return {mime:sn.mime};
}
export function parseRange(raw,size){
  if(!raw)return null;
  const m=/^bytes=(\d*)-(\d*)$/.exec(raw);
  if(!m||!m[1]&&!m[2]||!size)return false;
  if((m[1]&&!Number.isSafeInteger(Number(m[1])))||(m[2]&&!Number.isSafeInteger(Number(m[2]))))return false;
  const a=m[1]?Number(m[1]):Math.max(0,size-Number(m[2]));
  const b=m[1]?(m[2]?Math.min(size-1,Number(m[2])):size-1):size-1;
  return Number.isSafeInteger(a)&&Number.isSafeInteger(b)&&a>=0&&a<=b&&a<size?{offset:a,length:b-a+1}:false;
}
function validObject(o,h){return !!o&&o.size>0&&o.size<=cap(MEDIA_MIMES[o.httpMetadata?.contentType]?.kind)&&o.customMetadata?.sha256===h;}
export async function handleMedia(req,uid,bucket,live){
  const p=new URL(req.url).pathname,hash=p.split('/').at(-1),want=req.headers.get('x-opengym-account');
  if(!live())return denied();
  if(want&&want!==uid)return error(409,'account-mismatch','signed in as another account now');
  if(p.endsWith('/sweep'))return error(503,'media-sweep-unavailable','safe cleanup is not yet available');
  if(p.endsWith('/missing')){
    const {hashes}=await readMediaJson(req,80*1024);
    if(!Array.isArray(hashes)||hashes.length>1000||!hashes.every(h=>typeof h==='string'&&HASH_RE.test(h)))return error(400,'bad-request','hashes must be a list of at most 1000 lowercase sha256 hex strings');
    const i=await inventory(bucket,uid);
    if(!live())return denied();
    const known=new Set(i.objects.filter(o=>validObject(o,o.key.slice(prefix(uid).length))).map(o=>o.key.slice(prefix(uid).length)));
    return json({missing:[...new Set(hashes)].filter(h=>!known.has(h)),usage:i.usage});
  }
  const key=path(uid,hash);
  if(req.method==='PUT'){
    const declared=(req.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
    const max=cap(MEDIA_MIMES[declared]?.kind);
    if(!max)return error(415,'media-type','that file type is not accepted');
    const bytes=await boundedBytes(req,max);
    if(!bytes)return error(413,'media-too-large','that file is too large',{maxMB:max/MB});
    if(createHash('sha256').update(bytes).digest('hex')!==hash)return error(400,'hash-mismatch','the file does not match its name');
    const checked=inspect(bytes,declared);
    if(!checked.mime)return error(checked.status,checked.code);
    if(!live())return denied();
    const old=await bucket.head(key);
    if(old&&!validObject(old,hash))return error(503,'media-unreadable','existing object metadata is invalid');
    if(!live())return denied();
    if(old)return json({ok:true,hash,mime:old.httpMetadata.contentType,size:old.size,existed:true});
    const i=await inventory(bucket,uid);
    if(i.usage.bytes+bytes.length>QUOTA||i.usage.count>=COUNT)return error(413,'media-quota','your space for photos and videos is full',{usedMB:Math.round(i.usage.bytes/MB*10)/10,quotaMB:QUOTA/MB});
    if(!live())return denied();
    await bucket.put(key,bytes,{sha256:hash,httpMetadata:{contentType:checked.mime},customMetadata:{sha256:hash}});
    const back=await bucket.head(key);
    if(!validObject(back,hash)||back.size!==bytes.length)return error(503,'media-unreadable','upload not verified');
    if(!live())return denied();
    return json({ok:true,hash,mime:checked.mime,size:bytes.length,existed:false},201);
  }
  const meta=await bucket.head(key);
  if(!live())return denied();
  if(!meta)return missing();
  if(!validObject(meta,hash))return error(503,'media-unreadable','object metadata is invalid');
  const range=parseRange(req.headers.get('range'),meta.size);
  if(range===false)return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+meta.size}});
  const mime=meta.httpMetadata.contentType,headers=new Headers({'Content-Type':mime,'Content-Length':String(range?range.length:meta.size),'Accept-Ranges':'bytes','Cache-Control':'private, no-store','Content-Security-Policy':"default-src 'none'; sandbox",'Cross-Origin-Resource-Policy':'same-origin','Content-Disposition':'inline; filename="'+hash+'.'+MEDIA_MIMES[mime].ext+'"','X-Robots-Tag':'noindex','Access-Control-Expose-Headers':'Content-Length, Content-Range, Accept-Ranges'});
  if(range)headers.set('Content-Range','bytes '+range.offset+'-'+(range.offset+range.length-1)+'/'+meta.size);
  if(req.method==='HEAD')return new Response(null,{status:range?206:200,headers});
  const obj=await bucket.get(key,range?{range}:{});
  if(!live()){await obj?.body?.cancel();return denied();}
  if(!obj)return missing();
  return new Response(obj.body,{status:range?206:200,headers});
}
