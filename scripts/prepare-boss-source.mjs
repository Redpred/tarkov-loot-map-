import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';

const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'data/bosses/1ee2b75');
const commit='1ee2b758d2584958f103316ba3f3155f8fbe103e';
const prefix='Libraries/SPTushonka.Server.Assets/SPT_Data/';
const sha256=b=>crypto.createHash('sha256').update(b).digest('hex');
const blob=b=>crypto.createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
const tree=execFileSync('git',['-C',path.join(root,'work/spt5-source'),'ls-tree','-rl',commit,prefix],{encoding:'utf8',maxBuffer:10e6}).split('\n')
  .map(l=>/^\d+ blob ([0-9a-f]+)\s+(\d+)\t(.+)$/.exec(l)).filter(Boolean).map(m=>({sha:m[1],size:+m[2],path:m[3]}));
const selected=tree.filter(e=>/\/bots\/types\/(boss[^/]*|follower[^/]*|blackdivision|pmcbotblackdiv|sectant[^/]*|tagillahelperagro|exusec|infectedtagilla|ravangezryachiyevent|gifter)\.json$/.test(e.path)||/\/configs\/(bot|seasonalevents)\.json$/.test(e.path));
const files=[];
for(const entry of selected){
  const relative=entry.path.slice(prefix.length),destination=path.join(out,'raw',relative);
  let bytes,method;
  for(const candidate of [destination,path.join(root,'work/boss-source-review-20261020/raw',relative)]){
    if(fs.existsSync(candidate)){const b=fs.readFileSync(candidate);if(blob(b)===entry.sha){bytes=b;method='verified_existing';break;}}
  }
  if(!bytes){
    try{bytes=execFileSync('git',['-C',path.join(root,'work/spt5-source'),'cat-file','blob',entry.sha],{env:{...process.env,GIT_NO_LAZY_FETCH:'1'},stdio:['ignore','pipe','pipe'],timeout:10000,maxBuffer:10e6});method='git_blob';}
    catch{const r=await fetch(`https://api.github.com/repos/SP-Tushonka/server-csharp/git/blobs/${entry.sha}`,{headers:{'User-Agent':'tarkov-loot-map','Accept':'application/vnd.github.raw+json'},signal:AbortSignal.timeout(40000)});if(!r.ok)throw Error(`HTTP ${r.status}`);bytes=Buffer.from(await r.arrayBuffer());method='pinned_download';}
  }
  if(bytes.length!==entry.size||blob(bytes)!==entry.sha)throw Error(`Source mismatch: ${relative}`);
  JSON.parse(bytes);
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  if(!fs.existsSync(destination))fs.writeFileSync(destination,bytes,{flag:'wx'});
  files.push({path:path.relative(root,destination).replaceAll('\\','/'),repositoryPath:entry.path,sha256:sha256(bytes),gitBlob:entry.sha,bytes:bytes.length,method});
}
const manifest={version:1,repository:'https://github.com/SP-Tushonka/server-csharp',commit,eftBuild:47965,eftVersion:'1.2.0.0.47965',files};
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(`${files.length} verified source files`);
