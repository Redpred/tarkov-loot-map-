import * as THREE from 'three';
import {clippedVolume,volumesFor} from './atlas-volumes.js';

function faceTriangles(face){
  // Project onto the dominant plane for both concave manual polygons and
  // arbitrarily rotated collider faces. Positions stay in original XYZ.
  const normal=[0,0,0];
  for(let i=0;i<face.length;i++){
    const a=face[i],b=face[(i+1)%face.length];
    normal[0]+=(a[1]-b[1])*(a[2]+b[2]);normal[1]+=(a[2]-b[2])*(a[0]+b[0]);normal[2]+=(a[0]-b[0])*(a[1]+b[1]);
  }
  const axis=normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs))),indices=[0,1,2].filter(i=>i!==axis);
  return THREE.ShapeUtils.triangulateShape(face.map(p=>new THREE.Vector2(p[indices[0]],p[indices[1]])),[]).flatMap(triangle=>triangle.flatMap(i=>face[i]));
}

export function createVolumeLayer({region=false}={}){
  const group=new THREE.Group();group.name=region?'region-volumes':'point-volumes';
  let signature='',entryIds=new WeakMap(),nextId=1;
  const identity=entry=>{if(!entryIds.has(entry))entryIds.set(entry,nextId++);return entryIds.get(entry);};
  function clear(){for(const child of [...group.children]){group.remove(child);child.geometry.dispose();child.material.dispose();}}
  return {group,
    update(entries,{low=-Infinity,high=Infinity,selected=null,colorFor=()=>region?'#cfb57c':'#b1ddba',firstPerson=false,background='#101820',clipVolume=clippedVolume,cutRevision=0}={}){
      entries=entries.filter(entry=>volumesFor(entry).length);
      const next=`${low}:${high}:${firstPerson}:${background}:${selected?.id||''}:${cutRevision}|${entries.map(p=>`${identity(p)}:${colorFor(p)}`).join('|')}`;
      if(next===signature)return;signature=next;clear();
      const lightBackground=new THREE.Color(background).getHSL({}).l>.5;
      const drawn=new Map();
      // Several objectives can refer to one trigger; draw its physical region
      // once, retaining the selected objective's brighter styling.
      for(const entry of entries)for(const volume of volumesFor(entry)){
        const key=JSON.stringify(volume.type==='box'?volume.corners:volume.type==='sphere'?[volume.center,volume.radius]:[volume.polygon,volume.minY,volume.maxY]);
        if(!drawn.has(key)||entry===selected)drawn.set(key,{entry,volume});
      }
      for(const {entry,volume} of drawn.values()){
        const {faces,edges}=clipVolume(volume,low,high);if(!faces.length)continue;
        const color=colorFor(entry),active=entry===selected;
        const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(faces.flatMap(faceTriangles),3));
        const fill=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color,transparent:true,opacity:active ? .17 : region || lightBackground ? .035 : .065,side:THREE.DoubleSide,depthWrite:false,depthTest:true,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}));
        fill.renderOrder=2;fill.userData.volumeEntryId=entry.id;group.add(fill);
        const edgeGeometry=new THREE.BufferGeometry();edgeGeometry.setAttribute('position',new THREE.Float32BufferAttribute(edges.flat(2),3));
        const edgeColor=new THREE.Color(color);if(lightBackground)edgeColor.multiplyScalar(.18);
        const frame=new THREE.LineSegments(edgeGeometry,new THREE.LineBasicMaterial({color:edgeColor,transparent:true,opacity:active ? .95 : lightBackground ? .8 : region ? .48 : .65,depthWrite:false,depthTest:firstPerson}));
        frame.renderOrder=3;frame.userData.volumeEntryId=entry.id;group.add(frame);
      }
    },
    dispose(){clear();signature='';entryIds=new WeakMap();}
  };
}
