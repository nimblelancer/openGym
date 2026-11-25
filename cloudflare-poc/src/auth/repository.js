import { mac,equal,randomId,parse,requestToken } from './session.js';
import { randomBytes } from 'node:crypto';
import { MAX_PASSKEYS,transportsOf,passkeyName } from '../../../api/passkeys-store.js';
export { MAX_PASSKEYS };
const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export class AuthRepo{
  constructor(storage,c){
    this.storage=storage;this.sql=storage.sql;this.c=c;
    this.tx(()=>{
      this.q('CREATE TABLE IF NOT EXISTS auth_version (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, closed INTEGER NOT NULL)');
      const v=this.one('SELECT * FROM auth_version WHERE id=1');
      if(v&&v.version!==1)throw Error('unsupported auth schema');
      this.q('CREATE TABLE IF NOT EXISTS auth_users (id TEXT PRIMARY KEY, name TEXT NOT NULL, sv INTEGER NOT NULL, disabled INTEGER NOT NULL)');
      this.q('CREATE TABLE IF NOT EXISTS auth_creds (id TEXT PRIMARY KEY, uid TEXT NOT NULL, key TEXT NOT NULL, counter INTEGER NOT NULL, transports TEXT NOT NULL, name TEXT, created TEXT NOT NULL, lastUsed TEXT)');
      this.q('CREATE TABLE IF NOT EXISTS auth_challenges (id TEXT PRIMARY KEY, data TEXT NOT NULL, exp INTEGER NOT NULL)');
      this.q('CREATE TABLE IF NOT EXISTS auth_codes (kind TEXT PRIMARY KEY, digest TEXT NOT NULL, uid TEXT NOT NULL, sv INTEGER NOT NULL, exp INTEGER NOT NULL)');
      this.q('CREATE TABLE IF NOT EXISTS auth_limits (bucket TEXT PRIMARY KEY, window INTEGER NOT NULL, count INTEGER NOT NULL)');
      this.q('CREATE TABLE IF NOT EXISTS auth_audit (id INTEGER PRIMARY KEY, event TEXT NOT NULL, at INTEGER NOT NULL)');
      if(!v)this.q('INSERT INTO auth_version VALUES(1,1,0)');
    });
  }
  q(s,...args){return this.sql.exec(s,...args).toArray();}
  one(s,...args){return this.q(s,...args)[0]||null;}
  tx(fn){return this.storage.transactionSync(fn);}
  user(id){return this.one('SELECT * FROM auth_users WHERE id=?',id);}
  count(){return this.one('SELECT COUNT(*) AS n FROM auth_users').n;}
  open(){return this.one('SELECT closed FROM auth_version WHERE id=1').closed===0&&this.count()===0;}
  setup(code){return typeof code==='string'&&code.length===64&&equal(mac(this.c.secret,'setup:'+code),this.c.setupDigest);}
  session(req){const t=requestToken(this.c,req.headers);if(!t)return null;const p=parse(this.c,t.token);if(!p)return null;const s={...p,bearer:t.bearer};return this.live(s)?s:null;}
  live(s){if(!s||s.exp<=Date.now())return null;const u=this.user(s.uid);return u&&!u.disabled&&u.sv===s.sv?u:null;}
  creds(uid){return this.q('SELECT * FROM auth_creds WHERE uid=? ORDER BY created,id',uid);}
  cred(id){return typeof id==='string'&&id.length<=2048?this.one('SELECT * FROM auth_creds WHERE id=?',id):null;}
  list(uid){const a=this.creds(uid);return {passkeys:a.map(x=>({id:x.id,name:x.name||null,created:x.created,lastUsed:x.lastUsed||null,transports:JSON.parse(x.transports)})),password:false,lastWayIn:a.length<=1};}
  add(uid,c,body,first=false){
    if(this.cred(c.id))return false;if(this.creds(uid).length>=MAX_PASSKEYS)return false;
    const iso=new Date().toISOString();
    this.q('INSERT INTO auth_creds VALUES(?,?,?,?,?,?,?,?)',c.id,uid,Buffer.from(c.publicKey).toString('base64url'),c.counter,JSON.stringify(transportsOf(body.credential?.response?.transports)),passkeyName(body.name)||null,iso,first?iso:null);return true;
  }
  touch(c,n){const current=this.cred(c.id);if(!current||current.uid!==c.uid||current.key!==c.key||current.counter!==c.counter)return false;this.q('UPDATE auth_creds SET counter=?,lastUsed=? WHERE id=?',n,new Date().toISOString(),c.id);return true;}
  challenge(data){return this.tx(()=>{
    const now=Date.now();this.q('DELETE FROM auth_challenges WHERE exp<=?',now);
    if(this.one('SELECT COUNT(*) AS n FROM auth_challenges').n>=256)return null;
    const id=randomId();this.q('INSERT INTO auth_challenges VALUES(?,?,?)',id,JSON.stringify(data),now+300000);return id;
  });}
  take(id){return this.tx(()=>{if(typeof id!=='string'||id.length>64)return null;const r=this.one('SELECT * FROM auth_challenges WHERE id=?',id);this.q('DELETE FROM auth_challenges WHERE id=?',id);return r&&r.exp>Date.now()?JSON.parse(r.data):null;});}
  throttle(bucket,max){return this.tx(()=>{const now=Math.floor(Date.now()/60000);const r=this.one('SELECT * FROM auth_limits WHERE bucket=?',bucket);const n=r?.window===now?r.count:0;if(n>=max)return false;this.q('INSERT OR REPLACE INTO auth_limits VALUES(?,?,?)',bucket,now,n+1);return true;});}
  code(kind,u){
    const raw=Array.from(randomBytes(kind==='pair'?8:12),b=>alphabet[b%32]).join('');
    const code=kind==='pair'?raw:raw.match(/.{4}/g).join('-'),exp=Date.now()+(kind==='pair'?300000:600000);
    this.q('INSERT OR REPLACE INTO auth_codes VALUES(?,?,?,?,?)',kind,this.digest(kind,code),u.id,u.sv,exp);
    return {code,expires:exp};
  }
  digest(kind,code){if(typeof code!=='string'||code.length>64)return '';const s=kind==='pair'?code.trim().toUpperCase():code.toUpperCase().replace(/[^A-Z0-9]/g,'');return mac(this.c.secret,kind+':'+s);}
  findCode(kind,code){const r=this.one('SELECT * FROM auth_codes WHERE kind=?',kind);return r&&r.exp>Date.now()&&equal(r.digest,this.digest(kind,code))&&this.live({uid:r.uid,sv:r.sv,exp:r.exp})?r:null;}
  revoke(u){this.q('UPDATE auth_users SET sv=sv+1 WHERE id=?',u.id);this.q('DELETE FROM auth_codes WHERE uid=?',u.id);this.q('DELETE FROM auth_challenges');}
  audit(event){this.q('INSERT INTO auth_audit(event,at) VALUES(?,?)',event,Date.now());this.q('DELETE FROM auth_audit WHERE id <= (SELECT MAX(id)-256 FROM auth_audit)');}
  rename(uid,id,name){const c=this.cred(id);if(!c||c.uid!==uid)return false;this.q('UPDATE auth_creds SET name=? WHERE id=?',passkeyName(name)||null,id);return true;}
}
