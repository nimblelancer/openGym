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
// Deadline applies to adapter invocation and the complete byte stream.
// A timed-out audit aborts rather than proceeding to more adapters.
const timeoutError=()=>Object.assign(Error('migration audit deadline exceeded'),{code:'audit-timeout'});
async function bounded(fn,ms){
  if(ms<=0)throw timeoutError();
  const ctl=new AbortController();let timer;
  try{return await Promise.race([Promise.resolve().then(()=>fn(ctl.signal)),new Promise((_,reject)=>{timer=setTimeout(()=>{reject(timeoutError());ctl.abort();},ms);})]);}
  finally{clearTimeout(timer);}
}
async function verify(read,h,expected,signal){
  try{
    const blob=await read(h,{signal});
    signal.throwIfAborted();
    if(blob===null)return {status:'missing'};
    if(!blob||!Number.isSafeInteger(blob.size)||blob.size<1||blob.size>MAX_BYTES||typeof blob.stream!=='function')return {status:'invalid'};
    if(expected&&(expected.size!==blob.size||expected.mime!==blob.type))return {status:'invalid'};
    const reader=blob.stream().getReader(),hash=createHash('sha256');let n=0;
    const cancel=()=>{try{reader.cancel().catch(()=>{});}catch{}};
    signal.addEventListener('abort',cancel,{once:true});
    try{for(;;){signal.throwIfAborted();const {done,value}=await reader.read();signal.throwIfAborted();if(done)break;n+=value.byteLength;if(n>blob.size||n>MAX_BYTES){cancel();return {status:'invalid'};}hash.update(value);}}
    finally{signal.removeEventListener('abort',cancel);reader.releaseLock();}
    return n===blob.size&&hash.digest('hex')===h?{status:'verified',size:n,mime:blob.type}:{status:'invalid'};
  }catch{return {status:'unreadable'};}
}
export async function auditMigrationMedia({owner,snapshots,readLocal,readBackup,readDestination,isCurrent,retainedInventory=null,destinationInventory=null,adapterMs=15000,totalMs=180000}){
  if(typeof owner!=='string'||!owner||!Array.isArray(snapshots)||!snapshots.length||snapshots.length>32||![readLocal,readBackup,readDestination,isCurrent].every(f=>typeof f==='function'))throw Error('invalid migration preflight');
  if(!Number.isSafeInteger(adapterMs)||adapterMs<1||adapterMs>30000||!Number.isSafeInteger(totalMs)||totalMs<1||totalMs>300000)throw Error('invalid audit deadline');
  const deadline=performance.now()+totalMs;
  const step=fn=>bounded(fn,Math.min(adapterMs,Math.max(0,deadline-performance.now())));
  const fence=async()=>{if(!await step(signal=>isCurrent(owner,{signal})))throw Error('migration snapshot or owner changed');};
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
  // Explicit owner-bound retained objects must be verified too, even when
  // no current state references them. This is a supplied frozen inventory,
  // not an enumeration of unknown devices or a proof of completeness.
  for(const [kind,inventory] of [['retained',retainedInventory],['destination',destinationInventory]]){
    if(inventory===null)continue;
    if(inventory?.owner!==owner||!Array.isArray(inventory.rows)||inventory.rows.length>MAX_HASHES)throw Error('invalid or foreign '+kind+' inventory');
    const seen=new Set();
    for(const row of inventory.rows){
      if(!validHash(row?.hash)||seen.has(row.hash))throw Error('invalid '+kind+' inventory row');
      seen.add(row.hash);add(row);uploadable.add(row.hash);
    }
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
  await fence();
  const records=[];
  for(const h of [...required].sort()){
    const expected=refs.get(h);
    if(!expected)issues.add('missing-reference-metadata');
    const local=await step(signal=>verify(readLocal,h,expected,signal));await fence();
    const backup=await step(signal=>verify(readBackup,h,expected,signal));await fence();
    const destination=await step(signal=>verify(readDestination,h,expected,signal));await fence();
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


// Local-only, read-only R2 qualification. Do not expose this helper as a route.
// Enumerate the exact owner prefix, never trust supplied hash lists as complete.
// Compare listing generations before/after byte audit; callers still must freeze
// writers and supply the authoritative owner/state revision fence. This is not
// a transactional R2 snapshot or proof of all external devices.
export async function auditOwnerBucketMedia({bucket,owner,isCurrent,adapterMs=15000,totalMs=180000,...args}){
  if(typeof owner!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(owner)||typeof isCurrent!=='function'||
     typeof bucket?.list!=='function'||typeof bucket?.get!=='function'||
     !Number.isSafeInteger(adapterMs)||adapterMs<1||adapterMs>30000||!Number.isSafeInteger(totalMs)||totalMs<1||totalMs>300000||
     args.destinationInventory!=null||args.readDestination!=null)throw Error('invalid owner bucket audit');
  const prefix='private/v1/'+owner+'/',deadline=performance.now()+totalMs;
  const remaining=()=>Math.floor(deadline-performance.now());
  const step=fn=>bounded(fn,Math.min(adapterMs,remaining()));
  const fence=async()=>{if(!await step(signal=>isCurrent(owner,{signal})))throw Error('migration snapshot or owner changed');};
  const enumerate=async()=>{
    const rows=new Map(),cursors=new Set();let cursor;
    for(let page=0;page<MAX_HASHES+1;page++){
      await fence();
      const list=await step(()=>bucket.list({prefix,limit:100,include:['httpMetadata','customMetadata'],...(cursor?{cursor}:{})}));
      if(!Array.isArray(list?.objects)||typeof list.truncated!=='boolean'||list.objects.length>100)throw Error('invalid owner bucket listing');
      for(const o of list.objects){
        const h=typeof o?.key==='string'&&o.key.startsWith(prefix)?o.key.slice(prefix.length):null;
        const mime=o?.httpMetadata?.contentType;
        if(!validHash(h)||rows.has(h)||rows.size>=MAX_HASHES||!Object.hasOwn(MEDIA_MIMES,mime)||
           !Number.isSafeInteger(o.size)||o.size<1||o.size>MAX_BYTES||o.customMetadata?.sha256!==h||
           typeof o.version!=='string'||!o.version||typeof o.etag!=='string'||!o.etag)throw Error('invalid owner bucket object');
        rows.set(h,{hash:h,mime,size:o.size,version:o.version,etag:o.etag});
      }
      await fence();
      if(!list.truncated)return [...rows.values()].sort((a,b)=>a.hash.localeCompare(b.hash));
      if(typeof list.cursor!=='string'||!list.cursor||cursors.has(list.cursor)||!list.objects.length)throw Error('invalid owner bucket cursor');
      cursor=list.cursor;cursors.add(cursor);
    }
    throw Error('owner bucket listing exceeds bound');
  };
  const initial=await enumerate(),byHash=new Map(initial.map(row=>[row.hash,row]));
  const readDestination=async(h,{signal})=>{
    const expected=byHash.get(h);
    if(!expected)return null;
    const o=await bucket.get(prefix+h);
    if(signal.aborted||!o||o.key!==prefix+h||o.version!==expected.version||o.etag!==expected.etag||
       o.size!==expected.size||o.httpMetadata?.contentType!==expected.mime||o.customMetadata?.sha256!==h||!o.body){
      try{await o?.body?.cancel();}catch{}
      throw Error('owner bucket object changed');
    }
    return {size:o.size,type:expected.mime,stream:()=>o.body};
  };
  const budget=remaining();
  if(budget<1)throw timeoutError();
  const report=await auditMigrationMedia({...args,owner,isCurrent,readDestination,destinationInventory:{owner,rows:initial},adapterMs,totalMs:budget});
  const final=await enumerate();
  if(JSON.stringify(initial)!==JSON.stringify(final))throw Error('owner bucket inventory changed');
  await fence();
  return {...report,ownerBucketListingStable:true,enumeratedDestinationCount:initial.length,cutoverAuthorized:false};
}
