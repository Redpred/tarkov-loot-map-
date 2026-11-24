import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {ATLAS_MAPS} from '../site/atlas-maps.js';
const root=path.resolve(import.meta.dirname,'..');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'site/data/atlas-catalog.json')));
const layers=[];let total=0;
for(let i=0;i<catalog.maps.length;i++){
  const map=catalog.maps[i],p=map.preview;assert.ok(p,map.id);
  const geometry=JSON.parse(fs.readFileSync(path.join(root,'site',ATLAS_MAPS[map.id].geometry),'utf8'));
  assert.equal(p.recipeVersion,4,map.id);assert.equal(p.band,'all',map.id);
  assert.deepEqual(p.heightRange,[geometry.bounds.min[1]-1,geometry.bounds.max[1]+1],map.id);
  assert.equal(p.geometrySha256,geometry.sourceGeometrySha256||geometry.sha256,map.id);
  const image=fs.readFileSync(path.join(root,'site',p.file));assert.equal(crypto.createHash('sha256').update(image).digest('hex'),p.sha256);
  const metadata=await sharp(image).metadata();assert.equal(metadata.width,1440);assert.equal(metadata.height,960);
  const stats=await sharp(image).stats();assert.ok(stats.channels.some(c=>c.stdev>8),map.id+' appears blank');total+=image.length;
  const left=(i%4)*360,top=Math.floor(i/4)*266;
  layers.push({input:await sharp(image).resize(360,240).toBuffer(),left,top});
  const label=Buffer.from(`<svg width="360" height="26"><rect width="360" height="26" fill="#19252b"/><text x="12" y="19" fill="#e3e7df" font-size="15" font-family="Microsoft YaHei">${ATLAS_MAPS[map.id].name}</text></svg>`);
  layers.push({input:label,left,top:top+240});
}
await sharp({create:{width:1440,height:Math.ceil(catalog.maps.length/4)*266,channels:3,background:'#101820'}}).composite(layers).png().toFile(path.join(root,'work/preview-review.png'));
console.log(JSON.stringify({maps:catalog.maps.length,totalKiB:Math.round(total/1024),validated:true}));
