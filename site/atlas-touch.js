// Track the whole pointer gesture: lifting one finger after a pinch is never a tap.
export function createMapTapTracker(){
  const pointers=new Map();let blocked=false;
  const threshold=e=>e.pointerType==='touch'?8:e.pointerType==='pen'?6:4;
  const moved=(start,e)=>Math.hypot(e.clientX-start.x,e.clientY-start.y)>=start.threshold;
  return {
    get pointerCount(){return pointers.size;},
    down(e){
      if(e.button!==0)return;
      if(pointers.size)blocked=true;
      pointers.set(e.pointerId,{x:e.clientX,y:e.clientY,time:e.timeStamp,threshold:threshold(e),maxDuration:e.pointerType==='touch'?700:Infinity,moved:false});
    },
    move(e){const start=pointers.get(e.pointerId);if(start&&moved(start,e))start.moved=true;},
    up(e){
      const start=pointers.get(e.pointerId);
      const tap=Boolean(start)&&e.button===0&&!blocked&&!start.moved&&!moved(start,e)&&e.timeStamp-start.time<start.maxDuration;
      pointers.delete(e.pointerId);if(!pointers.size)blocked=false;
      return tap;
    },
    cancel(e){pointers.delete(e.pointerId);blocked=pointers.size>0;},
    reset(){pointers.clear();blocked=false;}
  };
}

// Feed only completed taps, never raw click/dblclick events after a drag.
export function createPointDoubleTapTracker(){
  let previous=null;
  return {
    tap(id,e){
      const next={id,type:e.pointerType,x:e.clientX,y:e.clientY,time:e.timeStamp};
      const elapsed=previous?next.time-previous.time:Infinity;
      const twice=Boolean(id&&previous&&previous.id===id&&previous.type===next.type&&elapsed>=0&&elapsed<=450&&Math.hypot(next.x-previous.x,next.y-previous.y)<=(next.type==='touch'?24:8));
      previous=twice||!id?null:next;return twice;
    },
    reset(){previous=null;}
  };
}

export function markerHitRadius(style,size,pointerType){
  const radius=style==='icons'?size/2+2:12;
  return pointerType==='touch'?Math.max(22,radius):radius;
}

export function touchMovement(actions){
  return {forward:Number(actions.has('forward'))-Number(actions.has('backward')),right:Number(actions.has('right'))-Number(actions.has('left')),up:Number(actions.has('up'))-Number(actions.has('down'))};
}

export function createTouchNavigation({parent,canvas,onMove}){
  const element=document.createElement('div');element.id='touchNavigation';element.hidden=true;
  element.setAttribute('aria-label','触摸移动');
  // Paths contain no selectable text, including the old Unicode arrows.
  // Names live only in ARIA so screen readers can still identify every action.
  const button=(action,label,path)=>`<button type="button" data-touch-action="${action}" aria-label="${label}" aria-pressed="false"><svg class="touch-control-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${path}"/></svg></button>`;
  element.innerHTML='<div class="touch-move-pad" role="group" aria-label="按住移动">'+
    button('forward','按住前进','M12 20V4m-7 7 7-7 7 7')+
    button('left','按住向左移动','M20 12H4m7-7-7 7 7 7')+
    button('backward','按住后退','M12 4v16m-7-7 7 7 7-7')+
    button('right','按住向右移动','M4 12h16m-7-7 7 7-7 7')+'</div>'+
    '<div class="touch-actions" role="group" aria-label="升降">'+
    button('up','按住上升','M4 21h16M12 17V3m-6 6 6-6 6 6')+
    button('down','按住下降','M4 21h16M12 3v14m-6-6 6 6 6-6')+'</div>';
  parent.append(element);
  const held=new Map(),keyboard=new Map(),buttons=[...element.querySelectorAll('[data-touch-action]')];let pulseTimer=null;
  function update(){
    const actions=new Set([...held.values(),...keyboard.values()].map(button=>button.dataset.touchAction));
    for(const button of buttons)button.setAttribute('aria-pressed',String(actions.has(button.dataset.touchAction)));
    onMove(touchMovement(actions));
  }
  function release(e){if(!held.has(e.pointerId))return;const button=held.get(e.pointerId);held.delete(e.pointerId);if(button.hasPointerCapture(e.pointerId))button.releasePointerCapture(e.pointerId);update();}
  function reset(){const previous=[...held];held.clear();keyboard.clear();clearTimeout(pulseTimer);pulseTimer=null;for(const [id,button] of previous)if(button.hasPointerCapture(id))button.releasePointerCapture(id);update();}
  for(const button of buttons){
    // Keep the held control protected even if the general map UI is unavailable.
    for(const type of ['selectstart','contextmenu','dragstart'])button.addEventListener(type,e=>e.preventDefault());
    button.addEventListener('pointerdown',e=>{
      if(e.button!==0)return;e.preventDefault();canvas.focus({preventScroll:true});
      held.set(e.pointerId,button);button.setPointerCapture(e.pointerId);update();
    });
    for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,release);
    button.addEventListener('keydown',e=>{
      if(!['Space','Enter'].includes(e.code))return;
      e.preventDefault();e.stopPropagation();if(e.repeat)return;
      keyboard.set(e.code,button);update();
    });
    button.addEventListener('click',e=>{
      if(e.detail!==0)return;
      canvas.focus({preventScroll:true});
      // Assistive activation has no held key or pointer; move one short step.
      keyboard.set('assistive',button);update();clearTimeout(pulseTimer);
      pulseTimer=setTimeout(()=>{keyboard.delete('assistive');pulseTimer=null;update();},180);
    });
  }
  window.addEventListener('keyup',e=>{if(keyboard.delete(e.code)){e.preventDefault();update();}});
  document.addEventListener('focusin',e=>{
    if(e.target!==canvas&&!buttons.includes(e.target)){reset();return;}
    if(keyboard.size&&![...keyboard.values()].includes(e.target)){keyboard.clear();update();}
  });
  window.addEventListener('blur',reset);document.addEventListener('visibilitychange',()=>{if(document.hidden)reset();});
  for(const name of ['fullscreenchange','webkitfullscreenchange'])document.addEventListener(name,reset);
  window.addEventListener('orientationchange',reset);
  return {element,reset,setMode(mode){
    reset();element.hidden=mode!=='fly';element.dataset.mode=mode==='fly'?'fly':'';
  }};
}
