import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import sharp from 'sharp';
import {ATLAS_MAPS} from '../site/atlas-maps.js';
import {TEXTURE_QUALITIES,textureSourceVersion} from '../site/atlas-texture-quality.js';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fileHash(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
export function mipBytes([width,height]){let total=0;for(;;){total+=width*height*4;if(width===1&&height===1)return total;width=Math.max(1,Math.floor(width/2));height=Math.max(1,Math.floor(height/2));}}
async function json(file,value,resume=false){const body=JSON.stringify(value,null,2)+'\n';await fs.mkdir(path.dirname(file),{recursive:true});try{await fs.writeFile(file,body,{flag:'wx'});}catch(error){if(!resume||error.code!=='EEXIST'||await fs.readFile(file,'utf8')!==body)throw error;}}
function inside(root,relative){const file=path.resolve(root,relative);if(!file.startsWith(path.resolve(root)+path.sep))throw new Error(`Unsafe asset path: ${relative}`);return file;}
async function pool(items,fn){let cursor=0;const results=await Promise.allSettled(Array.from({length:8},async()=>{while(cursor<items.length)await fn(items[cursor++]);}));const failure=results.find(r=>r.status==='rejected');if(failure)throw failure.reason;}

export async function buildTextureQuality({siteRoot,snapshotRoot,outRoot,maps=Object.values(ATLAS_MAPS),onProgress=console.log,resume=false}){
  siteRoot=path.resolve(siteRoot);snapshotRoot=path.resolve(snapshotRoot);outRoot=path.resolve(outRoot);
  const overlap=(a,b)=>a===b||a.startsWith(b+path.sep)||b.startsWith(a+path.sep);
  if(overlap(siteRoot,snapshotRoot)||overlap(siteRoot,outRoot)||overlap(snapshotRoot,outRoot))throw new Error('Source, snapshot and output must be separate directories');
  await fs.mkdir(snapshotRoot,{recursive:true});await fs.mkdir(outRoot,{recursive:true});
  const report={schemaVersion:1,createdAt:new Date().toISOString(),source:'Current project exports; no game installation reads',snapshotRoot,maps:[]};
  for(const map of maps){
    onProgress(`${map.id}: copying active model and texture resources`);
    const sourceFile=inside(siteRoot,map.geometry),savedFile=inside(snapshotRoot,map.geometry);
    await fs.mkdir(path.dirname(savedFile),{recursive:true});
    try{await fs.copyFile(sourceFile,savedFile,fs.constants.COPYFILE_EXCL);}catch(error){if(!resume||error.code!=='EEXIST'||await fileHash(sourceFile)!==await fileHash(savedFile))throw error;}
    const raw=await fs.readFile(savedFile),manifest=JSON.parse(raw),base=path.dirname(map.geometry);
    const inventory=[{file:map.geometry,bytes:raw.length,sha256:digest(raw)}];
    async function copy(relative,expected){
      const target=inside(snapshotRoot,relative);await fs.mkdir(path.dirname(target),{recursive:true});
      try{await fs.copyFile(inside(siteRoot,relative),target,fs.constants.COPYFILE_EXCL);}catch(error){if(!resume||error.code!=='EEXIST'||(!expected&&await fileHash(inside(siteRoot,relative))!==await fileHash(target)))throw error;}
      const bytes=(await fs.stat(target)).size,sha256=await fileHash(target);
      if(expected&&(sha256!==expected.sha256||bytes!==expected.bytes))throw new Error(`Snapshot source mismatch: ${relative}`);
      inventory.push({file:relative,bytes,sha256});return target;
    }
    if(map.streamed){
      for(const sector of manifest.sectors){
        const detailFile=await copy(path.join(base,sector.file));const detail=JSON.parse(await fs.readFile(detailFile,'utf8'));
        if(detail.sha256!==sector.sha256||detail.stats.bytes!==sector.stats.bytes)throw new Error(`Sector mismatch: ${sector.id}`);
        if(detail.binary!==sector.binary)throw new Error(`Sector binary mismatch: ${sector.id}`);
        await copy(path.join(base,detail.binary),{sha256:sector.sha256,bytes:sector.stats.bytes});
      }
    }else await copy(path.join(base,manifest.binary),{sha256:manifest.sha256,bytes:manifest.stats.bytes});
    // Copy first, then inspect/resize only the independent snapshot.
    await pool(Object.values(manifest.textures),entry=>copy(path.join(base,entry.file),entry));
    await json(path.join(snapshotRoot,`${map.id}-inventory.json`),{sourceManifestSha256:digest(raw),files:inventory.sort((a,b)=>a.file.localeCompare(b.file))},resume);
    onProgress(`${map.id}: generating 128px / 64px textures from snapshot`);
    const catalog={schemaVersion:1,mapId:map.id,sourceManifestSha256:await textureSourceVersion(manifest),source:{sceneSha256:manifest.sceneSha256,geometrySha256:manifest.sourceGeometrySha256||manifest.sha256,textureMaxSize:manifest.textureMaxSize},variants:{}};
    for(const quality of ['medium','low']){
      const maxSize=TEXTURE_QUALITIES[quality].maxSize,textures={};
      await fs.mkdir(path.join(outRoot,map.id,quality),{recursive:true});
      await pool(Object.entries(manifest.textures),async([name,entry])=>{
        const source=await fs.readFile(inside(snapshotRoot,path.join(base,entry.file))),metadata=await sharp(source).metadata();
        if(metadata.width!==entry.size[0]||metadata.height!==entry.size[1])throw new Error(`Texture dimensions mismatch: ${name}`);
        const buffer=Math.max(...entry.size)<=maxSize?source:await sharp(source).resize({width:maxSize,height:maxSize,fit:'inside',withoutEnlargement:true}).webp({lossless:true,effort:4}).toBuffer();
        const sha256=digest(buffer),file=`${quality}/${sha256}.webp`,{width,height,hasAlpha}=await sharp(buffer).metadata();
        if(metadata.hasAlpha&&!hasAlpha){
          // WebP legitimately omits an alpha channel when every resized pixel
          // is opaque. Check the resized pixels instead of the container flag.
          const rgba=await sharp(source).resize({width:maxSize,height:maxSize,fit:'inside',withoutEnlargement:true}).ensureAlpha().raw().toBuffer();
          for(let i=3;i<rgba.length;i+=4)if(rgba[i]!==255)throw new Error(`Lost texture alpha: ${name}`);
        }
        // Content-addressed names may be shared by equivalent textures.
        try{await fs.writeFile(path.join(outRoot,map.id,file),buffer,{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;if(await fileHash(path.join(outRoot,map.id,file))!==sha256)throw error;}
        textures[name]={file,size:[width,height],bytes:buffer.length,sha256,colorSpace:entry.colorSpace,sourceSha256:entry.sha256};
      });
      const sorted=Object.fromEntries(Object.keys(textures).sort().map(name=>[name,textures[name]]));
      catalog.variants[quality]={maxSize,stats:{textureBytes:Object.values(sorted).reduce((n,t)=>n+t.bytes,0),rgbaMipBytes:Object.values(sorted).reduce((n,t)=>n+mipBytes(t.size),0)},textures:sorted};
    }
    await json(path.join(outRoot,map.id,'manifest.json'),catalog,resume);
    report.maps.push({mapId:map.id,geometryBytes:manifest.stats.sectorBytes||manifest.stats.bytes,textureCount:Object.keys(manifest.textures).length,original:{textureBytes:Object.values(manifest.textures).reduce((n,t)=>n+t.bytes,0),rgbaMipBytes:Object.values(manifest.textures).reduce((n,t)=>n+mipBytes(t.size),0)},medium:catalog.variants.medium.stats,low:catalog.variants.low.stats});
    onProgress(`${map.id}: complete`);
  }
  await json(path.join(outRoot,'report.json'),report);return report;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const args=process.argv.slice(2),get=name=>args[args.indexOf(name)+1];
  if(!args.includes('--snapshot')||!args.includes('--out'))throw new Error('Required: --snapshot work/<new>/snapshot --out work/<new>/generated');
  const maps=args.includes('--map')?get('--map').split(',').map(id=>{if(!Object.hasOwn(ATLAS_MAPS,id))throw new Error(`Unknown map ${id}`);return ATLAS_MAPS[id];}):Object.values(ATLAS_MAPS);
  await buildTextureQuality({siteRoot:path.resolve(import.meta.dirname,'../site'),snapshotRoot:get('--snapshot'),outRoot:get('--out'),maps,resume:args.includes('--resume')});
}
