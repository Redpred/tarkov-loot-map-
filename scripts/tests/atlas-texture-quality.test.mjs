import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import * as THREE from 'three';
import {buildTextureQuality,mipBytes} from '../build-texture-quality.mjs';
import {TEXTURE_QUALITY_KEY,readTextureQuality,saveTextureQuality,selectTextureManifest,loadTextureQuality} from '../../site/atlas-texture-quality.js';
import {createMaterialLibrary} from '../../site/factory-materials.js';
import {createTextureSettings} from '../../site/atlas-texture-settings.js';

const hash=b=>createHash('sha256').update(b).digest('hex');
test('quality is shared across maps, validates input and reports unavailable storage',()=>{
  const data=new Map(),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};
  assert.equal(readTextureQuality(storage),'medium');
  assert.equal(saveTextureQuality('low',storage),true);assert.equal(readTextureQuality(storage),'low');
  assert.equal(data.get(TEXTURE_QUALITY_KEY),'low');
  data.set(TEXTURE_QUALITY_KEY,'__proto__');assert.equal(readTextureQuality(storage),'medium');
  const blocked={getItem(){throw Error();},setItem(){throw Error();}};
  assert.equal(readTextureQuality(blocked),'medium');assert.equal(saveTextureQuality('low',blocked),false);
});

test('fallback stays visible and can persist original quality instead of retrying a broken preference',()=>{
  const oldStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),oldLocation=Object.getOwnPropertyDescriptor(globalThis,'location');
  let saved='low',reloads=0;
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>saved,setItem:(key,value)=>{if(key===TEXTURE_QUALITY_KEY)saved=value;}}});
  Object.defineProperty(globalThis,'location',{configurable:true,value:{reload:()=>reloads++}});
  try{
    const nodes={'#textureQuality':{},'#applyTextureQuality':{},'#textureQualityStatus':{},'#geometryQuality':{},'#geometryQualityStatus':{},'#loadSceneryDetails':{},'#sceneryDetailsStatus':{}},ui=createTextureSettings({querySelector:id=>nodes[id]});
    ui.loaded({quality:'original',warning:'所选贴图暂不可用，本次使用原画质。'});
    assert.match(nodes['#textureQualityStatus'].textContent,/原画质/);assert.equal(nodes['#applyTextureQuality'].hidden,false);
    nodes['#textureQuality'].value='original';nodes['#textureQuality'].onchange();
    assert.equal(nodes['#applyTextureQuality'].hidden,false);assert.equal(saved,'low');
    nodes['#applyTextureQuality'].onclick();assert.equal(saved,'original');assert.equal(reloads,1);
  }finally{
    if(oldStorage)Object.defineProperty(globalThis,'localStorage',oldStorage);else delete globalThis.localStorage;
    if(oldLocation)Object.defineProperty(globalThis,'location',oldLocation);else delete globalThis.location;
  }
});

