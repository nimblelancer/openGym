import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {mkdtemp,rm,writeFile,readFile,stat,symlink,readdir,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {localRunner} from './local-runner.mjs';
import {authenticator} from './auth-fixture.mjs';
import {config} from '../src/auth/session.js';
import {persistRecoveryFile,readRecoveryFile} from '../src/recovery/disk.js';
import {inspectRecoveryInventory,MAX_ARCHIVE_BYTES} from '../src/recovery/archive.js';

const sha=b=>createHash('sha256').update(b).digest('hex');
const secret=()=>randomBytes(32).toString('hex');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64');
function wav(){const b=Buffer.alloc(44+2205*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(22050,24);b.writeUInt32LE(44100,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);return b;}
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
async function worker(){
  let signing=secret();const setup=secret();
  const runner=await localRunner('wrangler.web-media.jsonc',{health:'/api/health',privateLogs:true,vars:origin=>({AUTH_SECRET:signing,SETUP_CODE:setup,API_ORIGIN:origin,RP_ID:'localhost',P5_MEDIA:'1'})});
  const dev=authenticator({rp:'localhost',origin:runner.origin});let owner=null,cookie='',counter=0;
  const raw=async(p,method='GET',body,headers={},auth=true)=>fetch(runner.base+p,{method,redirect:'error',headers:{connection:'close',origin:runner.origin,...(auth&&cookie?{cookie}:{}),...headers},...(body===undefined?{}:{body}),signal:AbortSignal.timeout(15000)});
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
    // Actual authenticated input bound, no allocation of large request bodies.
    assert.equal((await source.usage(Array(1001).fill(photo.hash))).status,400);
    assert.equal((await source.usage(['not-a-hash'])).status,400);
    assert.equal((await source.put(photo,'foreignOwner0001')).status,409);
    await source.current(original);
    const saved=await persistRecoveryFile(path,p,key,owner);await source.current(original);
    key.fill(0);await source.runner.stop();
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
    await target.runner.stop();await target.runner.start();await target.current(restored);
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
