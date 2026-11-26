import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as sleep} from 'node:timers/promises';
import {fixture} from './auth-test-helpers.mjs';
test('Chrome CDP virtual resident passkey on localhost, actual browser cookie',{timeout:120000},async()=>{
  const {runner,SETUP_CODE}=await fixture();const dir=await mkdtemp(join(tmpdir(),'opengym-chrome-'));let browser,ws;
  try{
    await runner.start();
    browser=spawn(process.env.CHROME_BIN||'google-chrome',['--headless','--no-sandbox','--disable-dev-shm-usage','--remote-debugging-port=0','--user-data-dir='+dir,'about:blank'],{stdio:'ignore',detached:true});
    let launchError;browser.on('error',e=>launchError=e);
    let port;for(let i=0;i<300;i++){if(launchError)throw launchError;if((browser.exitCode!==null||browser.signalCode!==null))throw Error('Chrome exited');try{port=(await readFile(join(dir,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{}await sleep(100);}
    assert.ok(port,'Chrome CDP unavailable');
    const targets=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json(),page=targets.find(t=>t.type==='page');assert.ok(page);
    ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
    let seq=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);const cb=pending.get(m.id);if(cb){pending.delete(m.id);m.error?cb.reject(Error(m.error.message)):cb.resolve(m.result);}});
    const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
    const evalJS=async expression=>{const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
    await cdp('Page.enable');await cdp('WebAuthn.enable');await cdp('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
    await cdp('Page.navigate',{url:runner.origin+'/api/health'});
    let ready=false;for(let i=0;i<100;i++){try{ready=await evalJS("location.origin==="+JSON.stringify(runner.origin)+"&&document.readyState==='complete'");if(ready)break;}catch{}await sleep(100);}assert.ok(ready);
    const result=await evalJS(`(async()=>{
      const post=async(p,b)=>{const r=await fetch(p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});if(!r.ok)throw Error(p+' '+r.status);return r.json();};
      const reg=await post('/api/register/options',{name:'Browser fixture',code:${JSON.stringify(SETUP_CODE)}});
      const credential=await navigator.credentials.create({publicKey:PublicKeyCredential.parseCreationOptionsFromJSON(reg.options)});
      const created=await post('/api/register/verify',{cid:reg.cid,credential:credential.toJSON()});
      const me=await (await fetch('/api/me')).json();
      await post('/api/logout',{});
      const gone=(await fetch('/api/me')).status;
      const login=await post('/api/login/options',{});
      const assertion=await navigator.credentials.get({publicKey:PublicKeyCredential.parseRequestOptionsFromJSON(login.options)});
      const logged=await post('/api/login/verify',{cid:login.cid,credential:assertion.toJSON()});
      return {created:created.user.name,me:me.user.name,gone,logged:logged.user.name,httpOnly:!document.cookie.includes('gymsid')};
    })()`);
    assert.deepEqual(result,{created:'Browser fixture',me:'Browser fixture',gone:401,logged:'Browser fixture',httpOnly:true});console.log('PHASE3_BROWSER_VIRTUAL_PASSKEY PASS');
  }finally{ws?.close();if(browser&&browser.exitCode===null&&browser.pid){const done=once(browser,'exit');try{process.kill(-browser.pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}await done;}await runner.cleanup();await rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
});

test('manual localhost UI and proxy smoke with Chrome virtual authenticator',{timeout:150000},async()=>{
  const dir=await mkdtemp(join(tmpdir(),'opengym-manual-browser-'));let browser,ws,launcher;
  try{
    launcher=spawn(process.execPath,['test/manual-passkey.mjs'],{stdio:['ignore','pipe','pipe']});
    let output='',launcherError;launcher.on('error',e=>launcherError=e);launcher.stdout.on('data',b=>{output=(output+b).slice(-8000);});launcher.stderr.resume();
    let origin,code;
    for(let i=0;i<300;i++){
      if(launcherError)throw Error('manual launcher failed');if(launcher.exitCode!==null)throw Error('manual launcher exited');
      origin=output.match(/Open in a separate browser profile: (http:\/\/localhost:\d+)/)?.[1];
      code=output.match(/Disposable setup code \(local terminal only\): ([a-f0-9]{64})/)?.[1];if(origin&&code)break;await sleep(100);
    }
    assert.ok(origin&&code,'manual launcher readiness timeout');
    // Use the same localhost authority as the browser; Fetch does not reliably permit Host overrides.
    const health=await fetch(origin+'/api/health');assert.equal(health.status,200);
    browser=spawn(process.env.CHROME_BIN||'google-chrome',['--headless','--no-sandbox','--disable-dev-shm-usage','--remote-debugging-port=0','--user-data-dir='+dir,'about:blank'],{stdio:'ignore',detached:true});
    let launchError;browser.on('error',e=>launchError=e);
    let port;for(let i=0;i<300;i++){if(launchError)throw launchError;if((browser.exitCode!==null||browser.signalCode!==null))throw Error('Chrome exited');try{port=(await readFile(join(dir,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{}await sleep(100);}
    assert.ok(port,'Chrome CDP unavailable');
    const targets=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json(),page=targets.find(t=>t.type==='page');assert.ok(page);
    ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
    let seq=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);const cb=pending.get(m.id);if(cb){pending.delete(m.id);m.error?cb.reject(Error(m.error.message)):cb.resolve(m.result);}});
    const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
    const evalJS=async expression=>{const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
    await cdp('Page.enable');await cdp('WebAuthn.enable');await cdp('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
    await cdp('Page.navigate',{url:origin+'/'});
    let ready=false;for(let i=0;i<100;i++){try{ready=await evalJS("location.origin==="+JSON.stringify(origin)+"&&document.readyState==='complete'");if(ready)break;}catch{}await sleep(100);}assert.ok(ready);

    await evalJS("document.getElementById('setup').value="+JSON.stringify(code));
    const click=async(id,expected)=>{
      await evalJS("document.getElementById("+JSON.stringify(id)+").click()");
      let ok=false;for(let i=0;i<150;i++){ok=await evalJS("!document.getElementById("+JSON.stringify(id)+").disabled && document.getElementById('status').textContent.includes("+JSON.stringify(expected)+")");if(ok)break;await sleep(100);}
      assert.ok(ok,'manual UI step failed: '+id);
    };
    await click('register','Registration completed');
    await click('me','Session cookie not readable in JS: true');
    await click('write','Synthetic workout saved.');
    await click('logout','POST /api/logout 200');
    await click('me','GET /api/me 401');
    await click('login','Login completed');
    await click('read','Synthetic workout present: true');
    await click('all','POST /api/logout/all 200');
    console.log('PHASE3_MANUAL_HARNESS_VIRTUAL_SMOKE PASS');
  }finally{
    ws?.close();
    if(browser&&browser.exitCode===null&&browser.pid){const done=once(browser,'exit');try{process.kill(-browser.pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}await done;}
    if(launcher&&launcher.exitCode===null&&launcher.pid){const done=once(launcher,'exit');launcher.kill('SIGTERM');await done;}
    await rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:200});
  }
});
