import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {mkdtemp,rm,readFile,writeFile,rename,copyFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {persistRecoveryBundle,verifyRecoveryBundle,readVerifiedRestoreObject} from '../src/recovery/bundle.js';
const MB=1024*1024,owner='syntheticOwner01';
const makeRow=(size,seed,location='server')=>{
  const h=createHash('sha256'),b=Buffer.alloc(MB,seed);
  for(let i=0;i<size;i+=MB)h.update(b.subarray(0,Math.min(MB,size-i)));
  return {hash:h.digest('hex'),mime:'video/mp4',size,location};
};
const source=rows=>async function*(row){
  const seed=rows.findIndex(r=>r.hash===row.hash)+1;assert.ok(seed>0);
  for(let n=0;n<row.size;n+=MB)yield Buffer.alloc(Math.min(MB,row.size-n),seed);
};
function manifest(rows){
  const state={_rev:3,_wid:'synthetic-write',workouts:[],routines:[]};
  const device=rows.find(r=>r.location==='device');
  return {version:1,owner,snapshots:[{id:'server',kind:'server',owner,revision:3,writeIdentity:'synthetic-write',state},
    ...(device?[{id:'phone',kind:'device',owner,revision:3,writeIdentity:'synthetic-write',state:{active:{entries:[{sets:[{media:[{...device,kind:'video',width:1,height:1,local:true}]}]}]}}}]:[])],files:rows};
}
test('capacity bundle streams 200 MiB retained remote inventory and oversized device original',{timeout:120000},async()=>{
  const dir=await mkdtemp(join(tmpdir(),'opengym-p6-capacity-')),key=randomBytes(32);
  try{
    const rows=Array.from({length:25},(_,i)=>makeRow(8*MB,i+1));rows.push(makeRow(8*MB+1,26,'device'));
    const p=manifest(rows),path=join(dir,'backup');
    const got=await persistRecoveryBundle(path,p,key,owner,source(rows));
    assert.deepEqual(got.manifest,p);assert.equal(got.verifiedMediaBytes,208*MB+1);
    assert.equal(got.quota.serverBytes,200*MB);assert.equal(got.quota.retainedCount,25);assert.equal(got.quota.deviceOnlyBytes,8*MB+1);
    assert.equal(got.quota.withinKnownMediaLimits,true);assert.equal(got.cutoverAuthorized,false);
    const reread=await verifyRecoveryBundle(path,key,owner);assert.equal(reread.manifestDigest,got.manifestDigest);
    assert.equal(reread.verifiedMediaBytes,208*MB+1);
    let restored=0;
    for(const row of rows.filter(r=>r.location==='server')){
      const item=await readVerifiedRestoreObject(path,key,owner,got.manifestDigest,row.hash);
      try{assert.deepEqual(item.row,row);assert.equal(createHash('sha256').update(item.bytes).digest('hex'),row.hash);assert.ok(item.bytes.length<=8*MB);restored+=item.bytes.length;}
      finally{item.bytes.fill(0);}
    }
    assert.equal(restored,200*MB);
    await assert.rejects(readVerifiedRestoreObject(path,key,owner,got.manifestDigest,rows.at(-1).hash),/not a remote restore candidate/);
    console.log('PHASE6_CAPACITY_BOUNDED_RESTORE_READ_200MIB PASS');
    console.log('PHASE6_CAPACITY_BUNDLE_208MIB PASS');
  }finally{key.fill(0);await rm(dir,{recursive:true,force:true});}
});
test('bundle refuses interrupted, omitted, tampered, foreign and swapped inventory without publishing incomplete backup',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'opengym-p6-bundle-fault-')),key=randomBytes(32),wrong=randomBytes(32);
  try{
    const rows=[makeRow(1024,1),makeRow(2048,2)],p=manifest(rows),path=join(dir,'backup'),other=join(dir,'other');
    const saved=await persistRecoveryBundle(path,p,key,owner,source(rows));
    await assert.rejects(persistRecoveryBundle(path,p,key,owner,source(rows)),e=>e.code==='EEXIST');
    await assert.rejects(verifyRecoveryBundle(path,wrong,owner),/authentication failed/);
    await assert.rejects(verifyRecoveryBundle(path,key,'syntheticOwner02'),/owner mismatch/);
    await persistRecoveryBundle(other,p,key,owner,source(rows));
    const name=rows[0].hash+'.enc',file=join(path,name),original=await readFile(file);
    await copyFile(join(other,name),file);
    await assert.rejects(verifyRecoveryBundle(path,key,owner),/authentication failed/);
    await writeFile(file,original);
    const damaged=Buffer.from(original);damaged[damaged.length-1]^=1;await writeFile(file,damaged);
    await assert.rejects(verifyRecoveryBundle(path,key,owner),/authentication failed/);
    await assert.rejects(readVerifiedRestoreObject(path,key,owner,saved.manifestDigest,rows[0].hash),/authentication failed/);
    await writeFile(file,original);
    await assert.rejects(readVerifiedRestoreObject(path,key,owner,'0'.repeat(64),rows[0].hash),/manifest changed/);
    await assert.rejects(readVerifiedRestoreObject(path,key,owner,saved.manifestDigest,'0'.repeat(64)),/not a remote restore candidate/);
    await rename(file,join(dir,'missing.enc'));await assert.rejects(verifyRecoveryBundle(path,key,owner),/inventory incomplete/);
    await rename(join(dir,'missing.enc'),file);
    assert.equal((await verifyRecoveryBundle(path,key,owner)).manifestDigest,saved.manifestDigest);
    const incomplete=join(dir,'incomplete');
    await assert.rejects(persistRecoveryBundle(incomplete,p,key,owner,async function*(){yield Buffer.alloc(1);throw Error('synthetic interrupted source');}),/interrupted source/);
    assert.ok(!(await readdir(incomplete)).includes('manifest.enc'));
    await assert.rejects(verifyRecoveryBundle(incomplete,key,owner),e=>e.code==='ENOENT');
    await assert.rejects(persistRecoveryBundle(incomplete,p,key,owner,source(rows)),e=>e.code==='EEXIST');
    const omitted=manifest(rows);omitted.snapshots[0].state.customEx=[{media:{...rows[0],kind:'video',width:1,height:1}}];omitted.files=rows.slice(1);
    await assert.rejects(persistRecoveryBundle(join(dir,'omitted'),omitted,key,owner,source(rows)),/missing known media/);
    const excessive=manifest(Array.from({length:6},(_,i)=>({...makeRow(1,i+1),size:100*MB})));
    await assert.rejects(persistRecoveryBundle(join(dir,'excessive'),excessive,key,owner,source(rows)),/aggregate byte bound/);
    console.log('PHASE6_BUNDLE_INCOMPLETE_TAMPER_FAIL_CLOSED PASS');
  }finally{key.fill(0);wrong.fill(0);await rm(dir,{recursive:true,force:true});}
});

