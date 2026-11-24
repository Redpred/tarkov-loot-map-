export const SETTINGS_KEY='factory-marker-icons-v1';
export const emptySettings=()=>({version:1,types:{},points:{}});
// Quest records can reuse a scene ID at several different coordinates.
export function pointSettingKey(point){const p=point.position;return `${point.kind}:${point.sourceId}:${p?`${p.x},${p.y},${p.z}`:'unresolved'}`;}
export function typeSettingKey(point,descriptor){
  if(point.kind==='poi')return `poi:${point.poiTypes[0]}`;
  return point.kind==='container'?`container:${point.containerTpl}`:`${descriptor.mode}:${descriptor.key}`;
}
export function validateSettings(value,entries){
  if(!value||value.version!==1||!value.types||!value.points)throw new Error('图标配置格式或版本不支持');
  const clean=emptySettings();
  for(const group of ['types','points']){
    if(typeof value[group]!=='object'||Array.isArray(value[group]))throw new Error('图标配置格式错误');
    const pairs=Object.entries(value[group]);if(pairs.length>(group==='points'?20000:5000))throw new Error('配置记录过多');
    for(const [key,icon] of pairs){
      if(key.length>600||!key.includes(':')||typeof icon!=='string'||!Object.hasOwn(entries,icon))throw new Error('配置包含未知图标或无效记录');
      clean[group][key]=icon;
    }
  }
  return clean;
}
export function resolveMarker(point,base,settings,entries){
  const own=settings.points[pointSettingKey(point)],type=settings.types[typeSettingKey(point,base)];
  const key=own||type;
  if(!key||!Object.hasOwn(entries,key))return base;
  // Older browser settings may assign a specific inventory image to a category.
  // Keep their stored choices, but render the SVG default for multi-root loot.
  if(['loose','container'].includes(point.kind)&&base.mode!=='item'&&!entries[key].file?.endsWith('.svg'))return base;
  return {...base,key,custom:own?'point':'type',description:`自定义${own?'当前点位':'同类点位'}图标：${entries[key].name||entries[key].representative}。${base.description}`};
}

export function readMapIconSettings(storage,map,entries){
  const raw=storage.getItem(map.settingsKey);return raw?validateSettings(JSON.parse(raw),entries):emptySettings();
}

// Save a multi-map edit as one logical operation. If browser storage is full,
// restore every earlier write instead of leaving only some maps modified.
export function saveMapIconSettings(storage,batch,maps,entries){
  const changes=Object.entries(batch).map(([id,value])=>{
    if(!Object.hasOwn(maps,id))throw new Error('未知地图');
    return {key:maps[id].settingsKey,value:JSON.stringify(validateSettings(value,entries))};
  });
  const previous=changes.map(change=>({...change,old:storage.getItem(change.key)}));
  try{for(const change of changes)storage.setItem(change.key,change.value);}
  catch(error){for(const change of previous){try{if(change.old===null)storage.removeItem(change.key);else storage.setItem(change.key,change.old);}catch{}}throw new Error('浏览器无法保存图标配置，请检查可用存储空间。',{cause:error});}
}

export function editTypeAcrossMaps(settingsByMap,mapIds,typeKey,icon){
  const batch={};
  for(const id of mapIds){const next=structuredClone(settingsByMap[id]||emptySettings());if(icon===null)delete next.types[typeKey];else next.types[typeKey]=icon;batch[id]=next;}
  return batch;
}
