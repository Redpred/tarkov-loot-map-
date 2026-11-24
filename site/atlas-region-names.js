// Original names are stable across source reordering and shared road anchors.
export const regionNameKey=label=>label.en||label.id;
export function cleanRegionName(value){
  return typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,60):'';
}
export function validateRegionNames(value,labels){
  const names=Object.create(null),known=new Map(labels.map(l=>[regionNameKey(l),l.name]));
  if(value?.version!==1||!value.names||typeof value.names!=='object'||Array.isArray(value.names))return names;
  for(const [key,input] of Object.entries(value.names)){
    const name=cleanRegionName(input);
    if(known.has(key)&&name&&name!==known.get(key))names[key]=name;
  }
  return names;
}
export const regionDisplayName=(label,names)=>names[regionNameKey(label)]||label.name;

export function createRegionNameEditor({labels,getNames,onSave}){
  const dialog=document.createElement('dialog');dialog.id='regionNameEditor';dialog.className='region-name-editor';
  dialog.setAttribute('aria-labelledby','regionNameEditorTitle');
  dialog.innerHTML=`<div class="region-editor-header"><h2 id="regionNameEditorTitle">自定义区域名称</h2><button id="closeRegionNameEditor" type="button">关闭 ×</button></div>
    <label class="sr-only" for="regionEditSearch">搜索中文名或原始名称</label><input id="regionEditSearch" type="search" placeholder="搜索中文名或原始名称…" autocomplete="off">
    <p class="hint">修改后自动保存，留空恢复默认。下方原始名称始终保留。</p>
    <div id="regionNameRows" class="region-name-rows"></div><p id="regionEditEmpty" hidden>没有匹配的区域</p>
    <p id="regionEditStatus" role="status" aria-live="polite"></p>`;
  document.body.append(dialog);
  const $=id=>dialog.querySelector('#'+id),groups=new Map(),rows=[];
  for(const label of labels){const key=regionNameKey(label);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(label);}
  for(const [key,group] of groups){
    const label=group[0],row=document.createElement('div');row.className='region-name-row';
    const field=document.createElement('label'),caption=document.createElement('span'),original=document.createElement('small'),input=document.createElement('input');
    caption.textContent=label.name+(group.length>1?` · ${group.length} 处`:'');original.textContent=label.en;
    input.type='text';input.maxLength=60;input.dataset.regionName=key;input.setAttribute('aria-label',`${label.en} 自定义名称`);
    input.value=regionDisplayName(label,getNames());input.placeholder=label.name;
    field.append(caption,original,input);
    const reset=document.createElement('button');reset.type='button';reset.textContent='恢复默认';reset.setAttribute('aria-label',`${label.en} 恢复默认`);
    function save(value){
      const warning=onSave(key,cleanRegionName(value));
      $('regionEditStatus').textContent=warning||'已保存';
    }
    input.addEventListener('input',()=>save(input.value));
    input.addEventListener('change',()=>{input.value=regionDisplayName(label,getNames());});
    reset.onclick=()=>{save('');input.value=regionDisplayName(label,getNames());};
    row.append(field,reset);$('regionNameRows').append(row);rows.push({row,input,label});
  }
  function filter(){
    const query=$('regionEditSearch').value.trim().toLocaleLowerCase();let visible=0;
    for(const {row,label} of rows){row.hidden=!`${label.name} ${label.en} ${(label.aliases||[]).join(' ')} ${regionDisplayName(label,getNames())}`.toLocaleLowerCase().includes(query);if(!row.hidden)visible++;}
    $('regionEditEmpty').hidden=visible!==0;
  }
  $('regionEditSearch').oninput=filter;$('closeRegionNameEditor').onclick=()=>dialog.close();
  return {destroy(){dialog.close();dialog.remove();},open(){
    for(const {input,label} of rows)input.value=regionDisplayName(label,getNames());
    $('regionEditSearch').value='';$('regionEditStatus').textContent='';filter();dialog.showModal();$('regionEditSearch').focus();
  }};
}
