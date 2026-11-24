import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {buildRegionArrival} from '../site/atlas-region-arrivals.js';
import {requestedMaps} from './lib/atlas-build-maps.mjs';

const root=path.resolve(import.meta.dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const raw=read('data/regions/tarkov-dev-maps.json');
const maps=JSON.parse(raw),names={...JSON.parse(read('data/regions/names-zh.json')),...JSON.parse(read('data/regions/names-extra-zh.json'))};
const namingPath='data/regions/names-community-zh.json',namingRaw=read(namingPath),naming=JSON.parse(namingRaw);
const namesOnly=process.argv.includes('--names-only'),outArg=process.argv.indexOf('--out');
const output=outArg<0?path.join(root,'site/data'):path.resolve(root,process.argv[outArg+1]);
if(output!==path.join(root,'site/data')&&!output.startsWith(path.join(root,'work')+path.sep))throw Error('Stage region output under work/');
fs.mkdirSync(output,{recursive:true});
const namingSource={path:namingPath,sha256:createHash('sha256').update(namingRaw).digest('hex'),tarkovDevCommit:naming.tarkovDevCommit,policy:naming.policy};
function namedLabel(label,map){
  const record=naming.maps[map]?.[label.en];if(!record)return label;
  if(!record.name||!record.sources?.length||record.sources.some(key=>!naming.sources[key]))throw Error(`Invalid name evidence: ${map}/${label.en}`);
  const aliases=[...new Set([...(label.aliases||[]),label.name,...record.aliases])].filter(n=>n&&n!==record.name);
  return {...label,name:record.name,aliases,nameSources:record.sources};
}
const roomNames=new Set(['Main Office','Breach Room','Locked Office','Locker Rooms','Sinks','Hole','Servers','Rafters']);
const source={
  name:'tarkov.dev',url:'https://github.com/the-hideout/tarkov-dev/blob/main/src/data/maps.json',
  snapshotSha256:createHash('sha256').update(raw).digest('hex'),license:'MIT',licenseFile:'regions-LICENSE.txt',
  notice:'英文地标与锚点来自 tarkov.dev；中文优先采用已核实的玩家叫法，其他沿用描述性名称，中文不全部出自 tarkov.dev。X/Z 沿用原始世界坐标；Y 仅作文字显示高度，不表示建筑边界、入口或房间中心的精确高度。',
  naming:namingSource
};
fs.copyFileSync(path.join(root,'data/regions/tarkov-dev-LICENSE'),path.join(output,'regions-LICENSE.txt'));
for(const map of requestedMaps()){
  const id=map.id,data=maps.find(m=>m.normalizedName===map.dev)?.maps.find(m=>m.projection==='interactive');
  if(namesOnly){
    const current=JSON.parse(read(`site/data/${id}-regions.json`));
    const keys=new Set(current.labels.map(l=>l.en));
    for(const en of Object.keys(naming.maps[id]||{}))if(!keys.has(en))throw Error(`Unmatched name: ${id}/${en}`);
    const labels=current.labels.map(label=>namedLabel(label,id));
    fs.writeFileSync(path.join(output,`${id}-regions.json`),JSON.stringify({...current,source:{...current.source,notice:source.notice,naming:namingSource},labels},null,2)+'\n');
    console.log(`${id}: ${labels.filter((l,i)=>l.name!==current.labels[i].name).length} renamed, geometry unchanged`);continue;
  }
  const loot=JSON.parse(read(map.data.replace(/^data\//,'site/data/')));
  const positions=loot.points.filter(p=>p.position&&!p.outsideClientEnvelope&&p.sceneActive!==false).map(p=>p.position);
  // Heights of third-party captions are display slices, not measured terrain
  // elevations. Use nearby data only to place broad outdoor captions vertically.
  const localHeight=(l,fallback)=>{
    const [x,z]=l.position,near=positions.map(p=>({p,d:Math.hypot(p.x-x,p.z-z)})).filter(v=>v.d<100).sort((a,b)=>a.d-b.d).slice(0,7).map(v=>v.p.y).sort((a,b)=>a-b);
    return near.length?near[Math.floor(near.length/2)]-.5:fallback;
  };
  const labels=(map.skipLegacyRegions?[]:data?.labels||[]).map((l,index)=>{
    if(!names[l.text]||!l.position.slice(0,2).every(Number.isFinite))throw new Error(`Invalid label: ${l.text}`);
    const road=/ St\.$| Ave\.$| Alley$/.test(l.text);
    const room=id==='factory'?roomNames.has(l.text):id==='labs'&&!['Parking','Warehouse','Main Working Area'].includes(l.text)||id==='interchange'&&l.bottom>=25&&!['IDEA','OLI','Goshan'].includes(l.text)||id==='ground_zero'&&l.text==='Science Office';
    let floor=null,y=id==='streets'?3:map.labelHeight??1;
    if(id==='factory'){
      if(l.top<=-2){floor='underground';y=-3;}
      else if(l.bottom>=6){floor='office';y=7.5;}
      else if(l.bottom>=3){floor='upper';y=4.3;}
      else if(l.top<=2){floor='ground';y=.8;}
      // These broad locations extend across both lower storeys.
      else if(l.top<=5){floor=['ground','upper'];y=1;}
    }else if(id==='interchange'){
      floor=l.bottom>=34?'upper':l.bottom>=25?'mall':'ground';y=floor==='upper'?37:floor==='mall'?28:22;
    }else if(id==='labs'){
      floor=l.bottom>=3?'upper':l.text==='Boiler Room'?'underground':'ground';y=floor==='upper'?4.2:floor==='ground'?.5:-3;
    }else if(id==='ground_zero'){
      if(room){floor='ground';y=28;}else y=24;
    }else if(id!=='streets')y=localHeight(l,map.labelHeight??1);
    const priority=id==='streets'?(road?1:l.size>=90?4:2):l.text==='Office Building'?4:room?1:l.size>=80?4:3;
    const label={
      id:`${id}-region-${index}`,name:names[l.text],en:l.text,kind:road?'road':room?'room':'area',
      position:{x:l.position[0],y,z:l.position[1]},floor,priority,
      minPixelsPerMeter:room?(id==='factory'?8:3):0,
      overviewFor:l.text==='Office Building'?['upper','office']:[],
      sourceHeight:typeof l.bottom==='number'?{bottom:l.bottom,top:l.top}:null,
      heightMethod:['factory','streets','interchange','labs','ground_zero'].includes(id)?'display-floor':'nearby-point-height'
    };
    return namedLabel({...label,arrival:buildRegionArrival(label,id)},id);
  });
  fs.writeFileSync(path.join(output,`${id}-regions.json`),JSON.stringify({map:id,source,labels,
    emptyReason:labels.length?null:map.skipLegacyRegions?'新版地图区域名称待核验，未叠加旧版名称坐标。':'暂未收录此地图的区域名称锚点。'},null,2)+'\n');
  console.log(`${id}: ${labels.length} names (${labels.filter(l=>l.kind==='road').length} road labels)`);
}
