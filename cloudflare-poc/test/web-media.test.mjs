import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {request} from 'node:http';
import {setTimeout as sleep} from 'node:timers/promises';
import {DatabaseSync} from 'node:sqlite';
import {MediaLifecycle,GRACE_MS,DELETE_BATCH,SWEEP_BATCH} from '../src/media-lifecycle.js';
import {localRunner} from './local-runner.mjs';
import {authenticator} from './auth-fixture.mjs';
import {inspect,parseRange,boundedBytes,handleMedia,inventory} from '../src/media.js';
import {jpeg,png,gif,webpVp8x,mp4} from '../../frontend/src/lib/media-samples.test-util.js';
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
  assert.equal((await handleMedia(upload(),uid,quota,()=>live)).status,413);
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
test('GC marks survive restart, preserve references, and retry failed deletion',async()=>{
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
    assert.equal((await l.sweep(uid,()=>live)).body.removed,0);
    now+=GRACE_MS+1;
    state={kind:'corrupt'};assert.equal((await l.sweep(uid,()=>live)).status,503);assert.ok(objects.has(key));
    state={kind:'ok',state:{customEx:[{media:{hash}}]}};
    repo.tx(()=>l.noteState(uid,state.state));assert.equal((await l.sweep(uid,()=>live)).body.removed,0);
    state={kind:'ok',state:{workouts:[]}};assert.equal((await l.sweep(uid,()=>live)).body.removed,0);
    l=make();now+=GRACE_MS+1;fail=true;
    await assert.rejects(l.sweep(uid,()=>live),/injected/);assert.ok(objects.has(key));
    fail=false;assert.equal((await l.sweep(uid,()=>live)).body.removed,1);assert.equal(objects.size,0);
    objects.set(key,{key,size:image.length,uploaded:new Date(now),etag:'two'});
    // Durable intent is written before R2 deletion. A failed cleanup cannot finalize the account.
    repo.tx(()=>l.begin(uid));assert.equal(repo.user(uid).disabled,1);
    fail=true;let finalized=0;await assert.rejects(l.finish(uid,()=>{finalized++}),/injected/);
    assert.equal(l.pending(),uid);assert.equal(finalized,0);assert.ok(objects.has(key));
    fail=false;l=make();
    // A bulk-delete backend can delete only a subset before throwing. No finalization
    // or cross-owner cleanup, even when recovery needs several requests.
    const foreign='private/v1/otherowner123456/'+hash;
    objects.set(foreign,{key:foreign,size:1,uploaded:new Date(now),etag:'foreign'});
    for(let n=0;n<DELETE_BATCH+2;n++){const k='private/v1/'+uid+'/'+sha('batch-'+n);objects.set(k,{key:k,size:1,uploaded:new Date(now),etag:'batch-'+n});}
    const originalDelete=bucket.delete;
    bucket.delete=async keys=>{objects.delete([keys].flat()[0]);throw Error('partial batch failure');};
    const finalize=id=>{repo.q('DELETE FROM auth_users WHERE id=?',id);finalized++;};
    await assert.rejects(l.finish(uid,finalize),/partial batch failure/);
    assert.equal(l.pending(),uid);assert.equal(finalized,0);assert.equal(repo.user(uid).disabled,1);
    bucket.delete=originalDelete;l=make();
    assert.equal(await l.finish(uid,finalize),false);assert.equal(finalized,0);assert.equal(l.pending(),uid);
    assert.equal(await l.finish(uid,finalize),true);
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
  const runner=await localRunner('wrangler.web-media.jsonc',{health:'/api/health',privateLogs:true,syntheticDiagnostics:true,vars:origin=>({AUTH_SECRET,SETUP_CODE,API_ORIGIN:origin,RP_ID:'localhost',P5_MEDIA:'1'})});
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
    const cfg=await data(await raw('/api/config','GET',undefined,auth()));assert.equal(cfg.media.videoMB,8);assert.equal(cfg.media.sounds,false);
    assert.equal((await put(image,hash,{origin:'https://hostile.invalid'})).status,403);
    assert.equal((await put(image,hash,{'x-opengym-account':'not-this-owner'})).status,409);
    assert.equal((await put(image,other)).status,400);
    assert.equal((await put(Buffer.from('<svg/>'))).status,415);
    assert.equal((await put(Buffer.alloc(2*MB+1))).status,413);
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
    assert.equal(afterReset.removed,0);assert.equal(afterReset.usage.count,1);
    assert.equal((await raw('/api/me','GET',undefined,mobile)).status,200);
    assert.equal((await post('/api/account/delete',{name:'wrong name'},mobile)).status,400);
    assert.equal((await raw(path,'HEAD',undefined,mobile)).status,200);
    console.log('PHASE5_PRIVATE_MEDIA_AUTH_RANGE PASS');
    await runner.stop();await runner.start();
    const back=await raw(path,'GET',undefined,auth());assert.equal(back.status,200);assert.deepEqual(Buffer.from(await back.arrayBuffer()),image);
    assert.equal((await data(await post('/api/media/missing',{hashes:[hash]},auth()))).usage.bytes,image.length);
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
    // Interrupt the final SQLite transaction after R2 cleanup. The intent and disabled
    // owner must survive restart; health recovery finishes only the authorized deletion.
    await runner.stop();const dbPath=await findAuthDb(runner.dir);assert.ok(dbPath);
    let db=new DatabaseSync(dbPath,{timeout:5000});
    try{db.exec("CREATE TRIGGER test_fail_finalize BEFORE DELETE ON auth_users BEGIN SELECT RAISE(ABORT,'synthetic finalize failure'); END;");}finally{db.close();}
    await runner.start();
    assert.equal((await post('/api/account/delete',{name:'Synthetic Owner'},deleting)).status,503);
    assert.equal((await raw(path,'GET',undefined,deleting)).status,503);
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
    console.log('PHASE5_RESET_GRACE_ACCOUNT_DELETE PASS');
  }finally{await runner.cleanup();}
});
