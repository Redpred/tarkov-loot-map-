import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {ATLAS_MAPS} from '../site/atlas-maps.js';
import {DEFAULT_TEXTURE_QUALITY,selectTextureManifest} from '../site/atlas-texture-quality.js';
import {mipBytes} from './build-texture-quality.mjs';

const root=path.resolve(import.meta.dirname,'..'),args=process.argv.slice(2),arg=name=>args[args.indexOf(name)+1];
if(!args.includes('--directory'))throw new Error('Required: --directory <generated or site/data/model-quality> [--snapshot <snapshot>] [--map factory,streets] [--report <file>]');
const directory=path.resolve(arg('--directory'));
const ids=args.includes('--map')?arg('--map').split(','):Object.keys(ATLAS_MAPS);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fileHash(file){const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');}
const result={schemaVersion:1,checkedAt:new Date().toISOString(),maps:[]};
for(const id of ids){
  const map=ATLAS_MAPS[id];if(!map)throw new Error(`Unknown map: ${id}`);
  const manifestBytes=await fs.readFile(path.join(root,'site',map.geometry));
  const manifest=JSON.parse(manifestBytes);
  const catalog=JSON.parse(await fs.readFile(path.join(directory,id,'manifest.json'),'utf8'));
  assert.deepEqual(Object.keys(catalog.variants),[DEFAULT_TEXTURE_QUALITY]);
  let sourceFiles=0,sourceBytes=0;
  if(args.includes('--snapshot')){
    const snapshot=path.resolve(arg('--snapshot')),inventory=JSON.parse(await fs.readFile(path.join(snapshot,`${id}-inventory.json`),'utf8'));
    assert.equal(inventory.sourceManifestSha256,hash(manifestBytes),'Active source manifest changed');
    for(const entry of inventory.files){
      const file=path.resolve(snapshot,entry.file);if(!file.startsWith(snapshot+path.sep))throw new Error('Invalid inventory path');
      if((await fs.stat(file)).size!==entry.bytes||await fileHash(file)!==entry.sha256)throw new Error(`Source changed: ${file}`);
      sourceFiles++;sourceBytes+=entry.bytes;
    }
  }
  const summary={mapId:id,sourceFiles,sourceBytes,geometryBytes:manifest.stats.sectorBytes||manifest.stats.bytes,original:{textureBytes:Object.values(manifest.textures).reduce((n,t)=>n+t.bytes,0),rgbaMipBytes:Object.values(manifest.textures).reduce((n,t)=>n+mipBytes(t.size),0)}};
  const quality=DEFAULT_TEXTURE_QUALITY;
  await selectTextureManifest(manifest,catalog,id,quality);
  let textureBytes=0,rgbaMipBytes=0;
  for(const entry of Object.values(catalog.variants[quality].textures)){
    const bytes=await fs.readFile(path.join(directory,id,entry.file));
    if(bytes.length!==entry.bytes||hash(bytes)!==entry.sha256)throw new Error(`Texture hash mismatch: ${entry.file}`);
    const image=await sharp(bytes).metadata();
    if(image.format!=='webp'||image.width!==entry.size[0]||image.height!==entry.size[1])throw new Error(`Texture format/dimension mismatch: ${entry.file}`);
    textureBytes+=bytes.length;rgbaMipBytes+=mipBytes(entry.size);
  }
  if(textureBytes!==catalog.variants[quality].stats.textureBytes||rgbaMipBytes!==catalog.variants[quality].stats.rgbaMipBytes)throw new Error(`Invalid texture totals: ${id}/${quality}`);
  summary[quality]={textureBytes,rgbaMipBytes};
  result.maps.push(summary);console.log(`${id}: source binding, hashes, dimensions and materials verified`);
}
result.totals=result.maps.reduce((sum,m)=>{sum.geometryBytes+=m.geometryBytes;for(const q of ['original',DEFAULT_TEXTURE_QUALITY])for(const field of ['textureBytes','rgbaMipBytes'])sum[q][field]+=m[q][field];return sum;},{geometryBytes:0,original:{textureBytes:0,rgbaMipBytes:0},[DEFAULT_TEXTURE_QUALITY]:{textureBytes:0,rgbaMipBytes:0}});
if(args.includes('--report'))await fs.writeFile(path.resolve(arg('--report')),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result.totals));
