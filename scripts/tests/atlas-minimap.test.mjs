import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import fs from 'node:fs';
import {ATLAS_MAPS} from '../../site/atlas-maps.js';
import {minimapTransform,previewMinimapTransform} from '../../site/atlas-minimap.js';
const bounds={minX:-90,maxX:250,minZ:-120,maxZ:460};
test('minimap follows actual camera heading and its click transform is invertible',()=>{
  for(const heading of [0,Math.PI/2,Math.PI,3*Math.PI/2,.37,-.83]){
    const transform=minimapTransform(bounds,heading),camera=new THREE.OrthographicCamera(-100,100,100,-100,.1,2000);
    camera.position.setFromSphericalCoords(250,.00001,heading);camera.lookAt(0,0,0);camera.updateMatrixWorld();
    const centre=new THREE.Vector3().project(camera);
    for(const [x,z] of [[1,0],[0,1],[3,-2]]){
      const view=new THREE.Vector3(x,0,-z).project(camera),a=transform.pixel(0,0),b=transform.pixel(x,z);
      const expected=new THREE.Vector2(view.x-centre.x,-view.y+centre.y).normalize(),actual=new THREE.Vector2(b[0]-a[0],b[1]-a[1]).normalize();
      assert.ok(expected.distanceTo(actual)<1e-8,`heading ${heading}, ${x}/${z}`);
    }
    for(const [x,z] of [[-90,-120],[250,460],[-90,460],[250,-120],[123,42]]){
      const pixel=transform.pixel(x,z),world=transform.world(...pixel);
      assert.ok(Math.abs(x-world.x)<1e-9&&Math.abs(z-world.z)<1e-9);
      assert.ok(pixel[0]>=8.99&&pixel[0]<=171.01&&pixel[1]>=8.99&&pixel[1]<=151.01);
    }
  }
});

test('all homepage previews fit the complete scene and preserve image-to-world navigation after trimming margins',()=>{
  const read=path=>JSON.parse(fs.readFileSync(new URL('../../site/'+path,import.meta.url)));
  const catalog=read('data/atlas-catalog.json');
  for(const map of Object.values(ATLAS_MAPS)){
    const manifest=read(map.geometry),preview=catalog.maps.find(m=>m.id===map.id).preview,b=manifest.bounds;
    assert.equal(preview.geometrySha256,manifest.sourceGeometrySha256||manifest.sha256,map.id);
    assert.ok(fs.existsSync(new URL('../../site/'+preview.file,import.meta.url)),map.id);
    // Reconstruct the actual capture camera independently to project Unity points into image pixels.
    const span=Math.max(b.max[2]-b.min[2]+18,(b.max[0]-b.min[0]+18)*960/1440)*1.18;
    const cx=(b.min[0]+b.max[0])/2,cz=(b.min[2]+b.max[2])/2;
    const camera=new THREE.OrthographicCamera(-span*.75,span*.75,span/2,-span/2,.1,10000);
    camera.position.set(cx,b.max[1]+250,-cz);camera.up.set(0,0,1);camera.lookAt(cx,b.min[1],-cz);camera.updateMatrixWorld();
    for(const heading of [Math.PI,0,Math.PI/2,.37,-.83]){
      const t=previewMinimapTransform(b,preview,heading),[a,c0,c,d,e,f]=t.imageMatrix;
      const imagePixel=(x,y)=>[a*x+c*y+e,c0*x+d*y+f];
      for(const [x,z] of [[b.min[0],b.min[2]],[b.max[0],b.max[2]],[cx,cz],[cx+7,cz-3]]){
        const projected=new THREE.Vector3(x,0,-z).project(camera),fromImage=imagePixel((projected.x+1)*720,(1-projected.y)*480),fromWorld=t.pixel(x,z),back=t.world(...fromImage);
        assert.ok(Math.hypot(fromImage[0]-fromWorld[0],fromImage[1]-fromWorld[1])<1e-8,`${map.id}: image alignment`);
        assert.ok(Math.hypot(back.x-x,back.z-z)<1e-8,`${map.id}: click destination`);
      }
      const corners=[[b.min[0],b.min[2]],[b.max[0],b.min[2]],[b.max[0],b.max[2]],[b.min[0],b.max[2]]].map(p=>t.pixel(...p));
      for(const [x,y] of corners){assert.ok(x>=3-1e-8&&x<=177+1e-8&&y>=3-1e-8&&y<=157+1e-8,`${map.id}: full retained map`);assert.ok(t.contains(x,y));}
      const extentX=Math.max(...corners.map(p=>p[0]))-Math.min(...corners.map(p=>p[0])),extentY=Math.max(...corners.map(p=>p[1]))-Math.min(...corners.map(p=>p[1]));
      assert.ok(Math.abs(extentX-174)<1e-8||Math.abs(extentY-154)<1e-8,`${map.id}: fill at least one canvas axis`);
      const previous=minimapTransform(t.frame,heading,180,160,0);assert.ok(t.scale>previous.scale,`${map.id}: preview is enlarged`);
    }
    const normal=previewMinimapTransform(b,preview,Math.PI);assert.equal(normal.contains(90,0),false,'letterbox padding is not a map destination');
  }
});
test('trimmed preview keeps border and interior clicks accurate at desktop and mobile canvas sizes',()=>{
  const b={min:[-60,-5,-100],max:[80,30,75]},preview={recipeVersion:4,heading:180,width:1440,height:960};
  for(const [width,height] of [[180,160],[160,142],[120,106]])for(const heading of [Math.PI,Math.PI/2,.67]){
    const t=previewMinimapTransform(b,preview,heading,width,height);
    for(const fx of [0,.1,.5,.9,1])for(const fz of [0,.1,.5,.9,1]){
      const x=b.min[0]+(b.max[0]-b.min[0])*fx,z=b.min[2]+(b.max[2]-b.min[2])*fz,pixel=t.pixel(x,z),back=t.world(...pixel);
      assert.ok(t.contains(...pixel));assert.ok(Math.hypot(back.x-x,back.z-z)<1e-9);
    }
    assert.equal(t.contains(...t.pixel(b.max[0]+1,b.max[2]+1)),false);
  }
});
test('unknown preview recipes are rejected rather than silently misaligning navigation',()=>{
  const b={min:[-30,-5,-20],max:[40,10,80]};
  assert.throws(()=>previewMinimapTransform(b,{recipeVersion:3,heading:180,width:1440,height:960},Math.PI),/预览图待更新/);
  assert.throws(()=>previewMinimapTransform(b,{recipeVersion:4,heading:0,width:1440,height:960},Math.PI),/预览图待更新/);
});
