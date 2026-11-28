import * as THREE from 'three';

export function createFirstPerson({canvas,settings,onChange,onNotice}){
  const camera=new THREE.PerspectiveCamera(settings.fov,1,.06,settings.drawDistance||100),keys=new Set(),pendingKeys=new Set();
  const angles=new THREE.Euler(0,0,0,'YXZ'),touch={forward:0,right:0,up:0};let suspended=false,mode=null,drag=null,lookDragged=false,last=0,frameId=null;
  canvas.tabIndex=0;
  const editing=()=>document.activeElement!==canvas&&!document.activeElement?.closest?.('#touchNavigation [data-touch-action]')||document.querySelector('dialog[open]');
  function release(){const previous=drag;drag=null;if(previous&&canvas.hasPointerCapture(previous.id))canvas.releasePointerCapture(previous.id);}
  const clearMovement=()=>{keys.clear();pendingKeys.clear();touch.forward=touch.right=touch.up=0;};
  const stop=()=>{clearMovement();release();lookDragged=false;};
  function place(position){
    camera.position.copy(position);
    camera.position.y+=1.65;
  }
  window.addEventListener('blur',stop);document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
  window.addEventListener('keydown',e=>{
    if(suspended||!mode||editing()||document.activeElement!==canvas)return;
    if(['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','Space','ControlLeft','ShiftLeft','ShiftRight','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.code)){e.preventDefault();keys.add(e.code);if(!e.repeat)pendingKeys.add(e.code);}
  });
  window.addEventListener('keyup',e=>keys.delete(e.code));
  canvas.addEventListener('pointerdown',e=>{
    if(!mode)return;canvas.focus({preventScroll:true});
    if(e.button===0&&!drag){lookDragged=false;if(document.pointerLockElement!==canvas){drag={id:e.pointerId,x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,threshold:e.pointerType==='touch'?8:4};canvas.setPointerCapture(e.pointerId);}}
  });
  canvas.addEventListener('pointermove',e=>{
    if(!mode||(!drag&&document.pointerLockElement!==canvas))return;
    if(drag){
      if(e.pointerId!==drag.id)return;
      if(!lookDragged&&Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)<drag.threshold)return;
      lookDragged=true;
    }
    const dx=document.pointerLockElement===canvas?e.movementX:e.clientX-drag.x,dy=document.pointerLockElement===canvas?e.movementY:e.clientY-drag.y;
    if(drag){drag.x=e.clientX;drag.y=e.clientY;}
    angles.y-=dx*.0025*settings.rotationSpeed/.55;angles.x=THREE.MathUtils.clamp(angles.x-dy*.0025*settings.rotationSpeed/.55,-1.5,1.5);
    camera.quaternion.setFromEuler(angles);onChange();
  });
  canvas.addEventListener('pointerup',e=>{if(e.button===0&&e.pointerId===drag?.id)release();});
  canvas.addEventListener('pointercancel',stop);canvas.addEventListener('lostpointercapture',()=>{drag=null;});
  canvas.addEventListener('contextmenu',e=>{if(mode)e.preventDefault();});
  function frame(now){
    if(!mode||suspended)return;
    frameId=requestAnimationFrame(frame);const dt=Math.min((now-last)/1000,.05);last=now;
    if(editing()){clearMovement();return;}
    const pressed=key=>keys.has(key)||pendingKeys.has(key);
    const yaw=(Number(pressed('ArrowLeft'))-Number(pressed('ArrowRight')))*dt*1.4,pitch=(Number(pressed('ArrowUp'))-Number(pressed('ArrowDown')))*dt*1.4;
    if(yaw||pitch){angles.y+=yaw;angles.x=THREE.MathUtils.clamp(angles.x+pitch,-1.5,1.5);camera.quaternion.setFromEuler(angles);onChange();}
    const forward=new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion),right=new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion);
    // Keep a brief key tap for one frame even if keydown and keyup arrive
    // between two renders, which also helps when a heavy scene lowers FPS.
    const movement=new THREE.Vector3().addScaledVector(forward,THREE.MathUtils.clamp(Number(pressed('KeyW'))-Number(pressed('KeyS'))+touch.forward,-1,1)).addScaledVector(right,THREE.MathUtils.clamp(Number(pressed('KeyD'))-Number(pressed('KeyA'))+touch.right,-1,1));
    const ascend=pressed('KeyE')||pressed('Space'),descend=pressed('KeyQ')||pressed('ControlLeft');
    movement.y+=THREE.MathUtils.clamp(Number(ascend)-Number(descend)+touch.up,-1,1);
    if(movement.lengthSq()>1)movement.normalize();
    const boost=pressed('ShiftLeft')||pressed('ShiftRight');movement.multiplyScalar(settings.flySpeed*(boost?2.5:1)*dt);
    const before=camera.position.clone();
    camera.position.add(movement);
    pendingKeys.clear();if(camera.position.distanceToSquared(before)>1e-9)onChange();
  }
  return {camera,get mode(){return mode;},get lookDragged(){return lookDragged;},get touchMoving(){return Boolean(touch.forward||touch.right||touch.up);},
    setSuspended(value){
      suspended=Boolean(value);stop();if(frameId!==null)cancelAnimationFrame(frameId);frameId=null;
      if(suspended){if(document.pointerLockElement===canvas)document.exitPointerLock();}
      else if(mode){last=performance.now();frameId=requestAnimationFrame(frame);}
    },
    setTouchMovement(input){for(const key of ['forward','right','up'])touch[key]=Number.isFinite(input[key])?THREE.MathUtils.clamp(input[key],-1,1):0;},
    enter(position,heading=0){
      const starting=!mode;mode='fly';stop();
      if(position){place(position);angles.set(0,heading,0,'YXZ');camera.quaternion.setFromEuler(angles);}
      camera.fov=settings.fov;camera.updateProjectionMatrix();canvas.focus({preventScroll:true});onChange();
      if(starting&&!suspended){last=performance.now();frameId=requestAnimationFrame(frame);}
    },
    exit(){mode=null;stop();if(frameId!==null)cancelAnimationFrame(frameId);frameId=null;if(document.pointerLockElement===canvas)document.exitPointerLock();},
    teleport(position){place(position);onChange();},
    async lock(){try{await canvas.requestPointerLock();canvas.focus({preventScroll:true});}catch{onNotice('无法锁定鼠标，请按住左键转向。');}}
  };
}
