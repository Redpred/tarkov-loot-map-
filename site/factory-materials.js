import * as THREE from 'three';
import {loadCachedTexture} from './atlas-resource-cache.js';
import {buildingCutGLSL} from './atlas-building-cut-shader.js';

const vertexShader = `
attribute vec4 paintWeight;
varying vec3 world;
varying vec2 rawUV;
varying vec3 paint;
void main(){
  vec4 p=vec4(position,1.);
  #ifdef USE_INSTANCING
  p=instanceMatrix*p;
  #endif
  p=modelMatrix*p;world=p.xyz;rawUV=uv;paint=paintWeight.rgb;
  gl_Position=projectionMatrix*viewMatrix*p;
}`;
const fragmentShader = `
varying vec3 world;
varying vec2 rawUV;
varying vec3 paint;
uniform float low,high,cutoff,opacity,blend;
uniform vec4 tint,uvTransform,layer0UV,layer1UV,layer2UV;
uniform vec3 layer0Color,layer1Color,layer2Color,emissionColor;
uniform sampler2D baseMap,layer0Map,layer1Map,layer2Map,heightMap,emissionMap;
#ifdef BUILDING_CUTS
${buildingCutGLSL}
#endif
vec2 st(vec2 uv,vec4 transform){return uv*transform.xy+transform.zw;}
void main(){
  if(world.y<low||world.y>high)discard;
  #ifdef BUILDING_CUTS
  if(world.y>buildingHigh(world,high))discard;
  #endif
  vec4 sampleColor=texture2D(baseMap,st(rawUV,uvTransform));
  vec3 color=sampleColor.rgb*tint.rgb;
  #ifdef VERTEX_PAINT
  vec3 hw=texture2D(heightMap,rawUV).rgb*paint;
  vec3 weights=vec3(1.,0.,0.);
  float strongest=max(hw.r,max(hw.g,hw.b));
  if(strongest>0.00001){weights=pow(max(hw/strongest,vec3(0.00001)),vec3(max(blend,1.)));weights/=max(dot(weights,vec3(1.)),0.00001);}
  vec3 c0=texture2D(layer0Map,st(rawUV,layer0UV)).rgb*layer0Color;
  vec3 c1=texture2D(layer1Map,st(rawUV,layer1UV)).rgb*layer1Color;
  vec3 c2=texture2D(layer2Map,st(rawUV,layer2UV)).rgb*layer2Color;
  color=(c0*weights.r+c1*weights.g+c2*weights.b)*tint.rgb;
  #endif
  if(sampleColor.a<cutoff)discard;
  vec3 normal=normalize(cross(dFdx(world),dFdy(world)));
  float light=.72+.28*abs(dot(normal,normalize(vec3(.35,1.,.6))));
  color*=light;
  #ifdef EMISSIVE
  color+=texture2D(emissionMap,st(rawUV,uvTransform)).rgb*emissionColor;
  #endif
  float alpha=1.;
  #ifdef DECAL
  alpha=sampleColor.a*opacity;
  if(alpha<.025)discard;
  #endif
  gl_FragColor=vec4(color,alpha);
  #include <colorspace_fragment>
}`;

function buildMaterial(source,clipping,get){
  const vector=value=>new THREE.Vector4(...(value||[1,1,0,0]));
  const color=value=>new THREE.Vector3(...(value||[1,1,1]).slice(0,3));
    const layers=source.vp?.layers||[],decal=source.role==='decal';
    const rawTint=source.col||[1,1,1,1];
    const linearTint=new THREE.Color().setRGB(rawTint[0],rawTint[1],rawTint[2],THREE.SRGBColorSpace);
    return new THREE.ShaderMaterial({
      side:THREE.DoubleSide,transparent:decal,depthWrite:!decal,
      polygonOffset:decal,polygonOffsetFactor:-1,polygonOffsetUnits:-1,
      defines:{...(clipping.buildingCutEnabled?{BUILDING_CUTS:1}:{}),...(source.vp?{VERTEX_PAINT:1}:{}),...(decal?{DECAL:1}:{}),...(source.emis?{EMISSIVE:1}:{})},
      uniforms:{...clipping,baseMap:{value:get(source.tex)},tint:{value:new THREE.Vector4(linearTint.r,linearTint.g,linearTint.b,rawTint[3])},
        uvTransform:{value:vector(source.uv)},cutoff:{value:source.role==='cutout'?(source.cut??.5):0},
        opacity:{value:source.col?.[3]??1},blend:{value:source.vp?.blend??1},
        heightMap:{value:get(source.vp?.heights)},
        layer0Map:{value:get(layers[0]?.tex)},layer1Map:{value:get(layers[1]?.tex)},layer2Map:{value:get(layers[2]?.tex)},
        layer0UV:{value:vector(layers[0]?.uv)},layer1UV:{value:vector(layers[1]?.uv)},layer2UV:{value:vector(layers[2]?.uv)},
        layer0Color:{value:color(layers[0]?.col)},layer1Color:{value:color(layers[1]?.col)},layer2Color:{value:color(layers[2]?.col)},
        emissionMap:{value:get(source.emis)},emissionColor:{value:color(source.emisCol)}},
      vertexShader,fragmentShader,
    });

}

