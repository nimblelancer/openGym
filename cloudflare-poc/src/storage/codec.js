import { createHash } from 'node:crypto';
import { record } from '../sync/transition.js';
export const CHUNK_BYTES=512*1024, MAX_BODY=5*1024*1024, MAX_STORED=8*1024*1024;
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export class Corrupt extends Error {}
export class TooLarge extends Error {}
export function encode(state){
  const text=JSON.stringify(state), bytes=Buffer.from(text,'utf8');
  if(bytes.length>MAX_STORED)throw new TooLarge('state too large after stamping');
  const chunks=[];
  for(let i=0;i<bytes.length;i+=CHUNK_BYTES)chunks.push(bytes.subarray(i,i+CHUNK_BYTES));
  return {chunks,byteCount:bytes.length,digest:hash(bytes)};
}
export function metaHash(m){return hash(JSON.stringify([m.profile_id,m.rev,m.wid,m.byte_count,m.chunk_count,m.digest,m.updated_at]));}
export function validMeta(m){
  return Number.isSafeInteger(m.rev)&&m.rev>=0&&(m.wid===null||typeof m.wid==='string')&&
    Number.isSafeInteger(m.byte_count)&&m.byte_count>0&&m.byte_count<=MAX_STORED&&
    m.chunk_count===Math.ceil(m.byte_count/CHUNK_BYTES)&&/^[a-f0-9]{64}$/.test(m.digest)&&
    Number.isSafeInteger(m.updated_at)&&m.integrity===metaHash(m);
}
export function decode(m,rows){
  if(!validMeta(m)||rows.length!==m.chunk_count)throw new Corrupt('metadata or chunk count');
  const parts=rows.map((row,i)=>{
    const b=Buffer.from(row.bytes);
    if(row.idx!==i||b.length!==Math.min(CHUNK_BYTES,m.byte_count-i*CHUNK_BYTES))throw new Corrupt('chunk order or size');
    return b;
  });
  const bytes=Buffer.concat(parts);
  if(bytes.length!==m.byte_count||hash(bytes)!==m.digest)throw new Corrupt('digest mismatch');
  let state;
  try{state=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new Corrupt('invalid stored JSON');}
  if(!record(state)||(state._rev||0)!==m.rev||(state._wid||null)!==m.wid)throw new Corrupt('state metadata mismatch');
  return state;
}
export class HttpInputError extends Error{constructor(status,message){super(message);this.status=status;}}
export async function readBody(req,limit=MAX_BODY){
  if(!req.body)return {};
  const reader=req.body.getReader();let size=0;const chunks=[];
  try{
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
      if(size>limit){await reader.cancel();throw new HttpInputError(413,'body too large');}chunks.push(value);}
  }finally{reader.releaseLock();}
  if(!size)return {};
  if(!/^application\/json\s*(;|$)/i.test(req.headers.get('content-type')||''))throw new HttpInputError(415,'content-type must be application/json');
  let body;try{body=JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));}catch{throw new HttpInputError(400,'invalid json');}
  if(!record(body))throw new HttpInputError(400,'invalid json');return body;
}
