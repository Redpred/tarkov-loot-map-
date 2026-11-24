import {makeNameIndex,matchName,overlap,suppressDuplicates} from './loot-data.js';

const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
const luminance=(r,g,b)=>.299*r+.587*g+.114*b;
export function grayscale({data,width,height}){
  const gray=new Uint8Array(width*height);
  for(let i=0;i<gray.length;i++)gray[i]=luminance(data[i*4],data[i*4+1],data[i*4+2]);
  return gray;
}
// Find straight inventory borders. Short gaps allow text and anti-aliasing;
// diagonals and textured objects do not survive the minimum run length.
export function findGridLines(gray,width,height){
  function scan(vertical){
    const across=vertical?width:height,along=vertical?height:width,result=[];
    const pixel=(a,b)=>gray[vertical?b*width+a:a*width+b];
    for(let a=2;a<across-2;a++){
      let start=-1,last=-1,count=0;
      function finish(){if(last-start>=25&&count/(last-start+1)>.68)result.push({at:a,start,end:last});start=-1;count=0;}
      for(let b=2;b<along-2;b++){
        const edge=Math.abs(pixel(a-1,b)-pixel(a+1,b));
        const straight=Math.abs(pixel(a,b-1)-pixel(a,b+1));
        if(edge>=9&&straight<=20){if(start<0)start=b;last=b;count++;}
        else if(start>=0&&b-last>3)finish();
      }
      if(start>=0)finish();
    }
    const merged=[];
    for(const line of result.sort((a,b)=>b.end-b.start-(a.end-a.start))){
      if(!merged.some(other=>Math.abs(line.at-other.at)<=3&&Math.min(line.end,other.end)-Math.max(line.start,other.start)>.7*(line.end-line.start)))merged.push(line);
      if(merged.length>=1600)break;
    }
    return merged.sort((a,b)=>a.at-b.at);
  }
  return {vertical:scan(true),horizontal:scan(false)};
}
export function estimateCell(lines,width,height){
  const histogram=new Float64Array(241);
  for(const group of [lines.vertical,lines.horizontal])for(let i=0;i<group.length;i++){
    const a=group[i];
    for(let j=i+1;j<group.length;j++){
      const b=group[j],distance=b.at-a.at;if(distance>240)break;if(distance<28)continue;
      const common=Math.min(a.end,b.end)-Math.max(a.start,b.start);
      if(common<distance*.7)continue;
      for(let d=-1;d<=1;d++)histogram[Math.round(distance)+d]+=(d===0?1:.5)*Math.min(common/distance,8);
    }
  }
  let best=63,score=0;
  for(let cell=28;cell<=160;cell++){
    const current=histogram[cell]+.3*(histogram[cell*2]||0)+.12*(histogram[cell*3]||0);
    if(current>score){best=cell;score=current;}
  }
  if(score<3&&width>=1500&&height>=800)best=Math.round(height/1080*63);
  return clamp(best,28,160);
}
export function gridRectangles(lines,cell,width,height){
  const boxes=[],seen=new Set();
  for(const top of lines.horizontal){
    const vertical=lines.vertical.filter(v=>v.at>=top.start-4&&v.at<=top.end+4&&v.start<=top.at+4&&v.end>=top.at+cell*.75);
    for(let i=0;i<vertical.length;i++)for(let j=i+1;j<vertical.length;j++){
      const left=vertical[i],right=vertical[j],w=right.at-left.at,cols=Math.round(w/cell);
      if(cols<1||cols>6||Math.abs(w/cell-cols)>.14)continue;
      for(const bottom of lines.horizontal){
        const h=bottom.at-top.at,rows=Math.round(h/cell);
        if(rows<1||rows>6||Math.abs(h/cell-rows)>.14)continue;
        if(bottom.start>left.at+4||bottom.end<right.at-4||left.end<bottom.at-4||right.end<bottom.at-4)continue;
        const key=[left.at,top.at,w,h].map(n=>Math.round(n/4)).join(':');if(seen.has(key))continue;seen.add(key);
        boxes.push({x:clamp(left.at,0,width-1),y:clamp(top.at,0,height-1),width:w,height:h,cols,rows});
      }
    }
  }
  // Large empty container outlines are less useful than actual slot borders.
  return boxes.sort((a,b)=>a.width*a.height-b.width*b.height).slice(0,1200);
}
function decodeSignature(text){return Uint8Array.from(atob(text),c=>c.charCodeAt(0));}
export function prepareReferences(items){
  return items.map(item=>({...item,pixels:decodeSignature(item.signature)}));
}
function cropSignature(image,box,rotated=false){
  const {data,width,height}=image,pixels=new Float32Array(16*16*3),valid=new Uint8Array(256);
  const max=Math.max(box.width,box.height),rw=box.width/max*16,rh=box.height/max*16,ox=(16-rw)/2,oy=(16-rh)/2;
  for(let y=0;y<16;y++)for(let x=0;x<16;x++){
    const u=(x+.5-ox)/rw,v=(y+.5-oy)/rh;
    let dx=x,dy=y;if(rotated){dx=y;dy=15-x;}
    const target=dy*16+dx;
    // Item labels and durability counters are not part of the reference icon.
    valid[target]=u>=.06&&u<=.94&&v>=.23&&v<=.84?1:0;
    // Area averaging matches the downsampled reference. A single nearest
    // pixel exaggerates fine texture and JPEG noise on small inventory icons.
    for(let yy=0;yy<4;yy++)for(let xx=0;xx<4;xx++){
      const sx=clamp(Math.floor(box.x+(u+(xx-1.5)/4/rw)*box.width),0,width-1);
      const sy=clamp(Math.floor(box.y+(v+(yy-1.5)/4/rh)*box.height),0,height-1),p=(sy*width+sx)*4;
      for(let c=0;c<3;c++)pixels[target*3+c]+=data[p+c]/16;
    }
  }
  return {pixels,valid};
}
export function signatureSimilarity(sample,reference){
  let n=0,as=0,bs=0,aa=0,bb=0,ab=0,error=0;
  for(let i=0;i<256;i++){
    if(!sample.valid[i])continue;const k=i*3;
    const a=luminance(sample.pixels[k],sample.pixels[k+1],sample.pixels[k+2]),b=luminance(reference[k],reference[k+1],reference[k+2]);
    n++;as+=a;bs+=b;aa+=a*a;bb+=b*b;ab+=a*b;
    for(let c=0;c<3;c++)error+=Math.abs(sample.pixels[k+c]-reference[k+c]);
  }
  const av=aa-as*as/n,bv=bb-bs*bs/n;
  if(n<8||av/n<36||bv/n<36)return 0;
  const correlation=(ab-as*bs/n)/Math.sqrt(av*bv);
  return clamp(.78*Math.max(0,correlation)+.22*Math.max(0,1-error/(n*3*100)),0,1);
}
function candidatesForBox(image,box,references,ids){
  const normal=cropSignature(image,box),rotated=cropSignature(image,box,true),results=[];
  for(const item of references){
    if(ids&&!ids.has(item.id))continue;
    let score=0;
    if(!box.cols||(item.width===box.cols&&item.height===box.rows))score=signatureSimilarity(normal,item.pixels);
    if(!box.cols||(item.height===box.cols&&item.width===box.rows))score=Math.max(score,signatureSimilarity(rotated,item.pixels));
    if(score>.35)results.push({id:item.id,score});
  }
  return results.sort((a,b)=>b.score-a.score).slice(0,5);
}
function estimatedBox(label,item,cell,image){
  const width=item.width*cell,height=item.height*cell;
  return {x:clamp(label.x+label.width+4-width,0,Math.max(0,image.width-width)),y:clamp(label.y-4,0,Math.max(0,image.height-height)),width:Math.min(width,image.width),height:Math.min(height,image.height),cols:item.width,rows:item.height};
}
function refineMatch(image,box,item){
  let best={box,score:0};
  for(const dx of [-2,0,2])for(const dy of [-2,0,2]){
    const candidate={...box,x:clamp(box.x+dx,0,Math.max(0,image.width-box.width)),y:clamp(box.y+dy,0,Math.max(0,image.height-box.height))};
    const score=candidatesForBox(image,candidate,[item])[0]?.score||0;if(score>best.score)best={box:candidate,score};
  }
  return best;
}
export function recognizePixels(image,items,labels=[],{cellSize=0,progress=()=>{}}={}){
  const gray=grayscale(image),lines=findGridLines(gray,image.width,image.height);
  const cell=cellSize||estimateCell(lines,image.width,image.height),boxes=gridRectangles(lines,cell,image.width,image.height);
  const refs=prepareReferences(items),byId=new Map(refs.map(x=>[x.id,x])),names=makeNameIndex(items),detections=[];
  progress(.1);
  // Name recognition supplies candidates; pixels distinguish duplicate short names.
  for(const label of labels){
    const matches=matchName(label.text,names);if(!matches.length)continue;
    const nearby=boxes.filter(b=>label.x>=b.x-4&&label.x+label.width<=b.x+b.width+5&&label.y>=b.y-4&&label.y<=b.y+Math.min(cell*.45,28));
    let ranked=[];
    for(const match of matches){
      const item=byId.get(match.id);if(!item)continue;
      const possible=nearby.filter(b=>(b.cols===item.width&&b.rows===item.height)||(b.rows===item.width&&b.cols===item.height));
      if(!possible.length)possible.push(estimatedBox(label,item,cell,image));
      for(const box of possible){
        const refined=refineMatch(image,box,item),visual=refined.score;
        ranked.push({id:item.id,box:refined.box,textScore:match.score,visual,score:match.score*.62+visual*.38,hasBorder:nearby.includes(box)});
      }
    }
    ranked.sort((a,b)=>b.score-a.score);const top=ranked[0];if(!top)continue;
    const next=ranked.find(r=>r.id!==top.id),margin=next?top.score-next.score:1;
    // UI headings and partial names ("STASH", "Drum", "MPX") can match a
    // different item. Both visual evidence and an actual closed slot boundary
    // are required for automatic confirmation; text alone never prices it.
    if(top.visual<.50||top.textScore<1&&top.visual<.66)continue;
    const item=byId.get(top.id);
    const confirmed=top.textScore===1&&margin>.07&&top.visual>=.74&&top.hasBorder&&!item.types?.includes('gun')&&item.stackMax<=1;
    detections.push({itemId:top.id,box:top.box,quantity:1,confidence:top.score,confirmed,method:'名称与图标',text:label.text,
      candidates:[...new Set(ranked.map(r=>r.id))].slice(0,5)});
  }
  progress(.35);
  for(let i=0;i<boxes.length;i++){
    const box=boxes[i];if(detections.some(d=>d.confirmed&&overlap(box,d.box)>.58))continue;
    const ranked=candidatesForBox(image,box,refs),top=ranked[0];if(!top||top.score<.79)continue;
    const gap=top.score-(ranked[1]?.score||0);
    const item=byId.get(top.id);
    detections.push({itemId:top.id,box,quantity:1,confidence:top.score,confirmed:top.score>=.94&&gap>=.065&&!item.types?.includes('gun')&&item.stackMax<=1,method:'图标匹配',text:'',candidates:ranked.map(r=>r.id)});
    if(i%30===0)progress(.35+.65*i/boxes.length);
  }
  return {detections:suppressDuplicates(detections).slice(0,300),cellSize:cell,regions:boxes.length,labelCount:labels.length};
}
