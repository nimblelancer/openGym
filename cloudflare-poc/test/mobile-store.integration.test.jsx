// @vitest-environment happy-dom
// AGPL-3.0-or-later. Native mock structure adapted from upstream
// frontend/src/store/useStore.mobile-remote.test.jsx (e4a68a9).
// Actual store/remote/API/merge modules and real Worker HTTP, not a mock server.
// Copied to frontend/src/store in CI; no tracked upstream files modified.
import { afterEach, expect, it, vi } from 'vitest'
import { request } from 'node:http'
import { resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { localRunner } from '../../../cloudflare-poc/test/local-runner.mjs'
import { authenticator } from '../../../cloudflare-poc/test/auth-fixture.mjs'
import { mergeStates, stampChange } from '../lib/sync-merge.js'
const h = vi.hoisted(() => {
  vi.stubEnv('VITE_MOBILE', '1')   // lib/mobile.js: MOBILE = import.meta.env.VITE_MOBILE === '1'
  // `refuse`: file names whose writes fail, like a full disk.
  return { files: new Map(), server: null, calls: [], refuse: new Set() }
})

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA', Documents: 'DOCUMENTS', Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: {
    readFile: async ({ path, directory }) => {
      const k = directory + '/' + path
      if (!h.files.has(k)) throw new Error('File does not exist')
      return { data: h.files.get(k) }
    },
    writeFile: async ({ path, directory, data }) => {
      if (h.refuse.has(path)) throw new Error('No space left on device')
      h.files.set(directory + '/' + path, data)
      return { uri: 'file://' + path }
    },
  },
}))
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: { cancel: async () => {}, checkPermissions: async () => ({ display: 'granted' }), requestPermissions: async () => ({ display: 'granted' }), schedule: async () => {} },
}))
vi.mock('@capacitor/app', () => ({ App: { addListener: () => ({ remove() {} }) } }))
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'android', isNativePlatform: () => true }, registerPlugin: () => ({}) }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: () => {} }) } }))


vi.mock('../lib/coach-secrets.js',()=>({secureGet:async()=>null,secureSet:async()=>{},secureRemove:async()=>{}}))
vi.mock('../lib/oidc-app.js',()=>({phoneSignIn:async()=>{throw Error('OIDC deferred')}}))
vi.mock('../lib/capacitor-fetch.js',()=>({inAndroidApp:async()=>false,nativeFetch:async()=>{throw Error('not used in store fixture')}}))
vi.mock('../sheets.jsx',()=>({askAddDeviceData:async()=>false}))
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

