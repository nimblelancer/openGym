// Real built React SPA, Chromium, local Worker + R2. Synthetic credentials and pixels only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as sleep} from 'node:timers/promises';
import {randomBytes,createHash} from 'node:crypto';
import {localRunner} from './local-runner.mjs';

test('mounted production-built SPA renders a private progress photo and full-size viewer',{timeout:180000},async()=>{
  const AUTH_SECRET=randomBytes(32).toString('hex'),SETUP_CODE=randomBytes(32).toString('hex');
  const runner=await localRunner('wrangler.web-media.jsonc',{health:'/api/health',privateLogs:true,syntheticDiagnostics:true,vars:origin=>({AUTH_SECRET,SETUP_CODE,API_ORIGIN:origin,RP_ID:'localhost',P5_MEDIA:'1'})});
  const dir=await mkdtemp(join(tmpdir(),'opengym-p5-browser-'));let browser,ws,launchError;
  try{
    await runner.start();
    browser=spawn(process.env.CHROME_BIN||'google-chrome',['--headless','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-component-update','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+dir,'--lang=en-US','--window-size=1280,900','about:blank'],{stdio:'ignore',detached:true});
    browser.on('error',e=>launchError=e);
    // Chrome creates DevToolsActivePort before its contents are necessarily
    // readable. Do not break on an empty/partial file or before CDP serves a page.
    let page;
    for(let i=0;i<300;i++){
      if(launchError)throw launchError;
      if(browser.exitCode!==null||browser.signalCode!==null)throw Error('Chrome exited');
      try{
        const lines=(await readFile(join(dir,'DevToolsActivePort'),'utf8')).split('\n');
        const port=Number(lines[0].trim());
        if(/^\d+$/.test(lines[0].trim())&&Number.isInteger(port)&&port>0&&port<=65535&&lines[1]?.startsWith('/devtools/browser/')){
          const response=await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(1000)});
          if(response.ok){
            const targets=await response.json();
            page=targets.find(t=>t.type==='page'&&typeof t.webSocketDebuggerUrl==='string');
            if(page)break;
          }
        }
      }catch{/* startup readiness is retried, not test assertions */}
      await sleep(100);
    }
    assert.ok(page,'Chrome CDP unavailable after readiness polling');
    ws=new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
    let seq=0;const pending=new Map(),network=[];
    ws.addEventListener('message',e=>{const m=JSON.parse(e.data);const cb=pending.get(m.id);if(cb){pending.delete(m.id);m.error?cb.reject(Error(m.error.message)):cb.resolve(m.result);}if(m.method==='Network.responseReceived'){const r=m.params.response;network.push({url:r.url,status:r.status});}});
    const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
    const evaluate=async expression=>{const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw Error('Browser evaluation failed: '+(r.exceptionDetails.text||'exception'));return r.result.value;};
    const wait=async(expr,why)=>{for(let i=0;i<150;i++){try{if(await evaluate(expr))return;}catch{}await sleep(100);}throw Error(why);};
    await cdp('Page.enable');await cdp('Network.enable');await cdp('Network.setCacheDisabled',{cacheDisabled:true});
    // Observe real Web Audio playback without mocking decoding or replacing audio.
    await cdp('Page.addScriptToEvaluateOnNewDocument',{source:`window.__p5AudioStarts=[];
      const original=AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start=function(...args){
        const result=original.apply(this,args);
        if(this.buffer)window.__p5AudioStarts.push({duration:this.buffer.duration,channels:this.buffer.numberOfChannels,peak:Math.max(...this.buffer.getChannelData(0).slice(0,1000).map(Math.abs))});
        return result;
      };`});
    // Prevent page requests to non-fixture addresses. This is a closed local test.
    await cdp('Network.setBlockedURLs',{urls:['https://*','http://*']});
    // CDP blocked URL patterns cannot express an allow-list; use Fetch interception instead.
    await cdp('Network.setBlockedURLs',{urls:[]});
    await cdp('Fetch.enable',{patterns:[{urlPattern:'http*',requestStage:'Request'}]});
    ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Fetch.requestPaused'){const p=m.params;let local=false;try{local=new URL(p.request.url).origin===runner.origin;}catch{}cdp(local?'Fetch.continueRequest':'Fetch.failRequest',local?{requestId:p.requestId}:{requestId:p.requestId,errorReason:'BlockedByClient'}).catch(()=>{});}});
    await cdp('WebAuthn.enable');await cdp('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
    await cdp('Page.navigate',{url:runner.origin+'/'});
    await wait("document.querySelector('#root')?.textContent.includes('Create new profile')",'actual login UI did not mount');
    // Synthetic offline FFmpeg lavfi fixtures, decoded in full with FFmpeg and
    // checked with ffprobe before embedding. CI need not install an encoder.
    // Video: color=c=blue:s=48x32 (MOV 64x32):r=5:d=1, libx264 baseline,
    // yuv420p, faststart, filter_units=remove_types=6; GIF: testsrc 6x4, 4 fps, 1 s.
    const generated={"gif":"R0lGODlhBgAEAPcfMQAAACQAAEgAAGwAAJAAALQAANgAAPwAAAAkACQkAEgkAGwkAJAkALQkANgkAPwkAABIACRIAEhIAGxIAJBIALRIANhIAPxIAABsACRsAEhsAGxsAJBsALRsANhsAPxsAACQACSQAEiQAGyQAJCQALSQANiQAPyQAAC0ACS0AEi0AGy0AJC0ALS0ANi0APy0AADYACTYAEjYAGzYAJDYALTYANjYAPzYAAD8ACT8AEj8AGz8AJD8ALT8ANj8APz8AAAAVSQAVUgAVWwAVZAAVbQAVdgAVfwAVQAkVSQkVUgkVWwkVZAkVbQkVdgkVfwkVQBIVSRIVUhIVWxIVZBIVbRIVdhIVfxIVQBsVSRsVUhsVWxsVZBsVbRsVdhsVfxsVQCQVSSQVUiQVWyQVZCQVbSQVdiQVfyQVQC0VSS0VUi0VWy0VZC0VbS0Vdi0Vfy0VQDYVSTYVUjYVWzYVZDYVbTYVdjYVfzYVQD8VST8VUj8VWz8VZD8VbT8Vdj8Vfz8VQAAqiQAqkgAqmwAqpAAqrQAqtgAqvwAqgAkqiQkqkgkqmwkqpAkqrQkqtgkqvwkqgBIqiRIqkhIqmxIqpBIqrRIqthIqvxIqgBsqiRsqkhsqmxsqpBsqrRsqthsqvxsqgCQqiSQqkiQqmyQqpCQqrSQqtiQqvyQqgC0qiS0qki0qmy0qpC0qrS0qti0qvy0qgDYqiTYqkjYqmzYqpDYqrTYqtjYqvzYqgD8qiT8qkj8qmz8qpD8qrT8qtj8qvz8qgAA/yQA/0gA/2wA/5AA/7QA/9gA//wA/wAk/yQk/0gk/2wk/5Ak/7Qk/9gk//wk/wBI/yRI/0hI/2xI/5BI/7RI/9hI//xI/wBs/yRs/0hs/2xs/5Bs/7Rs/9hs//xs/wCQ/ySQ/0iQ/2yQ/5CQ/7SQ/9iQ//yQ/wC0/yS0/0i0/2y0/5C0/7S0/9i0//y0/wDY/yTY/0jY/2zY/5DY/7TY/9jY//zY/wD8/yT8/0j8/2z8/5D8/7T8/9j8//z8/yH/C05FVFNDQVBFMi4wAwEAAAAh+QQEGQAfACwAAAAABgAEAAAIGAABHMDxA9gxgceA/Th4IOHCAz9w4DMYEAAh+QQFGQAAACwAAAMABgABAAAICgAv+MADT9ihgAAAIfkEBRkAAAAsAAADAAYAAQAACAoAP/AAgI3YkYAAACH5BAUZAAAALAAAAwAGAAEAAAgKAG/owAfN2IGAAAA7","mov":"AAAAFGZ0eXBxdCAgAAACAHF0ICAAAAMObW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAnp0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAEAAAAAgAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAHybWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAoAAAAKAB//wAAAAAALWhkbHIAAAAAbWhscnZpZGUAAAAAAAAAAAAAAAAMVmlkZW9IYW5kbGVyAAABnW1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACxoZGxyAAAAAGRobHJ1cmwgAAAAAAAAAAAAAAAAC0RhdGFIYW5kbGVyAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAABMXN0YmwAAAClc3RzZAAAAAAAAAABAAAAlWF2YzEAAAAAAAAAAQAAAABGRk1QAAACAAAAAgAAQAAgAEgAAABIAAAAAAAAAAEVTGF2YzYxLjE5LjEwMSBsaWJ4MjY0AAAAAAAAAAAAAAAY//8AAAAvYXZjQwFCwAr/4QAXZ0LACtkEWwEQAAADABAAAAMAoPEiZIABAAVoy4PLIAAAABBwYXNwAAAAAQAAAAEAAAAYc3R0cwAAAAAAAAABAAAABQAACAAAAAAUc3RzcwAAAAAAAAABAAAAAQAAABxzdHNjAAAAAAAAAAEAAAABAAAABQAAAAEAAAAoc3RzegAAAAAAAAAAAAAABQAAAB4AAAAKAAAACgAAAAoAAAAKAAAAFHN0Y28AAAAAAAAAAQAAAzIAAAAgdWR0YQAAABipc3dyAAxVxExhdmY2MS43LjEwMwAAAAh3aWRlAAAATm1kYXQAAAAaZYiEBHxGKAAMSMcAAW1o4AAh8ycnJ11114AAAAAGQZo4CPiYAAAABkGaVAI+JgAAAAZBmmAQ8TAAAAAGQZqAP8TA","mp4":"AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAM2bW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAmF0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAADAAAAAgAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAHZbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAoAAAAKABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABhG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAURzdGJsAAAAuHN0c2QAAAAAAAAAAQAAAKhhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAADAAIABIAAAASAAAAAAAAAABFUxhdmM2MS4xOS4xMDEgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAALmF2Y0MBQsAK/+EAFmdCwArZDWwEQAAAAwBAAAADAoPEiZIBAAVoy4PLIAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAAAIYAAAAAAAAABhzdHRzAAAAAAAAAAEAAAAFAAAIAAAAABRzdHNzAAAAAAAAAAEAAAABAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAAFAAAAAQAAAChzdHN6AAAAAAAAAAAAAAAFAAAAHAAAAAoAAAAKAAAACgAAAAkAAAAUc3RjbwAAAAAAAAABAAADZgAAAGF1ZHRhAAAAWW1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALGlsc3QAAAAkqXRvbwAAABxkYXRhAAAAAQAAAABMYXZmNjEuNy4xMDMAAAAIZnJlZQAAAEttZGF0AAAAGGWIhAR8RigADEjHAAFtaOAAIfMnJ1114AAAAAZBmjgI+eAAAAAGQZpUAj54AAAABkGaYBDzwAAAAAVBmoA/zw=="};
    const fixtureDigests={"gif":"08cbe58f215d0fef2f21a812188a5f9a55115d7e8f02710f9b44e1a47ae16f7b","mov":"567f298a2bf9e06c2c55676c83518c32a23c8051e0ff642191bb03c95aa48207","mp4":"0bf40fcb53e4687e533d47780b3c393af7956aaf8ffa7be09187a813ed5e907f"};
    for(const [name,base64] of Object.entries(generated))assert.equal(createHash('sha256').update(Buffer.from(base64,'base64')).digest('hex'),fixtureDigests[name],'embedded fixture integrity: '+name);
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
      // Deterministic 1-second VP8 WebM, 32x32 blue frames, generated offline:
      // ffmpeg -f lavfi -i color=c=blue:s=32x32:r=10:d=1 -c:v libvpx -b:v 30k -an fixture.webm
      const video=new Blob([Uint8Array.from(atob('GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAALQEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEjTbuMU6uEHFO7a1OsggK67AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjEuNy4xMDNXQYxMYXZmNjEuNy4xMDNEiYhAj0AAAAAAABZUrmvIrgEAAAAAAAA/14EBc8WI4e+0tqyUpbucgQAitZyDdW5kiIEAhoVWX1ZQOIOBASPjg4QF9eEA4JCwgSC6gSCagQJVsIRVuYEBElTDZ/tzc59jwIBnyJlFo4dFTkNPREVSRIeMTGF2ZjYxLjcuMTAzc3PWY8CLY8WI4e+0tqyUpbtnyKFFo4dFTkNPREVSRIeUTGF2YzYxLjE5LjEwMSBsaWJ2cHhnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAxLjAwMDAwMDAwMAAfQ7Z1QRHngQCjvYEAAIDQAgCdASogACAAAEcIhYWIhYSIAgICdaoD+AIIIQg9AP7/TRL//FhX8WFfxYV/8WFf/PzO7cX85gCjlYEAZACxAQABEBAAGAAYWC/0AAhwAKOVgQDIALEBAAEQEAAYABhYL/QACHAAo5WBASwAsQEAARAQABgAGFgv9AAIcACjlYEBkACxAQABEBAAGAAYWC/0AAhwAKOVgQH0ALEBAAEQEAAYABhYL/QACHAAo5WBAlgAsQEAARAQABgAGFgv9AAIcACjlYECvACxAQABEBAUYABhYL/QACHAAKOVgQMgALEBAAEQEAAYABhYL/QACHAAo5WBA4QAsQEAARAQABgAGFgv9AAIcAAcU7trkbuPs4EAt4r3gQHxggGj8IED'),x=>x.charCodeAt(0))],{type:'video/webm'});
      const wav=new ArrayBuffer(44+22050*2),v=new DataView(wav);
      const ascii=(offset,text)=>{for(let n=0;n<text.length;n++)v.setUint8(offset+n,text.charCodeAt(n));};
      ascii(0,'RIFF');v.setUint32(4,wav.byteLength-8,true);ascii(8,'WAVEfmt ');v.setUint32(16,16,true);
      v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,22050,true);v.setUint32(28,44100,true);v.setUint16(32,2,true);v.setUint16(34,16,true);ascii(36,'data');v.setUint32(40,44100,true);
      for(let n=0;n<22050;n++)v.setInt16(44+2*n,Math.round(8000*Math.sin(n*2*Math.PI*440/22050)),true);
      const audio=new Blob([wav],{type:'audio/wav'});
      const upload=async b=>{
        const h=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await b.arrayBuffer())),x=>x.toString(16).padStart(2,'0')).join('');
        const resp=await fetch('/api/media/'+h,{method:'PUT',headers:{'Content-Type':b.type,'X-OpenGym-Account':reg.user.id},body:b});
        if(resp.status!==201)throw Error('playback fixture upload '+resp.status);
        return h;
      };
      const videoHash=await upload(video),audioHash=await upload(audio);
      const from64=(data,type)=>new Blob([Uint8Array.from(atob(data),x=>x.charCodeAt(0))],{type});
      const mp4=from64(${JSON.stringify(generated.mp4)},'video/mp4');
      const mov=from64(${JSON.stringify(generated.mov)},'video/quicktime');
      const gif=from64(${JSON.stringify(generated.gif)},'image/gif');
      const wc=document.createElement('canvas');wc.width=20;wc.height=10;wc.getContext('2d').fillRect(0,0,20,10);
      const webp=await new Promise(r=>wc.toBlob(r,'image/webp',0.8));
      if(!webp||webp.type!=='image/webp')throw Error('WebP encode failed');
      const formats=[];
      for(const [file,kind,width,height] of [[mp4,'video',48,32],[mov,'video',64,32],[webp,'image',20,10],[gif,'gif',6,4]]){
        const h=await upload(file);
        formats.push({kind,hash:h,mime:file.type,size:file.size,width,height,at:Date.now(),...(kind==='video'?{dur:1}:{})});
      }
      // Distinct poster for video as well, so the viewer cannot pass by using a photo thumbnail.
      const vc=document.createElement('canvas');vc.width=12;vc.height=12;vc.getContext('2d').fillRect(0,0,12,12);
      const vp=await new Promise(r=>vc.toBlob(r,'image/jpeg',0.8)),videoPosterHash=await upload(vp);
      const videoRef={kind:'video',hash:videoHash,mime:video.type,size:video.size,width:32,height:32,dur:1,codec:'vp8',at:Date.now(),poster:{hash:videoPosterHash,mime:vp.type,size:vp.size,width:12,height:12}};
      const audioRef={kind:'audio',hash:audioHash,mime:audio.type,size:audio.size,width:1,height:1,dur:1,at:Date.now()};
      // Check the actual video range response and byte slice independently of the
      // frontend's intentional download-to-local-store/blob playback path.
      const vr=await fetch('/api/media/'+videoHash,{headers:{Range:'bytes=0-15'}});
      if(vr.status!==206||vr.headers.get('content-range')!=='bytes 0-15/'+video.size)throw Error('video range headers');
      const actual=new Uint8Array(await vr.arrayBuffer()),expected=new Uint8Array(await video.slice(0,16).arrayBuffer());
      if(actual.length!==16||!actual.every((v,n)=>v===expected[n]))throw Error('video range bytes');
      for(const f of formats)f.poster=videoRef.poster;
      const cur=await (await fetch('/api/data')).json();
      const state={...(cur.state||{}),workouts:[{id:'p5-video-workout',name:'Synthetic video workout',d:'2026-09-20',start:1000,end:2000,entries:[],media:[videoRef,...formats]}],routines:[],sound:true,sounds:[{id:'p5-audio',name:'Synthetic WAV',m:audioRef,_ts:Date.now()}],modules:{body:true},dayPhotos:{[hash]:{d:'2026-09-21',m:ref,_ts:Date.now()}}};
      const saved=await fetch('/api/data',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({state,baseRev:cur.rev,baseWid:cur.state?._wid,stamped:true})});
      if(!saved.ok)throw Error('save '+saved.status);
      const readback=await (await fetch('/api/data')).json();
      if(readback.state?.dayPhotos?.[hash]?.m?.poster?.hash!==posterHash)throw Error('saved poster reference missing');
      const media=readback.state?.workouts?.find(w=>w.id==='p5-video-workout')?.media;
      if(!media||media.map(m=>m.hash).join(',')!==[videoHash,...formats.map(m=>m.hash)].join(','))throw Error('saved workout fixture order changed');
      return {hash,posterHash,videoHash,videoPosterHash,audioHash,formats,size:blob.size};
    })()`);
    assert.match(fixture.hash,/^[a-f0-9]{64}$/);assert.ok(fixture.size>0);assert.match(fixture.posterHash,/^[a-f0-9]{64}$/);assert.notEqual(fixture.hash,fixture.posterHash);
    await cdp('Page.navigate',{url:runner.origin+'/?phase5fixture=1#/progress-photos'});
    const photoSelector='.pp-tile[data-day="2026-09-21"]';
    await wait("document.querySelector("+JSON.stringify(photoSelector+" img")+")?.complete && document.querySelector("+JSON.stringify(photoSelector+" img")+").naturalWidth===8",'actual progress photo poster tile did not decode');
    assert.ok(network.some(r=>r.url===runner.origin+'/api/media/'+fixture.posterHash&&r.status===200),'gallery did not fetch private poster from Worker');
    await evaluate('document.querySelector('+JSON.stringify(photoSelector)+').click()');
    await wait("document.querySelector('.mviewer-stage img')?.complete && document.querySelector('.mviewer-stage img').naturalWidth===16",'actual photo viewer did not decode');
    assert.ok(network.some(r=>r.url===runner.origin+'/api/media/'+fixture.hash&&r.status===200),'viewer did not fetch private main image from Worker');
    console.log('PHASE5_MOUNTED_BROWSER_PRIVATE_PHOTO_VIEW PASS');
    // Actual History -> WorkoutDetail -> WorkoutMedia viewer, not a synthetic video element.
    await cdp('Page.navigate',{url:runner.origin+'/?phase5fixture=2#/history'});
    await wait("!!document.querySelector('[data-tour=history-row]')",'actual history row did not mount');
    await evaluate("document.querySelector('[data-tour=history-row]').click()");
    await wait("document.querySelector('.wmedia-item img')?.complete && document.querySelector('.wmedia-item img').naturalWidth===12",'actual workout video poster did not decode');
    assert.ok(network.some(r=>r.url===runner.origin+'/api/media/'+fixture.videoPosterHash&&r.status===200),'video poster not fetched');
    await evaluate("document.querySelector('.wmedia-item').click()");
    await wait("document.querySelector('.mviewer-stage video')?.videoWidth===32 && document.querySelector('.mviewer-stage video').readyState>=2",'actual workout video failed to decode');
    await wait("document.querySelector('.mviewer-stage video').currentTime>0 && !document.querySelector('.mviewer-stage video').paused",'actual workout video did not play');
    assert.ok(network.some(r=>r.url===runner.origin+'/api/media/'+fixture.videoHash&&r.status===200),'video not fetched in full');
    console.log('PHASE5_MOUNTED_BROWSER_VIDEO_PLAYBACK PASS');
    for(const f of fixture.formats){
      await evaluate("document.querySelector('.mviewer-nav button[aria-label=Next]').click()");
      const selector=f.kind==='video'?'.mviewer-stage video':'.mviewer-stage img';
      const expr=f.kind==='video'? "document.querySelector('"+selector+"')?.videoWidth==="+f.width+" && document.querySelector('"+selector+"').readyState>=2 && document.querySelector('"+selector+"').currentTime>0 && !document.querySelector('"+selector+"').paused" : "document.querySelector('"+selector+"')?.complete && document.querySelector('"+selector+"').naturalWidth==="+f.width;
      await wait(expr,'actual mounted '+f.mime+' decode/playback failed');
      assert.ok(network.some(r=>r.url===runner.origin+'/api/media/'+f.hash&&r.status===200),'missing actual '+f.mime+' download');
      if(f.kind==='gif'){
        await evaluate("document.querySelector('.mviewer-stage .exmedia').click()");
        await wait("document.querySelector('.mviewer-stage img')?.naturalWidth===12",'GIF poster pause did not render');
        await evaluate("document.querySelector('.mviewer-stage .exmedia').click()");
        await wait("document.querySelector('.mviewer-stage img')?.naturalWidth===6",'GIF did not resume main image');
      }
      console.log('PHASE5_MOUNTED_FORMAT '+f.mime+' PASS');
    }
    await cdp('Page.navigate',{url:runner.origin+'/?phase5fixture=3#/settings/alerts'});
    await wait("[...document.querySelectorAll('button.lrow')].some(b=>b.querySelector('.lrow-t')?.textContent==='Sound')",'actual sound settings did not mount');
    await evaluate("[...document.querySelectorAll('button.lrow')].find(b=>b.querySelector('.lrow-t')?.textContent==='Sound').click()");
    await wait("!!document.querySelector('[data-own-sound=p5-audio] .own-snd-pick')",'actual custom sound row did not mount');
    // The real App boot ensureSoundFiles fetches and verifies the server WAV into its store.
    for(let n=0;n<150&&!network.some(r=>r.url===runner.origin+'/api/media/'+fixture.audioHash&&r.status===200);n++)await sleep(100);
    assert.ok(network.some(r=>r.url===runner.origin+'/api/media/'+fixture.audioHash&&r.status===200),'custom sound not fetched');
    await evaluate("document.querySelector('[data-own-sound=p5-audio] .own-snd-pick').click()");
    await wait("window.__p5AudioStarts.some(b=>Math.abs(b.duration-1)<0.02&&b.channels===1&&b.peak>0.1)",'actual custom WAV preview did not start decoded audio');
    assert.equal(await evaluate("document.querySelector('[data-own-sound=p5-audio] .own-snd-pick').getAttribute('aria-pressed')"),'true');
    console.log('PHASE5_MOUNTED_BROWSER_WAV_PLAYBACK PASS');
    assert.equal(await evaluate("document.cookie.includes('gymsid')"),false);
    assert.equal(await evaluate("(async()=>{await fetch('/api/logout/all',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});return (await fetch('/api/media/"+fixture.hash+"')).status})()"),401);
    for(const h of [fixture.videoHash,fixture.videoPosterHash,fixture.audioHash,...fixture.formats.map(f=>f.hash)])assert.equal(await evaluate("(async()=> (await fetch('/api/media/"+h+"')).status)()"),401);
    console.log('PHASE5_MOUNTED_BROWSER_PRIVATE_PHOTO PASS');
  }finally{
    ws?.close();
    if(browser?.pid){try{process.kill(-browser.pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}if(browser.exitCode===null&&browser.signalCode===null)await once(browser,'exit');}
    await runner.cleanup();await rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:200});
  }
});
