import { readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
const root = resolve(process.argv[2] || '../frontend/dist');
const entries = [];
async function walk(dir) {
  for (const entry of await readdir(dir,{withFileTypes:true})) {
    const p = join(dir,entry.name);
    if (entry.isDirectory()) await walk(p);
    else if (entry.isFile()) entries.push({ path: relative(root,p), bytes:(await stat(p)).size });
    else throw Error('unexpected non-regular asset: '+p);
  }
}
await walk(root);
entries.sort((a,b)=>b.bytes-a.bytes || a.path.localeCompare(b.path));
const report = { count:entries.length,totalBytes:entries.reduce((n,e)=>n+e.bytes,0),largest:entries.slice(0,20),
  mediaCount:entries.filter(e=>e.path.startsWith('exercise-media/')).length,
  oversized:entries.filter(e=>e.bytes>25*1024*1024) };
await mkdir('reports',{recursive:true});
await writeFile('reports/assets.json', JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if (!report.mediaCount || !entries.some(e=>e.path==='index.html') || report.count>20000 || report.oversized.length) process.exitCode=1;
