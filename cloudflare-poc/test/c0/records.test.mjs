import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { canonical, digest, serverIdentity, entryIdentity, equivalent, makeRecord, decodeRecord, publish, inventory, namespace } from './records.mjs';
import { diskAdapter } from './disk-adapter.mjs';
const entry=(owner='owner-a',note='original')=>({owner,server:'https://example.invalid/gym',kind:'owned',at:123,payload:{workouts:[{id:'a',note}],active:{id:'active'},unknown:{z:2,a:1}}});
const child=(root,mode,body)=>new Promise((resolve,reject)=>{
  const p=spawn(process.execPath,[fileURLToPath(new URL('./publisher.mjs',import.meta.url)),root,mode],{stdio:['pipe','pipe','pipe']});
  let out=''; p.stdout.on('data',c=>{out+=c});p.stderr.resume();
  const timer=setTimeout(()=>{p.kill();reject(Error('child timeout'))},15000);
  p.on('error',e=>{clearTimeout(timer);reject(e)});
  p.on('close',code=>{clearTimeout(timer);try{assert.equal(code,0);const result=JSON.parse(out);assert.equal(result.pid,p.pid);assert.notEqual(result.pid,process.pid);resolve(result)}catch(e){reject(e)}});
  p.stdin.on('error',()=>{});p.stdin.end(body===undefined?'':JSON.stringify(body));
});
test('NR-01 canonical exact identity, divergence, invalid and collision controls',()=>{
  const a=entry(), b={...a,payload:{unknown:{a:1,z:2},active:{id:'active'},workouts:[{note:'original',id:'a'}]}};
  assert.equal(equivalent(entryIdentity(a),entryIdentity(b)),true);
  for(const v of [entry('owner-b'),entry('owner-a','different'),{...a,server:'https://example.invalid/other'}, {...a,payload:{...a.payload,active:{id:'other'}}},{...a,payload:{...a.payload,unknown:{a:1,z:3}}}]){
    assert.equal(equivalent(entryIdentity(a),entryIdentity(v)),false);
  }
  assert.equal(serverIdentity(' EXAMPLE.invalid/gym/ '),'https://example.invalid/gym');
  assert.notEqual(serverIdentity('https://example.invalid/gym'),serverIdentity('http://example.invalid/gym'));
  assert.notEqual(canonical(['a','b']),canonical(['b','a']));
  assert.notEqual(canonical('é'),canonical('e\u0301'));
  assert.notEqual(digest('raw',JSON.stringify(a)),entryIdentity(a).hash);
  for(const bad of [{...a,owner:''},{...a,server:null},{...a,kind:'bogus'},{...a,at:Infinity},{...a,payload:[]},{...a,server:'https://example.invalid/gym/'},{...a,payload:{n:9007199254740992}}]) assert.throws(()=>entryIdentity(bad));
  for(const url of ['ftp://example.invalid','https://u:p@example.invalid','https://example.invalid?x=1']) assert.throws(()=>serverIdentity(url));
  for(const bad of [NaN,undefined,-0,Array(2),JSON.parse('{"__proto__":{}}'),{bad:'\ud800'}, {x:()=>{}}]) assert.throws(()=>canonical(bad));
  const manual={...a,owner:null,server:null,kind:'manual'};
  assert.notEqual(entryIdentity(manual).hash,entryIdentity(a).hash);
  const rec=makeRecord(a), raw=canonical(rec);
  assert.deepEqual(decodeRecord(raw,rec.id),JSON.parse(raw));
  assert.throws(()=>decodeRecord(raw.replace('"schema":1','"schema":1,"schema":1'),rec.id));
  assert.throws(()=>decodeRecord(raw+' ',rec.id));
  assert.throws(()=>equivalent(entryIdentity(a),{hash:entryIdentity(a).hash,bytes:'different'}),/collision/);
});
test('NR-02 independent cooperating child publications, exact bytes and fresh process discovery',async()=>{
  const root=await mkdtemp(join(tmpdir(),'opengym-c0-'));
  try {
    const fs=diskAdapter(root), legacy='{"legacy":"untouched"}';
    await writeFile(join(root,'opengym-stash.json'),legacy);
    assert.deepEqual(await inventory(fs),{records:[],held:[],complete:true});
    const parent=await publish(fs,makeRecord(entry()));
    const [one,two]=await Promise.all([child(root,'publish',entry('owner-a','newer')),child(root,'publish',entry('foreign','foreign'))]);
    assert.notEqual(one.pid,two.pid);
    assert.equal(new Set([parent.id,one.id,two.id]).size,3);
    for(const p of [parent,one,two]) assert.equal(await readFile(join(root,namespace,p.id+'.json'),'utf8'),p.raw);
    const restart=await child(root,'inventory');
    assert.equal(restart.complete,true);
    assert.deepEqual(restart.records.map(r=>r.raw).sort(),[parent.raw,one.raw,two.raw].sort());
    assert.equal(await readFile(join(root,'opengym-stash.json'),'utf8'),legacy);
    assert.equal((await inventory(fs)).records.length,3);
    await assert.rejects(publish(fs,makeRecord(entry('owner-a','collision'),parent.id)),/collision/);
    assert.equal(await readFile(join(root,namespace,parent.id+'.json'),'utf8'),parent.raw);
    console.log('C0_NR02 distinct-child, unique IDs, exact raw, restart, legacy unchanged');
  } finally {await rm(root,{recursive:true,force:true})}
});
test('NR-02 refusal, partial/silent writes, unreadable directory and orphan holds',async()=>{
  const root=await mkdtemp(join(tmpdir(),'opengym-c0-'));
  try {
    const fs=diskAdapter(root), rec=makeRecord(entry());
    await assert.rejects(publish(diskAdapter(root,{refuse:true}),rec),/full disk/);
    assert.equal((await inventory(fs)).records.length,0);
    const original=await publish(fs,makeRecord(entry()));
    for(const partial of ['throw','silent']){
      const p=makeRecord(entry('owner-a',partial));
      await assert.rejects(publish(diskAdapter(root,{partial}),p));
      await assert.rejects(publish(fs,p),/collision/);
      assert.notEqual(await readFile(join(root,namespace,p.id+'.json'),'utf8'),canonical(p));
    }
    await assert.rejects(publish(diskAdapter(root,{silent:true}),makeRecord(entry())));
    await assert.rejects(publish(diskAdapter(root,{read:true}),makeRecord(entry('owner-a','read refused'))));
    await writeFile(join(root,namespace,'orphan'),'{');
    await assert.rejects(inventory(diskAdapter(root,{list:''})));
    await assert.rejects(inventory(diskAdapter(root,{list:namespace})));
    await assert.rejects(inventory({readdir:async()=>({files:[null]})}));
    const restarted=await child(root,'inventory');
    assert.equal(restarted.complete,false);
    assert.equal(restarted.held.length,3);
    assert.equal(restarted.records.length,2); // exact orphan after read refusal is discoverable, not ACKed
    assert.equal(await readFile(join(root,namespace,original.id+'.json'),'utf8'),original.raw);
  } finally {await rm(root,{recursive:true,force:true})}
});
test('NR-02 negative capability control: unconditional same-path write is not CAS',async()=>{
  const root=await mkdtemp(join(tmpdir(),'opengym-c0-'));
  try{
    const fs=diskAdapter(root), a=makeRecord(entry()), b=makeRecord(entry('owner-a','different'),a.id);
    await publish(fs,a);
    // Deliberate synthetic noncooperating direct write, not a preservation success.
    await fs.writeFile({path:namespace+'/'+a.id+'.json',directory:'DATA',data:canonical(b),encoding:'utf8'});
    assert.equal((await inventory(fs)).records[0].raw,canonical(b));
    assert.notEqual(canonical(a),canonical(b));
    console.log('C0_NR02 NEGATIVE CONTROL: same-path unconditional overwrite possible');
  }finally{await rm(root,{recursive:true,force:true})}
});
