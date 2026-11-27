// Local migration qualification helper, not a Worker route or cutover command.
// No mutations. Callers must freeze/export all relevant device/stash snapshots,
// supply owner-bound read adapters, and independently verify backup durability.
import {createHash} from 'node:crypto';
import {keptHashes,stateMediaRefs,uploadableFiles,MEDIA_MIMES,HASH_RE} from '../../frontend/src/lib/media-refs.js';
import {MEDIA_CONFIG,MEDIA_MAX_OBJECTS} from './media.js';
const MB=1024*1024,MAX_BYTES=100*MB,MAX_HASHES=1000;
const validHash=h=>typeof h==='string'&&HASH_RE.test(h);
const limit=m=>{const k=MEDIA_MIMES[m]?.kind;return (k==='video'?MEDIA_CONFIG.videoMB:k==='gif'?MEDIA_CONFIG.gifMB:k==='audio'?MEDIA_CONFIG.audioMB:k==='image'?MEDIA_CONFIG.imageMB:0)*MB;};
// A read adapter returns a Blob or null for confirmed absence. Unknown or
// unreadable is an error, not absence. Verify bytes, not prior pending flags.
async function verify(read,h,expected){
  try{
    const blob=await read(h);
    if(blob===null)return {status:'missing'};
    if(!blob||!Number.isSafeInteger(blob.size)||blob.size<1||blob.size>MAX_BYTES||typeof blob.stream!=='function')return {status:'invalid'};
    if(expected&&(expected.size!==blob.size||expected.mime!==blob.type))return {status:'invalid'};
    const reader=blob.stream().getReader(),hash=createHash('sha256');let n=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;n+=value.byteLength;if(n>blob.size||n>MAX_BYTES){await reader.cancel();return {status:'invalid'};}hash.update(value);}}
    finally{reader.releaseLock();}
    return n===blob.size&&hash.digest('hex')===h?{status:'verified',size:n,mime:blob.type}:{status:'invalid'};
  }catch{return {status:'unreadable'};}
}
export async function auditMigrationMedia({owner,snapshots,readLocal,readBackup,readDestination,isCurrent}){
  if(typeof owner!=='string'||!owner||!Array.isArray(snapshots)||!snapshots.length||snapshots.length>32||![readLocal,readBackup,readDestination,isCurrent].every(f=>typeof f==='function'))throw Error('invalid migration preflight');
  const refs=new Map(),issues=new Set(),required=new Set(),uploadable=new Set();
  const add=m=>{
    if(!m||typeof m!=='object'||!validHash(m.hash)){issues.add('invalid-reference');return;}
    const h=m.hash;required.add(h);
    if(typeof m.mime!=='string'||!Object.hasOwn(MEDIA_MIMES,m.mime)||!Number.isSafeInteger(m.size)||m.size<1||m.size>MAX_BYTES){issues.add('invalid-reference-metadata');return;}
    const previous=refs.get(h);
    if(previous&&(previous.size!==m.size||previous.mime!==m.mime))issues.add('conflicting-reference-metadata');
    else refs.set(h,{size:m.size,mime:m.mime});
  };
  for(const snap of snapshots){
    if(snap?.owner!==owner||!snap.state||typeof snap.state!=='object'||Array.isArray(snap.state))throw Error('unreadable or foreign snapshot');
    const S=snap.state;
    for(const h of keptHashes(S))required.add(h);
    for(const f of uploadableFiles(S))uploadable.add(f.hash);
    for(const m of stateMediaRefs(S)){add(m);if(m.poster!=null)add(m.poster);}
    // active set references are retained locally even though not uploadable.
    for(const m of stateMediaRefs({workouts:[S.active]})){add(m);if(m.poster!=null)add(m.poster);}
  }
  if(required.size>MAX_HASHES)throw Error('migration inventory exceeds audit bound');
  // Known-file minimum only: destination-retained objects and concurrent writes
  // may consume additional capacity. No claim of available destination quota.
  const minimumBytes=[...uploadable].reduce((n,h)=>n+(refs.get(h)?.size||0),0);
  if(minimumBytes>MEDIA_CONFIG.quotaMB*MB)issues.add('destination-minimum-byte-quota');
  if(uploadable.size>MEDIA_MAX_OBJECTS)issues.add('destination-minimum-object-quota');
  // Local-only and active references are not silently uploaded or dropped. A
  // destination blob alone is not proof of an installed-device local restore.
  if([...required].some(h=>!uploadable.has(h)))issues.add('device-local-restore-required');
  if(!await isCurrent(owner))throw Error('migration snapshot or owner changed');
  const records=[];
  for(const h of [...required].sort()){
    const expected=refs.get(h);
    if(!expected)issues.add('missing-reference-metadata');
    const local=await verify(readLocal,h,expected),backup=await verify(readBackup,h,expected),destination=await verify(readDestination,h,expected);
    if(!await isCurrent(owner))throw Error('migration snapshot or owner changed');
    if(destination.status!=='verified')issues.add('destination-not-verified');
    if(backup.status!=='verified')issues.add('backup-not-verified');
    if(expected&&expected.size>limit(expected.mime))issues.add('destination-size-limit');
    if(local.status!=='verified'&&backup.status!=='verified'&&destination.status!=='verified')issues.add('no-verified-copy');
    records.push({hash:h,local:local.status,backup:backup.status,destination:destination.status,overLimit:!!expected&&expected.size>limit(expected.mime)});
  }
  // A good report is only known-file evidence. Unknown devices, export encryption,
  // restore, state revisions, user consent and official native delivery remain gates.
  return {owner,records,issues:[...issues].sort(),knownMediaVerified:issues.size===0,cutoverAuthorized:false,minimumDestination:{bytes:minimumBytes,count:uploadable.size}};
}
