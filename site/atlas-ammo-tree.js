import {buildAmmoGroups} from './atlas-ammo-search.js';
import {checkboxState} from './atlas-point-selection.js';
export const ammoSelectionKey=item=>`ammo:${item.tpl}`;
export function selectedAmmoIds(groups,selected){return new Set(groups.flatMap(g=>g.items.filter(i=>selected.has(ammoSelectionKey(i))).flatMap(i=>i.searchIds)));}

export function createAmmoTree({host,index,selection,onChange}){
  let groups=[],ids=new Set(),checks=[],parents=[];
  const section=document.createElement('div');section.className='type-group ammo-tree';host.append(section);
  const heading=document.createElement('div');heading.className='type-group-heading';
  const all=document.createElement('input');all.type='checkbox';all.setAttribute('aria-label','子弹全选');all.disabled=true;
  const toggle=document.createElement('button');toggle.type='button';toggle.className='type-group-toggle';toggle.textContent='子弹';toggle.setAttribute('aria-expanded','false');
  const content=document.createElement('div');content.id='ammoTypeOptions';content.className='type-group-options';content.hidden=true;toggle.setAttribute('aria-controls',content.id);
  toggle.onclick=()=>{content.hidden=!content.hidden;toggle.setAttribute('aria-expanded',String(!content.hidden));};
  const status=document.createElement('p');status.className='hint';status.textContent='加载子弹列表…';content.append(status);heading.append(all,toggle);section.append(heading,content);
  const allKeys=()=>groups.flatMap(g=>g.items.map(ammoSelectionKey));
  function sync(){ids=selectedAmmoIds(groups,selection.keys);for(const {input,key} of checks)input.checked=selection.keys.has(key);for(const {input,keys} of parents)Object.assign(input,checkboxState(keys,selection.keys));Object.assign(all,checkboxState(allKeys(),selection.keys));}
  function change(keys,value){selection.setMany(keys,value);onChange();}
  all.onchange=()=>change(allKeys(),all.checked);selection.subscribe(sync);
  async function load(){
    try{
      const response=await fetch('data/ammo-catalog.json');if(!response.ok)throw Error();groups=buildAmmoGroups(await response.json(),index);checks=[];parents=[];content.replaceChildren();all.disabled=!groups.length;
      for(const group of groups){
        const node=document.createElement('details');node.className='ammo-caliber-group';
        const summary=document.createElement('summary'),input=document.createElement('input');input.type='checkbox';input.setAttribute('aria-label',`全部 ${group.name} 子弹`);
        const text=document.createElement('span');text.textContent=group.name;const count=document.createElement('small');count.textContent=`${group.items.length} 种`;
        summary.append(input,text,count);node.append(summary);const keys=group.items.map(ammoSelectionKey);parents.push({input,keys});
        input.onclick=event=>event.stopPropagation();input.onchange=()=>change(keys,input.checked);
        for(const item of group.items){const label=document.createElement('label');label.className='ammo-leaf';const check=document.createElement('input');check.type='checkbox';const key=ammoSelectionKey(item);check.dataset.ammo=key;check.setAttribute('aria-label',`子弹：${item.name}`);const name=document.createElement('span');name.textContent=item.name;name.title=item.en||item.name;label.append(check,name);node.append(label);checks.push({input:check,key});check.onchange=()=>change([key],check.checked);}
        content.append(node);
      }
      if(!groups.length){status.textContent='本地图暂无已收录的子弹';content.append(status);}sync();onChange();
    }catch{status.textContent='子弹列表加载失败。';const retry=document.createElement('button');retry.textContent='重试';retry.onclick=load;content.replaceChildren(status,retry);}
  }
  load();return {matches:point=>index.matches(point,ids),all(value){change(allKeys(),value);},get keys(){return allKeys();}};
}
