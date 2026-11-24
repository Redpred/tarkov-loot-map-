import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';

const script=name=>fileURLToPath(new URL('../'+name,import.meta.url));
export async function createResourceArchive(source,destination,name,rootName=path.basename(source)){
  const temporary=path.join(destination,name+'.zip');
  const child=spawn(process.execPath,[script('run-atlas-python.mjs'),script('zip-resource-pack.py'),source,temporary,rootName,script('resource-pack-readme.txt')],{stdio:'inherit',windowsHide:true});
  const [code]=await once(child,'exit');if(code!==0)throw Error('资源包压缩失败');
  const digest=createHash('sha256');let bytes=0;
  for await(const chunk of createReadStream(temporary)){digest.update(chunk);bytes+=chunk.length;}
  const sha256=digest.digest('hex');await fs.rename(temporary,path.join(destination,sha256+'.zip'));
  return {sha256,bytes,url:`/resource-packs/${sha256}.zip`};
}
export async function createResourceCollection(bundles,destination,packs){
  const archive=await createResourceArchive(bundles,destination,'all-maps','maps');
  return {mapIds:packs.map(pack=>pack.mapId),quality:packs[0].quality,resourceBytes:packs.reduce((n,pack)=>n+pack.resourceBytes,0),...archive};
}