function textureNames(source){return [...new Set([source.tex,source.emis,source.vp?.heights,...(source.vp?.layers||[]).map(l=>l.tex)].filter(Boolean))];}
export function createMaterialLibrary(manifest,clipping,base='data/atlas/'){
  const loader=new THREE.TextureLoader(),textures=new Map(),materials=new Map();
  const white=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);white.needsUpdate=true;
  async function ensureTexture(name,signal){
    signal?.throwIfAborted();
    if(!manifest.textures[name])return white;
    if(!textures.has(name)){
      const entry={refs:0,texture:null};
      const file=manifest.textures[name].file;
      entry.promise=loadCachedTexture(loader,file.startsWith('/')?file:base+file,manifest.textures[name],undefined,signal).then(texture=>{
        texture.colorSpace=manifest.textures[name].colorSpace==='linear'?THREE.NoColorSpace:THREE.SRGBColorSpace;
        texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.flipY=true;texture.anisotropy=4;entry.texture=texture;return texture;
      }).catch(e=>{textures.delete(name);throw e;});
      textures.set(name,entry);
    }
    return textures.get(name).promise;
  }
  function release(ids){
    for(const id of new Set(ids)){
      const m=materials.get(id);if(!m||--m.refs>0)continue;
      m.material.dispose();materials.delete(id);
      for(const name of m.names){const t=textures.get(name);if(t&&--t.refs<=0){t.texture?.dispose();textures.delete(name);}}
    }
  }
  async function acquire(ids,progress=()=>{},signal){
    signal?.throwIfAborted();
    const controller=new AbortController(),abort=()=>controller.abort();
    signal?.addEventListener('abort',abort,{once:true});
    const unique=[...new Set(ids)],needed=[...new Set(unique.filter(id=>!materials.has(id)).flatMap(id=>textureNames(manifest.materials[id])))];
    let cursor=0,done=0;
    try{
      const results=await Promise.allSettled(Array.from({length:4},async()=>{
        try{while(cursor<needed.length){controller.signal.throwIfAborted();await ensureTexture(needed[cursor++],controller.signal);progress(++done,needed.length);}}
        catch(error){controller.abort();throw error;}
      }));
      const failure=results.find(r=>r.status==='rejected'&&r.reason.name!=='AbortError')||results.find(r=>r.status==='rejected');if(failure)throw failure.reason;
      signal?.throwIfAborted();
      for(const id of unique){
        if(!materials.has(id)){
          const names=textureNames(manifest.materials[id]);for(const name of names)if(textures.has(name))textures.get(name).refs++;
          const material=buildMaterial(manifest.materials[id],clipping,name=>textures.get(name)?.texture||white);
          material.userData.atlasRole=manifest.materials[id].role;
          materials.set(id,{refs:0,names,material});
        }
        materials.get(id).refs++;
      }
      return new Map(unique.map(id=>[id,materials.get(id).material]));
    }catch(error){
      for(const [name,t] of textures)if(t.refs===0){t.texture?.dispose();textures.delete(name);}
      throw error;
    }finally{signal?.removeEventListener('abort',abort);}
  }
  return {acquire,release,dispose(){for(const m of materials.values())m.material.dispose();materials.clear();for(const t of textures.values())t.texture?.dispose();textures.clear();white.dispose();}};
}
export async function loadFactoryMaterials(manifest,clipping,progress,base='data/atlas/'){
  const library=createMaterialLibrary(manifest,clipping,base);
  const materials=await library.acquire(manifest.materials.map((_,i)=>i),progress);
  return manifest.materials.map((_,i)=>materials.get(i));
}
