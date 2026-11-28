import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {canonical,parse,D,sha,id,record,decode,logical,serverIdentity,LIMIT} from './contract.mjs';
const B=s=>Buffer.from(s);
test('Q1 strict canonical UTF-8, decimal and key vectors',()=>{
  assert.equal(canonical({'2':2,'10':10,a:[1,0.1,'😀']}),'{"10":10,"2":2,"a":[1,0.1,"😀"]}');
  assert.equal(canonical(parse(B(' { "x": 1.00e-1 } '))),'{"x":0.1}');
  for(const s of ['{"a":1,"\\u0061":2}','{"a":{"x":1,"x":2}}','{"__proto__":1}','-0','-0.0','1e-400','1e400','9007199254740993','0.10000000000000001','"\\ud800"','[1,]','\uFEFF{}','{"a":01}'])assert.throws(()=>parse(B(s)));
  assert.throws(()=>parse(Buffer.from([0xff])));assert.throws(()=>parse(B('{"b":1,"a":2}'),{exact:true}));
  const cycle={};cycle.x=cycle;assert.throws(()=>canonical(cycle));assert.throws(()=>canonical({get x(){throw Error('accessor invoked')}}));
  assert.throws(()=>canonical('x'.repeat(LIMIT.bytes)));assert.throws(()=>parse(B('['.repeat(66)+'0'+']'.repeat(66))));
});
test('Q1 exact entry envelope, event vs logical identity, authority, raw domain',()=>{
  const raw=B('{"workouts":[]}'),base={eventId:id(),owner:'fixture',server:'https://example.invalid/sub',kind:'owned',at:1,payload:{workouts:[]},source:{medium:'synthetic-new-event',raw:{id:id(),sha256:sha(raw),byteLength:raw.length},selector:null}};
  const b={...base,logicalDigest:D('logical-entry',canonical(logical(base)))},a=record('entry',b),other=record('entry',{...b,eventId:id()});
  assert.notEqual(a.id,other.id);assert.notEqual(a.bodyDigest,other.bodyDigest);assert.equal(a.body.logicalDigest,other.body.logicalDigest);
  assert.equal(canonical(decode(B(canonical(a)),a.id)),canonical(a));assert.notEqual(b.logicalDigest,sha(raw));
  for(const altered of [{...a,extra:1},{...a,version:2},{...a,bodyDigest:id()}])assert.throws(()=>decode(B(canonical(altered)),a.id));
  assert.throws(()=>record('entry',b,b.eventId));assert.throws(()=>record('entry',{...b,extra:1}));assert.throws(()=>record('entry',{...b,owner:null}));
  assert.equal(serverIdentity('https://example.invalid/sub/'),'https://example.invalid/sub');
  for(const s of ['https://u:p@example.invalid','https://example.invalid/a/../b','https://example.invalid/%2f','https://example.invalid/?x=1','ftp://example.invalid','https://example.invalid/#x'])assert.throws(()=>serverIdentity(s));
});

test('Q1 independent Python SHA-256 vector, UTF-16 order and scientific number spelling',()=>{
  const expected='{"10":10,"2":2,"tiny":1e-7,"😀":1,"":2}';
  assert.equal(canonical({'2':2,'10':10,tiny:1e-7,'':2,'😀':1}),expected);
  const digest=execFileSync('python3',['-c','import hashlib,sys; print(hashlib.sha256(b"opengym.stash.v1/logical-entry\\x00"+sys.stdin.buffer.read()).hexdigest())'],{input:Buffer.from(expected),encoding:'utf8'}).trim();
  assert.equal(D('logical-entry',expected),digest);
});
