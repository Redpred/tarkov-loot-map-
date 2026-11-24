const editable='input,textarea,select,[contenteditable]:not([contenteditable="false"]),a[href]';
const controls='button,summary,[role="button"],.check,.type-option,.range-label,.region-controls label,#viewport canvas,#navigatorCanvas,#touchNavigation';

// Prevent native long-press selection/callouts only on operation surfaces.
// Do not cancel touchstart: panels still scroll, and fields/text remain copyable.
export function bindMapInteractionGuards(root=document){
  function guard(event){
    const target=event.target?.closest?event.target:event.target?.parentElement;
    if(!target?.closest||target.closest(editable)||!target.closest(controls))return;
    event.preventDefault();
  }
  for(const name of ['selectstart','contextmenu','dragstart'])root.addEventListener(name,guard,{capture:true});
}
