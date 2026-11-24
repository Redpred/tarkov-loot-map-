import {DEFAULT_SETTINGS,scannerSettings,formatK,valueDetection,summarizeDetections,csvText} from './loot-data.js';
import {marketClient,marketMoney,marketTime,marketModeName,itemPriceDisplay} from './atlas-market-client.js';
import {recognizeLoot} from './loot-recognition.js';
import {getGameMode,subscribeGameMode} from './game-mode.js';

const $=id=>document.getElementById(id),prefsKey='tarkov-image-loot-v1';
const traderChinese={Prapor:'俄商',Therapist:'医生',Fence:'黑商',Skier:'滑雪者',Peacekeeper:'维和',Mechanic:'机械师',Ragman:'服装商',Jaeger:'猎人',Ref:'裁判'};
let settings;try{settings=scannerSettings(JSON.parse(localStorage.getItem(prefsKey)||'{}'));}catch{settings=scannerSettings();}
settings.mode=getGameMode();
let catalogPromise,items=[],itemMap=new Map(),market=null,priceRequest=0,imageEpoch=0,scanEpoch=0,uploadEpoch=0;
let source=null,working=null,fileName='',detections=[],busy=false,controller=null,selectedId=null,drawing=false,drag=null,redrawId=null,editing=null;
const canvas=$('resultCanvas'),ctx=canvas.getContext('2d');
const error=(id,message)=>{const el=$(id);el.textContent=message;el.hidden=!message;};
function element(tag,className,text){const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;}
function savePreferences(){try{localStorage.setItem(prefsKey,JSON.stringify(settings));}catch{}}
function syncSettings(){
  $('labelMode').value=settings.label;$('labelFont').value=settings.fontSize;
  $('ocrLanguage').value=settings.language;$('cellSize').value=settings.cellSize;
  for(let i=0;i<3;i++)$('threshold'+i).value=settings.thresholds[i]/1000;
  for(let i=0;i<4;i++)$('tierColor'+i).value=settings.colors[i];
  updateTierLabels();
}
function updateTierLabels(){
  const [a,b,c]=settings.thresholds.map(formatK);
  [a+' 以下',a+'–'+b,b+'–'+c,c+' 及以上'].forEach((text,i)=>{$('tier'+i+'Label').textContent=i===0?'低于 '+a:text;$('tier'+i+'Label').style.color=settings.colors[i];});
}
async function getCatalog(){
  if(!catalogPromise)catalogPromise=(async()=>{
    const response=await fetch('data/loot-scanner/catalog.json',{signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new Error('物品目录加载失败，请稍后重试');const data=await response.json();
    if(data.schemaVersion!==1||!Array.isArray(data.items)||data.items.length<1)throw new Error('物品目录格式无效');
    items=data.items.filter(item=>/^[a-f0-9]{24}$/.test(item.id)&&/^data\/icons\/items\/[a-f0-9]{24}\.webp$/.test(item.icon)&&item.width>0&&item.height>0);
    itemMap=new Map(items.map(item=>[item.id,item]));return items;
  })().catch(e=>{catalogPromise=null;throw e;});
  return catalogPromise;
}
async function loadPrices(reload=false){
  const request=++priceRequest,mode=settings.mode;market=null;render();
  $('priceStatus').textContent=`正在获取 ${marketModeName(mode)} 价格…`;$('refreshPrices').disabled=true;
  try{
    const data=await marketClient.load(mode,{reload});if(request!==priceRequest)return;
    market=data;$('priceStatus').textContent=`${marketModeName(mode)} · ${data.stale?'缓存价格 · ':''}获取于 ${marketTime(data.fetchedAt)}`;
  }catch{if(request===priceRequest)$('priceStatus').textContent='价格暂时不可用，可点击“刷新价格”重试；识别结果会保留。';}
  finally{if(request===priceRequest){$('refreshPrices').disabled=false;render();}}
}
function stopScan(message=true){
  scanEpoch++;controller?.abort();controller=null;busy=false;$('scanProgress').hidden=true;setControls();
  if(message)$('imageMessage').textContent='已取消识别。现有结果保留，可重新识别。';
}
function setControls(){
  $('scanImage').disabled=!working||busy;$('scanImage').textContent=detections.length?'重新识别':'开始识别';
  $('cancelScan').hidden=!busy;$('addBox').disabled=!working||busy;$('clearImage').disabled=busy;
  $('downloadImage').disabled=!working||!detections.length||busy;$('downloadList').disabled=!detections.length||busy;
  $('chooseImage').disabled=busy;$('pasteImage').disabled=busy;$('imageFile').disabled=busy;
}
function clearImage(){
  uploadEpoch++;imageEpoch++;stopScan(false);source?.close();source=null;working=null;detections=[];drawing=false;redrawId=null;selectedId=null;
  if($('itemEditor').open)$('itemEditor').close();$('imageFile').value='';$('imageStage').hidden=true;$('imageActions').hidden=true;$('dropZone').hidden=false;
  canvas.width=canvas.height=1;$('imageMessage').textContent='尽量使用清晰、无遮挡的原始截图。';error('imageError','');setDrawing(false);render();
}
async function loadImage(file){
  if(!file)return;const request=++uploadEpoch;stopScan(false);error('imageError','');
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)){error('imageError','请上传 PNG、JPG 或 WebP 图片。');return;}
  if(file.size>20*1024*1024){error('imageError','图片超过 20 MB，请先缩小图片。');return;}
  let bitmap;
  try{
    bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});
    if(request!==uploadEpoch){bitmap.close();return;}
    if(bitmap.width<40||bitmap.height<40||bitmap.width*bitmap.height>25e6||Math.max(bitmap.width,bitmap.height)>10000){bitmap.close();throw new Error('图片需至少 40 × 40 像素，且不超过 2,500 万像素或单边 10,000 像素。');}
    imageEpoch++;source?.close();source=bitmap;fileName=file.name?.replace(/\.[^.]+$/,'')||'物资截图';detections=[];selectedId=null;
    if($('itemEditor').open)$('itemEditor').close();setDrawing(false);
    const scale=Math.min(1,2400/Math.max(bitmap.width,bitmap.height));working=document.createElement('canvas');
    working.width=Math.round(bitmap.width*scale);working.height=Math.round(bitmap.height*scale);
    working.getContext('2d',{willReadFrequently:true}).drawImage(bitmap,0,0,working.width,working.height);
    canvas.width=working.width;canvas.height=working.height;
    $('dropZone').hidden=true;$('imageStage').hidden=false;$('imageActions').hidden=false;
    $('imageMeta').textContent=`${bitmap.width} × ${bitmap.height} · ${(file.size/1024/1024).toFixed(1)} MB`;
    $('imageMessage').textContent='点击“开始识别”。首次使用需加载识别组件，期间请保持页面打开。';render();
    getCatalog().catch(e=>error('imageError',e.message));if(!market||market.mode!==settings.mode)loadPrices();
  }catch(e){if(request===uploadEpoch)error('imageError',e.message||'图片无法读取，请换一张图片。');}
}
async function scan(){
  if(!working||busy)return;
  const epoch=++scanEpoch,imageVersion=imageEpoch;controller=new AbortController();busy=true;setDrawing(false);error('imageError','');setControls();$('scanProgress').hidden=false;
  try{
    $('scanStatus').textContent='加载物品目录…';const list=await getCatalog();if(epoch!==scanEpoch)return;
    const result=await recognizeLoot(working,list,settings,{signal:controller.signal,onProgress:(value,text)=>{if(epoch===scanEpoch){$('scanMeter').value=value;$('scanStatus').textContent=text;}}});
    if(epoch!==scanEpoch||imageVersion!==imageEpoch)return;
    detections=result.detections.map(row=>({...row,id:crypto.randomUUID()}));selectedId=null;
    const pending=detections.filter(d=>!d.confirmed).length;
    $('imageMessage').textContent=detections.length?`找到 ${detections.length} 项，${pending} 项待确认。点击图片标注或明细中的“核对”可修改；遗漏的物品可框选补充。`:'未找到可靠匹配。可尝试裁出库存区域、调整单格宽度，或框选补充物品。';
    $('imageMeta').textContent=`${source.width} × ${source.height} · 识别单格约 ${result.cellSize}px${source.width!==working.width?'（分析图）':''}`;
  }catch(e){if(epoch===scanEpoch&&e.name!=='AbortError')error('imageError',e.message||'识别失败，请重试。');}
  finally{if(epoch===scanEpoch){busy=false;controller=null;$('scanProgress').hidden=true;render();}}
}
function drawAnnotations(context,scale=1,exporting=false){
  context.save();context.scale(scale,scale);
  for(let i=0;i<detections.length;i++){
    const d=detections[i],item=itemMap.get(d.itemId),v=valueDetection(d,item,market,settings),b=d.box;
    const text=d.confirmed?v.label:'?';
    const size=Math.max(9,Math.min(settings.fontSize,b.width*.43));context.font=`700 ${size}px Consolas,monospace`;
    // Keep labels fully inside the image, even for items touching an edge.
    let textWidth=context.measureText(text).width;
    if(textWidth+8>b.width){context.font=`700 ${Math.max(8,size*(b.width-8)/(textWidth+1))}px Consolas,monospace`;textWidth=context.measureText(text).width;}
    const labelWidth=Math.min(working.width,textWidth+8),labelHeight=size+8;
    const x=Math.max(0,Math.min(working.width-labelWidth,b.x+3)),y=Math.max(0,Math.min(working.height-labelHeight,b.y+b.height-labelHeight-3));
    context.fillStyle='rgba(5,8,5,.86)';context.fillRect(x,y,labelWidth,labelHeight);
    context.fillStyle=d.confirmed?v.color:'#ffda8a';context.textBaseline='middle';context.fillText(text,x+4,y+labelHeight/2);
    if(!exporting){
      context.strokeStyle=d.id===selectedId?'#fff0bd':d.confirmed?v.color+'88':'#c5a76b';context.lineWidth=d.id===selectedId?2:1;
      context.setLineDash(d.confirmed?[]:[4,3]);context.strokeRect(b.x+1,b.y+1,b.width-2,b.height-2);context.setLineDash([]);
      context.font='10px Consolas,monospace';context.fillStyle='#080b08dd';context.fillRect(b.x+2,b.y+2,21,14);context.fillStyle='#eeeedf';context.fillText(String(i+1),b.x+5,b.y+9);
    }
  }
  context.restore();
}
function draw(){
  if(!working)return;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(working,0,0);drawAnnotations(ctx);
  if(drag){ctx.strokeStyle='#f5df9a';ctx.lineWidth=2;ctx.setLineDash([5,3]);ctx.strokeRect(drag.start.x,drag.start.y,drag.end.x-drag.start.x,drag.end.y-drag.start.y);ctx.setLineDash([]);}
}
function render(){
  setControls();draw();const summary=summarizeDetections(detections,itemMap,market,settings);
  $('itemCount').textContent=detections.length;$('totalValue').textContent=market?formatK(summary.total):'—';$('totalSlots').textContent=summary.slots;$('pendingCount').textContent=summary.pending;
  $('summaryNote').textContent=`售价取最高商人收购价与跳蚤最低价中的较高值。${summary.missing?` ${summary.missing} 项已确认物品暂无价格，未计入总价。`:''}${summary.pending?` ${summary.pending} 项待确认，未计入总价。`:''}`;
  if(detections.length&&!drawing&&!busy)$('imageMessage').textContent=`共 ${detections.length} 项，已确认 ${detections.length-summary.pending} 项，待确认 ${summary.pending} 项。点击标注或明细可修改，遗漏物品可框选补充。`;
  const query=$('listSearch').value.trim().normalize('NFKC').toLowerCase(),sort=$('listSort').value;
  let rows=detections.map((d,i)=>({d,i,item:itemMap.get(d.itemId),v:valueDetection(d,itemMap.get(d.itemId),market,settings)}));
  if(query)rows=rows.filter(({item})=>[item?.name,item?.en,item?.id].join(' ').normalize('NFKC').toLowerCase().includes(query));
  if(sort==='total')rows.sort((a,b)=>(b.v.total||0)-(a.v.total||0));if(sort==='slot')rows.sort((a,b)=>(b.v.perSlot||0)-(a.v.perSlot||0));if(sort==='pending')rows.sort((a,b)=>a.d.confirmed-b.d.confirmed);
  const list=$('resultsList');list.replaceChildren();
  if(!rows.length){list.append(element('p','empty-results',detections.length?'没有匹配的识别结果。':'识别后，物品、占格和售价会显示在这里。'));return;}
  for(const {d,i,item,v} of rows){
    const row=element('article','loot-row'+(!d.confirmed?' pending':'')+(selectedId===d.id?' selected':''));row.dataset.id=d.id;
    const top=element('div','item-top'),img=element('img','item-thumb');img.src=item.icon;img.alt='';img.loading='lazy';top.append(img);
    const title=element('div','item-title');title.append(element('strong','',`${i+1}. ${item.name}`),element('small','',`${v.quantity>1?v.quantity+' 件堆叠 · ':''}${v.slots} 格 · ${item.width} × ${item.height}${d.slots?'（占格已校正）':''}`));top.append(title);
    const price=element('div','item-price',d.confirmed?formatK(v.total):'待确认');price.style.color=d.confirmed?v.color:'#e4c37e';price.append(element('small','',d.confirmed?`${formatK(v.perSlot)} / 格`:'候选估价 '+formatK(v.total)));top.append(price);row.append(top);
    const prices=element('div','item-prices'),display=itemPriceDisplay(v.quote),trader=market?.traders?.[v.quote?.trader?.traderId]?.name;
    const traderText=trader?`${display.trader} · ${traderChinese[trader]||trader}`:display.trader;
    for(const [label,text] of [['最高商人收购价',traderText],['跳蚤最低价',display.low],['采用售价',`${marketMoney(v.value)} · ${v.source}`],['单格价值',marketMoney(v.perSlot)]]){
      const cell=element('div');cell.append(element('span','',label),element('b','',text));prices.append(cell);
    }
    if(v.quote?.trader?.currency&&v.quote.trader.currency!=='RUB'){
      const cell=element('div');cell.append(element('span','','商人实际支付'),element('b','',`${v.quote.trader.price} ${v.quote.trader.currency}`));prices.append(cell);
    }
    row.append(prices);
    const footer=element('div','item-footer'),note=element('span','recognition-note'+(!d.confirmed?' review-label':''),`${d.confirmed?'已确认':'待确认'} · ${d.method}${d.text?' · '+d.text:''}`);
    footer.append(note);const locate=element('button','','定位'),edit=element('button','',d.confirmed?'编辑':'核对');locate.type=edit.type='button';
    locate.addEventListener('click',()=>{selectedId=d.id;draw();$('imageStage').scrollIntoView({behavior:'smooth',block:'center'});});
    edit.addEventListener('click',()=>openEditor(d));footer.append(locate,edit);row.append(footer);list.append(row);
  }
}
function setDrawing(enabled){drawing=enabled;drag=null;$('addBox').setAttribute('aria-pressed',String(enabled));$('addBox').textContent=enabled?'取消框选':'框选补充物品';$('imageStage').classList.toggle('drawing',enabled);if(!enabled)redrawId=null;draw();}
function point(event){const r=canvas.getBoundingClientRect();return {x:Math.max(0,Math.min(canvas.width,(event.clientX-r.left)*canvas.width/r.width)),y:Math.max(0,Math.min(canvas.height,(event.clientY-r.top)*canvas.height/r.height))};}
canvas.addEventListener('pointerdown',e=>{
  if(busy||!working||e.button>0)return;
  if(drawing){const p=point(e);drag={start:p,end:p};canvas.setPointerCapture(e.pointerId);e.preventDefault();}
});
canvas.addEventListener('pointermove',e=>{if(drag){drag.end=point(e);draw();e.preventDefault();}});
canvas.addEventListener('pointercancel',()=>{drag=null;draw();});
canvas.addEventListener('pointerup',async e=>{
  if(busy||!working)return;
  if(drawing&&drag){
    const b={x:Math.min(drag.start.x,drag.end.x),y:Math.min(drag.start.y,drag.end.y),width:Math.abs(drag.end.x-drag.start.x),height:Math.abs(drag.end.y-drag.start.y)},previous=redrawId;
    drag=null;if(b.width<12||b.height<12){draw();return;}
    setDrawing(false);
    const existing=detections.find(d=>d.id===previous);
    if(existing){existing.box=b;render();openEditor(existing);}else openEditor({id:crypto.randomUUID(),itemId:null,box:b,quantity:1,confidence:1,confirmed:false,method:'手动框选',candidates:[]},true);
  }else if(!drawing){const p=point(e),d=[...detections].reverse().find(d=>p.x>=d.box.x&&p.x<=d.box.x+d.box.width&&p.y>=d.box.y&&p.y<=d.box.y+d.box.height);if(d)openEditor(d);}
});
async function openEditor(d,isNew=false){
  const epoch=imageEpoch;
  try{await getCatalog();if(epoch!==imageEpoch||!working||busy)return;}catch(e){error('imageError',e.message);return;}
  editing={row:d,isNew,itemId:d.itemId};selectedId=d.id;draw();
  $('itemSearch').value='';$('itemQuantity').value=d.quantity||1;$('itemSlots').value=d.slots||(itemMap.get(d.itemId)?.width||1)*(itemMap.get(d.itemId)?.height||1);
  $('editorHint').textContent=d.text?`识别文字：${d.text}。请核对物品、堆叠数量和实际占格。`:'请选择准确物品，并核对堆叠数量和实际占格。';
  const crop=$('cropPreview');crop.width=Math.max(1,Math.round(d.box.width));crop.height=Math.max(1,Math.round(d.box.height));crop.getContext('2d').drawImage(working,d.box.x,d.box.y,d.box.width,d.box.height,0,0,crop.width,crop.height);
  $('deleteItem').hidden=isNew;$('redrawItem').hidden=isNew;error('editError','');renderItemOptions();updateSelectedItem(false);$('itemEditor').showModal();
}
function updateSelectedItem(reset){
  const item=itemMap.get(editing?.itemId);$('selectedItemName').textContent=item?item.name:'请选择物品';$('saveItem').disabled=!item;
  $('itemQuantity').max=item?.stackMax||1;
  if(reset){$('itemSlots').value=item.width*item.height;$('itemQuantity').value=1;}
}
function renderItemOptions(){
  const q=$('itemSearch').value.trim().normalize('NFKC').toLowerCase();
  let options=q?items.filter(item=>[item.name,item.en,item.id,...item.aliases].join(' ').normalize('NFKC').toLowerCase().includes(q)):[...(editing.row.candidates||[]).map(id=>itemMap.get(id)).filter(Boolean)];
  if(!q&&!options.length&&editing.itemId)options=[itemMap.get(editing.itemId)];
  const container=$('itemOptions');container.replaceChildren();
  if(!options.length){container.append(element('p','panel-message muted',q?'没有匹配物品，请换一个名称。':'输入名称搜索物品。'));return;}
  for(const item of options.slice(0,50)){
    const button=element('button','item-option');button.type='button';button.setAttribute('aria-pressed',String(editing.itemId===item.id));
    const img=element('img');img.src=item.icon;img.alt='';img.loading='lazy';const label=element('span','',item.name);label.append(element('small','',`${item.en} · ${item.width} × ${item.height}`));button.append(img,label);
    button.addEventListener('click',()=>{editing.itemId=item.id;updateSelectedItem(true);renderItemOptions();});container.append(button);
  }
  if(options.length>50)container.append(element('p','panel-message muted',`显示前 50 项，共 ${options.length} 项；可继续输入缩小范围。`));
}
$('editForm').addEventListener('submit',e=>{
  e.preventDefault();const item=itemMap.get(editing?.itemId);if(!item)return;
  const quantity=Number($('itemQuantity').value),slots=Number($('itemSlots').value);
  if(!Number.isSafeInteger(quantity)||quantity<1||quantity>item.stackMax||!Number.isSafeInteger(slots)||slots<1||slots>100){error('editError',`数量需为 1–${item.stackMax} 的整数，占格需为 1–100 的整数。`);return;}
  Object.assign(editing.row,{itemId:item.id,quantity,slots,confirmed:true,method:'人工确认'});
  if(editing.isNew)detections.push(editing.row);$('itemEditor').close();editing=null;render();
});
$('deleteItem').addEventListener('click',()=>{detections=detections.filter(d=>d.id!==editing.row.id);$('itemEditor').close();editing=null;selectedId=null;render();});
$('redrawItem').addEventListener('click',()=>{const id=editing.row.id;$('itemEditor').close();setDrawing(true);redrawId=id;$('imageMessage').textContent='在图片上拖动，重新框选此物品的完整范围。';});
$('closeEditor').addEventListener('click',()=>$('itemEditor').close());$('itemSearch').addEventListener('input',renderItemOptions);
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);}
$('downloadImage').addEventListener('click',async()=>{
  if(!source||!detections.length)return;error('imageError','');
  try{
    const output=document.createElement('canvas'),scale=source.width/working.width,footer=Math.round(52*scale);
    output.width=source.width;output.height=source.height+footer;const c=output.getContext('2d');c.drawImage(source,0,0);drawAnnotations(c,scale,true);
    c.fillStyle='#11150f';c.fillRect(0,source.height,output.width,footer);c.fillStyle='#d7d5bd';c.font=`${12*scale}px sans-serif`;
    c.fillText(`${marketModeName(settings.mode)} · ${settings.label==='total'?'整件售价':settings.label==='slot'?'单格售价':'整件价 / 单格价'} · 颜色按单格价值 · 1K = 1,000 ₽`,12*scale,source.height+20*scale,output.width-24*scale);
    c.fillStyle='#a0a48f';c.font=`${10*scale}px sans-serif`;c.fillText(`tarkov.dev · ${market?marketTime(market.fetchedAt)+(market.stale?'（缓存）':''):'价格未获取'} · ? 待确认 · 未扣手续费`,12*scale,source.height+39*scale,output.width-24*scale);
    const blob=await new Promise(resolve=>output.toBlob(resolve,'image/png'));if(!blob)throw new Error('图片导出失败');download(blob,`${fileName}-${settings.mode}-标价.png`);output.width=output.height=1;
  }catch{error('imageError','图片导出失败，请重试或使用较小的图片。');}
});
$('downloadList').addEventListener('click',()=>{
  const rows=[['序号','物品','英文名','物品ID','状态','数量','占格','单件售价RUB','整件/堆叠售价RUB','单格售价RUB','最高商人收购价RUB','商人','跳蚤最低价RUB','采用渠道','模式','价格获取时间','缓存价格','识别方式']];
  detections.forEach((d,i)=>{const item=itemMap.get(d.itemId),v=valueDetection(d,item,market,settings),trader=market?.traders?.[v.quote?.trader?.traderId]?.name;
    const flea=v.quote?.fleaAllowed!==false&&v.quote?.offers!==0?v.quote?.fleaMin:null;
    rows.push([i+1,item.name,item.en,item.id,d.confirmed?'已确认':'待确认',v.quantity,v.slots,v.value,v.total,v.perSlot,v.quote?.trader?.priceRUB,traderChinese[trader]||trader,flea,v.source,marketModeName(settings.mode),market?.fetchedAt,market?.stale?'是':'否',d.method]);});
  download(new Blob([csvText(rows)],{type:'text/csv;charset=utf-8'}),`${fileName}-${settings.mode}-物资明细.csv`);
});
$('chooseImage').addEventListener('click',()=>$('imageFile').click());$('imageFile').addEventListener('change',e=>loadImage(e.target.files[0]));
$('pasteImage').addEventListener('click',async()=>{
  if(busy)return;
  if(!navigator.clipboard?.read){error('imageError','此浏览器无法通过按钮读取剪贴板，请在页面按 Ctrl+V 粘贴图片。');return;}
  try{
    const clipboard=await navigator.clipboard.read();
    for(const entry of clipboard){const type=entry.types.find(type=>['image/png','image/jpeg','image/webp'].includes(type));if(type){const blob=await entry.getType(type);await loadImage(new File([blob],'剪贴板截图.'+(type==='image/jpeg'?'jpg':type.split('/')[1]),{type}));return;}}
    error('imageError','剪贴板中没有图片。请先复制截图，再点击粘贴或按 Ctrl+V。');
  }catch{error('imageError','未能读取剪贴板，请直接按 Ctrl+V 粘贴，或拖入图片。');}
});
$('dropZone').addEventListener('click',()=>$('imageFile').click());$('dropZone').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('imageFile').click();}});
document.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();$('dropZone').classList.add('dragging');}});
document.addEventListener('dragleave',()=>$('dropZone').classList.remove('dragging'));
document.addEventListener('drop',e=>{if(e.dataTransfer.files.length){e.preventDefault();$('dropZone').classList.remove('dragging');if(!busy&&!$('itemEditor').open)loadImage(e.dataTransfer.files[0]);}});
document.addEventListener('paste',e=>{if(busy||$('itemEditor').open)return;const file=[...e.clipboardData.items].find(item=>item.type.startsWith('image/'))?.getAsFile();if(file){e.preventDefault();loadImage(file);}});
$('scanImage').addEventListener('click',scan);$('cancelScan').addEventListener('click',()=>stopScan());$('clearImage').addEventListener('click',clearImage);
$('addBox').addEventListener('click',()=>{setDrawing(!drawing);if(drawing)$('imageMessage').textContent='在图片上拖动，框住一个完整物品。手机上可用手指拖动。';});
$('refreshPrices').addEventListener('click',()=>loadPrices(true));subscribeGameMode(mode=>{settings.mode=mode;savePreferences();loadPrices();});
$('labelMode').addEventListener('change',()=>{settings.label=$('labelMode').value;savePreferences();draw();});
for(let i=0;i<4;i++)$('tierColor'+i).addEventListener('input',()=>{settings.colors[i]=$('tierColor'+i).value;savePreferences();updateTierLabels();render();});
for(let i=0;i<3;i++)$('threshold'+i).addEventListener('input',()=>{
  const values=[0,1,2].map(i=>Number($('threshold'+i).value)*1000);
  if(values.some((n,i)=>!Number.isFinite(n)||n<=0||n>1e10||i&&n<=values[i-1])){error('settingsError','三个分界必须大于 0，并按从小到大排列。当前仍使用上次有效设置。');return;}
  error('settingsError','');settings.thresholds=values;savePreferences();updateTierLabels();render();
});
$('labelFont').addEventListener('change',()=>{settings=scannerSettings({...settings,fontSize:Number($('labelFont').value)});syncSettings();savePreferences();draw();});
$('ocrLanguage').addEventListener('change',()=>{settings.language=$('ocrLanguage').value;savePreferences();});
$('cellSize').addEventListener('change',()=>{settings=scannerSettings({...settings,cellSize:Number($('cellSize').value)});syncSettings();savePreferences();});
$('resetSettings').addEventListener('click',()=>{settings=scannerSettings({...DEFAULT_SETTINGS,mode:getGameMode()});syncSettings();savePreferences();error('settingsError','');render();});
$('listSearch').addEventListener('input',render);$('listSort').addEventListener('change',render);
window.addEventListener('pagehide',event=>{stopScan(false);if(!event.persisted)source?.close();});
syncSettings();render();
