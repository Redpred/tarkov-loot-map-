export function buildAmmoGroups(catalog,index){
  const groups=new Map();
  for(const item of catalog.items||[]){
    const searchIds=[...new Set(item.searchIds||[item.tpl])].filter(id=>index.byId.has(id));
    if(!searchIds.length)continue;
    if(!groups.has(item.caliber))groups.set(item.caliber,{id:item.caliber,name:item.caliberName,items:[]});
    groups.get(item.caliber).items.push({...item,searchIds});
  }
  const compare=(a,b)=>a.name.localeCompare(b.name,'zh-CN',{numeric:true});
  for(const group of groups.values())group.items.sort(compare);
  return [...groups.values()].sort(compare);
}

export function createAmmoSearch({button,index,iconHtml,onSelect,onOpen=()=>{}}){
  const make=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
  const dialog=make('dialog','ammo-dialog');dialog.id='ammoDialog';dialog.setAttribute('aria-labelledby','ammoTitle');
  const header=make('div','ammo-header'),title=make('h2','','子弹搜索');title.id='ammoTitle';
  const all=make('button','','全选');all.type='button';all.setAttribute('aria-label','搜索所有子弹');all.disabled=true;
  const close=make('button','ammo-close','×');close.type='button';close.setAttribute('aria-label','关闭子弹搜索');
  header.append(title,all,close);
  const status=make('p','ammo-status','加载子弹…');status.setAttribute('role','status');
  const columns=make('div','ammo-columns'),left=make('div','ammo-calibers'),right=make('div','ammo-rounds');
  left.setAttribute('role','list');left.setAttribute('aria-label','子弹口径');right.setAttribute('role','list');right.setAttribute('aria-label','子弹型号');
  columns.append(left,right);dialog.append(header,status,columns);document.body.append(dialog);
  button.disabled=false;button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls',dialog.id);button.setAttribute('aria-expanded','false');
  let groups=null,selected=null,loading=null;
  function choose(items,label){const ids=[...new Set(items.flatMap(i=>i.searchIds))];if(!ids.length)return;dialog.close();onSelect(ids,label);}
  function renderModels(){
    const group=groups?.find(g=>g.id===selected);right.replaceChildren();if(!group)return;
    for(const item of group.items){
      const row=make('div','ammo-model-row');row.setAttribute('role','listitem');
      const choice=make('button','ammo-model');choice.type='button';choice.setAttribute('aria-label',`搜索子弹：${item.name}`);
      const icon=make('span','ammo-icon');icon.setAttribute('aria-hidden','true');icon.innerHTML=iconHtml(item.tpl);
      const copy=make('span','ammo-copy');copy.append(make('strong','',item.name));if(item.en&&item.en!==item.name)copy.append(make('small','',item.en));
      choice.append(icon,copy);choice.addEventListener('click',()=>choose([item],item.name));row.append(choice);right.append(row);
    }
    for(const choice of left.querySelectorAll('[data-caliber]'))choice.setAttribute('aria-pressed',String(choice.dataset.caliber===selected));
    right.scrollTop=0;
  }
  function render(){
    left.replaceChildren();all.disabled=!groups.length;status.textContent=groups.length?`${groups.length} 种口径 · ${groups.reduce((n,g)=>n+g.items.length,0)} 种子弹`:'本地图暂无已收录的子弹';
    for(const group of groups){
      const row=make('div','ammo-caliber-row');row.setAttribute('role','listitem');
      const choice=make('button','ammo-caliber',group.name);choice.type='button';choice.dataset.caliber=group.id;choice.setAttribute('aria-label',`查看口径：${group.name}`);
      choice.addEventListener('click',()=>{selected=group.id;renderModels();});
      const select=make('button','ammo-caliber-all','全选');select.type='button';select.setAttribute('aria-label',`搜索全部 ${group.name} 子弹`);select.addEventListener('click',()=>choose(group.items,`${group.name} · 全部子弹`));
      row.append(choice,select);left.append(row);
    }
    selected??=groups[0]?.id;renderModels();
  }
  async function load(){
    if(groups){render();return;}
    if(loading)return loading;
    loading=(async()=>{try{const response=await fetch('data/ammo-catalog.json');if(!response.ok)throw Error('ammo catalog');groups=buildAmmoGroups(await response.json(),index);render();}catch{status.textContent='子弹加载失败，请重新打开重试';}finally{loading=null;}})();return loading;
  }
  button.addEventListener('click',()=>{onOpen();dialog.showModal();button.setAttribute('aria-expanded','true');load();});
  all.addEventListener('click',()=>choose(groups.flatMap(g=>g.items),'所有子弹'));
  close.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{button.setAttribute('aria-expanded','false');button.focus({preventScroll:true});});
  dialog.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();dialog.close();}});
  dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();});
  return {close:()=>dialog.open&&dialog.close()};
}
