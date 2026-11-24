let library;
async function loadLibrary(){
  if(!library)library=new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src='vendor/ocr/tesseract.min.js';
    script.onload=()=>resolve(window.Tesseract);script.onerror=()=>{script.remove();library=null;reject(new Error('识别组件加载失败，请检查网络后重试'));};document.head.append(script);
  });
  return library;
}
export function textLabels(blocks,offsetX,offsetY,scale){
  const labels=[];
  for(const block of blocks||[])for(const paragraph of block.paragraphs||[])for(const line of paragraph.lines||[]){
    const words=(line.words||[]).filter(w=>w.text?.trim()&&w.confidence>25);
    // A text line can contain several adjacent item names. Try bounded spans,
    // never join across a large blank gap between inventory slots.
    for(let start=0;start<words.length;start++)for(let end=start;end<Math.min(words.length,start+5);end++){
      if(end>start&&words[end].bbox.x0-words[end-1].bbox.x1>26*scale)break;
      const span=words.slice(start,end+1),x0=Math.min(...span.map(w=>w.bbox.x0)),y0=Math.min(...span.map(w=>w.bbox.y0));
      const x1=Math.max(...span.map(w=>w.bbox.x1)),y1=Math.max(...span.map(w=>w.bbox.y1));
      labels.push({text:span.map(w=>w.text).join(' '),confidence:span.reduce((n,w)=>n+w.confidence,0)/span.length,x:offsetX+x0/scale,y:offsetY+y0/scale,width:(x1-x0)/scale,height:(y1-y0)/scale});
    }
  }
  return labels;
}
export async function recognizeLoot(canvas,items,settings,{signal,onProgress=()=>{}}={}){
  let ocr,vision,aborted=false;
  const abort=()=>{aborted=true;ocr?.terminate();vision?.terminate();};signal?.addEventListener('abort',abort,{once:true});
  function check(){if(aborted||signal?.aborted)throw new DOMException('已取消识别','AbortError');}
  try{
    onProgress(.01,'加载识别组件…');const Tesseract=await loadLibrary();check();
    const lang=settings.language==='en'?'eng':settings.language==='zh'?'chi_sim':['chi_sim','eng'];
    ocr=await Tesseract.createWorker(lang,1,{workerPath:new URL('vendor/ocr/worker.min.js',location.href).href,
      corePath:new URL('vendor/ocr/',location.href).href,langPath:new URL('vendor/ocr/',location.href).href,
      workerBlobURL:false,logger:message=>{if(message.status.startsWith('loading')||message.status.startsWith('initializing'))onProgress(.04,'准备文字识别…');}});
    check();await ocr.setParameters({tessedit_pageseg_mode:'11',preserve_interword_spaces:'1'});
    const tile=900,step=840,tiles=[];
    for(let y=0;y<canvas.height;y+=step)for(let x=0;x<canvas.width;x+=step){
      if(x&&canvas.width-x<60||y&&canvas.height-y<60)continue;
      tiles.push({x,y,width:Math.min(tile,canvas.width-x),height:Math.min(tile,canvas.height-y)});
    }
    const labels=[],scale=2;
    for(let i=0;i<tiles.length;i++){
      check();const t=tiles[i],part=document.createElement('canvas');part.width=t.width*scale;part.height=t.height*scale;
      const ctx=part.getContext('2d');ctx.drawImage(canvas,t.x,t.y,t.width,t.height,0,0,part.width,part.height);
      onProgress(.1+.6*i/tiles.length,`识别物品名称 ${i+1}/${tiles.length}…`);
      const result=await ocr.recognize(part,{}, {blocks:true});check();labels.push(...textLabels(result.data.blocks,t.x,t.y,scale));part.width=part.height=1;
    }
    await ocr.terminate();ocr=null;check();
    onProgress(.72,'匹配物品图标…');
    const pixels=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height);
    return await new Promise((resolve,reject)=>{
      vision=new Worker(new URL('./loot-vision-worker.js',import.meta.url),{type:'module'});
      const onAbort=()=>reject(new DOMException('已取消识别','AbortError'));signal?.addEventListener('abort',onAbort,{once:true});
      const finish=()=>{signal?.removeEventListener('abort',onAbort);vision?.terminate();vision=null;};
      vision.onmessage=({data})=>{if(data.error){finish();reject(new Error(data.error));}else if(data.result){finish();resolve(data.result);}else onProgress(.72+.27*data.progress,'匹配物品图标…');};
      vision.onerror=()=>{finish();reject(new Error('图标识别失败，可重试或手动补充物品'));};
      vision.postMessage({image:{data:pixels.data,width:canvas.width,height:canvas.height},items,labels,cellSize:settings.cellSize},[pixels.data.buffer]);
    });
  }finally{signal?.removeEventListener('abort',abort);ocr?.terminate();vision?.terminate();}
}