const clone=x=>JSON.parse(JSON.stringify(x))
const work=(id,d)=>({id,d,start:Date.parse(d+'T10:00:00Z'),end:Date.parse(d+'T11:00:00Z'),entries:[]})
const ids=x=>(x?.workouts||[]).map(w=>w.id).sort()
const readFile=name=>JSON.parse(h.files.get('DATA/'+name)||'null')
const secret=()=>randomBytes(32).toString('hex')
const {DEF}=await import('./useStore.js')
let stores=[],fixtures=[]
async function freshStore(){
  vi.resetModules()
  const {useStore}=await import('./useStore.js')
  stores.push(useStore);return useStore
}
async function makeServer(name){
  const AUTH_SECRET=secret(),SETUP_CODE=secret()
  const runner=await localRunner('wrangler.api.jsonc',{cwd:resolve('../cloudflare-poc'),health:'/api/health',privateLogs:true,vars:origin=>({AUTH_SECRET,SETUP_CODE,API_ORIGIN:origin,RP_ID:'localhost'})})
  fixtures.push(runner)
  const dev=authenticator({rp:'localhost',origin:runner.origin});let count=0,cookie
  const raw=async(path,method='GET',body)=>{
    const r=await httpFetch(runner.base+path,{method,headers:{origin:runner.origin,...(cookie?{cookie}:{}),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})})
    if(!r.ok)throw Error('owner '+method+' '+path+' '+r.status)
    return {body:await r.json(),cookie:r.headers.getSetCookie()[0]?.split(';')[0]}
  }
  const proof=async()=>{const {body:o}=await raw('/api/login/options','POST',{});return {cid:o.cid,credential:dev.login(o.options.challenge,++count)}}
  const login=async()=>{cookie=(await raw('/api/login/verify','POST',await proof())).cookie}
  const pair=async()=> (await raw('/api/pair/create','POST',await proof())).body.code
  const get=async()=> (await raw('/api/data')).body
  const save=async(state,base)=> (await raw('/api/data','PUT',{state,baseRev:base?.rev??0,baseWid:base?.state?._wid,stamped:true})).body
  await runner.start()
  const {body:o}=await raw('/api/register/options','POST',{name,code:SETUP_CODE})
  const reg=await raw('/api/register/verify','POST',{cid:o.cid,credential:dev.register(o.options.challenge)});cookie=reg.cookie
  return {runner,base:runner.base,uid:reg.body.user.id,get,save,pair,login,revoke:()=>raw('/api/logout/all','POST',{})}
}
let mode='online',seen=[]
function installTransport(){
  vi.stubGlobal('fetch',async(url,init={})=>{
    const u=new URL(String(url));const method=init.method||'GET'
    if(!fixtures.some(x=>x.base===u.origin))throw Error('nonfixture request refused')
    const path=u.pathname;const headers=new Headers(init.headers||{})
    const isHealth=path==='/api/health'
    if(isHealth)return httpFetch(url,init)
    // Store is using only bearer authorization, not the owner's cookie.
    expect(headers.has('cookie')).toBe(false)
    if(mode==='offline')throw Error('simulated offline')
    if(mode==='503'&&method==='PUT')return {ok:false,status:503,json:async()=>({error:'service unavailable'})}
    if(mode==='html'&&method==='PUT')return {ok:true,status:200,json:async()=>{throw Error('not JSON')}}
    const r=await httpFetch(url,init);seen.push({path,method,status:r.status,base:u.origin})
    return r
  })
}
afterEach(async()=>{
  mode='online'
  for(const s of stores)s.setState({user:null,ready:false})
  window.dispatchEvent(new Event('pagehide'))
  if(vi.isFakeTimers()){await vi.advanceTimersByTimeAsync(20);vi.useRealTimers()}
  for(const runner of fixtures.reverse())await runner.cleanup()
  fixtures=[];stores=[];seen=[];h.files.clear();h.refuse.clear();localStorage.clear();vi.unstubAllGlobals()
})
it('actual upstream store: offline conflict, failed acknowledgements, revoke, stash, account isolation and re-pair',async()=>{
  localStorage.clear();h.files.clear();h.files.set('DATA/opengym-remote.json',JSON.stringify({mode:'local'}))
  const home=await makeServer('Synthetic home')
  await home.save({...clone(DEF),_ts:Date.now(),workouts:[work('seed','2026-09-01')],routines:[]})
  installTransport()
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout']})
  let store=await freshStore()
  const connect=async(server)=>store.getState().connectToServer(server.base,await server.pair(),async()=>false)
  await store.getState().boot();await connect(home)
  expect(ids(store.getState().S)).toEqual(['seed'])
  expect(store.getState().user.id===home.uid).toBe(true)
  mode='offline'
  store.getState().update(s=>{s.workouts.push(work('phone-offline','2026-09-02'))})
  await store.getState().pushState()
  await vi.advanceTimersByTimeAsync(900)
  expect(store.getState().unsyncedChanges().owed).toBe(true)
  expect(ids(readFile('opengym-state.json'))).toContain('phone-offline')
  const common=await home.get(),other=clone(common.state)
  other.workouts.push(work('web-edit','2026-09-03'));other._ts=stampChange(common.state,other)
  await home.save(other,common)
  mode='online'
  await store.getState().pushState()
  expect(seen.some(x=>x.path==='/api/data'&&x.method==='PUT'&&x.status===409)).toBe(true)
  expect(ids((await home.get()).state)).toEqual(['phone-offline','seed','web-edit'])
  expect(store.getState().unsyncedChanges().owed).toBe(false)
  // These transport failures are injected on the client side; the Worker remains untouched.
  store.getState().update(s=>{s.workouts.push(work('owed','2026-09-04'))})
  for(const fault of ['503','html']){
    mode=fault;await store.getState().pushState()
    expect(store.getState().unsyncedChanges().owed).toBe(true)
    expect(ids((await home.get()).state)).not.toContain('owed')
  }
  mode='online';await home.revoke()
  await store.getState().pushState()
  expect(store.getState().sync.status).toBe('auth')
  expect((await store.getState().disconnectServer()).owed).toBe(true)
  expect(ids(store.getState().S)).toContain('owed')
  const kept=await store.getState().disconnectServer({force:true})
  expect(kept.stashed).toBe(true)
  expect(readFile('opengym-remote.json').mode).toBe('local')
  const stashKey=home.base+'|'+home.uid
  expect(ids(readFile('opengym-stash.json')[stashKey].state)).toContain('owed')
  // Simulate a second server without running two local workerd instances concurrently.
  await home.runner.stop()
  const otherServer=await makeServer('Synthetic other')
  await otherServer.save({...clone(DEF),_ts:Date.now(),workouts:[work('other-only','2026-09-05')],routines:[]})
  await connect(otherServer)
  expect(ids(store.getState().S)).toEqual(['other-only'])
  expect(ids((await otherServer.get()).state)).toEqual(['other-only'])
  expect(ids(readFile('opengym-stash.json')[stashKey].state)).toContain('owed')
  await otherServer.runner.stop();await home.runner.start();await home.login()
  // Lose the localStorage stash; the native mock's durable file must be sufficient.
  localStorage.removeItem('gym_stash')
  await connect(home)
  expect(ids((await home.get()).state)).toEqual(['owed','phone-offline','seed','web-edit'])
  expect(ids(store.getState().S)).toEqual(['owed','phone-offline','seed','web-edit'])
  expect(readFile('opengym-stash.json')?.[stashKey]||null).toBe(null)
  // Delete one item, reset via real store, then restart the backend.
  store.getState().update(s=>{s.workouts=s.workouts.filter(w=>w.id!=='seed')})
  await store.getState().pushState()
  expect(ids((await home.get()).state)).not.toContain('seed')
  await store.getState().resetEverything();await store.getState().pushState()
  const reset=(await home.get()).state
  expect(ids(reset)).toEqual([]);expect(Number(reset.resetAt)>0).toBe(true)
  await home.runner.stop();await home.runner.start()
  expect(ids((await home.get()).state)).toEqual([])
  expect((await home.get()).state.resetAt).toBe(reset.resetAt)
  console.log('PHASE4_REAL_STORE_STASH_CONFLICT_RESET PASS')
},240000)
