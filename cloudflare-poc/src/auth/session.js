import { createHmac,timingSafeEqual,randomBytes } from 'node:crypto';
export const TTL=90*86400000;
export const randomId=(n=16)=>randomBytes(n).toString('base64url');
export function mac(secret,value){return createHmac('sha256',secret).update(value).digest('base64url');}
export function equal(a,b){return typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));}
export function config(env){
  const secret=env.AUTH_SECRET, setup=env.SETUP_CODE,origin=env.API_ORIGIN,rp=env.RP_ID;
  if(typeof secret!=='string'||!/^[a-f0-9]{64}$/.test(secret)||new Set(secret).size<8||typeof setup!=='string'||!/^[a-f0-9]{64}$/.test(setup)||new Set(setup).size<8||secret===setup)throw Error('missing or invalid local secret');
  const u=new URL(origin);
  if(!['http:','https:'].includes(u.protocol)||u.origin!==origin||u.hostname!==rp||!['localhost','127.0.0.1'].includes(rp))throw Error('invalid local origin');
  return {secret,setupDigest:mac(secret,'setup:'+setup),origin,rp,secure:u.protocol==='https:'};
}
export function issue(c,user,kind,now=Date.now()){
  if(!['b','c'].includes(kind))throw Error('invalid kind');
  const p=[user.id,now+TTL,user.sv,kind].join(':');return p+'.'+mac(c.secret,p);
}
export function parse(c,token,now=Date.now()){
  if(typeof token!=='string'||token.length>512)return null;
  const m=token.match(/^([A-Za-z0-9_-]{16}):([0-9]{1,16}):([0-9]{1,12}):([bc])\.([A-Za-z0-9_-]{43})$/);
  if(!m||!equal(m[5],mac(c.secret,token.slice(0,token.lastIndexOf('.')))))return null;
  const exp=Number(m[2]),sv=Number(m[3]);if(!Number.isSafeInteger(exp)||!Number.isSafeInteger(sv)||exp<=now)return null;
  return {uid:m[1],exp,sv,kind:m[4]};
}
export function requestToken(c,headers){
  const accepted=new Set(c.secure?['__Host-gymsid','gymsid']:['gymsid']);
  const found=[];
  for(const part of (headers.get('cookie')||'').split(';')){
    const i=part.indexOf('=');if(i<0)continue;
    if(accepted.has(part.slice(0,i).trim()))found.push(part.slice(i+1).trim());
  }
  const auth=headers.get('authorization');
  if(found.length>1||found.length&&auth)return null;
  if(found.length)return {token:found[0],bearer:false};
  if(auth?.startsWith('Bearer '))return {token:auth.slice(7).trim(),bearer:true};
  return null;
}
export function cookies(c,token){
  const suffix='; Path=/; HttpOnly;'+(c.secure?' Secure;':'')+' SameSite=Lax';
  const expire=n=>n+'=; Max-Age=0'+suffix;
  const n=c.secure?'__Host-gymsid':'gymsid';
  return token?[n+'='+token+'; Max-Age='+TTL/1000+suffix,...(c.secure?[expire('gymsid')]:[])]:[expire(n),...(c.secure?[expire('gymsid')]:[])];
}
export const NATIVE=new Set(['https://localhost','capacitor://localhost','http://localhost']);
export function csrf(c,req,key,s){
  if(['GET','HEAD','OPTIONS'].includes(req.method)||key==='POST /api/pair/redeem')return true;
  const signIn=/^POST \/api\/(register|login|device-link)\//.test(key);
  if(!signIn&&s?.bearer&&s.kind==='b')return true;
  const origin=req.headers.get('origin'),site=req.headers.get('sec-fetch-site');
  if(origin&&origin!==c.origin)return false;
  return !site||site==='same-origin'||site==='none';
}
export function cors(c,req){
  const o=req.headers.get('origin'),h=new Headers({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'});
  if(o&&(o===c.origin||NATIVE.has(o)))h.set('Access-Control-Allow-Origin',o);
  return h;
}
