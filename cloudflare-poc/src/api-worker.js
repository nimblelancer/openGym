// Local-only Phase 3 integrated API. Never deploy this fixture configuration.
import { DurableObject } from 'cloudflare:workers';
import { generateRegistrationOptions,verifyRegistrationResponse,generateAuthenticationOptions,verifyAuthenticationResponse } from '@simplewebauthn/server';
import { config,issue,cookies,csrf,cors,NATIVE,TTL,randomId } from './auth/session.js';
import { AuthRepo,MAX_PASSKEYS } from './auth/repository.js';
import { StateStore,stateResponse,revisionResponse } from './storage/store.js';
import { readBody,HttpInputError,MAX_BODY } from './storage/codec.js';
import { validate,transition } from './sync/transition.js';
import { excusedOn,nudgeFor } from '../../api/nudge.js';
import { isMisconfigured } from '../../api/verify-error.js';
import { CORE } from './auth/routes.js';
import { Presence } from './auth/presence.js';
import { MEDIA_CONFIG,mediaRoute,handleMedia,readMediaJson } from './media.js';
import { MediaLifecycle } from './media-lifecycle.js';
const result=(status,body,token)=>({status,body,token});
const ok=(body={ok:true},token)=>result(200,body,token);
const err=(status,error,code)=>result(status,{error,...(code?{code}:{})});
const denied=()=>err(401,'not signed in');
const expired=()=>err(400,'challenge expired, try again','challenge-expired');
const proofFail=()=>err(403,'the passkey could not be verified','passkey');
const invite=()=>err(403,'a valid invite code is required','invite');
const invalidLink=()=>err(400,'that code is wrong, used or expired','link-invalid');
const limit=()=>err(409,'a profile can have at most '+MAX_PASSKEYS+' passkeys','passkey-limit');
const invalidPair=()=>err(400,'invalid or expired code','pair-invalid');
const publicUser=u=>({id:u.id,name:u.name,admin:true,owner:true});
const text=x=>typeof x==='string'?x:'';
export default {async fetch(req,env){
  const u=new URL(req.url);
  if(!['localhost','127.0.0.1'].includes(u.hostname))return Response.json({error:'local only'},{status:403,headers:{'Cache-Control':'no-store'}});
  try{return await env.AUTH.get(env.AUTH.idFromName('phase3-local-owner')).fetch(req);}
  catch{return Response.json(req.method==='GET'&&u.pathname==='/api/health'?{ok:false,writable:false}:{error:'service unavailable'},{status:503,headers:{'Cache-Control':'no-store'}});}
}};
export class AuthCoordinator extends DurableObject{
  constructor(ctx,env){super(ctx,env);this.c=config(env);this.a=new AuthRepo(ctx.storage,this.c);this.s=new StateStore(ctx.storage);this.storage=ctx.storage;this.presence=new Presence();this.media=env.P5_MEDIA==='1'?env.PRIVATE_MEDIA:null;this.mediaBusy=false;this.lifecycle=this.media?new MediaLifecycle(this.a,this.s,this.media):null;}
  respond(req,r){
    const h=cors(this.c,req);h.set('Content-Type','application/json');
    if(r.token!==undefined)for(const c of cookies(this.c,r.token))h.append('Set-Cookie',c);
    return new Response(JSON.stringify(r.body),{status:r.status,headers:h});
  }
  async fetch(req){
    const u=new URL(req.url),key=req.method+' '+u.pathname;const start=performance.now();
    let r;
    try{
      if(req.method==='OPTIONS'&&u.pathname.startsWith('/api/')){
        const h=cors(this.c,req);if(!h.has('Access-Control-Allow-Origin'))return this.respond(req,err(403,'origin refused'));
        h.set('Access-Control-Allow-Methods','GET,POST,PUT,PATCH,DELETE,OPTIONS');
        h.set('Access-Control-Allow-Headers','Content-Type, Authorization, CF-Access-Client-Id, CF-Access-Client-Secret, X-OpenGym-Account, If-Match, Range');
        h.set('Access-Control-Max-Age','86400');
        if(NATIVE.has(req.headers.get('origin'))&&req.headers.get('access-control-request-private-network')==='true')h.set('Access-Control-Allow-Private-Network','true');
        return new Response(null,{status:204,headers:h});
      }
      // A previously authorized deletion can be resumed without a live session.
      // Health is the explicit recovery trigger; no anonymous request can create an intent.
      const pending=this.lifecycle?.pending();
      if(pending){
        if(key!=='GET /api/health'||this.mediaBusy)return this.respond(req,err(503,'account deletion pending','media-cleanup-pending'));
        this.mediaBusy=true;
        try{if(!await this.lifecycle.finish(pending,uid=>this.removeAccount(uid)))return this.respond(req,err(503,'account deletion pending','media-cleanup-pending'));}
        finally{this.mediaBusy=false;}
      }
      const isMedia=!!this.media&&mediaRoute(req.method,u.pathname);
      if((!CORE.has(key)&&!isMedia)||/%|\\/.test(u.pathname))return this.respond(req,err(404,'not found'));
      const s=this.a.session(req);
      const anonymous=new Set(['GET /api/health','GET /api/config','POST /api/register/options','POST /api/register/verify','POST /api/login/options','POST /api/login/verify','POST /api/pair/redeem','POST /api/device-link/options','POST /api/device-link/verify','POST /api/logout']);
      if(!anonymous.has(key)&&!s)return this.respond(req,denied());
      if(!csrf(this.c,req,key,s))return this.respond(req,result(403,{error:'cross-origin request refused',code:'origin-mismatch',expected:this.c.origin}));
      if(isMedia){
        if(!this.a.live(s))return this.respond(req,denied());
        if(this.mediaBusy)return this.respond(req,err(429,'media busy','busy'));
        if(!this.a.throttle('media',120))return this.respond(req,err(429,'too many media requests'));
        this.mediaBusy=true;
        try{
          const live=()=>this.a.live(s);
          let response;
          if(key==='POST /api/media/sweep'){
            await readMediaJson(req,64*1024);
            const want=req.headers.get('x-opengym-account');
            if(want&&want!==s.uid)return this.respond(req,err(409,'signed in as another account now','account-mismatch'));
            const outcome=await this.lifecycle.sweep(s.uid,live);
            response=Response.json(outcome.body,{status:outcome.status});
          }else{
            response=await handleMedia(req,s.uid,this.media,live);
            if(req.method==='PUT'&&response.ok)this.a.tx(()=>this.lifecycle.touch(s.uid,u.pathname.split('/').at(-1)));
          }
          const h=new Headers(response.headers);
          for(const [k,v] of cors(this.c,req))if(!h.has(k)||k==='vary'||k==='access-control-allow-origin')h.set(k,v);
          h.set('X-POC-Wall-Ms',String(performance.now()-start));
          return new Response(response.body,{status:response.status,headers:h});
        }finally{this.mediaBusy=false;}
      }
      // Fixed buckets cannot be expanded by arbitrary client identifiers; global anonymous auth cap,
      // plus a separate authenticated step-up cap. No trusted remote IP in loopback harness.
      if((/\/(register|login|pair|device-link|passkeys)(\/|$)/.test(u.pathname)||key==='POST /api/account/delete')&&req.method!=='GET'){
        const bucket=s?'owner':'anonymous';if(!this.a.throttle(bucket,s?100:60))return this.respond(req,err(429,'too many attempts'));
      }
      const b=['GET','HEAD'].includes(req.method)?{}:await readBody(req,key==='PUT /api/data'?MAX_BODY:64*1024);
      if(key==='POST /api/account/delete'&&this.media){
        if(this.mediaBusy)return this.respond(req,err(409,'media busy','busy'));
        this.mediaBusy=true;
        try{
          const current=this.a.live(s);
          if(!current)return this.respond(req,denied());
          r=await this.route(req,u,key,s,b);
          if(r.status===200&&this.lifecycle.pending()===current.id){
            if(!await this.lifecycle.finish(current.id,uid=>this.removeAccount(uid)))return this.respond(req,err(503,'account deletion pending','media-cleanup-pending'));
            r=ok({ok:true},null);
          }
        }finally{this.mediaBusy=false;}
      }else r=await this.route(req,u,key,s,b);
    }catch(e){r=e instanceof HttpInputError?err(e.status,e.message):err(503,'service unavailable');}
    const res=this.respond(req,r);res.headers.set('X-POC-Wall-Ms',String(performance.now()-start));return res;
  }
  removeAccount(uid){
    const a=this.a;
    for(const table of ['profile_chunks','profile_state','corrupt_profiles'])a.q('DELETE FROM '+table+' WHERE profile_id=?',uid);
    a.q('DELETE FROM auth_creds WHERE uid=?',uid);a.q('DELETE FROM auth_codes WHERE uid=?',uid);a.q('DELETE FROM auth_challenges');a.q('DELETE FROM auth_users WHERE id=?',uid);a.audit('account-delete');this.presence.clear(uid);
  }
  async registration(u,kind,extra={}){
    const opts=await generateRegistrationOptions({rpName:'openGym',rpID:this.c.rp,userID:Buffer.from(u.id),userName:u.name,userDisplayName:u.name,attestationType:'none',authenticatorSelection:{residentKey:'required',userVerification:'required'},excludeCredentials:this.a.creds(u.id).map(c=>({id:c.id,transports:JSON.parse(c.transports)}))});
    const cid=this.a.challenge({kind,uid:u.id,name:u.name,sv:u.sv,challenge:opts.challenge,...extra});
    return cid?ok({cid,options:opts,...(kind==='link'?{id:u.id,name:u.name}:{})}):err(429,'too many challenges');
  }
  verificationFailure(e){return isMisconfigured(e)?result(400,{error:'passkey origin or RP ID mismatch',code:'origin-mismatch',expected:this.c.origin}):err(400,'passkey verification failed');}
  async newCredential(c,b){
    try{const v=await verifyRegistrationResponse({response:b.credential,expectedChallenge:c.challenge,expectedOrigin:this.c.origin,expectedRPID:this.c.rp,requireUserVerification:true});return v.verified?{credential:v.registrationInfo.credential}:{error:err(400,'not verified')};}catch(e){return {error:this.verificationFailure(e)};}
  }
  async assertion(b){
    const c=this.a.take(b.cid);if(c?.kind!=='login')return {error:expired()};
    const cred=this.a.cred(b.credential?.id);if(!cred)return {error:err(404,'unknown passkey, create a profile first','unknown-credential')};
    const user=this.a.user(cred.uid);if(!user||user.disabled)return {error:err(403,'this account has been disabled','disabled')};
    if(c.uid!==user.id||c.sv!==user.sv)return {error:expired()};
    try{
      const v=await verifyAuthenticationResponse({response:b.credential,expectedChallenge:c.challenge,expectedOrigin:this.c.origin,expectedRPID:this.c.rp,requireUserVerification:true,credential:{id:cred.id,publicKey:Buffer.from(cred.key,'base64url'),counter:cred.counter,transports:JSON.parse(cred.transports)}});
      return v.verified?{cred,user,counter:v.authenticationInfo.newCounter}:{error:err(400,'not verified')};
    }catch(e){return {error:this.verificationFailure(e)};}
  }
  async step(s,b,action){
    if(!b.credential)return err(403,'confirm with your passkey first','passkey-required');
    const p=await this.assertion(b);if(p.error||p.user.id!==s.uid)return proofFail();
    return this.a.tx(()=>{const u=this.a.live(s);if(!u)return denied();
      if(!this.a.touch(p.cred,p.counter))return proofFail();return action(u);
    });
  }
  async route(req,url,key,s,b){
    const a=this.a,c=this.c,live=()=>a.live(s);
    if(key==='GET /api/health'){
      // A real write in a rolled-back transaction probes storage without accumulating health rows.
      try{a.tx(()=>{a.q('UPDATE auth_version SET version=version WHERE id=1');throw Error('health-rollback');});}catch(e){if(e.message!=='health-rollback')return result(503,{ok:false,writable:false});}
      return ok({ok:true,users:a.count(),writable:true});
    }
    if(key==='GET /api/config')return ok({invite_only:true,allow_guest:false,signed_in:!!live(),...(live()?{coach:null,...(this.media?{media:{...MEDIA_CONFIG,resetRequiresVerifiedBackup:true}}:{})}:{})});
    if(key==='POST /api/register/options'){
      const name=text(b.name).trim().slice(0,40);if(!name)return err(400,'name required');
      if(!a.open()||!a.setup(text(b.code).trim().toLowerCase()))return invite();
      return this.registration({id:randomId(12),name,sv:0},'register',{setupDigest:c.setupDigest});
    }
    if(key==='POST /api/register/verify'){
      const ch=a.take(b.cid);if(ch?.kind!=='register')return expired();
      const checked=await this.newCredential(ch,b);if(checked.error)return checked.error;const cred=checked.credential;
      return a.tx(()=>{
        if(!a.open()||ch.setupDigest!==c.setupDigest)return invite();
        if(a.cred(cred.id))return err(409,'credential already registered');
        a.q('INSERT INTO auth_users VALUES(?,?,0,0)',ch.uid,ch.name);
        if(!a.add(ch.uid,cred,b,true))throw Error('credential insert failed');
        a.q('UPDATE auth_version SET closed=1 WHERE id=1');a.audit('register');
        const u=a.user(ch.uid);return ok({user:publicUser(u)},issue(c,u,'c'));
      });
    }
    if(key==='POST /api/login/options'){
      const options=await generateAuthenticationOptions({rpID:c.rp,userVerification:'required',allowCredentials:[]});
      const owner=a.one('SELECT id,sv FROM auth_users LIMIT 1');
      const cid=a.challenge({kind:'login',challenge:options.challenge,uid:owner?.id||null,sv:owner?.sv??null});
      return cid?ok({cid,options}):err(429,'too many challenges');
    }
    if(key==='POST /api/login/verify'){
      const p=await this.assertion(b);if(p.error)return p.error;
      return a.tx(()=>{const u=a.user(p.user.id);if(!u||u.disabled||u.sv!==p.user.sv||!a.touch(p.cred,p.counter))return err(400,'passkey verification failed');
        a.audit('login');return ok({user:publicUser(u)},issue(c,u,'c'));});
    }
    if(key==='GET /api/me'){
      const u=live();if(!u)return denied();
      return ok({user:publicUser(u),...(s.bearer&&s.kind==='b'&&s.exp-Date.now()<TTL/2?{token:issue(c,u,'b')}:{})});
    }
    if(key==='POST /api/logout')return ok({ok:true},null);
    if(key==='POST /api/logout/all')return a.tx(()=>{const u=live();if(!u)return denied();a.revoke(u);this.presence.clear(u.id);a.audit('logout-all');return ok({ok:true},null);});
    if(key==='POST /api/pair/create'||key==='POST /api/account/device-link'){
      const pair=key.includes('/pair/');
      if(!pair&&a.creds(s.uid).length>=MAX_PASSKEYS)return limit();
      return this.step(s,b,u=>{if(!pair&&a.creds(u.id).length>=MAX_PASSKEYS)return limit();const code=a.code(pair?'pair':'link',u);a.audit(pair?'pair-create':'link-create');return ok(pair?{code:code.code}:code);});
    }
    if(key==='POST /api/pair/redeem')return a.tx(()=>{
      const p=a.findCode('pair',b.code);if(!p)return invalidPair();
      a.q('DELETE FROM auth_codes WHERE kind=?','pair');const u=a.user(p.uid);a.audit('pair-redeem');return ok({token:issue(c,u,'b'),user:publicUser(u)});
    });
    if(key==='GET /api/account/passkeys')return live()?ok(a.list(s.uid)):denied();
    if(key==='POST /api/account/passkeys/options'){
      if(a.creds(s.uid).length>=MAX_PASSKEYS)return limit();
      const proof=await this.step(s,b,u=>ok({u}));if(proof.status!==200)return proof;
      return this.registration(proof.body.u,'add');
    }
    if(key==='POST /api/device-link/options'){
      const link=a.findCode('link',b.code);if(!link)return invalidLink();const u=a.user(link.uid);
      if(a.creds(u.id).length>=MAX_PASSKEYS)return limit();return this.registration(u,'link',{digest:link.digest});
    }
    if(key==='POST /api/account/passkeys/verify'||key==='POST /api/device-link/verify'){
      const link=key.includes('/device-link/'),ch=a.take(b.cid);
      if(!ch||ch.kind!==(link?'link':'add')||(!link&&ch.uid!==s.uid))return expired();
      if(link){const p=a.findCode('link',b.code);if(!p||p.digest!==ch.digest||p.uid!==ch.uid)return invalidLink();}
      const checked=await this.newCredential(ch,b);if(checked.error)return checked.error;const cred=checked.credential;
      return a.tx(()=>{
        const u=a.user(ch.uid);if(!u||u.disabled||u.sv!==ch.sv||(!link&&!live()))return denied();
        if(link){const p=a.findCode('link',b.code);if(!p||p.digest!==ch.digest||p.uid!==ch.uid)return invalidLink();}
        if(a.cred(cred.id))return err(409,'credential already registered','credential-exists');
        if(a.creds(u.id).length>=MAX_PASSKEYS)return limit();
        if(!a.add(u.id,cred,b,link))throw Error('credential insert failed');
        if(link)a.q('DELETE FROM auth_codes WHERE kind=?','link');a.audit('passkey-add');
        return link?ok({user:publicUser(u)},issue(c,u,'c')):ok({ok:true,...a.list(u.id)});
      });
    }
    if(key==='POST /api/account/passkeys/rename')return a.tx(()=>{const u=live();if(!u)return denied();return a.rename(u.id,b.id,b.name)?ok({ok:true,...a.list(u.id)}):err(404,'passkey not found','not-found');});
    if(key==='DELETE /api/account/passkeys'){
      const id=url.searchParams.get('id'),check=u=>{if(!a.creds(u.id).some(x=>x.id===id))return err(404,'passkey not found','not-found');if(a.creds(u.id).length<=1)return err(409,'this passkey is the only way into this profile','last-way-in');};
      const u=live();if(!u)return denied();const refusal=check(u);if(refusal)return refusal;
      return this.step(s,b,u=>{const refusal=check(u);if(refusal)return refusal;a.q('DELETE FROM auth_creds WHERE id=? AND uid=?',id,u.id);a.q('DELETE FROM auth_codes WHERE kind=?','link');a.audit('passkey-remove');return ok({ok:true,...a.list(u.id)});});
    }
    if(key==='GET /api/data'||key==='GET /api/data/rev'){
      if(!live())return denied();
      return key.endsWith('/rev')?revisionResponse(await this.s.revision(s.uid)):stateResponse(await this.s.read(s.uid));
    }
    if(key==='PUT /api/data'){
      // Upstream treats every state PUT 409 as a revision conflict with a server document.
      if(this.mediaBusy)return err(503,'media busy','busy');
      try{return a.tx(()=>{if(!live())return denied();const invalid=validate(b);if(invalid)return invalid;
        const next=transition(this.s.current(s.uid),b);if(next.next){this.s.save(s.uid,next.next);this.lifecycle?.noteState(s.uid,next.next);}return {status:next.status,body:next.body};
      });}catch(e){return this.s.error(s.uid,e).kind==='too_large'?err(413,'state too large after stamping'):err(503,'state unreadable');}
    }
    if(key==='POST /api/account/delete'){
      const check=u=>typeof b.name==='string'&&b.name.trim()===u.name;
      const u=live();if(!u)return denied();if(!check(u))return err(400,'type the account name to confirm','confirm-name');
      const remove=u=>{
        if(!check(u))return err(400,'type the account name to confirm','confirm-name');
        if(this.lifecycle){this.lifecycle.begin(u.id);return ok({ok:true});}
        this.removeAccount(u.id);return ok({ok:true},null);
      };
      if(s.bearer&&s.kind==='b')return a.tx(()=>{const u=live();return u?remove(u):denied();});
      return this.step(s,b,remove);
    }
    if(key==='POST /api/activity'){const u=live();if(!u)return denied();this.presence.update(u.id,b);return ok();}
    if(key==='GET /api/nudge-check'){
      if(!live())return denied();const date=url.searchParams.get('date')||'';
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date+'T00:00:00Z')))return err(400,'date must be YYYY-MM-DD','date-invalid');
      const r=await this.s.read(s.uid);if(!['missing','ok'].includes(r.kind))return err(503,'state unreadable');
      const doc=r.state||{},done=(Array.isArray(doc.workouts)&&doc.workouts.some(w=>w?.d===date))||excusedOn(doc,date);
      return ok({date,done,nudge:!done&&!!nudgeFor(doc,date),rev:doc._rev||0});
    }
    return err(404,'not found');
  }
}
