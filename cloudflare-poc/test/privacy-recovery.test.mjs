import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {sealRecoveryArchive,openRecoveryArchive,inspectRecoveryInventory,MAX_ARCHIVE_BYTES} from '../src/recovery/archive.js';
const owner='syntheticOwner01',foreign='syntheticOwner02';
const sha=b=>createHash('sha256').update(b).digest('hex');
function row(bytes,mime,location){const b=Buffer.from(bytes);return {hash:sha(b),mime,size:b.length,location,bytes:b.toString('base64')};}
function ref(f,extra={}){return {hash:f.hash,mime:f.mime,size:f.size,width:1,height:1,kind:f.mime.startsWith('video/')?'video':'image',at:1,...extra};}
function fixture(){
  const main=row('synthetic photo','image/png','both'),poster=row('synthetic poster','image/jpeg','server'),retained=row('retained remote bytes','image/webp','server'),local=row('device-only video','video/mp4','device');
  const state={_rev:7,_wid:'write-7',customEx:[{id:'ex',media:ref(main,{poster:ref(poster)})}],workouts:[{id:'w',entries:[]}],routines:[]};
  const device={customEx:[],active:{entries:[{sets:[{media:[ref(local,{local:true})]}]}]}};
  return {version:1,owner,snapshots:[{id:'server',kind:'server',owner,revision:7,writeIdentity:'write-7',state},{id:'phone',kind:'device',owner,revision:7,writeIdentity:'write-7',state:device}],files:[main,poster,retained,local]};
}
test('authenticated archive round trip preserves exact known state, retained and active bytes',()=>{
  const p=fixture(),key=randomBytes(32);
  try{
    const a=sealRecoveryArchive(p,key,owner),b=sealRecoveryArchive(p,key,owner);
    assert.notDeepEqual(a,b);assert.equal(a.includes(Buffer.from('synthetic photo')),false);assert.equal(a.includes(key),false);
    const got=openRecoveryArchive(a,key,owner);assert.deepEqual(got.payload,p);
    assert.deepEqual(got.quota,inspectRecoveryInventory(p,owner));assert.equal(got.quota.cutoverAuthorized,false);
    assert.equal(got.quota.completeAccountInventoryVerified,false);
    console.log('PHASE6_AUTHENTICATED_ARCHIVE_ROUNDTRIP PASS');
  }finally{key.fill(0);}
});
test('reject wrong key, owner, version, tamper, truncation and oversized envelope',()=>{
  const key=randomBytes(32),wrong=randomBytes(32),a=sealRecoveryArchive(fixture(),key,owner);
  try{
    assert.throws(()=>openRecoveryArchive(a,wrong,owner),/authentication failed/);
    assert.throws(()=>openRecoveryArchive(a,key,foreign),/owner mismatch/);
    for(const at of [0,4,5,17,a.length-1]){const bad=Buffer.from(a);bad[at]^=1;assert.throws(()=>openRecoveryArchive(bad,key,owner));}
    assert.throws(()=>openRecoveryArchive(a.subarray(0,a.length-1),key,owner),/authentication failed/);
    assert.throws(()=>openRecoveryArchive(Buffer.alloc(MAX_ARCHIVE_BYTES+1),key,owner),/header or size/);
    assert.throws(()=>sealRecoveryArchive(fixture(),Buffer.alloc(31),owner),/key/);
    console.log('PHASE6_ARCHIVE_AUTHENTICATION_FAILURES PASS');
  }finally{key.fill(0);wrong.fill(0);}
});
test('refuse missing known files, corrupt bytes, duplicate rows, foreign snapshot and stale server identity',()=>{
  const key=randomBytes(32);
  try{
    for(const mutate of [
      p=>p.files.pop(),
      p=>p.files[0].bytes=Buffer.alloc(p.files[0].size).toString('base64'),
      p=>p.files.push({...p.files[0]}),
      p=>p.snapshots[1].owner=foreign,
      p=>p.snapshots[0].revision++,
      p=>p.snapshots[0].writeIdentity='stale',
      p=>p.snapshots.push({...p.snapshots[0],id:'another'}),
      p=>p.snapshots[0].state.customEx[0].media.mime='constructor',
      p=>p.snapshots[0].state.customEx[0].media.poster.size++,
      p=>p.files[0].location='unknown',
      p=>p.extra='unexpected'
    ]){const p=fixture();mutate(p);assert.throws(()=>sealRecoveryArchive(p,key,owner));}
    const p=fixture();p.snapshots[0].state.customEx[0].media.poster=null;p.snapshots[0].state.customEx.push({media:{...ref(p.files[0]),size:1}});
    assert.throws(()=>sealRecoveryArchive(p,key,owner),/conflicting media reference/);
    console.log('PHASE6_KNOWN_INVENTORY_FAIL_CLOSED PASS');
  }finally{key.fill(0);}
});
test('read-only quota accounts for retained and device-only inventory without claiming available capacity',()=>{
  const p=fixture(),q=inspectRecoveryInventory(p,owner);
  assert.equal(q.serverCount,3);assert.equal(q.serverBytes,p.files.slice(0,3).reduce((n,f)=>n+f.size,0));
  assert.equal(q.retainedCount,1);assert.equal(q.retainedBytes,p.files[2].size);
  assert.equal(q.deviceCount,2);assert.equal(q.deviceOnlyCount,1);assert.equal(q.deviceOnlyBytes,p.files[3].size);
  assert.equal(q.configuredByteLimit,200*1024*1024);assert.equal(q.configuredObjectLimit,500);
  assert.equal(q.withinKnownMediaLimits,true);assert.deepEqual(q.missingServerReferences,[]);
  p.files[0].location='device';const missing=inspectRecoveryInventory(p,owner);
  assert.deepEqual(missing.missingServerReferences,[p.files[0].hash]);assert.equal(missing.cutoverAuthorized,false);
  p.files[0].location='both';
  p.files.push(...Array.from({length:498},(_,i)=>row('retained-'+i,'image/png','server')));
  const full=inspectRecoveryInventory(p,owner);assert.equal(full.serverCount,501);assert.equal(full.withinKnownMediaLimits,false);
  console.log('PHASE6_READ_ONLY_QUOTA_LEDGER PASS');
});
test('bounded proof refuses excessive input, never truncates or silently drops original bytes',()=>{
  const key=randomBytes(32);
  try{
    const p=fixture();p.files.push(row(Buffer.alloc(13*1024*1024),'video/mp4','device'));
    assert.throws(()=>sealRecoveryArchive(p,key,owner),/bound/);
    const d=fixture();let x=d.snapshots[0].state;for(let i=0;i<70;i++){x.deep={};x=x.deep;}
    assert.throws(()=>sealRecoveryArchive(d,key,owner),/structure bound/);
    const cyc=fixture();cyc.snapshots[0].state.cycle=cyc.snapshots[0].state;
    assert.throws(()=>sealRecoveryArchive(cyc,key,owner),/cyclic/);
    const legacy=fixture();const f=row(Buffer.alloc(8*1024*1024+1,42),'video/mp4','device');legacy.files.push(f);
    legacy.snapshots[1].state.active.entries[0].sets[0].media.push(ref(f,{local:true}));
    const result=openRecoveryArchive(sealRecoveryArchive(legacy,key,owner),key,owner);
    assert.equal(result.payload.files.at(-1).hash,f.hash);assert.equal(result.payload.files.at(-1).bytes,f.bytes);
    assert.equal(result.quota.cutoverAuthorized,false);
    console.log('PHASE6_BOUNDED_ORIGINAL_PRESERVATION PASS');
  }finally{key.fill(0);}
});
