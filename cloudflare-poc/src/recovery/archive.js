// Phase 6 local synthetic recovery proof. Not a Worker route, production
// archive format, key store, source discovery mechanism or restore command.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { HASH_RE, MEDIA_MIMES, keptHashes, stateMediaRefs, uploadableFiles } from '../../../frontend/src/lib/media-refs.js';
import { MEDIA_CONFIG, MEDIA_MAX_OBJECTS } from '../media.js';

const MB=1024*1024;
export const MAX_ARCHIVE_BYTES=16*MB;
const MAX_MEDIA_BYTES=100*MB, MAX_ROWS=1000, MAX_SNAPSHOTS=32;
const MAGIC=Buffer.from('OGP6\x01','binary'), NONCE=12, TAG=16, HEADER=MAGIC.length+NONCE+TAG;
const digest=b=>createHash('sha256').update(b).digest('hex');
const ownerOK=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{16}$/.test(x);
const hashOK=x=>typeof x==='string'&&HASH_RE.test(x);
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
const exact=(x,keys)=>record(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const mimeOK=m=>typeof m==='string'&&Object.hasOwn(MEDIA_MIMES,m);
const sizeOK=n=>Number.isSafeInteger(n)&&n>0&&n<=MAX_MEDIA_BYTES;
const requireThat=(ok,message)=>{if(!ok)throw Error(message);};
const keyOK=k=>Buffer.isBuffer(k)&&k.length===32;
const locationOK=x=>['server','device','both'].includes(x);
const serverSide=x=>x==='server'||x==='both';
const deviceSide=x=>x==='device'||x==='both';
// Bound JSON traversal before serializing supplied state. Refuse unsupported
// values, cycles, accessors, dangerous property names and excessive structure.
function checkJson(root){
  const seen=new Set(),stack=[[root,0]];let nodes=0,textBytes=0;
  while(stack.length){
    const [v,depth]=stack.pop();requireThat(++nodes<=200000&&depth<=64,'snapshot structure bound');
    if(v===null||typeof v==='boolean')continue;
    if(typeof v==='number'){requireThat(Number.isFinite(v),'invalid snapshot number');continue;}
    if(typeof v==='string'){textBytes+=Buffer.byteLength(v);requireThat(textBytes<=MAX_ARCHIVE_BYTES,'snapshot text bound');continue;}
    requireThat(Array.isArray(v)||record(v),'invalid snapshot JSON');
    requireThat(!seen.has(v),'shared or cyclic snapshot object');seen.add(v);
    const keys=Reflect.ownKeys(v);
    if(Array.isArray(v))requireThat(v.length<=200000&&keys.length===v.length+1,'invalid snapshot array');
    for(const k of keys){
      if(Array.isArray(v)&&k==='length')continue;
      requireThat(typeof k==='string'&&!['__proto__','constructor','prototype'].includes(k),'invalid snapshot key');
      const d=Object.getOwnPropertyDescriptor(v,k);
      requireThat(d.enumerable&&Object.hasOwn(d,'value'),'invalid snapshot property');
      if(Array.isArray(v))requireThat(/^(0|[1-9][0-9]*)$/.test(k)&&Number(k)<v.length,'invalid snapshot array index');
      textBytes+=Buffer.byteLength(k);requireThat(textBytes<=MAX_ARCHIVE_BYTES,'snapshot text bound');
      stack.push([d.value,depth+1]);
    }
  }
}
// Verify known inventory only. Explicit snapshot and file lists are supplied
// by a trusted local synthetic caller; unknown devices are not inferred empty.
function validate(payload,expectedOwner){
  requireThat(ownerOK(expectedOwner),'invalid expected owner');
  requireThat(exact(payload,['version','owner','snapshots','files'])&&payload.version===1&&payload.owner===expectedOwner,'archive version or owner mismatch');
  requireThat(Array.isArray(payload.snapshots)&&payload.snapshots.length>0&&payload.snapshots.length<=MAX_SNAPSHOTS,'invalid snapshot count');
  requireThat(Array.isArray(payload.files)&&payload.files.length<=MAX_ROWS,'invalid inventory count');
  const ids=new Set(),refs=new Map(),remoteRefs=new Set(),known=new Set();let serverCount=0;
  function add(m){
    requireThat(record(m)&&hashOK(m.hash)&&mimeOK(m.mime)&&sizeOK(m.size),'invalid media reference');
    const prev=refs.get(m.hash);
    requireThat(!prev||(prev.mime===m.mime&&prev.size===m.size),'conflicting media reference');
    refs.set(m.hash,{mime:m.mime,size:m.size});
  }
  for(const snap of payload.snapshots){
    requireThat(exact(snap,['id','kind','owner','revision','writeIdentity','state'])&&snap.owner===expectedOwner,'invalid snapshot owner or shape');
    requireThat(typeof snap.id==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(snap.id)&&!ids.has(snap.id),'duplicate or invalid snapshot id');ids.add(snap.id);
    requireThat(['server','device','stash'].includes(snap.kind)&&Number.isSafeInteger(snap.revision)&&snap.revision>=0,'invalid snapshot revision');
    requireThat(snap.writeIdentity===null||(typeof snap.writeIdentity==='string'&&snap.writeIdentity.length>0&&snap.writeIdentity.length<=128),'invalid write identity');
    requireThat(record(snap.state),'invalid snapshot state');checkJson(snap.state);
    if(snap.kind==='server'){
      serverCount++;
      requireThat((snap.state._rev??0)===snap.revision&&(snap.state._wid??null)===snap.writeIdentity,'server revision mismatch');
      for(const f of uploadableFiles(snap.state))remoteRefs.add(f.hash);
    }
    for(const h of keptHashes(snap.state))known.add(h);
    for(const m of [...stateMediaRefs(snap.state),...stateMediaRefs({workouts:[snap.state.active]})]){add(m);if(m.poster!=null)add(m.poster);}
  }
  requireThat(serverCount===1,'exactly one server snapshot required');
  const rows=new Map();let encodedBytes=0;
  for(const f of payload.files){
    requireThat(exact(f,['hash','mime','size','location','bytes'])&&hashOK(f.hash)&&mimeOK(f.mime)&&sizeOK(f.size)&&locationOK(f.location)&&!rows.has(f.hash),'invalid or duplicate inventory row');
    requireThat(typeof f.bytes==='string'&&f.bytes.length===4*Math.ceil(f.size/3),'invalid media encoding length');
    encodedBytes+=f.bytes.length;requireThat(encodedBytes<=MAX_ARCHIVE_BYTES,'inventory encoding bound');
    const b=Buffer.from(f.bytes,'base64');
    requireThat(b.length===f.size&&b.toString('base64')===f.bytes&&digest(b)===f.hash,'media integrity mismatch');
    const expected=refs.get(f.hash);
    requireThat(!expected||(expected.mime===f.mime&&expected.size===f.size),'inventory metadata mismatch');
    rows.set(f.hash,f);
  }
  for(const h of new Set([...known,...refs.keys()]))requireThat(rows.has(h)&&refs.has(h),'missing known media or metadata');
  // Device-only obligations are kept in the archive even when no remote copy
  // exists. A missing remote object is a reconciliation issue, not a reason to
  // discard its independently verified device copy.
  return {rows,remoteRefs};
}
function quotaOf({rows,remoteRefs}){
  let serverBytes=0,serverCount=0,retainedBytes=0,retainedCount=0,deviceBytes=0,deviceCount=0,deviceOnlyBytes=0,deviceOnlyCount=0;
  const overLimit=[],missingServerReferences=[];
  for(const h of remoteRefs)if(!serverSide(rows.get(h)?.location))missingServerReferences.push(h);
  for(const f of rows.values()){
    if(deviceSide(f.location)){deviceBytes+=f.size;deviceCount++;}
    if(!serverSide(f.location)){deviceOnlyBytes+=f.size;deviceOnlyCount++;continue;}
    serverBytes+=f.size;serverCount++;
    if(!remoteRefs.has(f.hash)){retainedBytes+=f.size;retainedCount++;}
    const kind=MEDIA_MIMES[f.mime].kind,limit=MEDIA_CONFIG[kind+'MB']*MB;
    if(!Number.isFinite(limit)||f.size>limit)overLimit.push(f.hash);
  }
  return {serverBytes,serverCount,retainedBytes,retainedCount,deviceBytes,deviceCount,deviceOnlyBytes,deviceOnlyCount,
    configuredByteLimit:MEDIA_CONFIG.quotaMB*MB,configuredObjectLimit:MEDIA_MAX_OBJECTS,
    withinKnownMediaLimits:serverBytes<=MEDIA_CONFIG.quotaMB*MB&&serverCount<=MEDIA_MAX_OBJECTS&&overLimit.length===0,
    missingServerReferences:missingServerReferences.sort(),overLimit:overLimit.sort(),completeAccountInventoryVerified:false,cutoverAuthorized:false};
}
export function inspectRecoveryInventory(payload,expectedOwner){return quotaOf(validate(payload,expectedOwner));}
export function sealRecoveryArchive(payload,key,expectedOwner){
  requireThat(keyOK(key),'invalid recovery key');validate(payload,expectedOwner);
  const plain=Buffer.from(JSON.stringify(payload),'utf8');
  requireThat(plain.length+HEADER<=MAX_ARCHIVE_BYTES,'archive size bound');
  const nonce=randomBytes(NONCE),cipher=createCipheriv('aes-256-gcm',key,nonce);
  cipher.setAAD(MAGIC);
  try{const body=Buffer.concat([cipher.update(plain),cipher.final()]);return Buffer.concat([MAGIC,nonce,cipher.getAuthTag(),body]);}
  finally{plain.fill(0);}
}
export function openRecoveryArchive(archive,key,expectedOwner){
  requireThat(keyOK(key)&&ownerOK(expectedOwner),'invalid recovery identity or key');
  requireThat(Buffer.isBuffer(archive)&&archive.length>HEADER&&archive.length<=MAX_ARCHIVE_BYTES&&archive.subarray(0,MAGIC.length).equals(MAGIC),'invalid archive header or size');
  let plain,partial;
  try{
    const d=createDecipheriv('aes-256-gcm',key,archive.subarray(MAGIC.length,MAGIC.length+NONCE));
    d.setAAD(MAGIC);d.setAuthTag(archive.subarray(MAGIC.length+NONCE,HEADER));
    partial=d.update(archive.subarray(HEADER));plain=Buffer.concat([partial,d.final()]);
  }catch{throw Error('archive authentication failed');}
  finally{partial?.fill(0);}
  try{
    const payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain));
    const quota=quotaOf(validate(payload,expectedOwner));
    return {payload,quota};
  }finally{plain.fill(0);}
}
