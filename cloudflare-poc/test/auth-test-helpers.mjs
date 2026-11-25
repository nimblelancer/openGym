import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {localRunner} from './local-runner.mjs';
import {config} from '../src/auth/session.js';
export const secret=()=>randomBytes(32).toString('hex');
export const fixture=async(options={})=>{
  const AUTH_SECRET=secret(),SETUP_CODE=secret();
  const runner=await localRunner('wrangler.api.jsonc',{health:'/api/health',privateLogs:true,...options,vars:origin=>({AUTH_SECRET,SETUP_CODE,API_ORIGIN:origin,RP_ID:'localhost',...(options.vars?.(origin)||{})})});
  const call=async(path,method='GET',body,headers={})=>{
    const r=await fetch(runner.base+path,{method,headers:{...(!['GET','HEAD','OPTIONS'].includes(method)?{origin:runner.origin}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});
    const data=r.status===204?null:await r.json();
    console.log(method,path.split('?')[0],r.status,'local wall ms:',r.headers.get('x-poc-wall-ms'));
    return {status:r.status,data,cookies:r.headers.getSetCookie(),headers:r.headers};
  };
  return {runner,call,SETUP_CODE,c:config({AUTH_SECRET,SETUP_CODE,API_ORIGIN:runner.origin,RP_ID:'localhost'})};
};
export const bodyOf=r=>{assert.equal(r.status,200);return r.data;};
export const cookieOf=r=>{assert.equal(r.status,200);assert.ok(r.cookies.length);assert.match(r.cookies[0],/HttpOnly/);return {cookie:r.cookies[0].split(';')[0]};};
export const post=(call,path,b={},h={})=>call(path,'POST',b,h);
