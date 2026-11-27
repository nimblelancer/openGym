// Local Phase 5 lifecycle. All operations run inside the coordinator's exclusive media
// admission gate; state PUT uses the same gate. SQLite intent precedes any destructive R2 IO.
import { referencedHashes } from '../../frontend/src/lib/media-refs.js';
import { inventory } from './media.js';
export const GRACE_MS=14*86400000;
export const DELETE_BATCH=16;
const uidOK=uid=>typeof uid==='string'&&/^[A-Za-z0-9_-]{16}$/.test(uid);
const hashOf=o=>o.key.split('/').at(-1);
export class MediaLifecycle{
  constructor(repo,state,bucket,{now=Date.now}={}){
    this.a=repo;this.s=state;this.bucket=bucket;this.now=now;
    repo.tx(()=>{
      repo.q('CREATE TABLE IF NOT EXISTS media_gc (uid TEXT NOT NULL, hash TEXT NOT NULL, since INTEGER NOT NULL, PRIMARY KEY(uid,hash))');
      repo.q('CREATE TABLE IF NOT EXISTS media_delete_intent (uid TEXT PRIMARY KEY, started INTEGER NOT NULL)');
    });
  }
  pending(){return this.a.one('SELECT uid FROM media_delete_intent LIMIT 1')?.uid||null;}
  // Must be called within the same transaction as the authorized account-delete proof.
  begin(uid){
    if(!uidOK(uid))throw Error('invalid owner');
    this.a.q('INSERT OR IGNORE INTO media_delete_intent VALUES(?,?)',uid,this.now());
    this.a.q('UPDATE auth_users SET disabled=1, sv=sv+1 WHERE id=?',uid);
    this.a.q('DELETE FROM auth_codes WHERE uid=?',uid);
    this.a.q('DELETE FROM auth_challenges');
  }
  // Called transactionally with each successful state commit. Re-reference clears the observation.
  noteState(uid,state){const refs=referencedHashes(state);for(const {hash} of this.a.q('SELECT hash FROM media_gc WHERE uid=?',uid))if(refs.has(hash))this.touch(uid,hash);}
  touch(uid,hash){this.a.q('DELETE FROM media_gc WHERE uid=? AND hash=?',uid,hash);}
  async sweep(uid,live){
    if(!uidOK(uid)||!live())return {status:401,body:{error:'not signed in'}};
    const state=await this.s.read(uid);
    if(state.kind!=='ok')return {status:503,body:{error:'state unreadable or not synced',code:'media-sweep-unavailable'}};
    const refs=referencedHashes(state.state),i=await inventory(this.bucket,uid),now=this.now();
    if(!live())return {status:401,body:{error:'not signed in'}};
    // A finite grace period cannot prove that all offline clients have dropped a
    // reference. Until a safe explicit purge/backup protocol is accepted, sweep
    // is observation-only, including explicit reset-triggered sweep. Retained
    // bytes still count against quota; only authorized account deletion purges.
    const observed=this.a.tx(()=>{
      const marks=new Map(this.a.q('SELECT hash,since FROM media_gc WHERE uid=?',uid).map(r=>[r.hash,r.since]));
      const present=new Set(i.objects.map(hashOf));
      for(const h of marks.keys())if(refs.has(h)||!present.has(h))this.touch(uid,h);
      let retained=0,retainedBytes=0,pastGrace=0;
      for(const o of i.objects){
        const h=hashOf(o);if(refs.has(h))continue;
        retained++;retainedBytes+=o.size;
        const since=marks.get(h);
        if(!Number.isSafeInteger(since)||since>now){this.a.q('INSERT OR REPLACE INTO media_gc VALUES(?,?,?)',uid,h,now);continue;}
        const uploaded=Number(new Date(o.uploaded));
        if(Number.isFinite(uploaded)&&uploaded>0&&now-Math.max(since,uploaded)>=GRACE_MS)pastGrace++;
      }
      return {retained,retainedBytes,pastGrace};
    });
    return {status:200,body:{removed:0,freedBytes:0,usage:i.usage,...observed,policy:'retain-until-authorized-delete'}};
  }
  // Authorized deletion is irreversible once the durable intent commits. Keep the
  // account disabled and state intact until every object is absent. A crash/failure
  // leaves the intent and the next recovery attempt repeats the idempotent deletion.
  async finish(uid,finalize){
    if(!uidOK(uid)||this.pending()!==uid)throw Error('missing deletion intent');
    const before=await inventory(this.bucket,uid);
    // Bound each recovery request; the durable intent stays until the last batch
    // is verified. Return false (not success) when more work remains.
    const keys=before.objects.slice(0,DELETE_BATCH).map(o=>o.key);
    if(keys.length){
      await this.bucket.delete(keys);
      for(const key of keys)if(await this.bucket.head(key))throw Error('account media delete not verified');
    }
    if((await inventory(this.bucket,uid)).usage.count)return false;
    this.a.tx(()=>{
      if(this.pending()!==uid||!this.a.user(uid)?.disabled)throw Error('deletion intent changed');
      finalize(uid);
      this.a.q('DELETE FROM media_gc WHERE uid=?',uid);
      this.a.q('DELETE FROM media_delete_intent WHERE uid=?',uid);
    });
    return true;
  }
}
