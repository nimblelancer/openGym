import { encode, decode, validMeta, metaHash, Corrupt, TooLarge, MAX_STORED } from './codec.js';
import { transition, validate, record, forClient } from '../sync/transition.js';
const fail=(status,error)=>({status,body:{error}});
export class StateStore {
  constructor(storage){
    this.storage=storage;this.sql=storage.sql;this.metrics={metaQueries:0,chunkQueries:0,rowsRead:0,rowsWritten:0,bytesWritten:0};
    storage.transactionSync(()=>{
      this.sql.exec('CREATE TABLE IF NOT EXISTS schema_version (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL)');
      const v=this.sql.exec('SELECT version FROM schema_version WHERE id=1').toArray()[0];
      if(v&&v.version!==1)throw new Error('unsupported schema');
      this.sql.exec('CREATE TABLE IF NOT EXISTS profile_state (profile_id TEXT PRIMARY KEY, rev INTEGER NOT NULL, wid TEXT, byte_count INTEGER NOT NULL, chunk_count INTEGER NOT NULL, digest TEXT NOT NULL, updated_at INTEGER NOT NULL, integrity TEXT NOT NULL)');
      this.sql.exec('CREATE TABLE IF NOT EXISTS profile_chunks (profile_id TEXT NOT NULL, idx INTEGER NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY(profile_id,idx))');
      this.sql.exec('CREATE TABLE IF NOT EXISTS corrupt_profiles (profile_id TEXT PRIMARY KEY)');
      if(!v)this.sql.exec('INSERT INTO schema_version VALUES(1,1)');
    });
  }
  query(q,...a){const cursor=this.sql.exec(q,...a);const rows=cursor.toArray();this.metrics.rowsRead+=cursor.rowsRead||0;this.metrics.rowsWritten+=cursor.rowsWritten||0;return rows;}
  meta(id){
    this.metrics.metaQueries++;
    if(this.query('SELECT profile_id FROM corrupt_profiles WHERE profile_id=?',id).length)throw new Corrupt('known corrupt profile');
    const m=this.query('SELECT * FROM profile_state WHERE profile_id=?',id)[0];
    if(m&&!validMeta(m))throw new Corrupt('metadata integrity');
    return m;
  }
  current(id){
    const m=this.meta(id);this.metrics.chunkQueries++;
    // Limit rows before materializing; unexpected additional rows are corruption.
    const rows=this.query('SELECT idx,bytes FROM profile_chunks WHERE profile_id=? ORDER BY idx LIMIT 17',id);
    if(!m){if(rows.length)throw new Corrupt('orphan chunks');return null;}
    return decode(m,rows);
  }
  save(id,state,{fault,now=Date.now()}={}){
    const e=encode(state);
    const m={profile_id:id,rev:state._rev||0,wid:state._wid||null,byte_count:e.byteCount,chunk_count:e.chunks.length,digest:e.digest,updated_at:now};
    m.integrity=metaHash(m);
    this.query('DELETE FROM profile_chunks WHERE profile_id=?',id);
    e.chunks.forEach((b,i)=>{this.query('INSERT INTO profile_chunks VALUES(?,?,?)',id,i,b);if(i===0&&fault==='chunk')throw new Error('injected chunk failure');});
    this.query('INSERT OR REPLACE INTO profile_state VALUES(?,?,?,?,?,?,?,?)',id,m.rev,m.wid,m.byte_count,m.chunk_count,m.digest,m.updated_at,m.integrity);
    if(fault==='metadata')throw new Error('injected metadata failure');
    this.metrics.bytesWritten+=e.byteCount;
    return m;
  }
  error(id,e){
    if(e instanceof Corrupt){try{this.query('INSERT OR IGNORE INTO corrupt_profiles VALUES(?)',id);}catch{}return {kind:'corrupt'};}
    if(e instanceof TooLarge)return {kind:'too_large'};
    return {kind:'unavailable'};
  }
  async read(id){try{const s=this.current(id);return s?{kind:'ok',state:s}:{kind:'missing'};}catch(e){return this.error(id,e);}}
  async revision(id){try{const m=this.meta(id);return m?{kind:'ok',rev:m.rev,...(m.wid?{wid:m.wid}:{})}:{kind:'missing',rev:0};}catch(e){return this.error(id,e);}}
  async compareAndWrite(id,body,ctx={}){
    const invalid=validate(body);if(invalid)return invalid;
    try{
      return this.storage.transactionSync(()=>{
        const cur=this.current(id),result=transition(cur,body,ctx);
        if(result.next)this.save(id,result.next,ctx);
        return {status:result.status,body:result.body};
      });
    }catch(e){const k=this.error(id,e).kind;return k==='too_large'?fail(413,'state too large after stamping'):fail(503,'state unreadable');}
  }
  async importSnapshot(id,snapshot,mode,ctx={}){
    if(!record(snapshot)||snapshot.schema!==1||snapshot.profile!==id||!record(snapshot.state)||!['seed-dry-run','seed'].includes(mode))return fail(400,'invalid snapshot or mode');
    const s=snapshot.state;
    if(validate({state:s})||!Number.isSafeInteger(s._rev)||s._rev<0||
      (s._wid!=null&&!/^[0-9a-f]{16}$/.test(s._wid))||
      (s._wids!=null&&(!Array.isArray(s._wids)||s._wids.length>50||s._wids.some(w=>typeof w!=='string')))||
      Object.hasOwn(s,'active'))return fail(400,'invalid snapshot state');
    try{
      const e=encode(s);if(e.digest!==snapshot.digest)return fail(400,'snapshot digest mismatch');
      return this.storage.transactionSync(()=>{
        const cur=this.current(id);
        if(cur){if(encode(cur).digest===e.digest)return {status:200,body:{ok:true,identical:true,rev:cur._rev||0}};
          return fail(409,'profile exists; live restore not supported');}
        if(mode==='seed-dry-run')return {status:200,body:{ok:true,dryRun:true,rev:s._rev,bytes:e.byteCount}};
        this.save(id,s,ctx);return {status:200,body:{ok:true,rev:s._rev}};
      });
    }catch(e){if(e instanceof RangeError)return fail(400,'invalid snapshot state');return this.error(id,e).kind==='too_large'?fail(413,'state too large after stamping'):fail(503,'state unreadable');}
  }
}
export function stateResponse(r){return r.kind==='missing'?{status:200,body:{state:null,rev:0}}:r.kind==='ok'?{status:200,body:{state:forClient(r.state),rev:r.state._rev||0}}:fail(503,'state unreadable');}
export function revisionResponse(r){return ['ok','missing'].includes(r.kind)?{status:200,body:{rev:r.rev,...(r.wid?{wid:r.wid}:{})}}:fail(503,'state unreadable');}
