// Disposable fixture filesystem only; no native exclusive-create, lock or fsync.
import { diskAdapter } from '../c0/disk-adapter.mjs';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { LIMIT, requireThat, hex, id, sha, canonical, decode, byteRef, parse, same, logical, serverIdentity, obj } from './contract.mjs';
const DIRECTORY='DATA', REC='p7-c1-records', EVD='p7-c1-evidence';
const sources=['gym_stash','opengym-stash.json','opengym-state.json','opengym-state.next.json'];
const pathFor=(ns,i,ext)=>{requireThat(hex(i));return ns+'/'+i+ext};
const recordPath=i=>pathFor(REC,i,'.json'), evidencePath=i=>pathFor(EVD,i,'.bin');
export async function bounded(fn,ms=LIMIT.io) {
  let timer;try{return await Promise.race([Promise.resolve().then(fn),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('C1 I/O deadline')),ms)})])}finally{clearTimeout(timer)}
}
export function adapter(root,fault={}){
  const fs=diskAdapter(root,fault);
  return {...fs,async size(path){const s=await lstat(join(root,path));requireThat(s.isFile());return s.size}};
}
async function list(fs,path,remaining){
  const r=await bounded(()=>fs.readdir({path,directory:DIRECTORY}),remaining());
  requireThat(Array.isArray(r?.files)&&r.files.length<=LIMIT.names);
  const names=r.files.map(f=>typeof f==='string'?f:f?.name);
  requireThat(names.every(n=>typeof n==='string'&&n&&!/[\\/]/.test(n)&&!['.','..'].includes(n))&&new Set(names).size===names.length);
  return names.sort();
}
async function exact(fs,path,remaining,budget){
  if(fs.size){const n=await bounded(()=>fs.size(path),remaining());requireThat(n<=LIMIT.bytes&&n<=budget)}
  const {data}=await bounded(()=>fs.readFile({path,directory:DIRECTORY}),remaining());
  requireThat(typeof data==='string'&&data.length<=Math.ceil(LIMIT.bytes/3)*4);
  const b=Buffer.from(data,'base64');requireThat(b.toString('base64')===data&&b.length<=LIMIT.bytes&&b.length<=budget);return b;
}
const deadline=(until=Date.now()+LIMIT.operation)=>()=>{const left=until-Date.now();requireThat(left>0);return Math.min(left,LIMIT.io)};
export async function inventory(fs,until=Date.now()+LIMIT.operation){
  const remaining=deadline(until), raw=new Map(), records=new Map(), held=[];let budget=LIMIT.total;
  try{
    const root=await list(fs,'',remaining), paths=[];
    for(const name of root){
      if(sources.includes(name))paths.push(name);
      else if([REC,EVD].includes(name))for(const f of await list(fs,name,remaining))paths.push(name+'/'+f);
      else held.push('unknown-root');
    }
    for(const path of paths){
      try{
        const b=await exact(fs,path,remaining,budget);budget-=b.length;raw.set(path,b);
        if(path.startsWith(REC+'/')){const m=/^p7-c1-records\/([a-f0-9]{64})\.json$/.exec(path);requireThat(m);records.set(m[1],decode(b,m[1]))}
        else if(path.startsWith(EVD+'/'))requireThat(/^p7-c1-evidence\/[a-f0-9]{64}\.bin$/.test(path));
        else requireThat(obj(parse(b)));
      }catch{held.push('unreadable-or-invalid')}
    }
  }catch{held.push('incomplete-enumeration')}
  return {raw,records,held,complete:held.length===0,bytes:LIMIT.total-budget};
}
export function rawMatches(a,b){
  return a.complete&&b.complete&&a.raw.size===b.raw.size&&[...a.raw].every(([p,v])=>b.raw.get(p)?.equals(v));
}
export function resolveBytes(inv,ref){
  byteRef(ref);const b=inv.raw.get(evidencePath(ref.id));
  requireThat(b&&b.length===ref.byteLength&&sha(b)===ref.sha256);return b;
}
export function resolveEntry(inv,ref){
  const r=inv.records.get(ref.id);requireThat(r?.type==='entry'&&r.bodyDigest===ref.bodyDigest&&r.body.eventId===ref.eventId&&r.body.logicalDigest===ref.logicalDigest);
  const b=r.body, raw=resolveBytes(inv,b.source.raw), source=parse(raw);
  if(b.source.medium==='synthetic-new-event'){
    requireThat(same(source,{eventId:b.eventId,...logical(b)}));
  }else{
    const old=source[b.source.selector];requireThat(obj(old)&&!old.cleared&&obj(old.state)&&old.uid===b.owner&&old.at===b.at&&same(old.state,b.payload));
    requireThat((old.server===null||old.server===undefined?null:serverIdentity(old.server))===b.server);
    requireThat(b.source.selector===(old.server||'')+'|'+old.uid);
    requireThat(b.kind===(old.server==null?'legacy-unbound':old.adopt===true?'held':'owned'));
  }
  return r;
}
export async function publish(fs,path,bytes,until=Date.now()+LIMIT.operation){
  requireThat(Buffer.isBuffer(bytes)&&bytes.length<=LIMIT.bytes);
  const remaining=deadline(until),root=await list(fs,'',remaining),[ns,name]=path.split('/');
  requireThat(ns===REC?/^[a-f0-9]{64}\.json$/.test(name):ns===EVD&&/^[a-f0-9]{64}\.bin$/.test(name));
  if(root.includes(ns))requireThat(!(await list(fs,ns,remaining)).includes(name));
  await bounded(()=>fs.writeFile({path,directory:DIRECTORY,data:bytes.toString('base64'),recursive:true}),remaining());
  requireThat((await exact(fs,path,remaining,LIMIT.bytes)).equals(bytes));return path;
}
// Expected inventory tracks only this driver's successful writes. Independent
// publications cause HOLD, never replacement. Checks are observations, not CAS.
export async function vault(fs){
  let expected=await inventory(fs);requireThat(expected.complete);
  const check=async(until=Date.now()+LIMIT.operation)=>{const current=await inventory(fs,until);requireThat(rawMatches(expected,current));return current};
  const add=async(path,bytes,until)=>{await check(until);await publish(fs,path,bytes,until);const next=new Map(expected.raw);next.set(path,bytes);expected={...expected,raw:next};expected=await check(until);return expected};
  return {check,async evidence(bytes,until=Date.now()+LIMIT.operation){const i=id();await add(evidencePath(i),bytes,until);return {id:i,sha256:sha(bytes),byteLength:bytes.length}},
    async record(r,until=Date.now()+LIMIT.operation){const bytes=Buffer.from(canonical(r));decode(bytes,r.id);await add(recordPath(r.id),bytes,until);return r}};
}
export {recordPath,evidencePath};

// Read-only union of independently enumerated synthetic media. Duplicate
// physical copies stay listed; divergent same-path bytes invalidate authority.
export function unionInventories(media){
  const raw=new Map(),records=new Map(),copies=[],held=[];let bytes=0;
  for(const {medium,inventory:i} of media){
    if(!i.complete)held.push('medium-incomplete');
    for(const [path,b] of i.raw){copies.push({medium,path,bytes:b});bytes+=b.length;
      if(raw.has(path)&&!raw.get(path).equals(b))held.push('same-path-divergence');
      else raw.set(path,b);
    }
    for(const [key,r] of i.records){if(records.has(key)&&!same(records.get(key),r))held.push('record-collision');else records.set(key,r)}
  }
  if(bytes>LIMIT.total)held.push('union-budget');
  return {raw,records,copies,held,complete:held.length===0,bytes};
}
