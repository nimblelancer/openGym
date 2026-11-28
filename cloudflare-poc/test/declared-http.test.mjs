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
function wav(samples=2205){
  const b=Buffer.alloc(44+samples*2);
  b.write('RIFF',0);b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);
  b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(22050,24);b.writeUInt32LE(44100,28);
  b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);
  return b;
}
// A disposable encrypted backup/restore qualification, not an export format,
// migration CLI or production cutover. No credentials or backup bytes are logged.
test('Phase 7 original declared-length HTTP rejection after independent restore',{timeout:240000},async()=>{
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
    // A deliberately oversized declaration must be rejected before body reads.
    // Send the real archived bytes in bounded chunks and capture the complete
    // HTTP response even if the server stops reading the request early.
    // Do not convert a connection reset without a response into a PASS.
    const rejectOversized=(h,b,m)=>new Promise(resolve=>{
      let settled=false,responded=false,offset=0,status=null,type='none',wallMarker=false,received=0;
      const chunks=[];
      const category=e=>['ECONNRESET','EPIPE','ECONNREFUSED','ETIMEDOUT','ERR_STREAM_PREMATURE_CLOSE'].includes(e?.code)?e.code:'transport-error';
      const finish=(outcome,body=null)=>{
        if(settled)return;settled=true;clearTimeout(deadline);req.destroy();
        // Never log raw response, cookie, owner ID, media hash or request bytes.
        const safe={outcome,status,type,wallMarker,offeredBytes:offset,responseBytes:received,
          code:body?.code==='media-too-large'?'media-too-large':null};
        console.log('PHASE7_DECLARED_HTTP_OBSERVATION',JSON.stringify(safe));
        resolve({...safe,body});
      };
      const req=request(runner.base+'/api/media/'+h,{method:'PUT',agent:false,headers:{connection:'close',origin:runner.origin,cookie,'content-type':m,'content-length':b.length,'x-opengym-account':owner}},res=>{
        responded=true;status=res.statusCode;wallMarker=typeof res.headers['x-poc-wall-ms']==='string';
        const ct=String(res.headers['content-type']||'').split(';')[0].toLowerCase();
        type=['application/json','text/plain','text/html'].includes(ct)?ct:ct?'other':'none';
        res.on('data',c=>{received+=c.length;if(received>64*1024){finish('response-bound');return;}chunks.push(c);});
        res.on('aborted',()=>finish('response-aborted'));
        res.on('error',e=>finish(category(e)));
        res.on('end',()=>{
          if(!res.complete){finish('response-incomplete');return;}
          let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{finish('non-json-response');return;}
          finish('complete-json',body);
        });
      });
      const deadline=setTimeout(()=>finish('deadline'),15000);
      req.on('error',e=>{if(!responded)finish(category(e));});
      // Preserve the exact historical HTTP framing and send pacing.
      const send=()=>{if(settled||responded)return;if(offset===b.length){req.end();return;}
        const next=Math.min(offset+64*1024,b.length),part=b.subarray(offset,next);offset=next;
        if(req.write(part))setImmediate(send);else req.once('drain',send);
      };
      req.flushHeaders();setImmediate(send);
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
    console.log('PHASE7_PRECONDITION_COMPATIBLE_RESTORE PASS');
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
    // Separate known application guard from the real declared-length transport.
    const noBucket=new Proxy({}, {get(){throw Error('oversized request touched storage');}});
    const direct=await handleMedia(new Request('http://localhost/api/media/'+lh,{method:'PUT',body:legacyBytes,headers:{'content-type':lr.mime,'content-length':String(legacyBytes.length),'x-opengym-account':destinationOwner}}),destinationOwner,noBucket,()=>true);
    assert.equal(direct.status,413);assert.equal((await direct.json()).code,'media-too-large');
    console.log('PHASE7_DECLARED_DIRECT_HANDLER PASS');
    const usage=async()=>target.json(await target.raw('/api/media/missing','POST',JSON.stringify({hashes:[hash,ah,lh]}),{'content-type':'application/json','x-opengym-account':destinationOwner}));
    const usageBefore=await usage();
    assert.deepEqual(usageBefore.missing,[lh]);
    assert.equal(usageBefore.usage.count,2);
    const reject=await target.rejectOversized(lh,legacyBytes,lr.mime);
    // Do not let a failing transport assertion skip integrity and admission checks.
    // Only poll read-only inventory while a previous request is still releasing
    // admission. Never retry the rejected write or restart to clear the lock.
    let after;
    for(let attempt=0;attempt<40;attempt++){
      const res=await target.raw('/api/media/missing','POST',JSON.stringify({hashes:[hash,ah,lh]}),{'content-type':'application/json','x-opengym-account':destinationOwner});
      if(res.status===200){after=await res.json();break;}
      assert.equal(res.status,429);assert.equal((await res.json()).code,'busy');await sleep(100);
    }
    assert.ok(after,'admission did not recover');assert.deepEqual(after,usageBefore);
    assert.equal(await target.read(lh,destinationOwner),null);
    assert.deepEqual(await target.state(),committed);
    assert.equal(sha(Buffer.from(await (await target.read(hash,destinationOwner)).arrayBuffer())),hash);
    assert.equal(sha(Buffer.from(await (await target.read(ah,destinationOwner)).arrayBuffer())),ah);
    assert.deepEqual(await readFile(legacyPath),legacyArchive);
    assert.equal(sha(Buffer.from(open(await readFile(legacyPath)).files[0].bytes,'base64')),lh);
    console.log('PHASE7_DECLARED_POST_FAILURE_INTEGRITY PASS');
    // Exercise authenticated admission and no unauthenticated/wrong-owner writes.
    const candidate=mp4().file,ch=sha(candidate),p='/api/media/'+ch;
    const unauth=await fetch(target.runner.base+p,{method:'PUT',headers:{connection:'close',origin:target.runner.origin,'content-type':'video/mp4','x-opengym-account':destinationOwner},body:candidate,signal:AbortSignal.timeout(15000)});
    assert.equal(unauth.status,401);await unauth.arrayBuffer();
    const wrong=await target.put(ch,candidate,'video/mp4',sourceOwner);assert.equal(wrong.status,409);await wrong.arrayBuffer();
    assert.equal(await target.read(ch,destinationOwner),null);
    await target.json(await target.put(ch,candidate,'video/mp4'),201);
    assert.equal(sha(Buffer.from(await (await target.read(ch,destinationOwner)).arrayBuffer())),ch);
    assert.deepEqual(await target.state(),committed);
    console.log('PHASE7_DECLARED_AUTH_ADMISSION_RECOVERY PASS');
    // A complete JSON 413 from the actual HTTP path is the required gate.
    assert.equal(reject.outcome,'complete-json','original declared-length HTTP did not return complete JSON');
    assert.equal(reject.status,413);assert.equal(reject.type,'application/json');assert.equal(reject.code,'media-too-large');
    assert.equal(reject.wallMarker,true,'expected coordinator response marker');
    console.log('PHASE7_ORIGINAL_DECLARED_LENGTH_HTTP PASS');
    assert.equal(await target.read(lh,destinationOwner),null);
    assert.deepEqual(await target.state(),committed);
    assert.deepEqual(await readFile(legacyPath),legacyArchive);
    assert.equal(sha(Buffer.from(open(await readFile(legacyPath)).files[0].bytes,'base64')),lh);
    console.log('PHASE7_OVERSIZED_ENCRYPTED_BACKUP_PRESERVED PASS');
    console.log('PHASE7_ENCRYPTED_DISK_BACKUP_RESTORE PASS');
    console.log('PHASE7_DESTINATION_OWNER_REVISION_PREFLIGHT PASS');
  }finally{key.fill(0);await source.runner.cleanup();await target.runner.cleanup();await rm(backupDir,{recursive:true,force:true});}
});
