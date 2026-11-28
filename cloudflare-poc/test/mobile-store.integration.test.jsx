// @vitest-environment happy-dom
// AGPL-3.0-or-later. Native mock structure adapted from upstream
// frontend/src/store/useStore.mobile-remote.test.jsx (e4a68a9).
// Actual store/remote/API/merge modules and real Worker HTTP, not a mock server.
// Copied to frontend/src/store in CI; no tracked upstream files modified.
import { afterEach, expect, it, vi } from 'vitest'
import { request } from 'node:http'
import { resolve, join } from 'node:path'
import { readdir } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { encode, metaHash } from '../../../cloudflare-poc/src/storage/codec.js'
import { randomBytes } from 'node:crypto'
import { localRunner } from '../../../cloudflare-poc/test/local-runner.mjs'
import { authenticator } from '../../../cloudflare-poc/test/auth-fixture.mjs'
import { stampChange } from '../lib/sync-merge.js'
const h = vi.hoisted(() => {
  vi.stubEnv('VITE_MOBILE', '1')   // lib/mobile.js: MOBILE = import.meta.env.VITE_MOBILE === '1'
  // `refuse`: file names whose writes fail, like a full disk.
  return { files: new Map(), server: null, calls: [], refuse: new Set() }
})

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA', Documents: 'DOCUMENTS', Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: {
    readdir: async ({ path, directory }) => {
      const prefix = directory + '/' + (path ? path + '/' : '')
      return { files: [...h.files.keys()].filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length)).filter(name => name && !name.includes('/')).map(name => ({ name, type: 'file' })) }
    },
    readFile: async ({ path, directory }) => {
      const k = directory + '/' + path
      if (!h.files.has(k)) throw new Error('File does not exist')
      return { data: h.files.get(k) }
    },
    writeFile: async ({ path, directory, data }) => {
      if (h.refuse.has(path)) {
        if(path==='opengym-stash.json')h.rejectedNativeStashWrites=(h.rejectedNativeStashWrites||0)+1
        throw new Error('No space left on device')
      }
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
function httpFetch(url,init={}){
  return new Promise((ok,fail)=>{
    const u=new URL(String(url));if(u.protocol!=='http:'||!['127.0.0.1','localhost'].includes(u.hostname)){fail(Error('nonlocal request refused'));return}
    const headers=new Headers(init.headers||{});if(!headers.has('origin'))headers.set('origin','capacitor://localhost')
    const req=request(u.href,{family:4,method:init.method||'GET',headers:Object.fromEntries(headers)},r=>{
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
// Offline rewind of a disposable DB only; no restore route in the Worker.
async function findAuthDb(root){
  for(const e of await readdir(root,{withFileTypes:true})){
    const p=join(root,e.name)
    if(e.isDirectory()){const hit=await findAuthDb(p);if(hit)return hit}
    else if(e.name.endsWith('.sqlite')){
      const db=new DatabaseSync(p,{timeout:5000})
      try{if(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='profile_state'").get())return p}finally{db.close()}
    }
  }
}
async function rewind(server,state){
  await server.runner.stop()
  const path=await findAuthDb(server.runner.dir);if(!path)throw Error('disposable profile DB not found')
  const db=new DatabaseSync(path,{timeout:5000})
  try{
    const e=encode(state),m={profile_id:server.uid,rev:state._rev,wid:state._wid,byte_count:e.byteCount,chunk_count:e.chunks.length,digest:e.digest,updated_at:Date.now()}
    m.integrity=metaHash(m)
    db.exec('BEGIN IMMEDIATE')
    try{
      db.prepare('DELETE FROM profile_chunks WHERE profile_id=?').run(server.uid)
      e.chunks.forEach((b,i)=>db.prepare('INSERT INTO profile_chunks VALUES(?,?,?)').run(server.uid,i,b))
      db.prepare('INSERT OR REPLACE INTO profile_state VALUES(?,?,?,?,?,?,?,?)').run(m.profile_id,m.rev,m.wid,m.byte_count,m.chunk_count,m.digest,m.updated_at,m.integrity)
      db.exec('COMMIT')
    }catch(e){db.exec('ROLLBACK');throw e}
  }finally{db.close()}
  await server.runner.start()
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
  // Install loopback transport before localRunner.start probes /api/health.
  // Happy DOM fetch has a browser origin and cannot make this Node harness probe.
  // Explicit native CORS assertions remain in the separate mobile contract fixture.
  installTransport()
  const home=await makeServer('Synthetic home')
  await home.save({...clone(DEF),_ts:Date.now(),workouts:[work('seed','2026-09-01')],routines:[]})
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout']})
  let store=await freshStore()
  const connect=async(server)=>store.getState().connectToServer(server.base,await server.pair(),async()=>false)
  await store.getState().boot()
  expect(seen).toEqual([])
  await connect(home)
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
  // A valid but older snapshot is restored offline, retaining the account and credentials.
  await rewind(home,common.state)
  expect((await home.get()).rev).toBe(common.rev)
  await store.getState().pullState()
  expect(ids((await home.get()).state)).toEqual(['phone-offline','seed','web-edit'])
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
  // If both stash targets fail, forced disconnect must refuse, not erase the only copy.
  expect(localStorage.getItem('gym_stash')).toBeNull()
  expect(readFile('opengym-stash.json')).toBeNull()
  h.refuse.add('opengym-stash.json')
  const realStorage=localStorage
  let rejectedStashWrites=0
  // Happy DOM Storage is a proxy: a prototype spy need not intercept actual writes.
  // Stub the global used by useStore and prove both faults were actually exercised.
  vi.stubGlobal('localStorage',{
    get length(){return realStorage.length},
    key:i=>realStorage.key(i),
    getItem:k=>realStorage.getItem(k),
    removeItem:k=>realStorage.removeItem(k),
    clear:()=>realStorage.clear(),
    setItem(k,v){
      if(k==='gym_stash'){rejectedStashWrites++;throw Error('fixture storage full')}
      realStorage.setItem(k,v)
    }
  })
  try{
    expect(()=>localStorage.setItem('gym_stash','{}')).toThrow('fixture storage full')
    rejectedStashWrites=0
    h.rejectedNativeStashWrites=0
    const noStash=await store.getState().disconnectServer({force:true})
    expect(rejectedStashWrites).toBeGreaterThan(0)
    expect(h.rejectedNativeStashWrites).toBeGreaterThan(0)
    expect(realStorage.getItem('gym_stash')).toBeNull()
    expect(readFile('opengym-stash.json')).toBeNull()
    expect(noStash.stashed).toBe(false)
    expect(ids(store.getState().S)).toContain('owed')
    expect(readFile('opengym-remote.json').mode).toBe('remote')
    // A previous stash may remain if cleanup failed. Equal key counts do not prove
    // that a new write succeeded: the old copy must not authorize wiping newer edits.
    const staleKey=home.base+'|'+home.uid
    const stale={ [staleKey]:{server:home.base,uid:home.uid,name:'Synthetic home',at:Date.now()-1000,state:clone(common.state)} }
    expect(ids(stale[staleKey].state)).not.toContain('owed')
    h.files.set('DATA/opengym-stash.json',JSON.stringify(stale))
    rejectedStashWrites=0;h.rejectedNativeStashWrites=0
    const staleResult=await store.getState().disconnectServer({force:true})
    expect(rejectedStashWrites).toBeGreaterThan(0)
    expect(h.rejectedNativeStashWrites).toBeGreaterThan(0)
    expect(realStorage.getItem('gym_stash')).toBeNull()
    expect(readFile('opengym-stash.json')).toEqual(stale)
    expect(staleResult.stashed,'an unchanged stale file must not count as a newly durable stash').toBe(false)
    expect(ids(store.getState().S)).toContain('owed')
    expect(readFile('opengym-remote.json').mode).toBe('remote')
    expect(store.getState().user.id).toBe(home.uid)
    expect(realStorage.getItem('gym_owner')).toBe(home.uid)
    console.log('PHASE4_DUAL_STASH_FAILURE_OWNER_RETAINED PASS')
    h.files.delete('DATA/opengym-stash.json')
  }finally{vi.stubGlobal('localStorage',realStorage);h.refuse.delete('opengym-stash.json')}
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
  expect(store.getState().user.id).toBe(otherServer.uid)
  expect(localStorage.getItem('gym_owner')).toBe(otherServer.uid)
  expect(readFile('opengym-remote.json')).toMatchObject({mode:'remote',base:otherServer.base})
  expect(ids(store.getState().S)).toEqual(['other-only'])
  expect(ids((await otherServer.get()).state)).toEqual(['other-only'])
  expect(ids(readFile('opengym-stash.json')[stashKey].state)).toContain('owed')
  await otherServer.runner.stop();await home.runner.start();await home.login()
  // Lose the localStorage stash; the native mock's durable file must be sufficient.
  localStorage.removeItem('gym_stash')
  const nativeOnly=readFile('opengym-stash.json')[stashKey]
  expect(nativeOnly).toMatchObject({uid:home.uid,server:home.base})
  expect(Number.isSafeInteger(nativeOnly.at)).toBe(true)
  expect(ids(nativeOnly.state)).toContain('owed')
  expect(localStorage.getItem('gym_stash')).toBeNull()
  await connect(home)
  expect(localStorage.getItem('gym_owner')).toBe(home.uid)
  expect(ids((await home.get()).state)).toEqual(['owed','phone-offline','seed','web-edit'])
  expect(ids(store.getState().S)).toEqual(['owed','phone-offline','seed','web-edit'])
  expect(readFile('opengym-stash.json')?.[stashKey]||null).toBe(null)
  console.log('PHASE7_NATIVE_ONLY_STASH_RECOVERY PASS')
  // Each medium alone can retain a new stash even if the other holds stale data.
  // Re-pair against the real Worker, not only a mocked API.
  for(const durable of ['localStorage','native']){
    const previous=await home.get(),newId='single-'+durable
    const stale={ [stashKey]:{server:home.base,uid:home.uid,name:'Synthetic home',at:Date.now()+10000,state:clone(previous.state)} }
    localStorage.setItem('gym_stash',JSON.stringify(stale))
    h.files.set('DATA/opengym-stash.json',JSON.stringify(stale))
    mode='offline'
    store.getState().update(s=>{s.workouts.push(work(newId,'2026-09-07'))})
    await store.getState().pushState()
    mode='online';await home.revoke()
    await store.getState().pushState()
    const storage=localStorage
    let refusedLocal=0
    h.rejectedNativeStashWrites=0
    if(durable==='localStorage')h.refuse.add('opengym-stash.json')
    else vi.stubGlobal('localStorage',{
      get length(){return storage.length},key:i=>storage.key(i),getItem:k=>storage.getItem(k),
      removeItem:k=>storage.removeItem(k),clear:()=>storage.clear(),
      setItem(k,v){if(k==='gym_stash'){refusedLocal++;throw Error('fixture storage full')}storage.setItem(k,v)}
    })
    try{
      expect(await store.getState().disconnectServer({force:true})).toMatchObject({stashed:true})
      const fresh=durable==='localStorage'?JSON.parse(storage.getItem('gym_stash')):readFile('opengym-stash.json')
      const old=durable==='localStorage'?readFile('opengym-stash.json'):JSON.parse(storage.getItem('gym_stash'))
      expect(old).toEqual(stale)
      expect(fresh[stashKey].at).toBeGreaterThan(stale[stashKey].at)
      expect(ids(fresh[stashKey].state)).toContain(newId)
      expect(ids(await store.getState().keptState(home.base,home.uid))).toContain(newId)
      if(durable==='localStorage')expect(h.rejectedNativeStashWrites).toBeGreaterThan(0)
      else expect(refusedLocal).toBeGreaterThan(0)
      expect(readFile('opengym-remote.json').mode).toBe('local')
    }finally{
      vi.stubGlobal('localStorage',storage);h.refuse.delete('opengym-stash.json')
    }
    await home.login()
    await connect(home)
    expect(ids((await home.get()).state)).toContain(newId)
    expect(ids(store.getState().S)).toContain(newId)
    expect(readFile('opengym-stash.json')?.[stashKey]||null).toBe(null)
    expect(localStorage.getItem('gym_stash')).toBeNull()
  }
  console.log('PHASE4_SINGLE_DURABLE_STASH_REPAIR PASS')
  // A fresh store with no localStorage recovers an unsent edit from the native file mirror.
  mode='offline';store.getState().update(s=>{s.workouts.push(work('mirror-only','2026-09-06'))})
  await store.getState().pushState();await vi.advanceTimersByTimeAsync(900)
  expect(ids(readFile('opengym-state.json'))).toContain('mirror-only')
  store.setState({user:null,ready:false});localStorage.clear();mode='online'
  store=await freshStore();await store.getState().boot()
  expect(store.getState().config).toMatchObject({invite_only:true,allow_guest:false,signed_in:true,coach:null})
  expect(store.getState().config.media).toBeFalsy()
  expect(ids((await home.get()).state)).toContain('mirror-only')
  expect(ids(store.getState().S)).toContain('mirror-only')
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
  // No deferred capability endpoint was needed by core boot/adoption/sync/stash/reset.
  const deferred=/^\/api\/(media|watch|coach|integrations|shared|sharing|trainer|tokens|push)(\/|$)/
  expect(seen.filter(x=>deferred.test(x.path))).toEqual([])
  console.log('PHASE4_REAL_STORE_STASH_CONFLICT_RESET PASS')
},240000)
