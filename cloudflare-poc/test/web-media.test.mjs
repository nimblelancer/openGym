import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {readFile,readdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:http';
import {setTimeout as sleep} from 'node:timers/promises';
import {DatabaseSync} from 'node:sqlite';
import {MediaLifecycle,GRACE_MS,DELETE_BATCH} from '../src/media-lifecycle.js';
import {auditMigrationMedia} from '../src/migration-media-preflight.js';
import {localRunner} from './local-runner.mjs';
import {authenticator} from './auth-fixture.mjs';
import {inspect,parseRange,boundedBytes,readMediaJson,handleMedia,inventory} from '../src/media.js';
import {jpeg,png,gif,webpVp8,webpVp8l,webpVp8x,mp4,webm} from '../../frontend/src/lib/media-samples.test-util.js';
import {referencedHashes,uploadableFiles} from '../../frontend/src/lib/media-refs.js';
const sha=b=>createHash('sha256').update(b).digest('hex');
const MB=1024*1024;
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64');
const hash=sha(image),other=sha('absent');
const path='/api/media/'+hash;
const upload=(b=image,h=sha(b),mime='image/png')=>new Request('http://localhost/api/media/'+h,{method:'PUT',body:b,headers:{'content-type':mime}});
test('bounded input, content sniff, dimensions, declared category, duration and range',async()=>{
  for(const [b,m] of [[jpeg(),'image/jpeg'],[png(),'image/png'],[gif(),'image/gif'],[webpVp8x(),'image/webp'],[mp4().file,'video/mp4']])assert.equal(inspect(b,m).mime,m);
  assert.equal(inspect(png(10000,10000),'image/png').status,415);
  assert.equal(inspect(Buffer.from('<svg/>'),'image/png').status,415);
  assert.equal(inspect(image,'video/mp4').status,415);
  assert.equal(inspect(mp4({seconds:62}).file,'video/mp4').code,'media-too-long');
  assert.equal(inspect(Buffer.from([0x89,0x50,0x4e,0x47]),'image/png').status,415);
  assert.equal(await boundedBytes(upload(Buffer.alloc(2*MB+1)),2*MB),null);
  assert.deepEqual(await boundedBytes(upload(image),2*MB),image);
  assert.deepEqual(parseRange('bytes=0-9',20),{offset:0,length:10});
  assert.deepEqual(parseRange('bytes=-5',20),{offset:15,length:5});
  assert.deepEqual(parseRange('bytes=15-',20),{offset:15,length:5});
  for(const bad of ['bytes=20-','bytes=3-2','bytes=0-1,5-6','bytes=-0','bytes=-9999999999999999999999999999999999'])assert.equal(parseRange(bad,20),false);
});
// Match the pinned client sound-ingest.js encoder (44-byte PCM header).
function wav(samples=2205){
  const b=Buffer.alloc(44+samples*2);
  b.write('RIFF',0);b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);
  b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(22050,24);b.writeUInt32LE(44100,28);
  b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);
  return b;
}
test('pinned format compatibility: MOV, WebM, WebP variants and canonical PCM WAV',()=>{
  for(const [b,m] of [[mp4({brand:'qt  '}).file,'video/quicktime'],[webm(),'video/webm'],[webpVp8(),'image/webp'],[webpVp8l(),'image/webp'],[wav(),'audio/wav'],[wav(30*22050),'audio/wav']])
    assert.equal(inspect(b,m).mime,m);
  for(const b of [wav(0),wav(30*22050+1),wav().subarray(0,45)])assert.equal(inspect(b,'audio/wav').status,415);
  for(const [offset,value] of [[4,0],[16,0],[24,0],[28,0],[40,0]]){
    const b=wav();b.writeUInt32LE(value,offset);assert.equal(inspect(b,'audio/wav').status,415);
  }
  const stereo=wav();stereo.writeUInt16LE(2,22);assert.equal(inspect(stereo,'audio/wav').status,415);
  assert.equal(inspect(wav(),'image/png').status,415);
  assert.equal(inspect(webm({durationMs:62000}),'video/webm').status,413);
  assert.equal(inspect(mp4({brand:'M4A '}).file,'video/mp4').status,415);
  console.log('PHASE5_MEDIA_FORMAT_MATRIX PASS');
});
test('bounded upload rejects incomplete, oversized, stalled and trickling streams',async()=>{
  const req=(body,headers={})=>new Request('http://localhost/api/media/'+hash,{method:'PUT',body,headers,duplex:'half'});
  const chunks=(parts)=>new ReadableStream({start(c){for(const p of parts)c.enqueue(p);c.close();}});
  assert.deepEqual(await boundedBytes(req(chunks([image.subarray(0,3),image.subarray(3)])),image.length),image);
  await assert.rejects(boundedBytes(req(chunks([image.subarray(0,4)]),{'content-length':String(image.length)}),image.length),e=>e.status===400);
  await assert.rejects(boundedBytes(req(chunks([image]),{'content-length':'4'}),image.length),e=>e.status===400);
  assert.equal(await boundedBytes(req(chunks([image,image])),image.length),null);
  let canceled=false;
  const stalled=new ReadableStream({start(c){c.enqueue(image.subarray(0,1));},cancel(){canceled=true;}});
  await assert.rejects(boundedBytes(req(stalled),image.length,{idleMs:15,totalMs:200}),e=>e.status===408);
  assert.equal(canceled,true);
  let timer,stopped=false;
  const trickle=new ReadableStream({start(c){timer=setInterval(()=>c.enqueue(Uint8Array.of(1)),3);},cancel(){clearInterval(timer);stopped=true;}});
  try{await assert.rejects(boundedBytes(req(trickle),4096,{idleMs:100,totalMs:35}),e=>e.status===408);assert.equal(stopped,true);}finally{clearInterval(timer);}
  const jsonReq=(b,mime='application/json')=>req(chunks([Buffer.from(b)]),{'content-type':mime});
  assert.deepEqual(await readMediaJson(jsonReq('{"hashes":[]}'),80),{hashes:[]});
  await assert.rejects(readMediaJson(jsonReq('[]'),80),e=>e.status===400);
  await assert.rejects(readMediaJson(jsonReq('{}','text/plain'),80),e=>e.status===415);
  await assert.rejects(readMediaJson(jsonReq(' '.repeat(81)),80),e=>e.status===413);
  console.log('PHASE5_BOUNDED_UPLOAD_STREAMS PASS');
});
test('media failure and quota paths never acknowledge a missing write',async()=>{
  let live=true,put=0;
  const uid='syntheticOwner';
  const blank={head:async()=>null,list:async()=>({objects:[],truncated:false}),put:async()=>{put++;throw Error('synthetic R2 write failure')}};
  await assert.rejects(handleMedia(upload(),uid,blank,()=>live),/synthetic R2 write failure/);
  assert.equal(put,1);
  const noCommit={...blank,put:async()=>{put++}};
  assert.equal((await handleMedia(upload(),uid,noCommit,()=>live)).status,503);
  const quota={...blank,list:async()=>({objects:[{key:'private/v1/'+uid+'/'+other,size:200*MB}],truncated:false})};
  const full=await handleMedia(upload(),uid,quota,()=>live);
  assert.equal(full.status,413);assert.deepEqual(await full.json(),{error:'your space for photos and videos is full',code:'media-quota',usedMB:200,quotaMB:200});
  await assert.rejects(inventory({...blank,list:async()=>({objects:[],truncated:true})},uid),/inventory invalid/);
  const revoke={...blank,list:async()=>{live=false;return {objects:[],truncated:false}}};
  assert.equal((await handleMedia(upload(),uid,revoke,()=>live)).status,401);
  assert.equal(put,2);
  const stored={size:image.length,httpMetadata:{contentType:'image/png'},customMetadata:{sha256:hash}};
  const byOwner={...blank,head:async k=>k==='private/v1/'+uid+'/'+hash?stored:null};
  assert.equal((await handleMedia(new Request('http://localhost'+path,{method:'HEAD'}),'anotherOwner',byOwner,()=>true)).status,404);
  assert.equal((await handleMedia(new Request('http://localhost'+path,{method:'HEAD'}),uid,byOwner,()=>true)).status,200);
});
test('all supported media reference locations and local-only set behavior',()=>{
  const ref={hash,kind:'image',mime:'image/png',size:image.length,width:1,height:1,poster:{hash:other,mime:'image/jpeg',size:1,width:1,height:1}};
  const state={customEx:[{media:ref}],workouts:[{media:[ref],entries:[{sets:[{media:[{...ref,local:true}]}]}]}],dayPhotos:{a:{m:ref}},sounds:[{m:ref}],exMedia:{a:{m:ref}},avatar:{m:ref}};
  assert.deepEqual([...referencedHashes(state)].sort(),[hash,other].sort());
  const local={workouts:[{entries:[{sets:[{media:[{...ref,local:true}]}]}]}]};
  assert.equal(uploadableFiles(local).length,0);
  assert.equal(referencedHashes(local).size,2);
});
test('GC observations survive restart and long-offline references; authorized deletion remains recoverable',async()=>{
  const uid='abcdefghijklmnop',key='private/v1/'+uid+'/'+hash;
  const db=new DatabaseSync(':memory:');let now=Date.now(),state={kind:'ok',state:{workouts:[]}},live=true,fail=false;
  db.exec('CREATE TABLE auth_users (id TEXT PRIMARY KEY, disabled INTEGER, sv INTEGER); CREATE TABLE auth_codes (uid TEXT); CREATE TABLE auth_challenges (id TEXT);');
  db.prepare('INSERT INTO auth_users VALUES(?,0,0)').run(uid);
  const repo={q:(sql,...args)=>db.prepare(sql).all(...args),one:(sql,...args)=>db.prepare(sql).get(...args),user:id=>db.prepare('SELECT * FROM auth_users WHERE id=?').get(id),tx:fn=>{db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}};
  const objects=new Map([[key,{key,size:image.length,uploaded:new Date(now),etag:'one'}]]);
  const bucket={list:async({prefix})=>({objects:[...objects.values()].filter(o=>o.key.startsWith(prefix)),truncated:false}),head:async k=>objects.get(k),delete:async k=>{if(fail)throw Error('injected delete failure');for(const x of [k].flat())objects.delete(x)}};
  const make=()=>new MediaLifecycle(repo,{read:async()=>state},bucket,{now:()=>now});
  let l=make();
  try{
    const first=await l.sweep(uid,()=>live);assert.equal(first.body.removed,0);assert.equal(first.body.retained,1);
    now+=GRACE_MS+1;
    state={kind:'corrupt'};assert.equal((await l.sweep(uid,()=>live)).status,503);assert.ok(objects.has(key));
    state={kind:'ok',state:{workouts:[]}};
    // A stale device can still have the only reference and no local bytes.
    // Age both the actual object and its mark well beyond the old grace, restart,
    // and forbid every destructive call on this non-account-deletion path.
    now+=365*86400000;l=make();fail=true;
    const retained=await l.sweep(uid,()=>live);
    assert.equal(retained.status,200);assert.equal(retained.body.removed,0);assert.equal(retained.body.freedBytes,0);
    assert.equal(retained.body.retained,1);assert.equal(retained.body.retainedBytes,image.length);assert.equal(retained.body.pastGrace,1);
    assert.equal(retained.body.usage.count,1);assert.equal(retained.body.usage.bytes,image.length);assert.ok(objects.has(key));
    state={kind:'ok',state:{customEx:[{media:{hash}}]}};
    repo.tx(()=>l.noteState(uid,state.state));
    assert.equal(repo.one('SELECT count(*) AS n FROM media_gc WHERE uid=?',uid).n,0);
    assert.equal((await l.sweep(uid,()=>live)).body.retained,0);assert.ok(objects.has(key));
    state={kind:'ok',state:{workouts:[]}};
    assert.equal((await l.sweep(uid,()=>live)).body.retained,1);
    for(let n=0;n<9;n++){const k='private/v1/'+uid+'/'+sha('sweep-'+n);objects.set(k,{key:k,size:1,uploaded:new Date(now),etag:'sweep-'+n});}
    assert.equal((await l.sweep(uid,()=>live)).body.removed,0);
    now+=GRACE_MS+1;l=make();
    const all=await l.sweep(uid,()=>live);
    assert.equal(all.body.pastGrace,10);assert.equal(all.body.removed,0);assert.equal(objects.size,10);
    console.log('PHASE5_LONG_OFFLINE_RETENTION PASS');
    fail=false;objects.clear(); // isolate the next synthetic inventory
    // Model full retained-byte inventory using bounded metadata, not 200 MiB of allocations.
    const meta=(h,size)=>({key:'private/v1/'+uid+'/'+h,size,uploaded:new Date(now),etag:h,httpMetadata:{contentType:'image/png'},customMetadata:{sha256:h}});
    objects.set(key,meta(hash,image.length));
    for(let n=0;n<100;n++){const o=meta(sha('retained-'+n),2*MB-(n===99?image.length:0));objects.set(o.key,o);}
    let writes=0;bucket.put=async()=>{writes++;throw Error('unexpected write');};
    const full=await l.sweep(uid,()=>live);
    assert.equal(full.body.usage.bytes,200*MB);assert.equal(full.body.retainedBytes,200*MB);assert.equal(full.body.removed,0);
    assert.equal((await l.sweep(uid,()=>false)).status,401);
    const newBytes=Buffer.concat([image,Buffer.from([1])]);
    const denied=await handleMedia(upload(newBytes),uid,bucket,()=>live);
    assert.equal(denied.status,413);assert.equal((await denied.json()).code,'media-quota');
    assert.equal(writes,0);assert.equal(objects.size,101);
    const dedup=await handleMedia(upload(),uid,bucket,()=>live);
    assert.equal(dedup.status,200);assert.equal((await dedup.json()).existed,true);
    assert.equal((await handleMedia(new Request('http://localhost'+path,{method:'HEAD'}),uid,bucket,()=>live)).status,200);
    // Re-reference is safe at quota, but it does not pretend to free bytes.
    state={kind:'ok',state:{customEx:[{media:{hash}}]}};
    repo.tx(()=>l.noteState(uid,state.state));assert.equal((await l.sweep(uid,()=>live)).body.usage.bytes,200*MB);
    console.log('PHASE5_RETAINED_BYTE_QUOTA PASS');
    // Test the independent 500-object ceiling with small synthetic metadata.
    objects.clear();objects.set(key,meta(hash,image.length));
    for(let n=0;n<499;n++){const o=meta(sha('count-'+n),1);objects.set(o.key,o);}
    state={kind:'ok',state:{workouts:[]}};
    const atCount=await l.sweep(uid,()=>live);
    assert.equal(atCount.body.usage.count,500);assert.equal(atCount.body.retained,500);
    const countDenied=await handleMedia(upload(newBytes),uid,bucket,()=>live);
    assert.equal(countDenied.status,413);assert.equal((await countDenied.json()).code,'media-quota');
    assert.equal((await handleMedia(upload(),uid,bucket,()=>live)).status,200);
    assert.equal(writes,0);assert.equal(objects.size,500);
    console.log('PHASE5_RETAINED_OBJECT_QUOTA PASS');
    // Durable intent is written before R2 deletion. A failed cleanup cannot finalize the account.
    repo.tx(()=>l.begin(uid));assert.equal(repo.user(uid).disabled,1);
    fail=true;let finalized=0;await assert.rejects(l.finish(uid,()=>{finalized++}),/injected/);
    assert.equal(l.pending(),uid);assert.equal(finalized,0);assert.ok(objects.has(key));
    fail=false;l=make();
    // A bulk-delete backend can delete only a subset before throwing. No finalization
    // or cross-owner cleanup, even when recovery needs several requests.
    const foreign='private/v1/otherowner123456/'+hash;
    objects.set(foreign,{key:foreign,size:1,uploaded:new Date(now),etag:'foreign'});
    const originalDelete=bucket.delete;
    await assert.rejects(l.finish('otherowner123456',()=>{}),/missing deletion intent/);
    bucket.delete=async keys=>{objects.delete([keys].flat()[0]);throw Error('partial batch failure');};
    const finalize=id=>{repo.q('DELETE FROM auth_users WHERE id=?',id);finalized++;};
    await assert.rejects(l.finish(uid,finalize),/partial batch failure/);
    assert.equal(l.pending(),uid);assert.equal(finalized,0);assert.equal(repo.user(uid).disabled,1);
    // A backend may report success but leave part of a batch behind.
    l=make();bucket.delete=async keys=>{objects.delete(keys[0]);};
    await assert.rejects(l.finish(uid,finalize),/account media delete not verified/);
    assert.equal(l.pending(),uid);assert.equal(finalized,0);
    let batches=0,partialFailures=0;
    bucket.delete=async keys=>{
      assert.ok(keys.length>0&&keys.length<=DELETE_BATCH);
      assert.ok(keys.every(k=>k.startsWith('private/v1/'+uid+'/')));
      batches++;
      if(batches%5===0){objects.delete(keys[0]);partialFailures++;throw Error('repeated partial batch');}
      await originalDelete(keys);
    };
    while((await inventory(bucket,uid)).usage.count){
      l=make();assert.equal(l.pending(),uid);assert.equal(repo.user(uid).disabled,1);
      // Fail the final SQLite transaction too, after all objects are absent.
      const failFinal=id=>{repo.q('DELETE FROM auth_users WHERE id=?',id);throw Error('finalize rollback');};
      try{assert.equal(await l.finish(uid,failFinal),false);}
      catch(e){assert.match(e.message,/repeated partial batch|finalize rollback/);}
      assert.equal(finalized,0);assert.equal(l.pending(),uid);assert.equal(repo.user(uid).disabled,1);
      assert.ok(batches<100,'bounded recovery must make progress');
    }
    assert.ok(partialFailures>=1);assert.ok(batches>=Math.ceil(498/DELETE_BATCH));
    l=make();assert.equal(await l.finish(uid,finalize),true);
    console.log('PHASE5_MAX_INVENTORY_RECOVERY PASS');
    assert.equal(l.pending(),null);assert.equal(finalized,1);assert.equal(objects.size,1);assert.ok(objects.has(foreign));assert.equal(repo.user(uid),undefined);
    console.log('PHASE5_PARTIAL_BATCH_DELETE_RECOVERY PASS');
    console.log('PHASE5_LIFECYCLE_FAULT_RECOVERY PASS');
  }finally{db.close();}
});
async function findAuthDb(root){
  for(const entry of await readdir(root,{withFileTypes:true})){
    const p=join(root,entry.name);
    if(entry.isDirectory()){const found=await findAuthDb(p);if(found)return found;}
    else if(entry.isFile()&&entry.name.endsWith('.sqlite')){
      const db=new DatabaseSync(p,{timeout:5000});try{if(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_version'").get())return p;}finally{db.close();}
    }
  }
}
test('actual local Worker: SPA, private R2, authenticated media contract and restart',{timeout:180000},async()=>{
  const AUTH_SECRET=randomBytes(32).toString('hex'),SETUP_CODE=randomBytes(32).toString('hex');
  const runner=await localRunner('wrangler.web-media.jsonc',{health:'/api/health',allowUnavailable:true,privateLogs:true,syntheticDiagnostics:true,vars:origin=>({AUTH_SECRET,SETUP_CODE,API_ORIGIN:origin,RP_ID:'localhost',P5_MEDIA:'1'})});
  let cookie='',bearer='',uid='',count=0;
  const dev=authenticator({rp:'localhost',origin:runner.origin});
  const raw=async(p,method='GET',body,headers={})=>fetch(runner.base+p,{method,headers:{...(!['GET','HEAD','OPTIONS'].includes(method)?{origin:runner.origin}:{}),...headers},...(body===undefined?{}:{body}),signal:AbortSignal.timeout(30000)});
  const post=async(p,b={},h={})=>raw(p,'POST',JSON.stringify(b),{'content-type':'application/json',...h});
  const data=async(r,status=200)=>{assert.equal(r.status,status);return r.json();};
  const auth=()=>({cookie});
  const put=async(b=image,h=sha(b),extra={})=>raw('/api/media/'+h,'PUT',b,{'content-type':'image/png',...auth(),'x-opengym-account':uid,...extra});
  try{
    await runner.start();
    const root=await raw('/');assert.equal(root.status,200);assert.match(root.headers.get('content-type'),/text\/html/);assert.equal(root.headers.get('x-frame-options'),'DENY');assert.match(root.headers.get('cache-control'),/no-cache/);
    const html=await root.text(),policy=root.headers.get('content-security-policy');
    assert.match(html,/<html/i);assert.match(policy,/frame-ancestors 'none'/);
    for(const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g))assert.ok(policy.includes("'sha256-"+createHash('sha256').update(m[1]).digest('base64')+"'"));
    const script=html.match(/<script[^>]+src="([^"]+\.js)"/)?.[1];assert.ok(script);
    const js=await raw(new URL(script,runner.base).pathname,'HEAD');assert.equal(js.status,200);assert.match(js.headers.get('content-type'),/javascript/);assert.match(js.headers.get('cache-control'),/immutable/);
    assert.equal(await (await raw('/workouts','GET',undefined,{accept:'text/html'})).text(),html);
    for(const p of ['/api/unknown','/api/media/not-a-hash','/mcp','/.well-known/openid-configuration','/assets/missing.js','/exercise-media/still/missing.webp'])assert.equal((await raw(p,'GET',undefined,{accept:'text/html'})).status,404);
    const noApi=await raw('/api/unknown','GET',undefined,{accept:'text/html'});assert.match(noApi.headers.get('content-type'),/application\/json/);
    const notice=await raw('/exercise-media/NOTICE.md');assert.equal(notice.status,200);assert.equal(await notice.text(),await readFile('../catalogue/media/NOTICE.md','utf8'));
    const file=(await readdir('../frontend/dist/exercise-media/still')).find(n=>/^\d+\.webp$/.test(n));assert.ok(file);
    const still=await raw('/exercise-media/still/'+file,'HEAD');assert.equal(still.status,200);assert.match(still.headers.get('content-type'),/image\/webp/);assert.match(still.headers.get('cache-control'),/immutable/);
    const sw=await raw('/sw.js');assert.equal(sw.status,200);assert.match(sw.headers.get('cache-control'),/no-cache/);assert.ok(!(await sw.text()).includes('__BUILD__'));
    console.log('PHASE5_SAME_ORIGIN_ASSETS PASS');
    assert.equal((await data(await raw('/api/config'))).media,undefined);
    assert.equal((await raw(path)).status,401);
    assert.equal((await raw(path,'PUT',image,{'content-type':'image/png'})).status,401);
    const o=await data(await post('/api/register/options',{name:'Synthetic Owner',code:SETUP_CODE}));
    const reg=await post('/api/register/verify',{cid:o.cid,credential:dev.register(o.options.challenge)});
    const r=await data(reg);uid=r.user.id;cookie=reg.headers.getSetCookie()[0].split(';')[0];
    const cfg=await data(await raw('/api/config','GET',undefined,auth()));assert.equal(cfg.media.videoMB,8);assert.equal(cfg.media.sounds,true);assert.equal(cfg.media.resetRequiresVerifiedBackup,true);
    assert.equal((await put(image,hash,{origin:'https://hostile.invalid'})).status,403);
    assert.equal((await put(image,hash,{'x-opengym-account':'not-this-owner'})).status,409);
    assert.equal((await put(image,other)).status,400);
    assert.equal((await put(Buffer.from('<svg/>'))).status,415);
    const oversize=Buffer.alloc(2*MB+1);
    const refused=await put(oversize);assert.equal(refused.status,413);assert.equal((await refused.json()).code,'media-too-large');
    assert.equal((await raw(path,'PUT',oversize,{'content-type':'image/png'})).status,401);
    assert.equal((await put(oversize,hash,{origin:'https://hostile.invalid'})).status,403);
    assert.equal((await put(oversize,hash,{'x-opengym-account':'not-this-owner'})).status,409);
    // An external header must not manufacture the bodyless rejection path.
    const forged=await put(image,other,{'x-opengym-internal-rejected-length':'8388609'});
    assert.equal(forged.status,400);assert.equal((await forged.json()).code,'hash-mismatch');
    assert.equal((await data(await post('/api/media/missing',{hashes:[hash,other]},auth()))).missing.length,2);
    console.log('PHASE7_DECLARED_REJECTION_AUTH_FENCE PASS');
    assert.equal((await post('/api/media/missing',{hashes:['bad']},auth())).status,400);
    assert.equal((await data(await post('/api/media/missing',{hashes:[hash,other,hash]},auth()))).missing.length,2);
    // Hold a real loopback HTTP upload in flight, without exposing a fault endpoint.
    // Observe admission via a second authenticated request rather than a fixed sleep.
    let heldResponse=null,heldError=null;
    const held=request(runner.base+path,{method:'PUT',headers:{cookie,origin:runner.origin,'content-type':'image/png','content-length':image.length,'x-opengym-account':uid}},res=>{heldResponse=res.statusCode;res.resume();});
    held.on('error',e=>{heldError=e;});held.setTimeout(12000,()=>held.destroy(Error('held upload timeout')));
    held.write(image.subarray(0,8));
    try{
      let admitted=false;
      for(let i=0;i<40;i++){
        const probe=await post('/api/media/missing',{hashes:[hash]},auth());
        if(probe.status===429){assert.equal((await probe.json()).code,'busy');admitted=true;break;}
        assert.equal(probe.status,200);assert.deepEqual((await probe.json()).missing,[hash]);await sleep(50);
      }
      assert.ok(admitted,'partial HTTP upload never acquired media admission');
      const concurrent=await put();assert.equal(concurrent.status,429);assert.equal((await concurrent.json()).code,'busy');
      const oversizedBusy=await put(oversize);assert.equal(oversizedBusy.status,429);assert.equal((await oversizedBusy.json()).code,'busy');
      const stateBusy=await raw('/api/data','PUT',JSON.stringify({state:{workouts:[],routines:[]},baseRev:0}),{'content-type':'application/json',...auth()});
      assert.equal(stateBusy.status,503);assert.equal((await stateBusy.json()).code,'busy');
      const sweepBusy=await post('/api/media/sweep',{},auth());assert.equal(sweepBusy.status,429);assert.equal((await sweepBusy.json()).code,'busy');
      const deleteBusy=await post('/api/account/delete',{name:'Synthetic Owner'},auth());assert.equal(deleteBusy.status,409);
      assert.equal((await data(await raw('/api/data','GET',undefined,auth()))).rev,0);
      assert.equal((await raw('/api/me','GET',undefined,auth())).status,200);
      held.destroy(Error('synthetic interrupted upload'));
      let available=false;
      for(let i=0;i<100;i++){
        const probe=await post('/api/media/missing',{hashes:[hash]},auth());
        if(probe.status===200){assert.deepEqual((await probe.json()).missing,[hash]);available=true;break;}
        assert.equal(probe.status,429);await probe.arrayBuffer();await sleep(100);
      }
      assert.ok(available,'interrupted upload did not release admission');
      assert.ok(heldResponse===null||heldResponse>=400);assert.ok(heldError||held.destroyed);
      console.log('PHASE5_CONCURRENT_INTERRUPTED_UPLOAD PASS');
    }finally{held.destroy();}
    const fresh=await data(await put(),201);assert.deepEqual(fresh,{ok:true,hash,mime:'image/png',size:image.length,existed:false});
    assert.equal((await data(await put())).existed,true);
    const m=await data(await post('/api/media/missing',{hashes:[hash,other,hash]},auth()));assert.deepEqual(m.missing,[other]);assert.deepEqual(m.usage,{bytes:image.length,count:1,quotaBytes:200*MB});
    const blob=await raw(path,'GET',undefined,auth());assert.equal(blob.status,200);assert.equal(blob.headers.get('content-type'),'image/png');assert.match(blob.headers.get('cache-control'),/private, no-store/);assert.equal(blob.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(Buffer.from(await blob.arrayBuffer()),image);
    const range=await raw(path,'GET',undefined,{...auth(),range:'bytes=1-5'});assert.equal(range.status,206);assert.equal(range.headers.get('content-range'),'bytes 1-5/'+image.length);assert.deepEqual(Buffer.from(await range.arrayBuffer()),image.subarray(1,6));
    assert.equal((await raw(path,'GET',undefined,{...auth(),range:'bytes=999-'})).status,416);
    assert.equal((await raw('/api/media/'+other,'GET',undefined,auth())).status,404);
    assert.equal((await raw('/private/v1/'+uid+'/'+hash)).status,404);
    const proofOpts=await data(await post('/api/login/options'));
    const pair=await data(await post('/api/pair/create',{cid:proofOpts.cid,credential:dev.login(proofOpts.options.challenge,++count)},auth()));
    bearer=(await data(await post('/api/pair/redeem',{code:pair.code}))).token;
    const mobile={'authorization':'Bearer '+bearer,origin:'capacitor://localhost'};
    const mobileGet=await raw(path,'GET',undefined,mobile);assert.equal(mobileGet.status,200);assert.equal(mobileGet.headers.get('access-control-allow-origin'),'capacitor://localhost');assert.deepEqual(Buffer.from(await mobileGet.arrayBuffer()),image);
    const preflight=await raw(path,'OPTIONS',undefined,{origin:'capacitor://localhost','access-control-request-method':'GET','access-control-request-headers':'authorization,range'});assert.equal(preflight.status,204);assert.match(preflight.headers.get('access-control-allow-headers'),/Range/i);
    assert.equal((await post('/api/media/sweep',{},auth())).status,503);
    // A committed state is required even for a conservative sweep.
    const state={workouts:[],routines:[],customEx:[{id:'synthetic',media:{hash,kind:'image',mime:'image/png',size:image.length,width:1,height:1}}]};
    await data(await raw('/api/data','PUT',JSON.stringify({state,baseRev:0,stamped:true}),{'content-type':'application/json',...auth()}));
    assert.equal((await data(await post('/api/media/sweep',{},auth()))).removed,0);
    const current=await data(await raw('/api/data','GET',undefined,auth()));
    await data(await raw('/api/data','PUT',JSON.stringify({state:{workouts:[],routines:[],customEx:[],resetAt:Date.now()},baseRev:current.rev,baseWid:current.state._wid,stamped:true}),{'content-type':'application/json',...auth()}));
    const afterReset=await data(await post('/api/media/sweep',{},auth()));
    // Deliberately retain recently unreferenced objects for offline clients; never pretend they were deleted.
    assert.equal(afterReset.removed,0);assert.equal(afterReset.usage.count,1);assert.equal(afterReset.retained,1);assert.equal(afterReset.retainedBytes,image.length);assert.equal(afterReset.policy,'retain-until-authorized-delete');
    assert.equal((await raw('/api/me','GET',undefined,mobile)).status,200);
    assert.equal((await post('/api/account/delete',{name:'wrong name'},mobile)).status,400);
    assert.equal((await raw(path,'HEAD',undefined,mobile)).status,200);
    const audio=wav(),audioHash=sha(audio);
    const uploadedAudio=await data(await raw('/api/media/'+audioHash,'PUT',audio,{'content-type':'audio/wav',...auth(),'x-opengym-account':uid}),201);
    assert.equal(uploadedAudio.mime,'audio/wav');
    const gotAudio=await raw('/api/media/'+audioHash,'GET',undefined,auth());
    assert.equal(gotAudio.status,200);assert.equal(gotAudio.headers.get('content-type'),'audio/wav');
    assert.deepEqual(Buffer.from(await gotAudio.arrayBuffer()),audio);
    const audioRange=await raw('/api/media/'+audioHash,'GET',undefined,{...auth(),range:'bytes=44-55'});assert.equal(audioRange.status,206);assert.equal(audioRange.headers.get('content-range'),'bytes 44-55/'+audio.length);assert.deepEqual(Buffer.from(await audioRange.arrayBuffer()),audio.subarray(44,56));
    console.log('PHASE5_CANONICAL_AUDIO_R2 PASS');
    console.log('PHASE5_PRIVATE_MEDIA_AUTH_RANGE PASS');
    await runner.stop();await runner.start();
    const back=await raw(path,'GET',undefined,auth());assert.equal(back.status,200);assert.deepEqual(Buffer.from(await back.arrayBuffer()),image);
    assert.equal((await data(await post('/api/media/missing',{hashes:[hash]},auth()))).usage.bytes,image.length+audio.length);
    await data(await post('/api/logout/all',{},auth()));
    assert.equal((await raw(path,'GET',undefined,mobile)).status,401);
    assert.equal((await raw(path,'GET',undefined,auth())).status,401);
    console.log('PHASE5_MEDIA_RESTART_REVOCATION PASS');
    // Re-authenticate after revoke, then authorize deletion via a fresh paired token.
    const login=await data(await post('/api/login/options'));
    const verified=await post('/api/login/verify',{cid:login.cid,credential:dev.login(login.options.challenge,++count)});
    await data(verified);cookie=verified.headers.getSetCookie()[0].split(';')[0];
    const pairOpts=await data(await post('/api/login/options'));
    const nextPair=await data(await post('/api/pair/create',{cid:pairOpts.cid,credential:dev.login(pairOpts.options.challenge,++count)},auth()));
    const nextToken=(await data(await post('/api/pair/redeem',{code:nextPair.code}))).token;
    const deleting={authorization:'Bearer '+nextToken,origin:'capacitor://localhost'};
    // Fill the real local R2 namespace with enough distinct valid WAV files for
    // multiple bounded recovery requests (65 total including the existing two).
    for(let n=0;n<63;n++){const b=wav(2206+n),h=sha(b);await data(await raw('/api/media/'+h,'PUT',b,{'content-type':'audio/wav',...auth(),'x-opengym-account':uid}),201);}
    assert.equal((await data(await post('/api/media/missing',{hashes:[hash,audioHash]},auth()))).usage.count,65);
    // Interrupt the final SQLite transaction after R2 cleanup. The intent and disabled
    // owner must survive restart; health recovery finishes only the authorized deletion.
    await runner.stop();const dbPath=await findAuthDb(runner.dir);assert.ok(dbPath);
    let db=new DatabaseSync(dbPath,{timeout:5000});
    try{db.exec("CREATE TRIGGER test_fail_finalize BEFORE DELETE ON auth_users BEGIN SELECT RAISE(ABORT,'synthetic finalize failure'); END;");}finally{db.close();}
    await runner.start();
    assert.equal((await post('/api/account/delete',{name:'Synthetic Owner'},deleting)).status,503);
    assert.equal((await raw(path,'GET',undefined,deleting)).status,503);
    // Interrupt after another bounded recovery request, with deletion intent
    // still durable. Startup health may process another batch but cannot finalize.
    assert.equal((await raw('/api/health')).status,503);
    await runner.stop();db=new DatabaseSync(dbPath,{timeout:5000});
    try{assert.equal(db.prepare('SELECT uid FROM media_delete_intent').get().uid,uid);
      assert.equal(db.prepare('SELECT disabled FROM auth_users WHERE id=?').get(uid).disabled,1);
      assert.equal(db.prepare('SELECT count(*) AS n FROM profile_state').get().n,1);
    }finally{db.close();}
    await runner.start();
    for(let n=0;n<5;n++)assert.equal((await raw('/api/health')).status,503);
    assert.equal((await raw('/api/me','GET',undefined,deleting)).status,503);
    await runner.stop();db=new DatabaseSync(dbPath,{timeout:5000});
    try{
      assert.equal(db.prepare('SELECT uid FROM media_delete_intent').get().uid,uid);
      assert.equal(db.prepare('SELECT disabled FROM auth_users WHERE id=?').get(uid).disabled,1);
      assert.equal(db.prepare('SELECT count(*) AS n FROM profile_state').get().n,1);
      db.exec('DROP TRIGGER test_fail_finalize;');
    }finally{db.close();}
    await runner.start();assert.equal((await data(await raw('/api/health'))).users,0);
    assert.equal((await raw(path,'GET',undefined,deleting)).status,401);
    await runner.stop();db=new DatabaseSync(dbPath,{timeout:5000});
    try{for(const table of ['media_delete_intent','media_gc','auth_users','auth_creds','profile_state','profile_chunks'])assert.equal(db.prepare('SELECT count(*) AS n FROM '+table).get().n,0,table);}finally{db.close();}
    console.log('PHASE5_RESTART_MULTIBATCH_LOCAL_R2 PASS');
    console.log('PHASE5_LARGE_LOCAL_R2_DELETE_RECOVERY PASS');
    console.log('PHASE5_RESET_GRACE_ACCOUNT_DELETE PASS');
  }finally{await runner.cleanup();}
});

test('read-only migration audit verifies known bytes and fails closed on missing, corrupt or stale sources',async()=>{
  const owner='abcdefghijklmnop',blob=new Blob([image],{type:'image/png'});
  const m={hash,mime:'image/png',kind:'image',size:image.length,width:1,height:1};
  const snapshots=[{owner,state:{customEx:[{media:m}],active:{entries:[{sets:[{media:[m]}]}]}}}];
  const args={owner,snapshots,readLocal:async()=>blob,readBackup:async()=>blob,readDestination:async()=>blob,isCurrent:async()=>true};
  const good=await auditMigrationMedia(args);
  assert.equal(good.knownMediaVerified,true);assert.equal(good.cutoverAuthorized,false);assert.equal(good.records.length,1);
  const missing=await auditMigrationMedia({...args,readDestination:async()=>null});
  assert.equal(missing.knownMediaVerified,false);assert.deepEqual(missing.issues,['destination-not-verified']);
  const invalid=await auditMigrationMedia({...args,readBackup:async()=>new Blob([Buffer.alloc(image.length)],{type:'image/png'})});
  assert.deepEqual(invalid.issues,['backup-not-verified']);assert.equal(invalid.records[0].backup,'invalid');
  const lost=await auditMigrationMedia({...args,readLocal:async()=>null,readBackup:async()=>null,readDestination:async()=>{throw Error('unreadable')}});
  assert.ok(lost.issues.includes('no-verified-copy'));assert.equal(lost.records[0].destination,'unreadable');
  const conflict=await auditMigrationMedia({...args,snapshots:[...snapshots,{owner,state:{customEx:[{media:{...m,size:m.size+1}}]}}]});
  assert.ok(conflict.issues.includes('conflicting-reference-metadata'));assert.equal(conflict.cutoverAuthorized,false);
  await assert.rejects(auditMigrationMedia({...args,snapshots:[{owner:'another',state:{}}]}),/foreign snapshot/);
  let checks=0;await assert.rejects(auditMigrationMedia({...args,isCurrent:async()=>++checks===1}),/snapshot or owner changed/);
  const wrongMime=await auditMigrationMedia({...args,snapshots:[{owner,state:{customEx:[{media:{...m,mime:'constructor'}}]}}]});
  assert.ok(wrongMime.issues.includes('invalid-reference-metadata'));assert.equal(wrongMime.knownMediaVerified,false);
  const localOnly=await auditMigrationMedia({...args,snapshots:[{owner,state:{workouts:[{entries:[{sets:[{media:[{...m,local:true}]}]}]}]}}]});
  assert.ok(localOnly.issues.includes('device-local-restore-required'));assert.equal(localOnly.minimumDestination.count,0);assert.equal(localOnly.knownMediaVerified,false);
  // Multiple device snapshots may reference the same bytes; count once.
  const min=await auditMigrationMedia({...args,snapshots:[...snapshots,...snapshots]});
  assert.deepEqual(min.minimumDestination,{bytes:image.length,count:1});
  const largeRefs=Array.from({length:501},(_,n)=>({media:{...m,hash:sha('minimum-quota-'+n),size:MB}}));
  const capacity=await auditMigrationMedia({...args,snapshots:[{owner,state:{customEx:largeRefs}}],readLocal:async()=>null,readBackup:async()=>null,readDestination:async()=>null});
  assert.deepEqual(capacity.minimumDestination,{bytes:501*MB,count:501});
  assert.ok(capacity.issues.includes('destination-minimum-byte-quota'));assert.ok(capacity.issues.includes('destination-minimum-object-quota'));
  assert.equal(capacity.cutoverAuthorized,false);
  const retained={hash:sha('retained synthetic'),mime:'image/png',size:18};
  const retainedBlob=new Blob(['retained synthetic'],{type:'image/png'});
  const retainedArgs={...args,retainedInventory:{owner,rows:[retained]},readLocal:async h=>h===retained.hash?retainedBlob:blob,readBackup:async h=>h===retained.hash?retainedBlob:blob,readDestination:async h=>h===retained.hash?retainedBlob:blob};
  const retainedResult=await auditMigrationMedia(retainedArgs);
  assert.equal(retainedResult.knownMediaVerified,true);
  assert.deepEqual(retainedResult.minimumDestination,{bytes:image.length+retained.size,count:2});
  assert.equal(retainedResult.cutoverAuthorized,false);
  await assert.rejects(auditMigrationMedia({...retainedArgs,retainedInventory:{owner:'foreign',rows:[retained]}}),/foreign retained/);
  const lostRetained=await auditMigrationMedia({...retainedArgs,readBackup:async h=>h===retained.hash?null:blob});
  assert.equal(lostRetained.knownMediaVerified,false);assert.ok(lostRetained.issues.includes('backup-not-verified'));
  let backupCalls=0;
  await assert.rejects(auditMigrationMedia({...args,isCurrent:async()=>++backupCalls===1,readBackup:async()=>{assert.fail('must not read backup after fence fails');}}),/snapshot or owner changed/);
  console.log('PHASE7_RETAINED_INVENTORY_FENCE PASS');
  console.log('PHASE5_PREFLIGHT_CAPACITY_LOCAL_ONLY_GATES PASS');
  console.log('PHASE5_MIGRATION_PREFLIGHT_INTEGRITY PASS');
});


// A disposable encrypted backup/restore qualification, not an export format,
// migration CLI or production cutover. No credentials or backup bytes are logged.
test('verified encrypted disk fixture restores known state/media to an independent local Worker',{timeout:180000},async()=>{
  const mk=async()=>{
    const AUTH_SECRET=randomBytes(32).toString('hex'),SETUP_CODE=randomBytes(32).toString('hex');
    const runner=await localRunner('wrangler.web-media.jsonc',{health:'/api/health',privateLogs:true,syntheticDiagnostics:true,vars:origin=>({AUTH_SECRET,SETUP_CODE,API_ORIGIN:origin,RP_ID:'localhost',P5_MEDIA:'1'})});
    let cookie='',owner=null;
    // The two disposable Workers are stopped and restarted on the same ports.
    // Use fresh connections rather than reusing a pooled socket across restart.
    // Never retry an unknown write outcome or treat a transport failure as 413.
    const raw=async(p,method='GET',body,headers={})=>{
      try{return await fetch(runner.base+p,{method,redirect:'error',headers:{connection:'close',origin:runner.origin,...(cookie?{cookie}:{}),...headers},...(body===undefined?{}:{body}),signal:AbortSignal.timeout(15000)});}
      catch(e){throw Error('restore fixture '+method+' '+p.replace(/[a-f0-9]{64}/g,'<hash>')+' transport '+(e.cause?.code||e.name),{cause:e});}
    };
    // The declared-length test is exercised directly at the application guard.
    // For the independent HTTP streaming path send the complete real archive
    // bytes with chunked framing, so the receiver detects overflow on the last
    // byte rather than the local proxy tearing down an unread declared body.
    // Keep the original declared-length HTTP response as a distinct open gate.
    const rejectOversized=(h,b,m)=>new Promise((resolve,reject)=>{
      let settled=false,responded=false;
      const finish=(err,value)=>{if(settled)return;settled=true;clearTimeout(deadline);req.destroy();err?reject(err):resolve(value);};
      const req=request(runner.base+'/api/media/'+h,{method:'PUT',agent:false,headers:{connection:'close','transfer-encoding':'chunked',origin:runner.origin,cookie,'content-type':m,'x-opengym-account':owner}},res=>{
        responded=true;const chunks=[];let n=0;
        res.on('data',c=>{n+=c.length;if(n>64*1024){finish(Error('oversized rejection response too large'));return;}chunks.push(c);});
        res.on('aborted',()=>finish(Error('oversized rejection response aborted')));
        res.on('error',e=>finish(e));
        res.on('end',()=>{try{finish(null,{status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))});}
          catch{finish(Error('oversized chunked HTTP response not JSON; status='+res.statusCode+' type='+String(res.headers['content-type']||'none')));}});
      });
      const deadline=setTimeout(()=>finish(Error('oversized rejection response deadline')),15000);
      req.on('error',e=>{if(!responded)finish(Error('oversized chunked restore PUT transport '+(e.code||e.name),{cause:e}));});
      req.end(b);
    });
    const json=async(res,status=200)=>{assert.equal(res.status,status);return res.json();};
    const post=(p,b)=>raw(p,'POST',JSON.stringify(b),{'content-type':'application/json'});
    function rawData(){return raw('/api/data');}
    const state=async()=>json(await rawData());
    const register=async()=>{
      const dev=authenticator({rp:'localhost',origin:runner.origin});
      const o=await json(await post('/api/register/options',{name:'Synthetic backup owner',code:SETUP_CODE}));
      const res=await post('/api/register/verify',{cid:o.cid,credential:dev.register(o.options.challenge)});
      owner=(await json(res)).user.id;cookie=res.headers.getSetCookie()[0].split(';')[0];return owner;
    };
    const put=(h,b,m,want=owner)=>raw('/api/media/'+h,'PUT',b,{'content-type':m,'x-opengym-account':want});
    const save=async(doc,base)=>json(await raw('/api/data','PUT',JSON.stringify({state:doc,baseRev:base.rev,baseWid:base.state?._wid,stamped:true}),{'content-type':'application/json'}));
    const current=async(want,rev,wid)=>{
      if(want!==owner)return false;
      const me=await raw('/api/me');if(!me.ok||(await me.json()).user.id!==want)return false;
      const d=await state();return d.rev===rev&&d.state?._wid===wid;
    };
    // The actual authenticated response supplies MIME and bytes. Never relabel
    // a server response using the expected type. Refuse unexpected status/size.
    const read=async(h,want)=>{
      const res=await raw('/api/media/'+h,'GET',undefined,{'x-opengym-account':want});
      if(res.status===404){await res.arrayBuffer();return null;}
      if(res.status!==200){await res.arrayBuffer();throw Error('destination read refused');}
      const length=Number(res.headers.get('content-length'));
      if(!Number.isSafeInteger(length)||length<1||length>8*MB)throw Error('destination size invalid');
      const blob=await res.blob();if(blob.size!==length)throw Error('destination truncated');
      return blob;
    };
    return {runner,register,raw,json,state,put,save,current,read,rejectOversized};
  };
  const source=await mk(),target=await mk(),backupDir=await mkdtemp(join(tmpdir(),'opengym-p5-backup-'));
  const key=randomBytes(32),aad=Buffer.from('opengym-synthetic-backup-fixture-v1'),archivePath=join(backupDir,'snapshot.enc');
  const seal=plain=>{
    const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(aad);
    const body=Buffer.concat([cipher.update(plain),cipher.final()]);return Buffer.concat([nonce,cipher.getAuthTag(),body]);
  };
  const open=(bytes,k=key)=>{
    if(bytes.length<29||bytes.length>16*MB)throw Error('backup fixture size');
    const d=createDecipheriv('aes-256-gcm',k,bytes.subarray(0,12));d.setAAD(aad);d.setAuthTag(bytes.subarray(12,28));
    return JSON.parse(Buffer.concat([d.update(bytes.subarray(28)),d.final()]).toString('utf8'));
  };
  const audio=wav(2205),ah=sha(audio);
  const media={kind:'image',hash,mime:'image/png',size:image.length,width:1,height:1,at:1};
  const sound={kind:'audio',hash:ah,mime:'audio/wav',size:audio.length,width:1,height:1,dur:0.1,at:1};
  try{
    await source.runner.start();const sourceOwner=await source.register();
    const original={customEx:[{id:'backup-photo',media}],workouts:[{id:'backup-workout',d:'2026-09-20',start:1000,end:2000,entries:[]}],routines:[],sounds:[{id:'backup-audio',name:'Synthetic WAV',m:sound,_ts:1}]};
    await source.json(await source.put(hash,image,media.mime),201);
    await source.json(await source.put(ah,audio,sound.mime),201);
    await source.save(original,await source.state());const exported=await source.state();
    assert.ok(await source.current(sourceOwner,exported.rev,exported.state._wid));
    const rows=[];
    for(const ref of [media,sound]){
      const blob=await source.read(ref.hash,sourceOwner);assert.ok(blob);
      const b=Buffer.from(await blob.arrayBuffer());assert.equal(sha(b),ref.hash);assert.equal(blob.type,ref.mime);assert.equal(b.length,ref.size);
      rows.push({hash:ref.hash,mime:blob.type,size:b.length,bytes:b.toString('base64')});
    }
    assert.ok(await source.current(sourceOwner,exported.rev,exported.state._wid));
    const plain=Buffer.from(JSON.stringify({version:1,sourceOwner,revision:exported.rev,state:exported.state,files:rows}));
    const stateDigest=sha(JSON.stringify(exported.state));
    await writeFile(archivePath,seal(plain),{mode:0o600,flag:'wx'});
    await source.runner.stop(); // source storage remains intact, never erased
    const encrypted=await readFile(archivePath);
    const damaged=Buffer.from(encrypted);damaged[damaged.length-1]^=1;
    assert.throws(()=>open(damaged));assert.throws(()=>open(encrypted,randomBytes(32)));
    const restored=open(encrypted);
    assert.equal(restored.version,1);assert.equal(restored.sourceOwner,sourceOwner);assert.equal(restored.revision,exported.rev);assert.equal(sha(JSON.stringify(restored.state)),stateDigest);
    const copies=new Map();
    for(const row of restored.files){const b=Buffer.from(row.bytes,'base64');assert.equal(b.length,row.size);assert.equal(sha(b),row.hash);copies.set(row.hash,new Blob([b],{type:row.mime}));}
    // Explicit source -> fresh destination owner mapping in this synthetic test.
    await target.runner.start();const destinationOwner=await target.register();assert.notEqual(destinationOwner,sourceOwner);
    const empty=await target.state();assert.equal(empty.rev,0);
    const snapshot={owner:destinationOwner,state:restored.state};
    const makeAudit=base=>({owner:destinationOwner,snapshots:[snapshot],readLocal:async()=>null,readBackup:async h=>copies.get(h)||null,readDestination:h=>target.read(h,destinationOwner),isCurrent:owner=>target.current(owner,base.rev,base.state?._wid)});
    const before=await auditMigrationMedia(makeAudit(empty));
    assert.equal(before.knownMediaVerified,false);assert.equal(before.cutoverAuthorized,false);
    assert.ok(before.records.every(r=>r.backup==='verified'&&r.destination==='missing'));
    assert.deepEqual(before.issues,['destination-not-verified']);
    assert.equal((await target.put(hash,image,media.mime,sourceOwner)).status,409);
    await assert.rejects(target.read(hash,sourceOwner),/destination read refused/);
    // Only copy verified blobs; simulate interruption after the first write.
    await target.json(await target.put(hash,Buffer.from(await copies.get(hash).arrayBuffer()),media.mime),201);
    const partial=await auditMigrationMedia(makeAudit(empty));
    assert.equal(partial.knownMediaVerified,false);
    assert.equal(partial.records.find(r=>r.hash===hash).destination,'verified');
    assert.equal(partial.records.find(r=>r.hash===ah).destination,'missing');
    assert.equal((await target.state()).rev,0);
    await target.runner.stop();await target.runner.start();
    const resumed=await target.json(await target.put(hash,Buffer.from(await copies.get(hash).arrayBuffer()),media.mime));
    assert.equal(resumed.existed,true);
    await target.json(await target.put(ah,Buffer.from(await copies.get(ah).arrayBuffer()),sound.mime),201);
    const allBytes=await auditMigrationMedia(makeAudit(empty));assert.equal(allBytes.knownMediaVerified,true);assert.equal(allBytes.cutoverAuthorized,false);
    // Only then publish the restored state to the disposable destination.
    // The destination allocates its own storage revision/write identity.
    const doc=structuredClone(restored.state);delete doc._rev;delete doc._wid;
    await target.save(doc,empty);const committed=await target.state();
    for(const k of ['customEx','workouts','routines','sounds'])assert.deepEqual(committed.state[k],restored.state[k],k);
    await assert.rejects(auditMigrationMedia(makeAudit(empty)),/snapshot or owner changed/);
    const audit=await auditMigrationMedia(makeAudit(committed));assert.equal(audit.knownMediaVerified,true);assert.equal(audit.cutoverAuthorized,false);
    assert.ok(audit.records.every(r=>r.backup==='verified'&&r.destination==='verified'));
    await target.runner.stop();await target.runner.start();
    assert.deepEqual(await target.state(),committed);
    assert.equal((await auditMigrationMedia(makeAudit(committed))).knownMediaVerified,true);
    await source.runner.start();assert.deepEqual(await source.state(),exported);
    assert.equal(sha(Buffer.from(await (await source.read(hash,sourceOwner)).arrayBuffer())),hash);
    assert.equal(sha(Buffer.from(await (await source.read(ah,sourceOwner)).arrayBuffer())),ah);
    assert.deepEqual(await readFile(archivePath),encrypted);
    console.log('PHASE5_COMPATIBLE_RESTORE_READBACK PASS');
    // Existing device bytes may exceed the destination cap even though the old
    // server accepted them. Keep a separate encrypted fixture and do not publish
    // a dangling ref or silently transcode/drop the original.
    const old=mp4().file,large=Buffer.alloc(8*MB+1);
    large.set(old);large.writeUInt32BE(large.length-old.length,old.length);large.write('free',old.length+4);
    const lh=sha(large),lr={kind:'video',hash:lh,mime:'video/mp4',size:large.length,width:1920,height:1080,dur:5,at:1};
    const legacyState={customEx:[{id:'legacy-video',media:lr}]};
    const legacyPath=join(backupDir,'legacy.enc');
    const legacyArchive=seal(Buffer.from(JSON.stringify({version:1,sourceOwner,state:legacyState,files:[{hash:lh,mime:lr.mime,size:large.length,bytes:large.toString('base64')}]})));
    await writeFile(legacyPath,legacyArchive,{mode:0o600,flag:'wx'});
    const legacyRestored=open(await readFile(legacyPath)),legacyBytes=Buffer.from(legacyRestored.files[0].bytes,'base64');
    assert.deepEqual(legacyRestored.state,legacyState);assert.equal(legacyRestored.sourceOwner,sourceOwner);
    assert.equal(legacyBytes.length,large.length);assert.equal(sha(legacyBytes),lh);
    const legacyAudit=await auditMigrationMedia({owner:destinationOwner,snapshots:[{owner:destinationOwner,state:legacyRestored.state}],
      readLocal:async()=>null,readBackup:async h=>h===lh?new Blob([legacyBytes],{type:lr.mime}):null,
      readDestination:h=>target.read(h,destinationOwner),isCurrent:owner=>target.current(owner,committed.rev,committed.state._wid)});
    assert.deepEqual(legacyAudit.issues,['destination-not-verified','destination-size-limit']);
    assert.deepEqual(legacyAudit.records,[{hash:lh,local:'missing',backup:'verified',destination:'missing',overLimit:true}]);
    assert.equal(legacyAudit.cutoverAuthorized,false);
    // Real handler, actual oversized archived bytes, exact declared size and
    // strict JSON result. Any attempted bucket access fails the test.
    const noBucket=new Proxy({}, {get(){throw Error('oversized request touched storage');}});
    const declared=new Request('http://localhost/api/media/'+lh,{method:'PUT',body:legacyBytes,headers:{'content-type':lr.mime,'content-length':String(legacyBytes.length),'x-opengym-account':destinationOwner}});
    const deniedByGuard=await handleMedia(declared,destinationOwner,noBucket,()=>true);
    assert.equal(deniedByGuard.status,413);assert.equal((await deniedByGuard.json()).code,'media-too-large');
    console.log('PHASE5_OVERSIZED_DECLARED_LENGTH_HANDLER PASS');
    // This is independent HTTP streaming qualification, not a claim that the
    // original declared-length loopback transport failure is fixed.
    const reject=await target.rejectOversized(lh,legacyBytes,lr.mime);assert.equal(reject.status,413);assert.equal(reject.body.code,'media-too-large');
    console.log('PHASE5_OVERSIZED_CHUNKED_HTTP_REJECTION PASS');
    assert.equal(await target.read(lh,destinationOwner),null);
    assert.deepEqual(await target.state(),committed);
    assert.deepEqual(await readFile(legacyPath),legacyArchive);
    assert.equal(sha(Buffer.from(open(await readFile(legacyPath)).files[0].bytes,'base64')),lh);
    console.log('PHASE5_OVERSIZED_ENCRYPTED_BACKUP_PRESERVED PASS');
    console.log('PHASE5_ENCRYPTED_DISK_BACKUP_RESTORE PASS');
    console.log('PHASE5_DESTINATION_OWNER_REVISION_PREFLIGHT PASS');
  }finally{key.fill(0);await source.runner.cleanup();await target.runner.cleanup();await rm(backupDir,{recursive:true,force:true});}
});
