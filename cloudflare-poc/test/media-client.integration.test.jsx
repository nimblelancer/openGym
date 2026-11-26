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
it('actual media-sync uploads, retries, deduplicates, downloads and refuses stale owner against local R2',async()=>{
  const AUTH_SECRET=randomBytes(32).toString('hex'),SETUP_CODE=randomBytes(32).toString('hex')
  const runner=await localRunner('wrangler.web-media.jsonc',{cwd:resolve('../cloudflare-poc'),health:'/api/health',privateLogs:true,syntheticDiagnostics:true,vars:origin=>({AUTH_SECRET,SETUP_CODE,API_ORIGIN:origin,RP_ID:'localhost',P5_MEDIA:'1'})})
  const dev=authenticator({rp:'localhost',origin:runner.origin})
  let cookie='',offline=false,uploads=0,count=0
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
    const proof=(await post('/api/login/options',{})).data
    const pair=(await post('/api/pair/create',{cid:proof.cid,credential:dev.login(proof.options.challenge,++count)})).data
    const paired=(await post('/api/pair/redeem',{code:pair.code})).data
    setRemoteAuth(runner.base,paired.token)
    const mobile=make(createMediaStore(memoryBackend()))
    expect(await mobile.fetchToStore(hash,ref,{force:true})).toBe(true)
    console.log('PHASE5_ACTUAL_FRONTEND_MEDIA_SYNC PASS')
  }finally{setRemoteAuth('',null);vi.unstubAllGlobals();_resetMediaOwed();await runner.cleanup()}
},180000)
