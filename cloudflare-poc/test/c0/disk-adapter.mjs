// Synthetic disk adapter: same ordinary methods/options as pinned Capacitor,
// no exclusive create, lock, CAS, fsync or rename. Not the installed bridge.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
export function diskAdapter(root, fault = {}) {
  const pathOf = path => {
    const p = resolve(root,path);
    if (p !== root && !p.startsWith(root+sep)) throw Error('outside fixture');
    return p;
  };
  return {
    async readdir({path}) {
      if (fault.list === path) throw Error('fixture directory refused');
      return {files:(await readdir(pathOf(path),{withFileTypes:true})).map(e=>({name:e.name,type:e.isDirectory()?'directory':'file'}))};
    },
    async readFile({path,encoding}) {
      if (fault.read) throw Error('fixture read refused');
      const bytes = await readFile(pathOf(path));
      return {data:encoding==='utf8'?bytes.toString('utf8'):bytes.toString('base64')};
    },
    async writeFile({path,data,encoding,recursive}) {
      if (fault.refuse) throw Error('fixture full disk');
      if (recursive) await mkdir(dirname(pathOf(path)),{recursive:true});
      const bytes=Buffer.from(data,encoding==='utf8'?'utf8':'base64');
      if (fault.partial) {
        await writeFile(pathOf(path),bytes.subarray(0,Math.max(1,bytes.length>>1)));
        if (fault.partial==='throw') throw Error('fixture interrupted write');
      } else if (!fault.silent) await writeFile(pathOf(path),bytes);
      return {uri:'fixture'};
    }
  };
}