test('Phase 7: independent synthetic backup copy retains exact inventory and rejects stale manifest identity',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'opengym-p7-independent-')),key=randomBytes(32);
  try{
    const rows=[makeRow(1024,1),makeRow(2048,2,'device')],p=manifest(rows);
    const primary=join(dir,'primary'),copy=join(dir,'copy'),newer=join(dir,'newer');
    const saved=await persistRecoveryBundle(primary,p,key,owner,source(rows));
    const {mkdir}=await import('node:fs/promises');
    await mkdir(copy,{mode:0o700});
    for(const name of await readdir(primary))await copyFile(join(primary,name),join(copy,name));
    const checked=await verifyRecoveryBundle(copy,key,owner);
    assert.equal(checked.manifestDigest,saved.manifestDigest);
    assert.deepEqual(checked.manifest,p);
    assert.equal(checked.offProviderVerified,false);
    assert.equal(checked.cutoverAuthorized,false);
    const next=JSON.parse(JSON.stringify(p));
    next.snapshots[0].revision=4;next.snapshots[0].writeIdentity='newer-write';
    next.snapshots[0].state._rev=4;next.snapshots[0].state._wid='newer-write';
    await persistRecoveryBundle(newer,next,key,owner,source(rows));
    await assert.rejects(readVerifiedRestoreObject(newer,key,owner,saved.manifestDigest,rows[0].hash),/manifest changed/);
    const restored=await readVerifiedRestoreObject(copy,key,owner,saved.manifestDigest,rows[0].hash);
    try{assert.equal(createHash('sha256').update(restored.bytes).digest('hex'),rows[0].hash);}
    finally{restored.bytes.fill(0);}
    assert.equal((await verifyRecoveryBundle(primary,key,owner)).manifestDigest,saved.manifestDigest);
    console.log('PHASE7_INDEPENDENT_SYNTHETIC_COPY_FENCE PASS');
  }finally{key.fill(0);await rm(dir,{recursive:true,force:true});}
});
