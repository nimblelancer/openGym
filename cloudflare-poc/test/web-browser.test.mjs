// Real built React SPA, Chromium, local Worker + R2. Synthetic credentials and pixels only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as sleep} from 'node:timers/promises';
import {randomBytes} from 'node:crypto';
import {localRunner} from './local-runner.mjs';

test('mounted production-built SPA renders a private progress photo and full-size viewer',{timeout:180000},async()=>{
  const AUTH_SECRET=randomBytes(32).toString('hex'),SETUP_CODE=randomBytes(32).toString('hex');
  const runner=await localRunner('wrangler.web-media.jsonc',{health:'/api/health',privateLogs:true,syntheticDiagnostics:true,vars:origin=>({AUTH_SECRET,SETUP_CODE,API_ORIGIN:origin,RP_ID:'localhost',P5_MEDIA:'1'})});
  const dir=await mkdtemp(join(tmpdir(),'opengym-p5-browser-'));let browser,ws,launchError;
  try{
    await runner.start();
    browser=spawn(process.env.CHROME_BIN||'google-chrome',['--headless','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-component-update','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+dir,'--lang=en-US','--window-size=1280,900','about:blank'],{stdio:'ignore',detached:true});
    browser.on('error',e=>launchError=e);
    let port;
    for(let i=0;i<300;i++){if(launchError)throw launchError;if(browser.exitCode!==null||browser.signalCode!==null)throw Error('Chrome exited');try{port=(await readFile(join(dir,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{}await sleep(100);}
    assert.ok(port,'Chrome CDP unavailable');
    const targets=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json(),page=targets.find(t=>t.type==='page');assert.ok(page);
    ws=new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
    let seq=0;const pending=new Map(),network=[];
    ws.addEventListener('message',e=>{const m=JSON.parse(e.data);const cb=pending.get(m.id);if(cb){pending.delete(m.id);m.error?cb.reject(Error(m.error.message)):cb.resolve(m.result);}if(m.method==='Network.responseReceived'){const r=m.params.response;network.push({url:r.url,status:r.status});}});
    const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
    const evaluate=async expression=>{const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw Error('Browser evaluation failed: '+(r.exceptionDetails.text||'exception'));return r.result.value;};
    const wait=async(expr,why)=>{for(let i=0;i<150;i++){try{if(await evaluate(expr))return;}catch{}await sleep(100);}throw Error(why);};
    await cdp('Page.enable');await cdp('Network.enable');await cdp('Network.setCacheDisabled',{cacheDisabled:true});
    // Prevent page requests to non-fixture addresses. This is a closed local test.
    await cdp('Network.setBlockedURLs',{urls:['https://*','http://*']});
    // CDP blocked URL patterns cannot express an allow-list; use Fetch interception instead.
    await cdp('Network.setBlockedURLs',{urls:[]});
    await cdp('Fetch.enable',{patterns:[{urlPattern:'http*',requestStage:'Request'}]});
    ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Fetch.requestPaused'){const p=m.params;let local=false;try{local=new URL(p.request.url).origin===runner.origin;}catch{}cdp(local?'Fetch.continueRequest':'Fetch.failRequest',local?{requestId:p.requestId}:{requestId:p.requestId,errorReason:'BlockedByClient'}).catch(()=>{});}});
    await cdp('WebAuthn.enable');await cdp('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
    await cdp('Page.navigate',{url:runner.origin+'/'});
    await wait("document.querySelector('#root')?.textContent.includes('Create new profile')",'actual login UI did not mount');
    const fixture=await evaluate(`(async()=>{
      const post=async(p,b)=>{const r=await fetch(p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});if(!r.ok)throw Error('POST '+p+' '+r.status);return r.json();};
      const o=await post('/api/register/options',{name:'Synthetic browser',code:${JSON.stringify(SETUP_CODE)}});
      const cred=await navigator.credentials.create({publicKey:PublicKeyCredential.parseCreationOptionsFromJSON(o.options)});
      const reg=await post('/api/register/verify',{cid:o.cid,credential:cred.toJSON()});
      const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;const ctx=canvas.getContext('2d');ctx.fillStyle='#3478a1';ctx.fillRect(0,0,16,16);
      const blob=await new Promise(r=>canvas.toBlob(r,'image/png')),bytes=await blob.arrayBuffer();
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
      const put=await fetch('/api/media/'+hash,{method:'PUT',headers:{'Content-Type':'image/png','X-OpenGym-Account':reg.user.id},body:blob});
      if(put.status!==201)throw Error('upload '+put.status);
      // The actual photo ingest always supplies a JPEG/WebP poster. CustomThumb reads
      // only that poster, while MediaView reads the main image. Keep distinct hashes.
      const thumb=document.createElement('canvas');thumb.width=8;thumb.height=8;
      thumb.getContext('2d').drawImage(canvas,0,0,8,8);
      const poster=await new Promise(r=>thumb.toBlob(r,'image/jpeg',0.8));
      if(!poster||poster.type!=='image/jpeg')throw Error('poster encode failed');
      const posterHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await poster.arrayBuffer())),x=>x.toString(16).padStart(2,'0')).join('');
      if(posterHash===hash)throw Error('main and poster must be distinct');
      const putPoster=await fetch('/api/media/'+posterHash,{method:'PUT',headers:{'Content-Type':poster.type,'X-OpenGym-Account':reg.user.id},body:poster});
      if(putPoster.status!==201)throw Error('poster upload '+putPoster.status);
      const ref={kind:'image',hash,mime:'image/png',size:blob.size,width:16,height:16,at:Date.now(),poster:{hash:posterHash,mime:poster.type,size:poster.size,width:8,height:8}};
      const cur=await (await fetch('/api/data')).json();
      const state={...(cur.state||{}),workouts:[],routines:[],modules:{body:true},dayPhotos:{[hash]:{d:'2026-09-20',m:ref,_ts:Date.now()}}};
      const saved=await fetch('/api/data',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({state,baseRev:cur.rev,baseWid:cur.state?._wid,stamped:true})});
      if(!saved.ok)throw Error('save '+saved.status);
      const readback=await (await fetch('/api/data')).json();
      if(readback.state?.dayPhotos?.[hash]?.m?.poster?.hash!==posterHash)throw Error('saved poster reference missing');
      return {hash,posterHash,size:blob.size};
    })()`);
    assert.match(fixture.hash,/^[a-f0-9]{64}$/);assert.ok(fixture.size>0);assert.match(fixture.posterHash,/^[a-f0-9]{64}$/);assert.notEqual(fixture.hash,fixture.posterHash);
    await cdp('Page.navigate',{url:runner.origin+'/?phase5fixture=1#/progress-photos'});
    await wait("document.querySelector('.pp-tile img')?.complete && document.querySelector('.pp-tile img').naturalWidth===8",'actual progress photo poster tile did not decode');
    assert.ok(network.some(r=>r.url===runner.origin+'/api/media/'+fixture.posterHash&&r.status===200),'gallery did not fetch private poster from Worker');
    await evaluate("document.querySelector('.pp-tile').click()");
    await wait("document.querySelector('.mviewer-stage img')?.complete && document.querySelector('.mviewer-stage img').naturalWidth===16",'actual photo viewer did not decode');
    assert.ok(network.some(r=>r.url===runner.origin+'/api/media/'+fixture.hash&&r.status===200),'viewer did not fetch private main image from Worker');
    assert.equal(await evaluate("document.cookie.includes('gymsid')"),false);
    assert.equal(await evaluate("(async()=>{await fetch('/api/logout/all',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});return (await fetch('/api/media/"+fixture.hash+"')).status})()"),401);
    console.log('PHASE5_MOUNTED_BROWSER_PRIVATE_PHOTO PASS');
  }finally{
    ws?.close();
    if(browser?.pid){try{process.kill(-browser.pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}if(browser.exitCode===null&&browser.signalCode===null)await once(browser,'exit');}
    await runner.cleanup();await rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:200});
  }
});
