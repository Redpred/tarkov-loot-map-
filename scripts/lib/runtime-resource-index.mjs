import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {runtimeInputs,RUNTIME_VERSION} from '../../site/atlas-runtime.js';

const stamp=stat=>`${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
export function createRuntimeResourceIndex(root,readManifest) {
  const hashes=new Map();
  async function fingerprint(relative) {
    const file=path.join(root,relative),before=stamp(await fs.promises.stat(file)),cached=hashes.get(file);
    if(cached?.stamp===before)return cached.value;
    const value=(async()=>{
      const hash=createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);
      if(stamp(await fs.promises.stat(file))!==before)throw new Error('Source changed');
      return hash.digest('hex');
    })();
    hashes.delete(file);hashes.set(file,{stamp:before,value});
    if(hashes.size>256)hashes.delete(hashes.keys().next().value);
    try{return await value;}catch(error){hashes.delete(file);throw error;}
  }
  return async map=>{
    const result={version:RUNTIME_VERSION,mapId:map.id,map:null,geometry:{}};
    try {
      const catalog=await readManifest(path.join(root,'data/runtime/manifest.json'));
      if(catalog.version!==RUNTIME_VERSION)return result;
      result.geometry=catalog.geometry?.[map.id]||{};
      const entry=catalog.maps?.[map.id];if(!entry)return result;
      const inputs=runtimeInputs(map);
      if(inputs.length!==Object.keys(entry.inputs||{}).length)return result;
      // Hash changed files once, not per visitor. Concurrent cold requests share
      // the same promise; unchanged files require only stat calls afterwards.
      for(const input of inputs)if(await fingerprint(input)!==entry.inputs[input])return result;
      const {file,sha256,bytes}=entry;result.map={file,sha256,bytes};
    }catch{/* Missing, stale or partially published derivatives use the legacy loader. */}
    return result;
  };
}
