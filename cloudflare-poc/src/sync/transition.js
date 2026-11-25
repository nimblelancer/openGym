// AGPL-3.0-or-later. Adapted from upstream api/server.js (pinned e4a68a9).
import { stampPut } from '../../../api/sync-stamps.js';
import { randomBytes } from 'node:crypto';
export const record = x => !!x && typeof x === 'object' && !Array.isArray(x);
export const forClient = s => {
  if (!s) return s;
  const { _unstamped, _prior, ...rest } = s;
  return rest;
};
const bad = error => ({status:400,body:{error}});
// Explicit safety budget: JSON.stringify stack behavior varies by V8 version.
// Iterative traversal keeps only one iterator per level, not a stack of all sibling values.
export const MAX_DEPTH=256;
export function boundedDepth(root){
  if(!root||typeof root!=='object')return true;
  const frames=[Object.values(root)[Symbol.iterator]()];
  while(frames.length){
    const {value,done}=frames.at(-1).next();
    if(done){frames.pop();continue;}
    if(value&&typeof value==='object'){
      if(frames.length>=MAX_DEPTH)return false;
      frames.push(Object.values(value)[Symbol.iterator]());
    }
  }
  return true;
}
export function validate(body) {
  if (!record(body)) return bad('invalid json');
  const s = body.state;
  if (!s || typeof s !== 'object') return bad('state required');
  if (!Array.isArray(s) && !Object.keys(s).some(k=>k!=='_rev'&&k!=='_ts')) return bad('state required');
  if (Array.isArray(s) || ['workouts','routines'].some(k=>s[k]!=null&&!Array.isArray(s[k]))) return bad('invalid state');
  if(!boundedDepth(s))return bad('invalid state');
  return null;
}
export function transition(cur,body,{now=Date.now(),wid=()=>randomBytes(8).toString('hex')}={}) {
  const invalid=validate(body); if(invalid)return invalid;
  const rev=cur?._rev||0;
  if(body.baseRev!=null&&(body.baseRev!==rev||(typeof body.baseWid==='string'&&cur?._wid&&body.baseWid!==cur._wid))) {
    return {status:409,body:{error:'conflict',rev,state:forClient(cur)}};
  }
  try {
    const state=JSON.parse(JSON.stringify(body.state));
    for(const k of ['workouts','routines'])if(Array.isArray(state[k]))state[k]=state[k].filter(record);
    delete state.active;
    const reset=Number(cur?.resetAt)||0;
    if(reset>(Number(state.resetAt)||0)){state.resetAt=cur.resetAt;if(cur.resetIds&&typeof cur.resetIds==='object')state.resetIds=cur.resetIds;else delete state.resetIds;}
    const report={};
    stampPut(cur,state,{overRead:body.baseRev!=null&&body.baseRev===rev,stamped:body.stamped===true,now,report});
    state._rev=rev+(report.changed?2:1);
    state._wids=[...(Array.isArray(cur?._wids)?cur._wids:[]),...(cur?._wid?[cur._wid]:[])].filter(x=>typeof x==='string').slice(-50);
    state._wid=wid();
    JSON.stringify(state);
    return {status:200,body:{ok:true,ts:state._ts||null,rev:rev+1,wid:state._wid},next:state};
  }catch(e){if(e instanceof RangeError)return bad('invalid state');throw e;}
}
