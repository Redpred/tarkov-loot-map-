// Unity X/Z to camera-aligned canvas coordinates. The inverse is also used
// for navigation clicks, so rotating the preview never changes destinations.
export function minimapTransform(bounds,heading,width=180,height=160,padding=9){
  const cx=(bounds.minX+bounds.maxX)/2,cz=(bounds.minZ+bounds.maxZ)/2;
  const c=Math.cos(heading),s=Math.sin(heading);
  const dx=bounds.maxX-bounds.minX,dz=bounds.maxZ-bounds.minZ;
  const scale=Math.min((width-2*padding)/Math.max(1,Math.abs(c)*dx+Math.abs(s)*dz),(height-2*padding)/Math.max(1,Math.abs(s)*dx+Math.abs(c)*dz));
  return {
    pixel(x,z){const a=x-cx,b=z-cz;return [width/2+(c*a+s*b)*scale,height/2+(s*a-c*b)*scale];},
    world(x,y){const a=(x-width/2)/scale,b=(y-height/2)/scale;return {x:cx+c*a+s*b,z:cz+s*a-c*b};},
    axisZ:[s,-c],axisX:[c,s],scale,
  };
}

// Recipe 4 in scripts/preview/capture.js frames the complete retained geometry,
// with an 18 m margin and 1.18 scale. The image already includes the Unity Z flip.
export function previewMinimapTransform(bounds,preview,heading,width=180,height=160){
  if(preview?.recipeVersion!==4||preview.heading!==180||!(preview.width>0&&preview.height>0))throw new Error('预览图待更新');
  const aspect=preview.width/preview.height;
  const span=Math.max(bounds.max[2]-bounds.min[2]+18,(bounds.max[0]-bounds.min[0]+18)/aspect)*1.18;
  const cx=(bounds.min[0]+bounds.max[0])/2,cz=(bounds.min[2]+bounds.max[2])/2;
  const frame={minX:cx-span*aspect/2,maxX:cx+span*aspect/2,minZ:cz-span/2,maxZ:cz+span/2};
  // Fit the retained scene, not the capture frame: the latter includes large
  // margins and aspect-ratio padding. Keep the original frame for image/world
  // registration, so trimming only the blank border cannot shift click targets.
  const mapBounds={minX:bounds.min[0],maxX:bounds.max[0],minZ:bounds.min[2],maxZ:bounds.max[2]};
  const transform=minimapTransform(mapBounds,heading,width,height,3);
  const origin=transform.pixel(frame.maxX,frame.minZ),right=transform.pixel(frame.minX,frame.minZ),bottom=transform.pixel(frame.maxX,frame.maxZ);
  return {...transform,frame,mapBounds,
    imageMatrix:[(right[0]-origin[0])/preview.width,(right[1]-origin[1])/preview.width,(bottom[0]-origin[0])/preview.height,(bottom[1]-origin[1])/preview.height,...origin],
    contains(x,y){const p=transform.world(x,y),epsilon=1e-8;return p.x>=mapBounds.minX-epsilon&&p.x<=mapBounds.maxX+epsilon&&p.z>=mapBounds.minZ-epsilon&&p.z<=mapBounds.maxZ+epsilon;},
  };
}
