// @vitest-environment happy-dom
// Copied to frontend/src/lib in the disposable CI checkout only. Pinned client modules
// and actual local HTTP backend; OS file storage and native network fallback are simulated.
import { it, expect, vi } from 'vitest'
import { request } from 'node:http'
import { resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { localRunner } from '../../../cloudflare-poc/test/local-runner.mjs'
import { authenticator } from '../../../cloudflare-poc/test/auth-fixture.mjs'
import { config, issue, TTL } from '../../../cloudflare-poc/src/auth/session.js'
const h = vi.hoisted(() => {
  vi.stubEnv('VITE_MOBILE','1')
  return { files:new Map(), secure:new Map() }
})
vi.mock('@capacitor/core',()=>({Capacitor:{getPlatform:()=> 'android',isNativePlatform:()=>true},registerPlugin:()=>({})}))
vi.mock('@capacitor/filesystem',()=>({
  Directory:{Data:'DATA',LibraryNoCloud:'LIBRARY_NOCLOUD',Documents:'DOCUMENTS',Cache:'CACHE'},
  Encoding:{UTF8:'utf8'},
  Filesystem:{
    async readFile({path,directory}){const k=directory+'/'+path;if(!h.files.has(k))throw Error('not found');return {data:h.files.get(k)}},
    async writeFile({path,directory,data}){h.files.set(directory+'/'+path,data);return {uri:'fixture'}},
    async deleteFile({path,directory}){h.files.delete(directory+'/'+path)},
    async rename({from,to,directory,toDirectory}){const k=directory+'/'+from;if(!h.files.has(k))throw Error('not found');h.files.set((toDirectory||directory)+'/'+to,h.files.get(k));h.files.delete(k)}
  }
}))
vi.mock('./coach-secrets.js',()=>({secureGet:async k=>h.secure.get(k)||null,secureSet:async(k,v)=>h.secure.set(k,v),secureRemove:async k=>h.secure.delete(k)}))
vi.mock('./oidc-app.js',()=>({phoneSignIn:async()=>{throw Error('OIDC deferred')}}))
vi.mock('./capacitor-fetch.js',()=>({inAndroidApp:async()=>false,nativeFetch:async()=>{throw Error('native transport not simulated here')}}))
import { api, setRemoteAuth, remoteAuth, setAccessHeaders } from './api.js'
import { connect,loadRemote,renewToken,forgetRemote } from './remote.js'
import { nativeLoad,nativeSave } from './mobile.js'
import { mergeStates,stampChange } from './sync-merge.js'
import { idsToCancel } from './nudge-check.js'
const secret=()=>randomBytes(32).toString('hex')
const clone=x=>JSON.parse(JSON.stringify(x))
const work=(id,date)=>({id,d:date,start:Date.parse(date+'T10:00:00Z'),end:Date.parse(date+'T11:00:00Z'),entries:[]})
// Real HTTP response bytes from loopback. This is a transport adapter, not a fake backend.
// The browser's native-origin header is explicitly supplied in the Node test. CORS enforcement
// in a real WebView remains manual; preflight headers are asserted separately.
function httpFetch(url,init={}){
  return new Promise((ok,fail)=>{
    const u=new URL(String(url));if(u.protocol!=='http:'||!['127.0.0.1','localhost'].includes(u.hostname)){fail(Error('nonlocal request refused'));return}
    const headers=new Headers(init.headers||{});if(!headers.has('origin'))headers.set('origin','capacitor://localhost')
    const req=request(u.href,{method:init.method||'GET',headers:Object.fromEntries(headers)},r=>{
      const parts=[];r.on('data',c=>parts.push(c));r.on('error',fail);r.on('end',()=>{
        const body=Buffer.concat(parts).toString('utf8')
        ok({ok:r.statusCode>=200&&r.statusCode<300,status:r.statusCode,headers:{get:k=>r.headers[k.toLowerCase()]??null,getSetCookie:()=>r.headers['set-cookie']||[]},json:async()=>JSON.parse(body),text:async()=>body})
      })
    })
    req.on('error',fail);req.setTimeout(30000,()=>req.destroy(Error('socket timeout')))
    if(init.signal){if(init.signal.aborted){req.destroy(Error('aborted'));return}init.signal.addEventListener('abort',()=>req.destroy(Error('aborted')),{once:true})}
    req.end(init.body)
  })
}
it('actual mobile API/remote/merge modules: pair, persist, offline conflict, renewal and re-pair against Worker',async()=>{
  const AUTH_SECRET=secret(),SETUP_CODE=secret()
  const runner=await localRunner('wrangler.api.jsonc',{cwd:resolve('../cloudflare-poc'),health:'/api/health',privateLogs:true,vars:origin=>({AUTH_SECRET,SETUP_CODE,API_ORIGIN:origin,RP_ID:'localhost'})})
  let offline=false,html=false,network=0,counter=0
  const dev=authenticator({rp:'localhost',origin:runner.origin})
  const cfg=config({AUTH_SECRET,SETUP_CODE,API_ORIGIN:runner.origin,RP_ID:'localhost'})
  vi.stubGlobal('fetch',(url,init={})=>{network++;if(offline)return Promise.reject(Error('synthetic offline'));if(html)return Promise.resolve({ok:true,status:200,json:async()=>{throw Error('HTML')},text:async()=>'<html>not API</html>'});return httpFetch(url,init)})
  const owner=async(path,body,cookie)=>{
    const r=await httpFetch(runner.base+path,{method:body===undefined?'GET':'POST',headers:{origin:runner.origin,...(body===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})})
    if(!r.ok)throw Error('owner fixture '+path+' '+r.status)
    return {data:await r.json(),cookie:r.headers.getSetCookie()[0]?.split(';')[0]}
  }
  const proof=async()=>{const o=(await owner('/api/login/options',{})).data;return {cid:o.cid,credential:dev.login(o.options.challenge,++counter)}}
  const pair=async cookie=>(await owner('/api/pair/create',await proof(),cookie)).data.code
  const put=(state,rev,wid)=>api('/api/data',{method:'PUT',body:JSON.stringify({state,baseRev:rev,baseWid:wid,stamped:true})})
  try{
    await runner.start()
    let before=network
    await expect(api('/api/data')).rejects.toMatchObject({code:'not-paired',status:0})
    expect(network===before).toBe(true)
    const o=(await owner('/api/register/options',{name:'Mobile synthetic',code:SETUP_CODE})).data
    let reg=await owner('/api/register/verify',{cid:o.cid,credential:dev.register(o.options.challenge)}),cookie=reg.cookie
    const pre=await httpFetch(runner.base+'/api/data',{method:'OPTIONS',headers:{origin:'capacitor://localhost','access-control-request-method':'PUT','access-control-request-headers':'authorization,content-type'}})
    expect(pre.status).toBe(204);expect(pre.headers.get('access-control-allow-origin')).toBe('capacitor://localhost');expect(pre.headers.get('access-control-allow-credentials')).toBe(null)
    expect(pre.headers.get('access-control-allow-headers').toLowerCase().includes('authorization')).toBe(true)
    const code=await pair(cookie),user=await connect(runner.base,code),remote=await loadRemote()
    expect(user.id===reg.data.user.id).toBe(true);expect(remote.mode).toBe('remote');expect(remote.token===remoteAuth().headers.Authorization.slice(7)).toBe(true)
    await expect(connect(runner.base,code)).rejects.toMatchObject({code:'pair-invalid',status:400})
    expect((await loadRemote()).token===remote.token).toBe(true)
    const first={unit:'kg',workouts:[work('seed','2026-09-01')],routines:[],_ts:Date.now()}
    await put(first,0)
    const common=await api('/api/data'),local=clone(common.state)
    local.workouts.push(work('offline-phone','2026-09-02'));local._ts=stampChange(common.state,local)
    offline=true
    await nativeSave(local)
    await expect(put(local,common.rev,common.state._wid)).rejects.toThrow('synthetic offline')
    expect((await nativeLoad()).workouts.some(w=>w.id==='offline-phone')).toBe(true)
    offline=false
    // A second device writes while the phone's copy is stale.
    const other=clone(common.state);other.workouts.push(work('other-device','2026-09-03'));other._ts=stampChange(common.state,other)
    await put(other,common.rev,common.state._wid)
    let conflict
    try{await put(local,common.rev,common.state._wid)}catch(e){conflict=e}
    expect(conflict?.status).toBe(409);expect(!!conflict?.data?.state).toBe(true)
    const merged=mergeStates(await nativeLoad(),conflict.data.state)
    await put(merged,conflict.data.rev,conflict.data.state._wid)
    expect((await api('/api/data')).state.workouts.map(w=>w.id).sort()).toEqual(['offline-phone','other-device','seed'])
    const done=await api('/api/nudge-check?date=2026-09-02')
    expect(idsToCancel({date:'2026-09-02',reminder:[1000],nudge:[2000]},done)).toEqual([1000,2000])
    html=true;await expect(api('/api/data')).rejects.toMatchObject({code:'bad-response',status:200});html=false
    const aged=issue(cfg,{id:user.id,sv:0},'b',Date.now()-TTL*.75)
    setRemoteAuth(remote.base,aged)
    const me=await api('/api/me');expect(typeof me.token==='string'&&me.token!==aged).toBe(true)
    await renewToken(remote,me.token);expect((await loadRemote()).token===me.token).toBe(true)
    await owner('/api/logout/all',{},cookie)
    await expect(api('/api/me')).rejects.toMatchObject({status:401})
    expect((await loadRemote()).mode).toBe('remote')
    expect((await nativeLoad()).workouts.some(w=>w.id==='offline-phone')).toBe(true)
    cookie=(await owner('/api/login/verify',await proof())).cookie
    const re=await connect(runner.base,await pair(cookie));expect(re.id===user.id).toBe(true)
    await runner.stop();await runner.start()
    expect((await api('/api/data')).state.workouts.length).toBe(3)
    await forgetRemote();expect((await loadRemote()).mode).toBe('local')
    before=network;await expect(api('/api/me')).rejects.toMatchObject({code:'not-paired',status:0});expect(network===before).toBe(true)
    console.log('PHASE4_PINNED_MOBILE_MODULES PASS')
  }finally{setRemoteAuth('',null);setAccessHeaders({},'');await runner.cleanup();vi.unstubAllGlobals();vi.unstubAllEnvs();h.files.clear();h.secure.clear()}
},150000)
