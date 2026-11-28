// C0 fixture only. Never imported by the live mobile store.
import { createHash, randomBytes } from 'node:crypto';
const MAX = 1024 * 1024, DEPTH = 64, COUNT = 512; // harness bounds, not production policy
const idPattern = /^[a-f0-9]{64}$/;
const directory = 'DATA', ns = 'p7-c0-records';
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const validString = s => typeof s === 'string' && !/[\uD800-\uDFFF]/u.test(s);
const fail = reason => { throw Error(reason); };
export const digest = (domain, bytes) => createHash('sha256').update(domain + '\0').update(bytes).digest('hex');
export function canonical(value) {
  function encode(v, depth) {
    if (depth > DEPTH) fail('depth limit');
    if (v === null || typeof v === 'boolean') return JSON.stringify(v);
    if (typeof v === 'string') { if (!validString(v)) fail('invalid Unicode'); return JSON.stringify(v); }
    if (typeof v === 'number') {
      if (!Number.isFinite(v) || (Number.isInteger(v) && !Number.isSafeInteger(v)) || Object.is(v, -0)) fail('invalid number');
      return JSON.stringify(v);
    }
    if (Array.isArray(v)) {
      if (Object.keys(v).length !== v.length || Reflect.ownKeys(v).length !== v.length + 1) fail('invalid array');
      return '[' + Array.from({length:v.length}, (_, i) => {
        const d = Object.getOwnPropertyDescriptor(v, String(i));
        if (!d || !Object.hasOwn(d, 'value') || !d.enumerable) fail('invalid array element');
        return encode(d.value, depth + 1);
      }).join(',') + ']';
    }
    if (!object(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) fail('invalid object');
    const keys = Object.keys(v).sort();
    if (Reflect.ownKeys(v).length !== keys.length) fail('invalid keys');
    return '{' + keys.map(k => {
      if (!validString(k) || ['__proto__','prototype','constructor'].includes(k)) fail('invalid key');
      const d = Object.getOwnPropertyDescriptor(v, k);
      if (!Object.hasOwn(d, 'value')) fail('invalid property');
      return JSON.stringify(k) + ':' + encode(d.value, depth + 1);
    }).join(',') + '}';
  }
  const raw = encode(value, 0);
  if (Buffer.byteLength(raw) > MAX) fail('byte limit');
  return raw;
}
// Mirrors existing pairing normalization for accepted HTTP(S) inputs only.
// Credentials/query/fragment and invalid schemes are conservatively refused,
// not silently normalized to another authority. Exact subpath is retained.
export function serverIdentity(raw) {
  if (typeof raw !== 'string' || !raw.trim()) fail('invalid server');
  const s = raw.trim();
  const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : 'https://' + s);
  if (!['http:', 'https:'].includes(u.protocol) || !u.hostname || u.username || u.password || u.search || u.hash) fail('invalid server');
  return u.origin + u.pathname.replace(/\/+$/, '');
}
export function entryIdentity(entry) {
  if (!object(entry) || !['owned','held','active-only','manual','legacy-unbound'].includes(entry.kind) ||
      !Number.isSafeInteger(entry.at) || entry.at < 0 || !object(entry.payload) ||
      (entry.owner !== null && (!validString(entry.owner) || !entry.owner.trim())) ||
      (entry.server !== null && entry.server !== serverIdentity(entry.server)) ||
      (['owned','held','active-only'].includes(entry.kind) && (!entry.owner || !entry.server))) fail('invalid entry');
  const bytes = canonical({schema:1, entry});
  return {bytes, hash:digest('p7-c0-entry-v1', bytes)};
}
export function equivalent(a,b) {
  if (a.hash !== b.hash) return false;
  if (a.bytes !== b.bytes) fail('digest collision');
  return true;
}
export function makeRecord(entry, id = randomBytes(32).toString('hex')) {
  if (!idPattern.test(id)) fail('invalid publication id');
  const identity = entryIdentity(entry);
  return {schema:1, type:'entry', id, entry, digest:identity.hash};
}
export function decodeRecord(raw, id) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > MAX) fail('invalid bytes');
  const value = JSON.parse(raw);
  // Only canonical record bytes accepted. Duplicate JSON keys, alternate
  // encodings and invalid numeric representations cannot silently collapse.
  if (canonical(value) !== raw || value?.id !== id ||
      canonical(makeRecord(value.entry,id)) !== raw) fail('invalid record');
  return value;
}
async function list(fs,path) {
  const r = await fs.readdir({path,directory});
  if (!Array.isArray(r?.files) || r.files.length > COUNT) fail('inventory unavailable');
  const names = r.files.map(f => typeof f === 'string' ? f : f?.name);
  if (names.some(n => typeof n !== 'string' || !n || n.includes('/') || n.includes('\\') || ['.','..'].includes(n)) ||
      new Set(names).size !== names.length) fail('invalid inventory');
  return names;
}
async function names(fs) {
  if (!(await list(fs,'')).includes(ns)) return [];
  return list(fs,ns);
}
async function exact(fs,path) {
  // No encoding => Capacitor readFile returns base64 on native. Compare bytes
  // rather than relying on replacement-character UTF-8 decoding.
  const {data} = await fs.readFile({path,directory});
  if (typeof data !== 'string') fail('invalid native bytes');
  const bytes = Buffer.from(data,'base64');
  if (bytes.toString('base64') !== data) fail('invalid base64');
  const raw = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
  if (!Buffer.from(raw).equals(bytes)) fail('nonexact UTF8');
  return raw;
}
export async function publish(fs, record) {
  const raw = canonical(record), id = record.id;
  decodeRecord(raw,id);
  const file = id + '.json', path = ns + '/' + file;
  // Positive inventory + readback are NOT exclusive allocation or CAS.
  // Cooperating writers use independent IDs; no retry overwrites a used ID.
  if ((await names(fs)).includes(file)) fail('publication collision');
  await fs.writeFile({path,directory,data:raw,encoding:'utf8',recursive:true});
  if (await exact(fs,path) !== raw) fail('nonexact readback');
  return {id, raw};
}
export async function inventory(fs) {
  const records = [], held = [];
  for (const name of await names(fs)) {
    try {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) fail('unknown file');
      const raw = await exact(fs,ns+'/'+name);
      records.push({raw, record:decodeRecord(raw,name.slice(0,-5))});
    } catch { held.push(name); }
  }
  return {records, held, complete:held.length===0};
}
export const namespace = ns;
