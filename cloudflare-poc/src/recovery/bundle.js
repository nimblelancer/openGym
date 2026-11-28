// Local capacity proof, not a deployed route or a production restore command.
// A trusted private parent directory and independent recovery key are required.
// No plaintext media is written; final manifest is published only after every
// listed ciphertext has authenticated and matched the expected plaintext hash.
import {createHash,createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {constants} from 'node:fs';
import {open,mkdir,readdir,link} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {inspectRecoveryManifest,MAX_ARCHIVE_BYTES} from './archive.js';
import {MEDIA_CONFIG} from '../media.js';
import {MEDIA_MIMES} from '../../../frontend/src/lib/media-refs.js';
const MB=1024*1024,CHUNK=MB,MAX_TOTAL=512*MB;
const MAGIC=Buffer.from('OGB6v1'),NONCE=12,TAG=16,HEADER=NONCE+TAG;
const ok=(cond,msg)=>{if(!cond)throw Error(msg);};
const sha=b=>createHash('sha256').update(b).digest('hex');
function checkKey(key){ok(Buffer.isBuffer(key)&&key.length===32,'invalid bundle key');}
function checkManifest(p,owner){
  const quota=inspectRecoveryManifest(p,owner);
  ok(p.files.reduce((n,f)=>n+f.size,0)<=MAX_TOTAL,'bundle aggregate byte bound');
  return quota;
}
async function syncDir(path){const f=await open(path,constants.O_RDONLY|constants.O_DIRECTORY);try{await f.sync();}finally{await f.close();}}
async function privateFile(path,max){
  const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{const s=await f.stat();ok(s.isFile()&&(s.mode&0o077)===0&&s.size<=max,'invalid private bundle file');return {f,s};}
  catch(e){await f.close();throw e;}
}
async function readExact(f,n,offset){
  const b=Buffer.alloc(n);let i=0;
  while(i<n){const r=await f.read(b,i,n-i,offset+i);ok(r.bytesRead>0,'truncated bundle');i+=r.bytesRead;}return b;
}
async function writeExact(f,b,offset){
  let i=0;while(i<b.length){const r=await f.write(b,i,b.length-i,offset+i);ok(r.bytesWritten>0,'short bundle write');i+=r.bytesWritten;}
}
async function unchanged(f,s){const end=await f.stat();ok(end.size===s.size&&end.mtimeMs===s.mtimeMs&&end.ctimeMs===s.ctimeMs,'bundle file changed');}
const aad=(id,owner,row)=>Buffer.from(JSON.stringify(['opengym-bundle-object-v1',id,owner,row.hash,row.mime,row.size,row.location]));
const filename=row=>row.hash+'.enc';
async function writeObject(dir,id,owner,row,key,read){
  const f=await open(join(dir,filename(row)),'wx',0o600),nonce=randomBytes(NONCE),cipher=createCipheriv('aes-256-gcm',key,nonce),h=createHash('sha256');
  cipher.setAAD(aad(id,owner,row));let n=0;
  try{
    await writeExact(f,Buffer.concat([nonce,Buffer.alloc(TAG)]),0);
    for await(const chunk of read(row)){
      ok(chunk instanceof Uint8Array&&chunk.byteLength>0&&chunk.byteLength<=CHUNK,'invalid bundle source chunk');
      ok(n+chunk.byteLength<=row.size,'bundle source exceeds declared size');
      h.update(chunk);const encrypted=cipher.update(chunk);await writeExact(f,encrypted,HEADER+n);n+=chunk.byteLength;
    }
    ok(n===row.size&&h.digest('hex')===row.hash,'bundle source integrity mismatch');
    ok(cipher.final().length===0,'unexpected cipher tail');
    await writeExact(f,cipher.getAuthTag(),NONCE);await f.sync();
  }finally{await f.close();}
}
async function verifyObject(dir,id,owner,row,key,output=null){
  const {f,s}=await privateFile(join(dir,filename(row)),row.size+HEADER);
  try{
    ok(s.size===row.size+HEADER,'bundle object size mismatch');
    const header=await readExact(f,HEADER,0),d=createDecipheriv('aes-256-gcm',key,header.subarray(0,NONCE)),h=createHash('sha256');
    d.setAAD(aad(id,owner,row));d.setAuthTag(header.subarray(NONCE));
    for(let pos=0;pos<row.size;pos+=CHUNK){
      const b=d.update(await readExact(f,Math.min(CHUNK,row.size-pos),HEADER+pos));
      try{h.update(b);if(output)b.copy(output,pos);}finally{b.fill(0);}
    }
    try{ok(d.final().length===0,'unexpected decipher tail');}catch{throw Error('bundle object authentication failed');}
    ok(h.digest('hex')===row.hash,'bundle object hash mismatch');await unchanged(f,s);
  }finally{await f.close();}
}
function sealManifest(p,id,key){
  const plain=Buffer.from(JSON.stringify({id,p}));ok(plain.length+HEADER+MAGIC.length<=MAX_ARCHIVE_BYTES,'bundle manifest bound');
  const nonce=randomBytes(NONCE),c=createCipheriv('aes-256-gcm',key,nonce);c.setAAD(MAGIC);
  try{const b=Buffer.concat([c.update(plain),c.final()]);return Buffer.concat([MAGIC,nonce,c.getAuthTag(),b]);}finally{plain.fill(0);}
}
async function readManifest(path,key){
  const {f,s}=await privateFile(path,MAX_ARCHIVE_BYTES);let plain,part;
  try{
    ok(s.size>MAGIC.length+HEADER,'invalid bundle manifest');
    const b=await readExact(f,s.size,0);await unchanged(f,s);
    ok(b.subarray(0,MAGIC.length).equals(MAGIC),'invalid bundle version');
    const d=createDecipheriv('aes-256-gcm',key,b.subarray(MAGIC.length,MAGIC.length+NONCE));d.setAAD(MAGIC);d.setAuthTag(b.subarray(MAGIC.length+NONCE,MAGIC.length+HEADER));
    try{part=d.update(b.subarray(MAGIC.length+HEADER));plain=Buffer.concat([part,d.final()]);}catch{throw Error('bundle manifest authentication failed');}
    const m=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain));ok(m&&Object.keys(m).length===2&&typeof m.id==='string'&&/^[a-f0-9]{32}$/.test(m.id)&&m.p,'invalid bundle manifest');return {id:m.id,p:m.p,digest:sha(b)};
  }finally{part?.fill(0);plain?.fill(0);await f.close();}
}
export async function verifyRecoveryBundle(dir,key,owner){
  checkKey(key);const {id,p,digest}=await readManifest(join(dir,'manifest.enc'),key),quota=checkManifest(p,owner);
  const names=(await readdir(dir)).sort(),expected=['manifest.enc',...p.files.map(filename)].sort();
  ok(names.length===expected.length&&names.every((n,i)=>n===expected[i]),'bundle inventory incomplete or unexpected');
  for(const row of p.files)await verifyObject(dir,id,owner,row,key);
  return {manifest:p,manifestDigest:digest,verifiedMediaBytes:p.files.reduce((n,f)=>n+f.size,0),quota,localReadbackVerified:true,offProviderVerified:false,cutoverAuthorized:false};
}
export async function persistRecoveryBundle(dir,p,key,owner,read){
  checkKey(key);ok(typeof read==='function','bundle source reader required');
  // Freeze the trusted caller's metadata before async source reads.
  checkManifest(p,owner);p=JSON.parse(JSON.stringify(p));checkManifest(p,owner);
  const id=randomBytes(16).toString('hex'),manifest=sealManifest(p,id,key);
  await mkdir(dir,{mode:0o700}); // exclusive directory; never resume or overwrite
  await syncDir(dirname(dir));
  for(const row of p.files){await writeObject(dir,id,owner,row,key,read);await verifyObject(dir,id,owner,row,key);}
  await syncDir(dir);
  // Publish manifest without exposing a partial file under the final name.
  const temp=join(dir,'manifest.pending'),f=await open(temp,'wx',0o600);
  try{await f.writeFile(manifest);await f.sync();}finally{await f.close();}
  const check=await readManifest(temp,key);ok(check.digest===sha(manifest),'manifest readback mismatch');
  await link(temp,join(dir,'manifest.enc'));
  const {unlink}=await import('node:fs/promises');await unlink(temp);await syncDir(dir);
  // A post-publication error is ambiguous, not a reason to remove the backup.
  return verifyRecoveryBundle(dir,key,owner);
}

// Reopen the pinned manifest and authenticate a single compatible remote object
// into at most 8 MiB of memory. No bytes are returned before GCM final and SHA
// verification. The caller must first verify the entire bundle and freeze the
// destination; this helper does not authorize a state commit or any restore.
// Device-only originals remain preserved; they must not be silently uploaded.
export async function readVerifiedRestoreObject(dir,key,owner,manifestDigest,hash){
  checkKey(key);
  const {id,p,digest}=await readManifest(join(dir,'manifest.enc'),key);
  ok(digest===manifestDigest,'bundle manifest changed');
  checkManifest(p,owner);
  const row=p.files.find(f=>f.hash===hash);
  ok(row&&row.location!=='device','object is not a remote restore candidate');
  const cap=MEDIA_CONFIG[MEDIA_MIMES[row.mime].kind+'MB']*MB;
  ok(Number.isSafeInteger(cap)&&row.size<=cap&&row.size<=8*MB,'restore object size limit');
  const bytes=Buffer.alloc(row.size);
  try{await verifyObject(dir,id,owner,row,key,bytes);return {row,bytes};}
  catch(e){bytes.fill(0);throw e;}
}
