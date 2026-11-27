// @vitest-environment happy-dom
// Actual upstream media sync/store/api modules. Only OS/XHR/browser transport is simulated;
// every backend response comes from the disposable loopback Worker with local R2.
import {it,expect,vi} from 'vitest'
import {request} from 'node:http'
import {resolve} from 'node:path'
import {createHash,randomBytes} from 'node:crypto'
import {localRunner} from '../../../cloudflare-poc/test/local-runner.mjs'
import {authenticator} from '../../../cloudflare-poc/test/auth-fixture.mjs'
import {createMediaSync} from './media-sync.js'
import {createMediaStore,memoryBackend} from './media-store.js'
import {api,apiBlob,apiUpload,setRemoteAuth} from './api.js'
import { _resetMediaOwed } from './media-owed.js'
import {mp4} from './media-samples.test-util.js'
import {auditMigrationMedia} from '../../../cloudflare-poc/src/migration-media-preflight.js'
it('actual media-sync uploads, retries, deduplicates, downloads and refuses stale owner against local R2',async()=>{
  const AUTH_SECRET=randomBytes(32).toString('hex'),SETUP_CODE=randomBytes(32).toString('hex')
  const runner=await localRunner('wrangler.web-media.jsonc',{cwd:resolve('../cloudflare-poc'),health:'/api/health',privateLogs:true,syntheticDiagnostics:true,vars:origin=>({AUTH_SECRET,SETUP_CODE,API_ORIGIN:origin,RP_ID:'localhost',P5_MEDIA:'1'})})
  const dev=authenticator({rp:'localhost',origin:runner.origin})
  let cookie='',offline=false,uploads=0,count=0,dropAckHash=null
  const calls=[]
  const transport=async(url,init={})=>{
    const u=new URL(String(url),runner.base)
    if(u.origin!==runner.base&&u.origin!==runner.origin)throw Error('nonlocal transport refused')
    if(offline)throw Error('synthetic offline')
    const h=new Headers(init.headers||{});if(!h.has('origin'))h.set('origin',runner.origin);if(cookie&&!h.has('authorization'))h.set('cookie',cookie)
    const body=init.body?.arrayBuffer?Buffer.from(await init.body.arrayBuffer()):init.body
    if(body&&!h.has('content-length'))h.set('content-length',String(Buffer.byteLength(body)))
    return new Promise((ok,fail)=>{
      const req=request(u.href,{family:4,method:init.method||'GET',headers:Object.fromEntries(h)},r=>{
        const parts=[];r.on('data',c=>parts.push(c));r.on('error',fail);r.on('end',()=>{
          const b=Buffer.concat(parts);calls.push({path:u.pathname,method:init.method||'GET',status:r.statusCode,want:h.get('x-opengym-account')})
          if(init.method==='PUT'&&u.pathname==='/api/media/'+dropAckHash&&r.statusCode===201){dropAckHash=null;fail(Error('synthetic lost upload acknowledgement'));return}
          ok({ok:r.statusCode>=200&&r.statusCode<300,status:r.statusCode,body:null,headers:{get:k=>r.headers[k.toLowerCase()]??null,getSetCookie:()=>r.headers['set-cookie']||[]},json:async()=>JSON.parse(b),text:async()=>b.toString(),blob:async()=>new Blob([new Uint8Array(b)])})
        })
      })
      req.on('error',fail);req.setTimeout(30000,()=>req.destroy(Error('socket timeout')))
      if(init.signal){if(init.signal.aborted){req.destroy(Error('aborted'));return}init.signal.addEventListener('abort',()=>req.destroy(Error('aborted')),{once:true})}
      req.end(body)
    })
  }
  class LoopbackXHR{
    constructor(){this.upload={};this.headers={};this.ctl=new AbortController()}
    open(method,url){this.method=method;this.url=url}
    setRequestHeader(k,v){this.headers[k]=v}
    getResponseHeader(k){return this.response?.headers.get(k)}
    abort(){this.ctl.abort();this.onabort?.()}
    send(blob){uploads++;transport(this.url,{method:this.method,headers:this.headers,body:blob,signal:this.ctl.signal}).then(async r=>{this.response=r;this.status=r.status;this.responseText=await r.text();this.onload?.()},()=>this.onerror?.())}
  }
  const post=async(p,b)=>{const r=await transport(runner.base+p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});expect(r.status).toBe(200);return {data:await r.json(),cookie:r.headers.getSetCookie()[0]?.split(';')[0]}}
  const bytes=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64'))
  const sha=b=>createHash('sha256').update(b).digest('hex'),hash=sha(bytes)
  vi.stubGlobal('fetch',transport)
  try{
    await runner.start()
    const o=(await post('/api/register/options',{name:'Media synthetic',code:SETUP_CODE})).data
    const reg=await post('/api/register/verify',{cid:o.cid,credential:dev.register(o.options.challenge)});cookie=reg.cookie
    const uid=reg.data.user.id;setRemoteAuth(runner.base,null)
    const cfg=await api('/api/config')
    const ref={kind:'image',hash,mime:'image/png',size:bytes.length,width:1,height:1,at:1}
    const S={customEx:[{id:'synthetic',media:ref}],workouts:[],routines:[]}
    const st={ready:true,user:{id:uid},config:cfg,S,sync:{lastSynced:0}}
    const store={getState:()=>st,subscribe:()=>()=>{}}
    const local=createMediaStore(memoryBackend()),second=createMediaStore(memoryBackend())
    const make=media=>createMediaSync({store,media,api,apiUpload:(p,b,m,o)=>apiUpload(p,b,m,{...o,XHR:LoopbackXHR}),apiBlob:(p,o)=>apiBlob(p,{...o,fetchImpl:transport}),sha256:async b=>sha(b),allowed:()=>true,locks:null,toast:()=>{},storage:null})
    await api('/api/data',{method:'PUT',body:JSON.stringify({state:S,baseRev:0,stamped:true})})
    await local.put(hash,new Blob([bytes],{type:'image/png'}),{mime:'image/png',pending:true})
    const sync=make(local)
    offline=true;await sync.syncMedia({force:true});expect([...local.pendingNow()]).toContain(hash);expect(uploads).toBe(0)
    offline=false;await sync.syncMedia({force:true});expect([...local.pendingNow()]).not.toContain(hash);expect(uploads).toBe(1)
    expect(calls.some(c=>c.path==='/api/media/'+hash&&c.method==='PUT'&&c.status===201&&c.want===uid)).toBe(true)
    await sync.syncMedia({force:true});expect(uploads).toBe(1)
    expect(await make(second).fetchToStore(hash,ref,{force:true})).toBe(true)
    expect(sha(new Uint8Array(await (await second.get(hash)).blob.arrayBuffer()))).toBe(hash)
    expect([...second.pendingNow()]).not.toContain(hash)
    await expect(apiUpload('/api/media/'+hash,new Blob([bytes]),'image/png',{XHR:LoopbackXHR,headers:{'X-OpenGym-Account':'stale-owner'}})).rejects.toMatchObject({status:409,code:'account-mismatch'})
    const usage=await api('/api/media/missing',{method:'POST',body:JSON.stringify({hashes:[hash]})})
    expect(usage.missing).toEqual([]);expect(usage.usage.count).toBe(1)
    // The server commits the whole file, then the transport drops the 201. A retry
    // must reconcile /missing without another PUT or clearing pending prematurely.
    const bytes2=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64'))
    // Distinct synthetic byte sequence; server checks header/hash, not a full decode.
    const distinct=Uint8Array.from([...bytes2,0])
    const h2=sha(distinct),ref2={...ref,hash:h2,size:distinct.length}
    S.customEx.push({id:'lost-ack',media:ref2})
    const cur=await api('/api/data')
    await api('/api/data',{method:'PUT',body:JSON.stringify({state:S,baseRev:cur.rev,baseWid:cur.state._wid,stamped:true})})
    await local.put(h2,new Blob([distinct],{type:'image/png'}),{mime:'image/png',pending:true})
    const before=uploads;dropAckHash=h2
    await sync.syncMedia({force:true})
    expect(dropAckHash).toBeNull()
    expect(uploads).toBe(before+1)
    expect([...local.pendingNow()]).toContain(h2)
    const committed=await api('/api/media/missing',{method:'POST',body:JSON.stringify({hashes:[h2]})})
    expect(committed.missing).toEqual([]);expect(committed.usage.count).toBe(2)
    await sync.syncMedia({force:true})
    expect([...local.pendingNow()]).not.toContain(h2);expect(uploads).toBe(before+1)
    expect(await make(second).fetchToStore(h2,ref2,{force:true})).toBe(true)
    expect(sha(new Uint8Array(await (await second.get(h2)).blob.arrayBuffer()))).toBe(h2)
    console.log('PHASE5_LOST_UPLOAD_ACK_RECONCILIATION PASS')
    // The real web Zustand store must keep edits owed on media-busy 503, not merge
    // an absent conflict document. Do not alter the frozen Phase 4 source.
    const {useStore}=await import('../store/useStore.js')
    await useStore.getState().boot()
    expect(useStore.getState().user?.id).toBe(uid)
    const initial=await api('/api/data')
    const held=request(runner.base+'/api/media/'+hash,{method:'PUT',headers:{cookie,origin:runner.origin,'content-type':'image/png','content-length':bytes.length,'x-opengym-account':uid}},r=>r.resume())
    held.on('error',()=>{});held.setTimeout(12000,()=>held.destroy());held.write(Buffer.from(bytes.subarray(0,8)))
    try{
      let busy=false
      for(let i=0;i<40;i++){
        const r=await transport(runner.base+'/api/media/missing',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({hashes:[hash]})})
        if(r.status===429){expect((await r.json()).code).toBe('busy');busy=true;break}
        expect(r.status).toBe(200);await new Promise(r=>setTimeout(r,50))
      }
      expect(busy).toBe(true)
      useStore.getState().update(s=>{s.workouts.push({id:'busy-edit',d:'2026-09-20',start:1000,end:2000,entries:[]})})
      const beforePush=calls.length
      await useStore.getState().pushState()
      expect(calls.slice(beforePush).filter(c=>c.path==='/api/data'&&c.method==='PUT').map(c=>c.status)).toEqual([503])
      expect(useStore.getState().unsyncedChanges().owed).toBe(true)
      expect(useStore.getState().S.workouts.map(w=>w.id)).toContain('busy-edit')
      expect((await api('/api/data')).rev).toBe(initial.rev)
    }finally{held.destroy()}
    let released=false
    for(let i=0;i<100;i++){
      const r=await transport(runner.base+'/api/media/missing',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({hashes:[hash]})})
      if(r.status===200){released=true;break}
      expect(r.status).toBe(429);await new Promise(r=>setTimeout(r,100))
    }
    expect(released).toBe(true)
    await useStore.getState().pushState()
    expect(useStore.getState().unsyncedChanges().owed).toBe(false)
    expect((await api('/api/data')).state.workouts.map(w=>w.id)).toContain('busy-edit')
    expect((await api('/api/data')).state.customEx.map(e=>e.id)).toContain('lost-ack')
    useStore.setState({user:null,ready:false})
    console.log('PHASE5_ACTUAL_STATE_STORE_BUSY_RETRY PASS')
    const proof=(await post('/api/login/options',{})).data
    const pair=(await post('/api/pair/create',{cid:proof.cid,credential:dev.login(proof.options.challenge,++count)})).data
    const paired=(await post('/api/pair/redeem',{code:pair.code})).data
    setRemoteAuth(runner.base,paired.token)
    const mobile=make(createMediaStore(memoryBackend()))
    expect(await mobile.fetchToStore(hash,ref,{force:true})).toBe(true)
    console.log('PHASE5_ACTUAL_FRONTEND_MEDIA_SYNC PASS')
    // Existing media from the old 100 MiB video configuration: structural
    // MP4 fixture with a free box, not a browser decode claim.
    const small=mp4().file,large=Buffer.alloc(8*1024*1024+1)
    large.set(small);large.writeUInt32BE(large.length-small.length,small.length);large.write('free',small.length+4)
    const largeHash=sha(large),largeBlob=new Blob([new Uint8Array(large)],{type:'video/mp4'})
    const largeRef={kind:'video',hash:largeHash,mime:'video/mp4',size:large.length,width:1920,height:1080,dur:5,at:1}
    const latest=await api('/api/data')
    st.S={...latest.state,customEx:[...latest.state.customEx,{id:'oversized-legacy',media:largeRef}]}
    await api('/api/data',{method:'PUT',body:JSON.stringify({state:st.S,baseRev:latest.rev,baseWid:latest.state._wid,stamped:true})})
    await local.put(largeHash,largeBlob,{mime:'video/mp4',pending:true})
    const beforeLarge=uploads
    await make(local).syncMedia({force:true,retryRejected:true})
    const kept=await local.get(largeHash)
    expect(kept).toMatchObject({pending:true,rejected:true,size:large.length})
    expect(sha(new Uint8Array(await kept.blob.arrayBuffer()))).toBe(largeHash)
    expect(uploads).toBe(beforeLarge)
    expect((await api('/api/data')).state.customEx.find(x=>x.id==='oversized-legacy').media.hash).toBe(largeHash)
    expect((await api('/api/media/missing',{method:'POST',body:JSON.stringify({hashes:[largeHash]})})).missing).toEqual([largeHash])
    console.log('PHASE5_OVERSIZED_PENDING_MEDIA_PRESERVED PASS')
    // Diagnostic (not an acceptance PASS): a file previously acknowledged by a
    // different server is not automatically marked pending when now refused.
    // Do not delete it; the frozen client cache eviction and sign-out use pending.
    await second.put(largeHash,largeBlob,{mime:'video/mp4',pending:false})
    await make(second).syncMedia({force:true,retryRejected:true})
    const legacy=await second.get(largeHash)
    expect(legacy).toMatchObject({pending:false,rejected:true})
    expect(sha(new Uint8Array(await legacy.blob.arrayBuffer()))).toBe(largeHash)
    expect(uploads).toBe(beforeLarge)
    console.log('PHASE5_LEGACY_ACK_PENDING_GAP RISK_REPRODUCED')
    // Read-only qualification against the real destination. A prior ACK is not
    // a receipt. Even a byte-verified independent synthetic copy cannot authorize
    // cutover while a destination file is missing or incompatible.
    const legacySnapshot={owner:uid,state:{customEx:[{media:largeRef}]}};
    const backupCopies=new Map([[largeHash,new Blob([new Uint8Array(large)],{type:'video/mp4'})]]);
    const audit=await auditMigrationMedia({owner:uid,snapshots:[legacySnapshot],
      readLocal:async h=>(await second.get(h))?.blob||null,
      readBackup:async h=>backupCopies.get(h)||null,
      readDestination:async h=>{try{const b=await apiBlob('/api/media/'+h,{fetchImpl:transport});return new Blob([await b.arrayBuffer()],{type:largeRef.mime})}catch(e){if(e.status===404)return null;throw e}},
      isCurrent:async owner=>owner===uid&&st.user.id===uid});
    expect(audit.records).toEqual([{hash:largeHash,local:'verified',backup:'verified',destination:'missing',overLimit:true}])
    expect(audit.issues).toEqual(['destination-not-verified','destination-size-limit'])
    expect(audit.cutoverAuthorized).toBe(false)
    expect((await second.get(largeHash)).pending).toBe(false)
    // Explicitly re-stage the verified bytes using the frozen store's public API
    // in this disposable test only. No automatic mutation during preflight.
    await second.put(largeHash,legacy.blob,{mime:legacy.mime,pending:true})
    await make(second).syncMedia({force:true,retryRejected:true})
    expect((await second.get(largeHash))).toMatchObject({pending:true,rejected:true})
    expect(sha(new Uint8Array(await (await second.get(largeHash)).blob.arrayBuffer()))).toBe(largeHash)
    expect(uploads).toBe(beforeLarge)
    console.log('PHASE5_READ_ONLY_PREFLIGHT_AND_EXPLICIT_RESTAGE PASS')
  }finally{setRemoteAuth('',null);vi.unstubAllGlobals();_resetMediaOwed();await runner.cleanup()}
},180000)