test('snapshot builder preserves geometry and alpha; lower tiers bind to the exact source and reject corruption',async t=>{
  const work=path.resolve(import.meta.dirname,'../../work');await fs.mkdir(work,{recursive:true});
  const root=await fs.mkdtemp(path.join(work,'texture-quality-test-'));
  t.after(async()=>{assert.equal(path.dirname(root),work);assert.ok(path.basename(root).startsWith('texture-quality-test-'));await fs.rm(root,{recursive:true,force:true});});
  const site=path.join(root,'site'),atlas=path.join(site,'data/atlas');await fs.mkdir(path.join(atlas,'textures'),{recursive:true});
  const pixels=Buffer.alloc(256*128*4);for(let i=0;i<pixels.length;i+=4){pixels[i]=i%251;pixels[i+1]=123;pixels[i+2]=50;pixels[i+3]=(i/4)%256;}
  const image=await sharp(pixels,{raw:{width:256,height:128,channels:4}}).webp({lossless:true}).toBuffer();
  const tiny=await sharp({create:{width:8,height:8,channels:4,background:{r:50,g:10,b:90,alpha:.25}}}).webp({lossless:true}).toBuffer();
  const binary=Buffer.from('Geometry stays unchanged'),manifest={binary:'factory-geometry.bin',sha256:hash(binary),sceneSha256:'b'.repeat(64),stats:{bytes:binary.length},textureMaxSize:256,materials:[{tex:'color'},{tex:'mask'}],textures:{color:{file:'textures/color.webp',size:[256,128],bytes:image.length,sha256:hash(image),colorSpace:'srgb'},mask:{file:'textures/mask.webp',size:[8,8],bytes:tiny.length,sha256:hash(tiny),colorSpace:'linear'}}};
  const manifestRaw=JSON.stringify(manifest);await fs.writeFile(path.join(atlas,'factory-geometry.json'),manifestRaw);await fs.writeFile(path.join(atlas,manifest.binary),binary);
  await fs.writeFile(path.join(atlas,'textures/color.webp'),image);await fs.writeFile(path.join(atlas,'textures/mask.webp'),tiny);
  const options={siteRoot:site,snapshotRoot:path.join(root,'snapshot'),outRoot:path.join(root,'generated'),maps:[{id:'factory',geometry:'data/atlas/factory-geometry.json'}],onProgress:()=>{}};
  const report=await buildTextureQuality(options),catalog=JSON.parse(await fs.readFile(path.join(options.outRoot,'factory/manifest.json'),'utf8'));
  assert.equal(await fs.readFile(path.join(atlas,'factory-geometry.json'),'utf8'),manifestRaw);
  assert.deepEqual(await fs.readFile(path.join(options.snapshotRoot,'data/atlas',manifest.binary)),binary);
  assert.deepEqual(await fs.readFile(path.join(atlas,'textures/color.webp')),image);
  assert.equal(report.maps[0].geometryBytes,binary.length);
  for(const [quality,size] of [['medium',[128,64]],['low',[64,32]]]){
    const selected=await selectTextureManifest(manifest,catalog,'factory',quality);
    assert.equal(selected.materials,manifest.materials);assert.equal(selected.sha256,manifest.sha256);
    assert.deepEqual(selected.textures.color.size,size);assert.match(selected.textures.color.file,new RegExp(`^/data/model-quality/factory/${quality}/`));
    const record=catalog.variants[quality].textures.color,b=await fs.readFile(path.join(options.outRoot,'factory',record.file));
    assert.equal(hash(b),record.sha256);assert.equal(b.length,record.bytes);
    const meta=await sharp(b).metadata();assert.equal(meta.hasAlpha,true);
    const {data}=await sharp(b).raw().toBuffer({resolveWithObject:true});const alpha=[];for(let i=3;i<data.length;i+=4)alpha.push(data[i]);assert.ok(Math.min(...alpha)<50);assert.ok(Math.max(...alpha)>200);
    assert.equal(selected.textures.mask.sha256,manifest.textures.mask.sha256);assert.equal(selected.textures.mask.colorSpace,'linear');
    assert.ok(report.maps[0][quality].rgbaMipBytes<report.maps[0].original.rgbaMipBytes);
  }
  assert.equal(await selectTextureManifest(manifest,null,'factory','original'),manifest);
  await assert.rejects(selectTextureManifest({...manifest,manualCull:{changed:true}},catalog,'factory','low'),/版本/);
  for(const mutate of [c=>delete c.variants.low.textures.mask,c=>c.mapId='streets',c=>c.variants.low.textures.color.sourceSha256='0'.repeat(64),c=>c.variants.low.textures.color.file='../original.webp',c=>c.variants.low.textures.color.colorSpace='linear',c=>c.variants.low.textures.color.size=[512,512]]){
    const bad=structuredClone(catalog);mutate(bad);await assert.rejects(selectTextureManifest(manifest,bad,'factory','low'));
  }
  let requests=0;await loadTextureQuality(manifest,'factory','original',{fetcher(){requests++;}});assert.equal(requests,0);
  const loaded=await loadTextureQuality(manifest,'factory','medium',{fetcher:async()=>({ok:true,json:async()=>catalog})});assert.equal(loaded.quality,'medium');
  const fallback=await loadTextureQuality(manifest,'factory','low',{fetcher:async()=>({ok:false,status:404})});assert.equal(fallback.quality,'original');assert.equal(fallback.manifest,manifest);assert.match(fallback.warning,/原画质/);
  await assert.rejects(buildTextureQuality(options),e=>e.code==='EEXIST');
  await assert.rejects(buildTextureQuality({...options,outRoot:path.join(site,'derived')}),/separate/);
  assert.equal(mipBytes([4,2]),44);
});

test('materials use only the chosen texture URLs and release shared GPU textures',async()=>{
  const original=THREE.TextureLoader.prototype.loadAsync,urls=[];let disposed=0;
  THREE.TextureLoader.prototype.loadAsync=async url=>{urls.push(url);const t=new THREE.Texture();t.addEventListener('dispose',()=>disposed++);return t;};
  try{
    const library=createMaterialLibrary({materials:[{tex:'shared'},{tex:'shared'}],textures:{shared:{file:'/data/model-quality/factory/low/test.webp',colorSpace:'linear'}}},{},'data/atlas/');
    const a=await library.acquire([0]),b=await library.acquire([1]);assert.deepEqual(urls,['/data/model-quality/factory/low/test.webp']);assert.equal(a.get(0).uniforms.baseMap.value,b.get(1).uniforms.baseMap.value);
    assert.equal(a.get(0).uniforms.baseMap.value.colorSpace,THREE.NoColorSpace);
    library.release([0]);assert.equal(disposed,0);library.release([1]);assert.equal(disposed,1);library.dispose();
  }finally{THREE.TextureLoader.prototype.loadAsync=original;}
});
