import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {mkdtemp,rm,writeFile,readFile,stat,symlink,readdir,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {localRunner} from './local-runner.mjs';
import {authenticator} from './auth-fixture.mjs';
import {config} from '../src/auth/session.js';
import {DatabaseSync} from 'node:sqlite';
import {decode,MAX_STORED} from '../src/storage/codec.js';
import {forClient} from '../src/sync/transition.js';
import {persistRecoveryBundle,verifyRecoveryBundle,readVerifiedRestoreObject} from '../src/recovery/bundle.js';
import {persistRecoveryFile,readRecoveryFile} from '../src/recovery/disk.js';
import {inspectRecoveryInventory,MAX_ARCHIVE_BYTES} from '../src/recovery/archive.js';

const sha=b=>createHash('sha256').update(b).digest('hex');
const secret=()=>randomBytes(32).toString('hex');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64');
function wav(samples=2205){const b=Buffer.alloc(44+samples*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(22050,24);b.writeUInt32LE(44100,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);return b;}
function row(b,mime,location='server'){return {hash:sha(b),mime,size:b.length,location,bytes:b.toString('base64')};}
const photo=row(png,'image/png'),retained=row(wav(),'audio/wav');
const media={kind:'image',hash:photo.hash,mime:photo.mime,size:photo.size,width:1,height:1,at:1};
const state={workouts:[{id:'backup-workout',d:'2026-09-20',start:1000,end:2000,entries:[]}],routines:[],customEx:[{id:'backup-photo',media}],notes:'synthetic recovery'};
const snapshot=(owner,d)=>({version:1,owner,snapshots:[{id:'server',kind:'server',owner,revision:d.rev,writeIdentity:d.state?._wid??null,state:d.state}],files:[photo,retained]});
test('exclusive private durable archive publication and fail-closed readback',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'opengym-p6-disk-')),key=randomBytes(32),owner='syntheticOwner01';
  const path=join(dir,'archive.enc'),p=snapshot(owner,{rev:1,state:{...state,_rev:1,_wid:'synthetic-1'}});
  try{
    const saved=await persistRecoveryFile(path,p,key,owner);
    assert.equal(saved.localReadbackVerified,true);assert.equal(saved.offProviderVerified,false);assert.equal(saved.cutoverAuthorized,false);
    const bytes=await readFile(path);assert.equal(sha(bytes),saved.archiveDigest);
    assert.equal((await stat(path)).mode&0o777,0o600);assert.deepEqual((await readRecoveryFile(path,key,owner)).payload,p);
    await assert.rejects(persistRecoveryFile(path,p,key,owner),e=>e.code==='EEXIST');
    assert.deepEqual(await readFile(path),bytes);assert.deepEqual(await readdir(dir),['archive.enc']);
    const alias=join(dir,'alias.enc');await symlink(path,alias);
    await assert.rejects(readRecoveryFile(alias,key,owner));
    await assert.rejects(persistRecoveryFile(alias,p,key,owner),e=>e.code==='EEXIST');
    await chmod(path,0o644);await assert.rejects(readRecoveryFile(path,key,owner),/private archive file/);await chmod(path,0o600);
    const bad=join(dir,'bad.enc');await writeFile(bad,bytes.subarray(0,bytes.length-1),{mode:0o600});
    await assert.rejects(readRecoveryFile(bad,key,owner),/authentication failed/);
    const large=join(dir,'large.enc');await writeFile(large,Buffer.alloc(MAX_ARCHIVE_BYTES+1),{mode:0o600});
    await assert.rejects(readRecoveryFile(large,key,owner),/private archive file/);
    await assert.rejects(persistRecoveryFile(join(dir,'missing','archive.enc'),p,key,owner),e=>e.code==='ENOENT');
    assert.deepEqual(await readFile(path),bytes);
    console.log('PHASE6_DURABLE_EXCLUSIVE_ARCHIVE PASS');
  }finally{key.fill(0);await rm(dir,{recursive:true,force:true});}
});
// Offline synthetic inspection only, with the Worker stopped. No raw DB export.
async function committedStateEvidence(root,owner,expected){
  async function find(dir){
    for(const e of await readdir(dir,{withFileTypes:true})){
      const p=join(dir,e.name);
      if(e.isDirectory()){const found=await find(p);if(found)return found;}
      else if(e.isFile()&&e.name.endsWith('.sqlite')){
        const db=new DatabaseSync(p,{readOnly:true});
        try{if(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='profile_state'").get())return p;}finally{db.close();}
      }
    }
  }
  const p=await find(root);assert.ok(p,'local state database missing');const db=new DatabaseSync(p,{readOnly:true});
  try{
    assert.equal(db.prepare('SELECT count(*) n FROM profile_state').get().n,1);
    const meta=db.prepare('SELECT * FROM profile_state WHERE profile_id=?').get(owner);
    const rows=db.prepare('SELECT idx,bytes FROM profile_chunks WHERE profile_id=? ORDER BY idx LIMIT 17').all(owner);
    assert.ok(meta);const state=decode(meta,rows);
    assert.deepEqual(forClient(state),expected.state);assert.equal(meta.rev,expected.rev);
    assert.equal(meta.byte_count,rows.reduce((n,r)=>n+r.bytes.length,0));
    assert.equal(meta.byte_count,Buffer.byteLength(JSON.stringify(state)));
    assert.ok(meta.byte_count<=MAX_STORED);
    return {committedStateBytes:meta.byte_count,stateLimitBytes:MAX_STORED};
  }finally{db.close();}
}
async function worker(){
  let signing=secret();const setup=secret();
  const runner=await localRunner('wrangler.web-media.jsonc',{health:'/api/health',privateLogs:true,vars:origin=>({AUTH_SECRET:signing,SETUP_CODE:setup,API_ORIGIN:origin,RP_ID:'localhost',P5_MEDIA:'1'})});
  const dev=authenticator({rp:'localhost',origin:runner.origin});let owner=null,cookie='',counter=0;
  const raw=async(p,method='GET',body,headers={},auth=true)=>fetch(runner.base+p,{method,redirect:'error',headers:{connection:'close',origin:runner.origin,...(auth&&cookie?{cookie}:{}),...headers},...(body===undefined?{}:{body}),...(body instanceof ReadableStream?{duplex:'half'}:{}),signal:AbortSignal.timeout(15000)});
  const json=async(res,status=200)=>{assert.equal(res.status,status);assert.match(res.headers.get('content-type')||'',/application\/json/);return res.json();};
  const post=(p,b,auth=true)=>raw(p,'POST',JSON.stringify(b),{'content-type':'application/json'},auth);
  const options=code=>post('/api/register/options',{name:'Phase 6 synthetic owner',code},false);
  const register=async()=>{
    assert.equal((await options('wrong')).status,403);
    const o=await json(await options(setup));
    const proof={cid:o.cid,credential:dev.register(o.options.challenge)};
    const res=await post('/api/register/verify',proof,false);owner=(await json(res)).user.id;cookie=res.headers.getSetCookie()[0].split(';')[0];
    assert.equal((await options(setup)).status,403);assert.equal((await post('/api/register/verify',proof,false)).status,400);return owner;
  };
  const loginProof=async()=>{const o=await json(await post('/api/login/options',{},false));return {cid:o.cid,credential:dev.login(o.options.challenge,++counter)};};
  const login=async()=>{const res=await post('/api/login/verify',await loginProof(),false);assert.equal((await json(res)).user.id,owner);cookie=res.headers.getSetCookie()[0].split(';')[0];};
  const read=async()=>json(await raw('/api/data'));
  const save=(doc,base)=>raw('/api/data','PUT',JSON.stringify({state:doc,baseRev:base.rev,baseWid:base.state?._wid,stamped:true}),{'content-type':'application/json'});
  const put=(f,want=owner)=>raw('/api/media/'+f.hash,'PUT',Buffer.from(f.bytes,'base64'),{'content-type':f.mime,'x-opengym-account':want});
  const get=async(f,want=owner)=>{
    const res=await raw('/api/media/'+f.hash,'GET',undefined,{'x-opengym-account':want});
    assert.equal(res.status,200);assert.equal(res.headers.get('content-type'),f.mime);assert.equal(Number(res.headers.get('content-length')),f.size);
    const b=Buffer.from(await res.arrayBuffer());assert.equal(b.length,f.size);assert.equal(sha(b),f.hash);return row(b,f.mime);
  };
  const usage=hashes=>post('/api/media/missing',{hashes});
  const current=async base=>{assert.equal((await json(await raw('/api/me'))).user.id,owner);assert.deepEqual(await read(),base);};
  const rotate=async()=>{await runner.stop();signing=secret();await runner.start();};
  return {runner,raw,json,post,register,read,save,put,get,usage,current,rotate,loginProof,login,options};
}
// Two separate persistence directories and a separate synthetic key directory.
// This is a synthetic rehearsal of a fresh-account restore, not a user-facing
// recovery utility. No existing-account merge or destructive restore.
test('durable encrypted recovery against independent local Workers, actual quota and secret rotation',{timeout:240000},async()=>{
  let source,target,dir,keyDir;let key=randomBytes(32),recovered;
  try{
    dir=await mkdtemp(join(tmpdir(),'opengym-p6-archive-'));keyDir=await mkdtemp(join(tmpdir(),'opengym-p6-key-'));
    const path=join(dir,'backup.enc'),keyPath=join(keyDir,'recovery.key');
    // Synthetic key custody only; independent directories are not off-provider custody.
    await writeFile(keyPath,key,{mode:0o600,flag:'wx'});
    source=await worker();target=await worker();
    await source.runner.start();
    assert.equal((await source.raw('/api/data','GET',undefined,{},false)).status,401);
    const owner=await source.register();
    assert.equal((await source.raw('/api/media/'+photo.hash,'GET',undefined,{},false)).status,401);
    await source.json(await source.put(photo),201);await source.json(await source.put(retained),201);
    await source.json(await source.save(state,await source.read()));const original=await source.read();
    const files=[await source.get(photo),await source.get(retained)];
    const p={...snapshot(owner,original),files};
    const q=inspectRecoveryInventory(p,owner);
    const reconcile=async(w,rows,expected)=>{
      const got=await w.json(await w.usage(rows.map(x=>x.hash)));
      assert.deepEqual(got.missing,[]);assert.equal(got.usage.bytes,expected.serverBytes);assert.equal(got.usage.count,expected.serverCount);
      assert.equal(got.usage.quotaBytes,expected.configuredByteLimit);
      // A read-only observation of retention, never a deletion command.
      const swept=await w.json(await w.post('/api/media/sweep',{}));
      assert.equal(swept.removed,0);assert.equal(swept.freedBytes,0);assert.equal(swept.retained,expected.retainedCount);assert.equal(swept.retainedBytes,expected.retainedBytes);
      assert.equal(swept.policy,'retain-until-authorized-delete');assert.deepEqual(swept.usage,got.usage);
    };
    await reconcile(source,files,q);await source.current(original);
    // Omitting a retained row is detected by actual R2 totals, even when all
    // named references are present. Never infer completeness from missing=[].
    const incomplete=inspectRecoveryInventory({...p,files:[files[0]]},owner);
    const actual=await source.json(await source.usage([files[0].hash]));
    assert.deepEqual(actual.missing,[]);assert.notEqual(actual.usage.count,incomplete.serverCount);
    assert.notEqual(actual.usage.bytes,incomplete.serverBytes);
    console.log('PHASE6_RETAINED_INVENTORY_OMISSION_DETECTED PASS');
    // Actual authenticated input bound, no allocation of large request bodies.
    assert.equal((await source.usage(Array(1001).fill(photo.hash))).status,400);
    assert.equal((await source.usage(['not-a-hash'])).status,400);
    assert.equal((await source.put(photo,'foreignOwner0001')).status,409);
    await source.current(original);
    const saved=await persistRecoveryFile(path,p,key,owner);await source.current(original);
    key.fill(0);await source.runner.stop();
    const sourceStateQuota=await committedStateEvidence(source.runner.dir,owner,original);
    assert.ok(sourceStateQuota.committedStateBytes>0);
    assert.equal(sourceStateQuota.stateLimitBytes,8*1024*1024);
    recovered=await readFile(keyPath);assert.equal(recovered.length,32);
    const reopened=await readRecoveryFile(path,recovered,owner);assert.equal(reopened.archiveDigest,saved.archiveDigest);
    assert.deepEqual(reopened.payload,p);
    assert.equal(reopened.quota.cutoverAuthorized,false);
    const wrong=randomBytes(32);try{await assert.rejects(readRecoveryFile(path,wrong,owner),/authentication failed/);}finally{wrong.fill(0);}
    // Restarted fresh destination, exact owner mapping. Upload all known remote
    // rows, including retained objects, before publishing state.
    await target.runner.start();const dest=await target.register();assert.notEqual(dest,owner);
    await assert.rejects(readRecoveryFile(path,recovered,dest),/owner mismatch/);
    const empty=await target.read();assert.equal(empty.rev,0);
    const inventory=reopened.payload.files;
    assert.deepEqual((await target.json(await target.usage(inventory.map(x=>x.hash)))).missing,inventory.map(x=>x.hash));
    assert.equal((await target.put(inventory[0],owner)).status,409);
    await target.json(await target.put(inventory[0]),201);
    await target.runner.stop();await target.runner.start();
    await target.current(empty);
    const partial=await target.json(await target.usage(inventory.map(x=>x.hash)));
    assert.deepEqual(partial.missing,[retained.hash]);assert.equal(partial.usage.count,1);
    assert.equal((await target.json(await target.put(inventory[0]))).existed,true);
    await target.json(await target.put(inventory[1]),201);
    for(const f of inventory)assert.deepEqual(await target.get(f),f);
    await target.current(empty);
    const doc=structuredClone(reopened.payload.snapshots[0].state);
    for(const k of ['_rev','_wid','_wids'])delete doc[k];
    await target.json(await target.save(doc,empty));const restored=await target.read();
    for(const k of ['workouts','routines','customEx','notes'])assert.deepEqual(restored.state[k],original.state[k],k);
    assert.equal((await target.save({workouts:[],routines:[]},empty)).status,409);
    await target.current(restored);
    await reconcile(target,inventory,q);
    await target.runner.stop();
    const destStateQuota=await committedStateEvidence(target.runner.dir,dest,restored);
    assert.ok(destStateQuota.committedStateBytes>0);
    console.log('PHASE6_COMMITTED_STATE_BYTE_RECONCILIATION PASS');
    await target.runner.start();await target.current(restored);
    for(const f of inventory)assert.deepEqual(await target.get(f),f);
    // Restart original source and rotate signing secret, then confirm old session
    // and pending proof no longer work, but workout data and media are intact.
    await source.runner.start();await source.current(original);
    const proof=await source.loginProof();await source.rotate();
    assert.equal((await source.raw('/api/data')).status,401);
    assert.equal((await source.post('/api/login/verify',proof,false)).status,400);
    await source.login();await source.current(original);
    for(const f of inventory)assert.deepEqual(await source.get(f),f);
    await reconcile(source,inventory,q);
    assert.equal((await readRecoveryFile(path,recovered,owner)).archiveDigest,saved.archiveDigest);
    console.log('PHASE6_INDEPENDENT_WORKER_RESTORE PASS');
    console.log('PHASE6_AUTHENTICATED_QUOTA_RECONCILIATION PASS');
    console.log('PHASE6_RESTRICTIVE_REGISTRATION_ROTATION_ABUSE PASS');
  }finally{
    key.fill(0);recovered?.fill(0);
    if(source)await source.runner.cleanup();if(target)await target.runner.cleanup();
    if(dir)await rm(dir,{recursive:true,force:true});if(keyDir)await rm(keyDir,{recursive:true,force:true});
  }
});
test('secret configuration rejects missing, weak, reused or nonlocal values',()=>{
  const env={AUTH_SECRET:secret(),SETUP_CODE:secret(),API_ORIGIN:'http://localhost:8787',RP_ID:'localhost'};
  assert.ok(config(env).setupDigest);
  for(const bad of [{AUTH_SECRET:''},{SETUP_CODE:''},{AUTH_SECRET:'a'.repeat(64)},{SETUP_CODE:env.AUTH_SECRET},{API_ORIGIN:'https://external.invalid',RP_ID:'external.invalid'}])assert.throws(()=>config({...env,...bad}));
  console.log('PHASE6_SECRET_CONFIGURATION_FAIL_CLOSED PASS');
});

test('segmented restore reads authenticated objects before bounded HTTP streaming, reconciles interruption and rejects unsupported capabilities',{timeout:240000},async()=>{
  let source,target,dir;const key=randomBytes(32);
  try{
    dir=await mkdtemp(join(tmpdir(),'opengym-p6-stream-restore-'));const path=join(dir,'backup');
    source=await worker();target=await worker();await source.runner.start();const owner=await source.register();
    const large=row(wav(30*22050),'audio/wav');
    const sourceRows=[photo,large];
    for(const f of sourceRows)await source.json(await source.put(f),201);
    await source.json(await source.save(state,await source.read()));const original=await source.read();
    const verified=[];for(const f of sourceRows)verified.push(await source.get(f));
    const manifest={...snapshot(owner,original),files:verified.map(({bytes,...meta})=>meta)};
    const backup=await persistRecoveryBundle(path,manifest,key,owner,async function*(meta){
      const bytes=Buffer.from(verified.find(r=>r.hash===meta.hash).bytes,'base64');
      try{for(let i=0;i<bytes.length;i+=1024*1024)yield bytes.subarray(i,i+1024*1024);}finally{bytes.fill(0);}
    });
    await source.current(original);await source.runner.stop();
    await target.runner.start();const dest=await target.register();assert.notEqual(dest,owner);
    const empty=await target.read();assert.equal(empty.rev,0);assert.equal(empty.state,null);
    const plan=await verifyRecoveryBundle(path,key,owner);assert.equal(plan.manifestDigest,backup.manifestDigest);
    assert.equal(plan.quota.withinKnownMediaLimits,true);assert.deepEqual(plan.quota.missingServerReferences,[]);
    const hashes=plan.manifest.files.map(f=>f.hash);
    const usage=await target.json(await target.usage(hashes));
    assert.deepEqual(usage.missing,hashes);assert.equal(usage.usage.count,0);assert.equal(usage.usage.bytes,0);
    const upload=async hash=>{
      await target.current(empty);
      const {row:meta,bytes}=await readVerifiedRestoreObject(path,key,owner,plan.manifestDigest,hash);
      let offset=0;
      const stream=new ReadableStream({pull(controller){
        if(offset===bytes.length){controller.close();return;}
        const end=Math.min(offset+64*1024,bytes.length);controller.enqueue(bytes.subarray(offset,end));offset=end;
      }});
      try{return await target.json(await target.raw('/api/media/'+hash,'PUT',stream,{'content-type':meta.mime,'x-opengym-account':dest}),201);}
      finally{bytes.fill(0);}
    };
    // Stop after the first write, before state publication; reconcile by exact
    // readback, not retrying the write or trusting a client acknowledgement.
    await upload(hashes[0]);await target.runner.stop();await target.runner.start();await target.current(empty);
    const partial=await target.json(await target.usage(hashes));assert.deepEqual(partial.missing,[hashes[1]]);
    assert.deepEqual(await target.get(sourceRows[0]),sourceRows[0]);
    // An archive that was verified earlier can still change. Refuse it before
    // any second PUT, keep the destination state empty and first object intact.
    const object=join(path,hashes[1]+'.enc'),originalCipher=await readFile(object);
    const damaged=Buffer.from(originalCipher);damaged[damaged.length-1]^=1;await writeFile(object,damaged);
    await assert.rejects(upload(hashes[1]),/authentication failed/);
    await target.current(empty);assert.deepEqual((await target.json(await target.usage(hashes))).missing,[hashes[1]]);
    await writeFile(object,originalCipher);
    assert.equal((await verifyRecoveryBundle(path,key,owner)).manifestDigest,plan.manifestDigest);
    await upload(hashes[1]);for(const f of sourceRows)assert.deepEqual(await target.get(f),f);
    const complete=await target.json(await target.usage(hashes));assert.deepEqual(complete.missing,[]);
    assert.equal(complete.usage.bytes,plan.quota.serverBytes);assert.equal(complete.usage.count,plan.quota.serverCount);
    await target.current(empty);
    const doc=structuredClone(plan.manifest.snapshots[0].state);for(const k of ['_rev','_wid','_wids'])delete doc[k];
    await target.json(await target.save(doc,empty));const restored=await target.read();
    for(const k of ['workouts','routines','customEx','notes'])assert.deepEqual(restored.state[k],original.state[k],k);
    assert.equal((await target.save({workouts:[],routines:[]},empty)).status,409);
    await target.current(restored);await target.runner.stop();await target.runner.start();await target.current(restored);
    for(const f of sourceRows)assert.deepEqual(await target.get(f),f);
    await source.runner.start();await source.current(original);for(const f of sourceRows)assert.deepEqual(await source.get(f),f);
    assert.equal((await verifyRecoveryBundle(path,key,owner)).manifestDigest,plan.manifestDigest);
    console.log('PHASE6_SEGMENTED_HTTP_RESTORE_INTERRUPTION PASS');
    // Representative unsupported upstream route families, plus no live backup
    // or restore endpoint. Exact JSON 404, never SPA HTML or successful fallback.
    const deferred=[
      ['POST','/api/login/password'],['GET','/api/oidc/start'],['POST','/api/watch/redeem'],
      ['GET','/api/tokens'],['GET','/api/calendar'],['GET','/api/push/status'],
      ['GET','/api/integrations'],['GET','/api/coach/status'],['GET','/api/shared'],
      ['GET','/api/sharing'],['GET','/api/trainer'],['GET','/api/gym'],
      ['GET','/api/admin/users'],['POST','/api/oauth/token'],
      ['GET','/.well-known/openid-configuration'],['POST','/mcp'],
      ['GET','/api/backup'],['POST','/api/restore'],['POST','/api/media/purge']
    ];
    for(const [method,p] of deferred){
      for(const auth of [false,true]){
        const res=await target.raw(p,method,method==='POST'?'{}':undefined,{'content-type':'application/json',accept:'text/html'},auth);
        assert.equal(res.status,404,method+' '+p);
        assert.match(res.headers.get('content-type')||'',/application\/json/);
        assert.equal(res.headers.get('cache-control'),'no-store');await res.arrayBuffer();
      }
    }
    const anonymous=await target.json(await target.raw('/api/config','GET',undefined,{},false));
    assert.deepEqual(anonymous,{invite_only:true,allow_guest:false,signed_in:false});
    const signed=await target.json(await target.raw('/api/config'));
    assert.deepEqual(Object.keys(signed).sort(),['allow_guest','coach','invite_only','media','signed_in']);
    assert.equal(signed.coach,null);assert.equal(signed.invite_only,true);assert.equal(signed.allow_guest,false);assert.equal(signed.signed_in,true);
    const privateRes=await target.raw('/api/media/'+hashes[0]);assert.equal(privateRes.status,200);
    assert.equal(privateRes.headers.get('cache-control'),'private, no-store');
    assert.equal(privateRes.headers.get('cross-origin-resource-policy'),'same-origin');await privateRes.arrayBuffer();
    assert.equal((await target.raw('/api/media/'+hashes[0],'GET',undefined,{},false)).status,401);
    await target.current(restored);
    console.log('PHASE6_PRIVACY_UNSUPPORTED_ROUTE_MATRIX PASS');
  }finally{key.fill(0);if(source)await source.runner.cleanup();if(target)await target.runner.cleanup();if(dir)await rm(dir,{recursive:true,force:true});}
});
