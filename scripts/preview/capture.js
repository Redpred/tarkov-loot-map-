import * as THREE from 'three';
import {ATLAS_MAPS} from '/atlas-maps.js';
import {createMaterialLibrary} from '/factory-materials.js';
import {buildGeometryGroups} from '/atlas-sectors.js';
import {resourceCache,sha256} from '/atlas-resource-cache.js';
import {UNITY_TO_VIEW_SCALE} from '/factory-coordinates.js';

const $=id=>document.getElementById(id),width=1440,height=960;
const renderer=new THREE.WebGLRenderer({canvas:$('preview'),antialias:true,preserveDrawingBuffer:true,powerPreference:'high-performance'});
renderer.setSize(width,height,false);renderer.setPixelRatio(1);renderer.setClearColor('#101820');renderer.autoClear=false;
for(const map of Object.values(ATLAS_MAPS))$('map').add(new Option(map.name,map.id));
resourceCache.setEnabled(false);
const nextFrame=()=>new Promise(resolve=>setTimeout(resolve,0));
async function json(url){const r=await fetch(url);if(!r.ok)throw new Error(`${url}: HTTP ${r.status}`);return r.json();}

async function capture(map){
  const started=performance.now();
  $('status').textContent=`${map.name}：读取场景…`;
  const manifest=await json('/'+map.geometry);
  // Frame the full retained scene after scenery cleanup. Loot-only bounds can
  // crop roofs, building edges or ship decks even with every height enabled.
  const bounds={minX:manifest.bounds.min[0],maxX:manifest.bounds.max[0],minZ:manifest.bounds.min[2],maxZ:manifest.bounds.max[2]};
  const span=Math.max(bounds.maxZ-bounds.minZ+18,(bounds.maxX-bounds.minX+18)*height/width)*1.18;
  const cx=(bounds.minX+bounds.maxX)/2,cz=-(bounds.minZ+bounds.maxZ)/2;
  const camera=new THREE.OrthographicCamera(-span*width/height/2,span*width/height/2,span/2,-span/2,.1,manifest.bounds.max[1]-manifest.bounds.min[1]+1000);
  // The viewer's default azimuth is 180 degrees: X decreases toward the right.
  camera.position.set(cx,manifest.bounds.max[1]+250,cz);camera.up.set(0,0,1);camera.lookAt(cx,manifest.bounds.min[1],cz);camera.updateMatrixWorld();
  // Home previews show every floor and roof, regardless of viewer floor settings.
  const clipping={low:{value:manifest.bounds.min[1]-1},high:{value:manifest.bounds.max[1]+1}};
  const scene=new THREE.Scene(),world=new THREE.Group();world.scale.set(...UNITY_TO_VIEW_SCALE);scene.add(world);
  const library=createMaterialLibrary(manifest,clipping,'/'+map.textureBase);
  renderer.clear(true,true,true);
  let drawn=0;
  try{
    const materials=await library.acquire(manifest.materials.map((_,i)=>i),(done,total)=>{$('status').textContent=`${map.name}：材质 ${done}/${total}`;});
    const sectors=map.streamed?manifest.sectors:[{file:null,binary:manifest.binary,sha256:manifest.sha256}];
    for(let n=0;n<sectors.length;n++){
      const sector=sectors[n];$('status').textContent=`${map.name}：绘制分区 ${n+1}/${sectors.length}`;
      const detail=sector.file?await json('/'+map.textureBase+sector.file):manifest;
      const response=await fetch('/'+map.textureBase+sector.binary);if(!response.ok)throw new Error(`模型 HTTP ${response.status}`);
      const buffer=await response.arrayBuffer();
      if(await sha256(buffer)!==sector.sha256)throw new Error(`${map.id} 模型校验失败`);
      // Keep the framebuffer and depth buffer while retiring each mesh batch.
      // Every sector contributes to the same camera; this is a full scene render.
      for(let start=0;start<detail.meshes.length;start+=160){
        const groups=buildGeometryGroups({meshes:detail.meshes.slice(start,start+160)},buffer,materials),matrix=new THREE.Matrix4();
        for(const g of groups){let count=0;
          for(let i=0;i<g.instances;i++){
            if(g.boxes[i*6+4]<clipping.low.value||g.boxes[i*6+1]>clipping.high.value)continue;
            const m=g.matrices.subarray(i*12,i*12+12);
            matrix.set(m[0],m[1],m[2],m[3],m[4],m[5],m[6],m[7],m[8],m[9],m[10],m[11],0,0,0,1);g.mesh.setMatrixAt(count++,matrix);
          }
          g.mesh.count=count;g.mesh.visible=count>0;g.mesh.instanceMatrix.needsUpdate=true;
          if(count){g.mesh.computeBoundingSphere();drawn+=count;}world.add(g.mesh);
        }
        renderer.render(scene,camera);
        for(const g of groups){world.remove(g.mesh);g.mesh.dispose();g.mesh.geometry.dispose();}
        renderer.renderLists.dispose();await nextFrame();
      }
    }
    const blob=await new Promise(resolve=>$('preview').toBlob(resolve,'image/webp',.9));
    if(!blob)throw new Error('无法保存截图');
    const saved=await fetch(`/__capture/save?map=${map.id}`,{method:'POST',headers:{'Content-Type':'image/webp'},body:blob});
    if(!saved.ok)throw new Error(await saved.text());
    const entry=await saved.json();
    const row=document.createElement('p');row.textContent=`${map.name} ✓ ${width}×${height} · ${Math.round(entry.bytes/1024)} KiB · ${drawn.toLocaleString()} 个场景实例 · ${Math.round((performance.now()-started)/1000)} 秒`;$('results').append(row);
  }finally{library.dispose();renderer.renderLists.dispose();}
}
async function run(ids){
  $('capture').disabled=$('all').disabled=true;
  try{for(const id of ids)await capture(ATLAS_MAPS[id]);$('status').textContent=`完成：${ids.length} 张全景图`;}
  catch(error){$('status').textContent='失败：'+error.message;console.error(error);}
  finally{$('capture').disabled=$('all').disabled=false;}
}
$('capture').onclick=()=>run([$('map').value]);
$('all').onclick=async()=>{const ready=await json('/__capture/existing');run(Object.keys(ATLAS_MAPS).filter(id=>!ready.includes(id)));};
