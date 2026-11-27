// Local synthetic proof only. Caller supplies a trusted private directory and
// an independently managed recovery key. No remote resources or restore writes.
import { constants } from 'node:fs';
import { open, link, unlink } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { MAX_ARCHIVE_BYTES, sealRecoveryArchive, openRecoveryArchive } from './archive.js';

const hash=b=>createHash('sha256').update(b).digest('hex');
async function readBounded(path){
  const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const before=await f.stat();
    if(!before.isFile()||(before.mode&0o077)!==0||before.size<1||before.size>MAX_ARCHIVE_BYTES)throw Error('invalid private archive file');
    const bytes=Buffer.alloc(before.size);
    let offset=0;
    while(offset<bytes.length){
      const {bytesRead}=await f.read(bytes,offset,bytes.length-offset,offset);
      if(!bytesRead)throw Error('truncated archive file');offset+=bytesRead;
    }
    const extra=Buffer.alloc(1);
    if((await f.read(extra,0,1,offset)).bytesRead!==0)throw Error('archive size changed');
    const after=await f.stat();
    if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw Error('archive file changed');
    return bytes;
  }finally{await f.close();}
}
export async function readRecoveryFile(path,key,owner){
  const bytes=await readBounded(path);
  return {...openRecoveryArchive(bytes,key,owner),archiveDigest:hash(bytes)};
}
async function syncDirectory(path){const d=await open(path,constants.O_RDONLY|constants.O_DIRECTORY);try{await d.sync();}finally{await d.close();}}
// Write exclusive temp inode, sync, authenticate readback, atomically publish
// via hard link (never replace an existing path), sync directory, read again.
// After publication an error is an ambiguous outcome: leave the archive intact
// for explicit reconciliation, never overwrite or delete a final path.
export async function persistRecoveryFile(path,payload,key,owner){
  const bytes=sealRecoveryArchive(payload,key,owner),expected=hash(bytes);
  const dir=dirname(path),temp=join(dir,'.'+basename(path)+'.'+randomBytes(16).toString('hex')+'.tmp');
  let created=false;
  try{
    const f=await open(temp,'wx',0o600);created=true;
    try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}
    if((await readRecoveryFile(temp,key,owner)).archiveDigest!==expected)throw Error('archive readback mismatch');
    await link(temp,path);
    await syncDirectory(dir);
    const got=await readRecoveryFile(path,key,owner);
    if(got.archiveDigest!==expected)throw Error('published archive mismatch');
    return {archiveDigest:expected,archiveBytes:bytes.length,localReadbackVerified:true,offProviderVerified:false,cutoverAuthorized:false};
  }finally{if(created){await unlink(temp);await syncDirectory(dir);}}
}
