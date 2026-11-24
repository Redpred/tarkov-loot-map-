import * as THREE from 'three';

export async function loadMarkerIcons(){
  const response=await fetch('data/icons/factory/manifest.json');
  if(!response.ok)throw new Error('物资图标未生成，请运行 npm run factory:icons');
  const manifest=await response.json();
  const catalogResponse=await fetch('data/icons/items/manifest.json');
  if(!catalogResponse.ok)throw new Error('完整图标库未生成，请运行 npm run icons:fetch');
  const catalog=await catalogResponse.json();
  const extraResponse=await fetch('data/icons/items/spt-extras.json');
  if(!extraResponse.ok)throw new Error('物品图标暂不可用，请稍后刷新页面');
  const extras=await extraResponse.json();
  manifest.entries={...manifest.entries,...catalog.entries,...extras.entries};
  manifest.items={...manifest.items,...catalog.items,...extras.items};
  manifest.catalog=catalog;
  manifest.extras=extras;
  // Only icons used on this map occupy GPU memory. The searchable catalogue
  // stays on disk and is never uploaded as one enormous texture.
  const canvas=document.createElement('canvas');canvas.width=canvas.height=2048;
  const context=canvas.getContext('2d'),rects=new Map();
  const texture=new THREE.CanvasTexture(canvas);
  texture.colorSpace=THREE.SRGBColorSpace;
  texture.minFilter=THREE.LinearFilter;texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=false;
  async function prepare(keys){
    const unique=[...new Set(['other',...keys])];
    if(unique.length>1024)throw new Error('当前地图使用的不同图标超过 1024 个');
    const images=await Promise.all(unique.map(async key=>{
      const entry=manifest.entries[key];if(!entry)throw new Error(`未知图标：${key}`);
      const image=new Image();image.src=entry.file;await image.decode();return image;
    }));
    // Rebuild slots atomically, so repeated changes cannot fill the atlas.
    context.clearRect(0,0,2048,2048);rects.clear();
    images.forEach((image,i)=>{
      const x=i%32*64,y=Math.floor(i/32)*64,scale=Math.min(60/image.width,60/image.height);
      const w=image.width*scale,h=image.height*scale;
      context.drawImage(image,x+(64-w)/2,y+(64-h)/2,w,h);rects.set(unique[i],[x,y,64,64]);
    });
    texture.needsUpdate=true;
  }
  return {manifest,texture,rects,prepare};
}

export function createMarkerCloud(points,{icons,descriptors,colorFor,size,pixelRatio,style,selected=false,valueRings=false}){
  const geo=new THREE.BufferGeometry();
  const ringFor=p=>typeof valueRings==='function'?valueRings(p):valueRings&&p.kind!=='poi';
  const width=2048,height=2048;
  const rects=points.flatMap(p=>{
    const [x,y,w,h]=icons.rects.get(descriptors.get(p.id).key)||icons.rects.get('other');return [x/width,1-(y+h)/height,w/width,h/height];
  });
  geo.setAttribute('position',new THREE.Float32BufferAttribute(points.flatMap(p=>[p.position.x,p.position.y+.07,p.position.z]),3));
  geo.setAttribute('color',new THREE.Float32BufferAttribute(points.flatMap(p=>new THREE.Color(selected&&!ringFor(p)?'#fff5c7':colorFor(p)).toArray()),3));
  geo.setAttribute('valueRing',new THREE.Float32BufferAttribute(points.map(p=>Number(ringFor(p))),1));
  geo.setAttribute('shape',new THREE.Float32BufferAttribute(points.map(p=>p.kind==='container'?1:0),1));
  geo.setAttribute('iconRect',new THREE.Float32BufferAttribute(rects,4));
  const mat=new THREE.ShaderMaterial({vertexColors:true,depthTest:false,depthWrite:false,transparent:true,
    uniforms:{size:{value:size*pixelRatio},atlas:{value:icons.texture},useIcons:{value:style==='icons'}},
    vertexShader:`attribute float shape;attribute vec4 iconRect;attribute float valueRing;
      varying vec3 col;varying float square;varying vec4 rect;varying float ring;uniform float size;
      void main(){col=color;square=shape;rect=iconRect;ring=valueRing;gl_PointSize=size;
      gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`varying vec3 col;varying float square;varying vec4 rect;varying float ring;
      uniform sampler2D atlas;uniform bool useIcons;
      void main(){
        vec2 p=gl_PointCoord-.5;
        if(!useIcons){
          float d=square>.5?max(abs(p.x),abs(p.y)):length(p);
          if(d>.47)discard;
          gl_FragColor=vec4(d>.34?vec3(.01,.02,.03):col,1.);
        }else{
          float d=length(p);
          if(ring>.5&&d>.40&&d<.49){gl_FragColor=vec4(col,1.);}
          else{
            vec2 uv=ring>.5?p/.78+.5:gl_PointCoord;
            if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))discard;
            vec4 icon=texture2D(atlas,rect.xy+vec2(uv.x,1.-uv.y)*rect.zw);
            if(icon.a<.01)discard;
            gl_FragColor=icon;
          }
        }
        #include <colorspace_fragment>
      }`});
  const cloud=new THREE.Points(geo,mat);cloud.renderOrder=selected?12:10;cloud.frustumCulled=false;
  return cloud;
}
