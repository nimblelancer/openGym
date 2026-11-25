// Temporary public dependency lockfile handoff; do not print environment or credentials.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const bytes = readFileSync('package-lock.json');
const lock = JSON.parse(bytes);
for (const item of Object.values(lock.packages || {})) {
  if (!item.resolved) continue;
  const u = new URL(item.resolved);
  if (u.protocol !== 'https:' || u.hostname !== 'registry.npmjs.org' || u.username || u.password || u.search || u.hash) {
    throw new Error('non-public registry resolution; refusing log handoff');
  }
}
console.log('POC_LOCK_SHA256=' + createHash('sha256').update(bytes).digest('hex'));
const b64 = bytes.toString('base64');
for (let i=0;i<b64.length;i+=2048) console.log('POC_LOCK_CHUNK=' + b64.slice(i,i+2048));
