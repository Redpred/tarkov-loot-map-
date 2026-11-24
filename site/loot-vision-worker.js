import {recognizePixels} from './loot-vision.js';
self.onmessage=event=>{
  const {image,items,labels,cellSize}=event.data;
  try{const result=recognizePixels(image,items,labels,{cellSize,progress:value=>self.postMessage({progress:value})});self.postMessage({result});}
  catch(error){self.postMessage({error:error.message||'图标识别失败'});}
};
