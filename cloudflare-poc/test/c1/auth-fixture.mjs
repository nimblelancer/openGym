// Independent C1 synthetic pairing fixture, derived from C0 without changing it.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {localRunner} from '../local-runner.mjs';
import {authenticator} from '../auth-fixture.mjs';
import {parse} from './contract.mjs';
import {createServer} from 'node:http';
import {once} from 'node:events';
const secret=()=>randomBytes(32).toString('hex');
export async function server(t,name){
  const AUTH_SECRET=secret(),SETUP_CODE=secret();
  const runner=await localRunner('wrangler.api.jsonc',{health:'/api/health',privateLogs:true,vars:origin=>({AUTH_SECRET,SETUP_CODE,API_ORIGIN:origin,RP_ID:'localhost'})});
  t.after(()=>runner.cleanup());
  await runner.start();
  const dev=authenticator({rp:'localhost',origin:runner.origin});
  let cookie,token;
  const send=async(path,method='GET',wire,auth='bearer')=>{
    const headers={origin:auth==='bearer'?'capacitor://localhost':runner.origin};
    if(auth==='owner'&&cookie)headers.cookie=cookie;
    if(auth==='bearer'&&token)headers.authorization='Bearer '+token;
    if(wire!==undefined)headers['content-type']='application/json';
    const res=await fetch(runner.base+path,{method,headers,body:wire,redirect:'error',signal:AbortSignal.timeout(15000)});
    const raw=await res.text();
    let body;try{body=parse(Buffer.from(raw))}catch{body=null}
    return {status:res.status,body,cookie:res.headers.getSetCookie()[0]?.split(';')[0]};
  };
  const post=async(path,value,auth='owner')=>send(path,'POST',JSON.stringify(value),auth);
  const opt=await post('/api/register/options',{name,code:SETUP_CODE});
  assert.equal(opt.status,200);
  const reg=await post('/api/register/verify',{cid:opt.body.cid,credential:dev.register(opt.body.options.challenge)});
  assert.equal(reg.status,200);cookie=reg.cookie;assert.ok(cookie);
  const login=await post('/api/login/options',{});
  assert.equal(login.status,200);
  const pair=await post('/api/pair/create',{cid:login.body.cid,credential:dev.login(login.body.options.challenge,1)});
  assert.equal(pair.status,200);
  const redeem=await post('/api/pair/redeem',{code:pair.body.code},'none');
  assert.equal(redeem.status,200);token=redeem.body.token;assert.ok(token);
  assert.equal(redeem.body.user.id===reg.body.user.id,true);
  const me=await send('/api/me');assert.equal(me.status,200);assert.equal(me.body.user.id===reg.body.user.id,true);
  return {base:runner.base,uid:reg.body.user.id,send,revoke:()=>post('/api/logout/all',{}),async get(){const r=await send('/api/data');assert.equal(r.status,200);return r.body}};
}

// Actual HTTP disconnect at a local forwarding boundary. Before: no upstream
// dispatch. After: authenticated upstream Worker completed the PUT but the
// requesting client receives no response bytes. No fabricated ACK object.
export async function disconnectTransport(t,s,when){
  let forwarded=0,upstreamStatus=null,received=0,bodyMatched=false;
  let expected;
  const proxy=createServer(async(req,res)=>{
    try{
      const parts=[];for await(const chunk of req)parts.push(chunk);
      const body=Buffer.concat(parts);received=body.length;bodyMatched=body.equals(expected);
      if(when==='after'){forwarded++;const ack=await s.send(req.url,req.method,body.toString('utf8'));upstreamStatus=ack.status}
      req.socket.destroy();
    }catch{req.socket.destroy()}
  });
  proxy.listen(0,'127.0.0.1');await once(proxy,'listening');t.after(()=>{proxy.closeAllConnections();return new Promise(resolve=>proxy.close(resolve))});
  const transport=async(path,method,wire)=>{expected=Buffer.from(wire);await fetch('http://127.0.0.1:'+proxy.address().port+path,{method,body:wire,redirect:'error',signal:AbortSignal.timeout(15000)});throw Error('unexpected response')};
  return {transport,observation:()=>({forwarded,upstreamStatus,received,bodyMatched})};
}
