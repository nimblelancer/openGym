import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encode,decode,metaHash,CHUNK_BYTES,MAX_STORED,TooLarge,Corrupt,readBody } from '../src/storage/codec.js';
import { transition,forClient } from '../src/sync/transition.js';
const now=1800000000000,wid=()=> '0123456789abcdef';
test('codec bounds, UTF-8 chunk edges, integrity and invalid metadata',()=>{
  const state={_rev:1,_wid:wid(),notes:'語🏋️'.repeat(70000)};
  const e=encode(state);assert.ok(e.chunks.length>1);assert.ok(e.chunks.every(c=>c.length<=CHUNK_BYTES));
  const m={profile_id:'a',rev:1,wid:wid(),byte_count:e.byteCount,chunk_count:e.chunks.length,digest:e.digest,updated_at:now};m.integrity=metaHash(m);
  const rows=e.chunks.map((bytes,idx)=>({bytes,idx}));
  assert.deepEqual(decode(m,rows),state);
  assert.throws(()=>decode(m,rows.slice(1)),Corrupt);assert.throws(()=>decode({...m,rev:2},rows),Corrupt);
  assert.throws(()=>decode(m,rows.map((r,i)=>i? r:{...r,bytes:Buffer.alloc(r.bytes.length)})),Corrupt);
  assert.throws(()=>encode({notes:'x'.repeat(MAX_STORED)}),TooLarge);
});
test('upstream transition contract, optional revision, response, reset, hidden bookkeeping, history',()=>{
  const first=transition(null,{baseRev:0,state:{_ts:1,workouts:[null,{id:'a'},5],routines:[],active:{},resetAt:5000,resetIds:{workouts:['old']}}},{now,wid});
  assert.deepEqual(first.body,{ok:true,ts:1,rev:1,wid:wid()});assert.equal(first.next.active,undefined);assert.deepEqual(first.next.workouts,[{id:'a'}]);
  assert.equal(transition(first.next,{baseRev:1,baseWid:'bad',state:{workouts:[]}},{now,wid}).status,409);
  assert.equal(transition(first.next,{baseRev:'1',state:{workouts:[]}},{now,wid}).status,409);
  assert.equal(transition(first.next,{baseRev:0,state:{}},{now,wid}).body.error,'state required');
  const next=transition(first.next,{state:{workouts:[],routines:[],_ts:2,resetAt:1}},{now,wid});
  assert.equal(next.status,200);assert.equal(next.next.resetAt,5000);assert.deepEqual(next.next.resetIds,{workouts:['old']});
  assert.deepEqual(forClient({_unstamped:1,_prior:2,_rev:2}),{_rev:2});
  const prev={...next.next,_wids:Array.from({length:60},(_,i)=>String(i))};
  assert.equal(transition(prev,{baseRev:null,state:{workouts:[]}},{now,wid}).next._wids.length,50);
});
test('wire body error status and precedence',async()=>{
  for(const [body,type,status] of [['{}','text/plain',415],['null','application/json',400],['{','application/json',400],['12345','text/plain',413]]){
    await assert.rejects(readBody(new Request('http://localhost',{method:'PUT',body,headers:{'content-type':type}}),4),e=>e.status===status);
  }
  assert.deepEqual(await readBody(new Request('http://localhost',{method:'PUT',body:'{}',headers:{'content-type':'application/json'}})),{});
});
