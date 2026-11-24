import * as THREE from 'three';
import {CUT_GRID,MAX_CELL_CUTS} from './atlas-building-cuts.js';

export const buildingCutGLSL=`
uniform float buildingCutEnabled;
uniform sampler2D buildingCutCells,buildingCutIds,buildingCutRects;
uniform vec4 buildingCutBounds;
uniform vec2 buildingCutIdSize;
uniform float buildingCutRegionCount;
float buildingHigh(vec3 viewWorld,float fallback){
  if(buildingCutEnabled<.5)return fallback;
  vec2 p=vec2(viewWorld.x,-viewWorld.z);
  if(p.x<buildingCutBounds.x||p.y<buildingCutBounds.y||p.x>buildingCutBounds.z||p.y>buildingCutBounds.w)return fallback;
  vec2 cell=min(floor((p-buildingCutBounds.xy)/(buildingCutBounds.zw-buildingCutBounds.xy)*${CUT_GRID}.),vec2(${CUT_GRID-1}.));
  vec2 entry=texture2D(buildingCutCells,(cell+.5)/${CUT_GRID}.).xy;
  for(int i=0;i<${MAX_CELL_CUTS};i++){
    if(float(i)>=entry.y)break;
    float address=entry.x+float(i);
    float id=texture2D(buildingCutIds,(vec2(mod(address,buildingCutIdSize.x),floor(address/buildingCutIdSize.x))+.5)/buildingCutIdSize).r;
    vec4 rect=texture2D(buildingCutRects,vec2(.25,(id+.5)/buildingCutRegionCount));
    if(p.x>=rect.x&&p.y>=rect.y&&p.x<=rect.z&&p.y<=rect.w)return texture2D(buildingCutRects,vec2(.75,(id+.5)/buildingCutRegionCount)).r;
  }
  return fallback;
}`;
const texture=(data,w,h)=>{const t=new THREE.DataTexture(data,w,h,THREE.RGBAFormat,THREE.FloatType);t.minFilter=t.magFilter=THREE.NearestFilter;t.generateMipmaps=false;t.needsUpdate=true;return t;};
export function createBuildingCutUniforms(){
  const blank=texture(new Float32Array(4),1,1);let owned=[];
  const uniforms={buildingCutEnabled:{value:0},buildingCutCells:{value:blank},buildingCutIds:{value:blank},buildingCutRects:{value:blank},buildingCutBounds:{value:new THREE.Vector4(0,0,1,1)},buildingCutIdSize:{value:new THREE.Vector2(1,1)},buildingCutRegionCount:{value:1}};
  return {uniforms,set(plan,enabled){
    uniforms.buildingCutEnabled.value=enabled&&plan?.regions.length?1:0;
    if(!enabled||!plan?.regions.length)return;
    const cellData=new Float32Array(CUT_GRID**2*4),ids=[];
    plan.cells.forEach((c,i)=>{cellData[i*4]=ids.length;cellData[i*4+1]=c.length;ids.push(...c);});
    const width=Math.min(1024,Math.max(1,ids.length)),height=Math.max(1,Math.ceil(ids.length/width)),idData=new Float32Array(width*height*4);
    ids.forEach((id,i)=>idData[i*4]=id);
    const rects=new Float32Array(plan.regions.length*8);
    plan.regions.forEach((r,i)=>rects.set([r.minX,r.minZ,r.maxX,r.maxZ,r.high,0,0,0],i*8));
    for(const t of owned)t.dispose();owned=[texture(cellData,CUT_GRID,CUT_GRID),texture(idData,width,height),texture(rects,2,plan.regions.length)];
    [uniforms.buildingCutCells.value,uniforms.buildingCutIds.value,uniforms.buildingCutRects.value]=owned;
    uniforms.buildingCutBounds.value.set(plan.bounds.minX,plan.bounds.minZ,plan.bounds.maxX,plan.bounds.maxZ);uniforms.buildingCutIdSize.value.set(width,height);uniforms.buildingCutRegionCount.value=plan.regions.length;
  },dispose(){owned.forEach(t=>t.dispose());blank.dispose();}};
}
