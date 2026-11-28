// C1 isolated contract; never imported by shipped code.
import { createHash, randomBytes } from 'node:crypto';
export const LIMIT = Object.freeze({bytes:1048576,depth:64,names:512,total:16777216,io:15000,operation:180000});
export const reject = () => { throw Error('C1 invalid or unsupported evidence'); };
export const requireThat = x => { if (!x) reject(); };
export const obj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
export const id = () => randomBytes(32).toString('hex');
export const hex = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
export const wid = x => typeof x === 'string' && /^[a-f0-9]{16}$/.test(x);
export const uint = x => Number.isSafeInteger(x) && x >= 0 && !Object.is(x,-0);
export const str = x => typeof x === 'string' && !/[\uD800-\uDFFF]/u.test(x);
const keyOK = x => str(x) && !['__proto__','constructor','prototype'].includes(x);
export const sha = b => createHash('sha256').update(b).digest('hex');
export const D = (label,b) => createHash('sha256').update('opengym.stash.v1/'+label+'\0').update(b).digest('hex');
export function canonical(v) {
  let bytes=0; const parts=[], seen=new Set();
  const emit=s=>{bytes+=Buffer.byteLength(s);requireThat(bytes<=LIMIT.bytes);parts.push(s)};
  function walk(x,d) {
    requireThat(d<=LIMIT.depth);
    if(x===null||typeof x==='boolean'){emit(JSON.stringify(x));return}
    if(typeof x==='string'){requireThat(str(x));emit(JSON.stringify(x));return}
    if(typeof x==='number'){requireThat(Number.isFinite(x)&&(!Number.isInteger(x)||Number.isSafeInteger(x))&&!Object.is(x,-0));emit(JSON.stringify(x));return}
    requireThat(x&&typeof x==='object'&&!seen.has(x));seen.add(x);
    const a=Array.isArray(x);const keys=Object.keys(x);
    requireThat(a?keys.length===x.length&&Reflect.ownKeys(x).length===x.length+1:
      [Object.prototype,null].includes(Object.getPrototypeOf(x))&&Reflect.ownKeys(x).length===keys.length);
    emit(a?'[':'{');
    const ks=a?Array.from({length:x.length},(_,i)=>String(i)):keys.sort();
    for(let i=0;i<ks.length;i++){
      const k=ks[i],p=Object.getOwnPropertyDescriptor(x,k);
      requireThat(keyOK(k)&&p&&Object.hasOwn(p,'value')&&p.enumerable);
      if(i)emit(',');if(!a){emit(JSON.stringify(k));emit(':')}walk(p.value,d+1);
    }
    emit(a?']':'}');seen.delete(x);
  }
  walk(v,0);return parts.join('');
}
export const same = (a,b) => canonical(a)===canonical(b);
// Normalize decimal mathematical values before Number materialization can erase distinctions.
// Bounds are fixture limits: extreme exponent strings are held rather than allocated.
function decimal(s) {
  const m=/^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(s);requireThat(m);
  let digits=(m[2]+(m[3]||'')).replace(/^0+/,'');
  const e=Number(m[4]||0);requireThat(Number.isSafeInteger(e)&&Math.abs(e)<=LIMIT.bytes);
  let exp=e-(m[3]||'').length;
  if(!digits)return m[1]?'negative-zero':'0';
  const tail=digits.match(/0+$/)?.[0].length||0;
  if(tail){digits=digits.slice(0,-tail);exp+=tail}
  return m[1]+digits+'e'+exp;
}
export function parse(bytes,{exact=false}={}) {
  requireThat(Buffer.isBuffer(bytes)&&bytes.length<=LIMIT.bytes);
  const raw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
  requireThat(!raw.startsWith('\uFEFF')&&Buffer.from(raw).equals(bytes));
  let i=0;
  const ws=()=>{while(/[ \t\r\n]/.test(raw[i]||'x'))i++};
  function string(){requireThat(raw[i]==='"');const start=i++;
    for(;i<raw.length;i++){if(raw[i]==='\\'){i++;continue}if(raw[i]==='"'){i++;const x=JSON.parse(raw.slice(start,i));requireThat(str(x));return x}}reject()}
  function value(d) {
    requireThat(d<=LIMIT.depth);ws();const c=raw[i];
    if(c==='"')return string();
    if(c==='{'||c==='['){i++;const a=c==='[',out=a?[]:Object.create(null),end=a?']':'}',keys=new Set();ws();
      if(raw[i]===end){i++;return out}
      for(;;){ws();if(a)out.push(value(d+1));else{const k=string();requireThat(keyOK(k)&&!keys.has(k));keys.add(k);ws();requireThat(raw[i++]===':');out[k]=value(d+1)}
        ws();if(raw[i]===end){i++;return out}requireThat(raw[i++]===',')}
    }
    for(const [token,v] of [['true',true],['false',false],['null',null]])if(raw.startsWith(token,i)){i+=token.length;return v}
    const m=/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;m.lastIndex=i;const t=m.exec(raw);requireThat(t);i=m.lastIndex;
    const n=Number(t[0]);requireThat(Number.isFinite(n)&&!Object.is(n,-0)&&(!Number.isInteger(n)||Number.isSafeInteger(n))&&decimal(t[0])===decimal(JSON.stringify(n)));return n;
  }
  const result=value(0);ws();requireThat(i===raw.length);const encoded=canonical(result);if(exact)requireThat(encoded===raw);return result;
}
export function serverIdentity(s){
  requireThat(str(s)&&s.trim()===s&&s.length>0&&!/[\s\\%?#]/.test(s)&&!/(?:^|\/)\.{1,2}(?:\/|$)/.test(s));
  requireThat(!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)||/^https?:\/\//i.test(s));
  requireThat(!/^https?:\/(?!\/)/i.test(s)&&!/^https?:\/\/\//i.test(s));
  const u=new URL(/^https?:\/\//i.test(s)?s:'https://'+s);
  requireThat(['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!u.search&&!u.hash);
  const result=u.origin+u.pathname.replace(/\/+$/,'');requireThat(!result.includes('%'));return result;
}
export const keys=(x,k)=>requireThat(obj(x)&&JSON.stringify(Object.keys(x).sort())===JSON.stringify(k.split(' ').sort()));
const nonempty=x=>str(x)&&x.trim().length>0;
const h=x=>requireThat(hex(x)),n=x=>requireThat(uint(x));
const enumOf=(x,vs)=>requireThat(vs.includes(x));
const array=(x,f)=>{requireThat(Array.isArray(x));x.forEach(f)};
export const byteRef=x=>{keys(x,'id sha256 byteLength');h(x.id);h(x.sha256);n(x.byteLength);requireThat(x.byteLength<=LIMIT.bytes)};
export const recRef=x=>{keys(x,'id bodyDigest');h(x.id);h(x.bodyDigest)};
export const entryRef=x=>{keys(x,'id bodyDigest eventId logicalDigest');for(const v of Object.values(x))h(v)};
export const refEntry=r=>({id:r.id,bodyDigest:r.bodyDigest,eventId:r.body.eventId,logicalDigest:r.body.logicalDigest});
const entries=x=>{array(x,entryRef);requireThat(x.length>0&&x.every((v,i)=>i===0||x[i-1].id<v.id))};
function authority(x){requireThat(nonempty(x.owner)&&nonempty(x.server)&&serverIdentity(x.server)===x.server)}
function stateRef(x,base=false){keys(x,'rev wid stateDigest stateBytes');n(x.rev);requireThat(base&&x.rev===0?x.wid===null:x.rev>0&&wid(x.wid));h(x.stateDigest);byteRef(x.stateBytes)}
export const logical=b=>({owner:b.owner,server:b.server,kind:b.kind,at:b.at,payload:b.payload});
export function validateBody(type,b){
  if(type==='entry'){
    keys(b,'eventId owner server kind at payload source logicalDigest');h(b.eventId);n(b.at);
    enumOf(b.kind,['owned','held','active-only','manual','legacy-unbound']);
    if(['owned','held','active-only'].includes(b.kind))authority(b);
    else{requireThat(b.owner===null||nonempty(b.owner));requireThat(b.server===null||(nonempty(b.server)&&serverIdentity(b.server)===b.server))}
    requireThat(obj(b.payload));keys(b.source,'medium raw selector');enumOf(b.source.medium,['synthetic-native','synthetic-browser','synthetic-new-event']);byteRef(b.source.raw);
    requireThat(b.source.medium==='synthetic-new-event'?b.source.selector===null:nonempty(b.source.selector));
    requireThat(b.logicalDigest===D('logical-entry',canonical(logical(b))));return;
  }
  if(type==='intent'){
    keys(b,'attemptId owner server epochId entries base planned wire wireDigest obligations createdAt');h(b.attemptId);h(b.epochId);authority(b);entries(b.entries);stateRef(b.base,true);keys(b.planned,'stateDigest stateBytes');h(b.planned.stateDigest);byteRef(b.planned.stateBytes);byteRef(b.wire);h(b.wireDigest);n(b.createdAt);
    keys(b.obligations,'active media');
    array(b.obligations.active,x=>{keys(x,'entryId digest required');h(x.entryId);h(x.digest);requireThat(x.required===true)});
    array(b.obligations.media,x=>{keys(x,'entryId sha256 byteLength');h(x.entryId);h(x.sha256);n(x.byteLength)});return;
  }
  enumOf(type,['receipt']);keys(b,'intent attemptId owner server epochId entries wireDigest ack committed disposition localProof observedAt');recRef(b.intent);h(b.attemptId);h(b.epochId);authority(b);entries(b.entries);h(b.wireDigest);keys(b.ack,'rev wid');n(b.ack.rev);requireThat(b.ack.rev>0&&wid(b.ack.wid));stateRef(b.committed);n(b.observedAt);
  array(b.disposition,x=>{keys(x,'entryId logicalDigest decision evidence');h(x.entryId);h(x.logicalDigest);enumOf(x.decision,['incorporated','superseded-by-verified-merge','excluded-by-verified-reset-or-tombstone']);byteRef(x.evidence)});
  requireThat(b.disposition.length===b.entries.length&&b.entries.every(e=>b.disposition.filter(x=>x.entryId===e.id&&x.logicalDigest===e.logicalDigest).length===1));
  keys(b.localProof,'active media');
  array(b.localProof.active,x=>{keys(x,'entryId digest resolution evidence');h(x.entryId);h(x.digest);enumOf(x.resolution,['exact-owner-tagged-copy','explicit-fixture-resolution']);byteRef(x.evidence)});
  array(b.localProof.media,x=>{keys(x,'entryId sha256 byteLength evidence');h(x.entryId);h(x.sha256);n(x.byteLength);byteRef(x.evidence)});
}
export function record(type,body,recordId=id()){
  h(recordId);canonical(body);validateBody(type,body);requireThat(type!=='entry'||body.eventId!==recordId);
  return {schema:'opengym.stash-retention',version:1,type,id:recordId,body,bodyDigest:D(type,canonical(body))};
}
export function decode(bytes,recordId){const r=parse(bytes,{exact:true});keys(r,'schema version type id body bodyDigest');requireThat(r.id===recordId&&same(r,record(r.type,r.body,r.id)));return r}
