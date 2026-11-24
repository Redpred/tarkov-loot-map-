import path from 'node:path';
import assert from 'node:assert/strict';
import {parseArgs} from 'node:util';
import {copyClientSnapshot,verifyClientSnapshot} from './lib/client-snapshot.mjs';
const root=path.resolve(import.meta.dirname,'..');
const {values}=parseArgs({options:{source:{type:'string'},out:{type:'string'},include:{type:'string'},verify:{type:'string'},help:{type:'boolean'}}});
if(values.help){console.log('snapshot-client.mjs --source=<EFT installation> --out=work/<new-client-copy> [--include=EscapeFromTarkov.exe,EscapeFromTarkov_Data/resources.assets]\nsnapshot-client.mjs --verify=work/<client-copy>');process.exit(0);}
const directory=path.resolve(root,values.verify||values.out||'');assert(directory.startsWith(path.join(root,'work')+path.sep),'Snapshot must be under project work/');
const result=values.verify?await verifyClientSnapshot(directory):(assert(values.source&&values.out,'--source and --out are required'),await copyClientSnapshot({source:path.resolve(values.source),output:directory,...(values.include?{include:values.include.split(',')}:{})}));
console.log(JSON.stringify({files:result.files.length,bytes:result.files.reduce((n,f)=>n+f.bytes,0),directory,verified:true}));
