import * as THREE from 'three';

export function createMeasurementPaths(){
  const paths=[];
  let current=null;
  return {
    paths,
    add(point){
      if(!current){current=[];paths.push(current);}
      const last=current.at(-1);
      current.push(point);
      return last?last.distanceTo(point):null;
    },
    end(){current=null;},
    remove(path,point){
      const pathIndex=paths.indexOf(path),index=path.indexOf(point);
      if(pathIndex<0||index<0)return false;
      // Keep the connected fragments on either side of the deleted point.
      const remaining=[path.slice(0,index),path.slice(index+1)].filter(part=>part.length>1);
      paths.splice(pathIndex,1,...remaining);
      if(current===path)current=remaining.at(-1)??null;
      return true;
    }
  };
}

export const formatMeasurement=metres=>`${metres.toFixed(1)} m`;

export function createMeasurementLayer({scene,viewport}){
  const model=createMeasurementPaths(),projected=new THREE.Vector3();
  const lines=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({
    color:0xffdf84,transparent:true,depthTest:false,depthWrite:false
  }));
  lines.name='measurement-lines';lines.renderOrder=1000;lines.visible=false;scene.add(lines);
  const overlay=document.createElement('div');
  overlay.className='measurement-overlay';overlay.setAttribute('aria-hidden','true');viewport.append(overlay);
  let pins=[],labels=[];

  function rebuild(){
    const vertices=[],nodes=document.createDocumentFragment();
    pins=[];labels=[];
    for(const path of model.paths){
      for(let i=0;i<path.length;i++){
        const point=path[i],pin=document.createElement('span');
        pin.className='measurement-pin';pin.hidden=true;
        nodes.append(pin);pins.push({point,path,node:pin});
        if(i===0)continue;
        const previous=path[i-1],label=document.createElement('span');
        vertices.push(previous.x,previous.y,previous.z,point.x,point.y,point.z);
        label.className='measurement-label';label.hidden=true;
        label.textContent=formatMeasurement(previous.distanceTo(point));
        nodes.append(label);labels.push({point:previous.clone().lerp(point,.5),node:label});
      }
    }
    overlay.replaceChildren(nodes);
    lines.geometry.dispose();
    lines.geometry=new THREE.BufferGeometry();
    lines.geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    lines.visible=vertices.length>0;
  }

  function project(point,camera,width,height){
    projected.copy(point).project(camera);
    if(!Number.isFinite(projected.z)||Math.abs(projected.z)>1||Math.abs(projected.x)>1||Math.abs(projected.y)>1)return null;
    return {x:(projected.x+1)*width/2,y:(1-projected.y)*height/2};
  }

  return {
    add(point){const distance=model.add(point);rebuild();return distance;},
    end:model.end,
    removeAt(camera,{x,y,width,height}){
      camera.updateMatrixWorld();
      let nearest=null,distance=14;
      for(const pin of pins){
        const screen=project(pin.point,camera,width,height);
        if(!screen)continue;
        const gap=Math.hypot(screen.x-x,screen.y-y);
        if(gap<=distance){nearest=pin;distance=gap;}
      }
      if(!nearest)return false;
      model.remove(nearest.path,nearest.point);
      rebuild();
      return true;
    },
    render(camera){
      if(!pins.length)return;
      const width=viewport.clientWidth,height=viewport.clientHeight;
      camera.updateMatrixWorld();
      for(const {point,node} of [...pins,...labels]){
        const screen=project(point,camera,width,height);
        node.hidden=!screen;
        if(screen)node.style.transform=`translate(${screen.x.toFixed(1)}px,${screen.y.toFixed(1)}px) translate(-50%,-50%)`;
      }
    }
  };
}
