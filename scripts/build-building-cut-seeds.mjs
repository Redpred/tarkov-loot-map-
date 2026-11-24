import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ATLAS_MAPS} from '../site/atlas-maps.js';
import {validateBuildingCuts,createCutPlan,inCutRect,rectArea,defaultCutPresets} from '../site/atlas-building-cuts.js';
const root=path.resolve(import.meta.dirname,'..'),work='work/building-cuts-20261019';
const read=p=>fs.readFileSync(path.join(root,p)),json=p=>JSON.parse(read(p)),hash=p=>createHash('sha256').update(read(p)).digest('hex');
const out=path.join(root,work,'staged');fs.mkdirSync(out,{recursive:true});
const upstreamPath='work/region-names-20261019/upstream/src/data/maps.json',upstream=json(upstreamPath);
const raw=(fd,offset,count,integer=false)=>{const b=Buffer.alloc(count*4);if(fs.readSync(fd,b,0,b.length,offset)!==b.length)throw Error('Short geometry read');return Array.from({length:count},(_,i)=>integer?b.readUInt32LE(i*4):b.readFloatLE(i*4));};
const matrixKey=m=>Array.from(m.slice(0,12),Math.fround).join(',');
const building=/house|cabin|warehouse|building|barn|sawmill|sanatorium|casarm|hotel|chalet|station|hospital|dorm|azs|repairbox|abandoned_lab|Stuff_storage|garage|hangar|cottage|barrack/i;
const structural=/floor|ceiling|wall|roof|exterior|exterier|outside|interior|inside/i;
const reject=/cabinet|greenhouse|doghouse|birdhouse|road|shadow|decal|window|glass|(?:^|_)doors?(?:_|$|\b)|fence|ruin|ruined|scaffold|machine|railing|handrail|vent|plinth|trim|column|pillar|booth|dog_house|sign|carpet|bed_|mirror|table|furniture|photo|clock|(?:^|_)box_|boxes|air_conditioner|Home_theater|Folders|clothes|kitchen|Tennis_court|wallpaper|chimney|Transformer|Sub_Station|Pipe_Station/i;
function groupFor(map,row){
  const name=row.gameObjectName||'',r=row.root||'';
  const subject=name.replace(/^Lighthouse_(?!Tower|RLS_Station)/i,'');
  if(reject.test(name)||!(structural.test(subject)||building.test(subject)))return null;
  if(/pipes|wires|workbench|screen|urinal|hooks|imposter|fountain|fakeindoor|welding|_territory|_soil_|_terrain/i.test(name))return null;
  if(map==='streets'&&/^SBG_City_/i.test(r)&&!/(Roads|LIGHT|Design|courtyard|cortyard|courtyad|PLANTS|back)/i.test(r))return r.replace(/_(?:indoor|outdoor).*$/i,'').replace(/_(?:2ST|3ST).*$/i,'');
  if(map==='terminal'&&/^SBG_Terminal_Area_/.test(r)&&!/(Courtyard|PLANTS)/i.test(r))return r.replace(/_Indoor$/i,'');
  if(map==='labyrinth'&&/^SBG_Labyrinth_Area_/.test(r))return r;
  if(map==='ground_zero'&&/^SBG_Sandbox_Area_/.test(r))return r;
  if(map==='icebreaker'||map==='factory'||map==='labs')return null;
  if(/terrace|ladder|stairs|staircase/i.test(name))return null;
  if(!building.test(subject))return null;
  if(!/(?:_LOD0|outside|inside|exterior|exterier)$/i.test(name.replace(/\s*\(\d+\)$/,'')))return null;
  return `${r}:${row.rendererSource}:${row.rendererPathId}`;
}
const sourceNames={dome:'雷达站',pawns:'兵营区','black bishop':'机头楼（黑主教）','white bishop':'医疗楼（白主教）','white king':'皇冠楼（白王）',knights:'马楼区','train depot':'火车站',towers:'哨塔','scav lands':'Scav 土地','checkpoint fence tower':'围墙哨塔',dorms:'宿舍楼',mechanic:'修车房',skeleton:'新烂尾楼',mall:'商场','big red 2nd':'大红仓','construction 2nd':'老烂尾楼','west wing':'疗养院西楼',admin:'疗养院管理楼',garage:'地下车库',underpass:'地下通道'};
const summary=[],audit=[];
for(const map of Object.values(ATLAS_MAPS)){
  const manifestPath=map.id==='factory'?'site/data/atlas/factory-geometry.json':`site/data/atlas/${map.id}/${map.id}-geometry.json`,manifest=json(manifestPath),scenePath=`work/atlas-assets/${map.atlas}/scene.json`,scene=json(scenePath);
  if(hash(scenePath)!==manifest.sceneSha256)throw Error(`${map.id}: scene binding differs`);
  const geometrySha256=manifest.sha256,labels=json(`site/data/${map.id}-regions.json`).labels,loot=json('site/'+map.data).points.filter(p=>p.position&&!p.outsideClientEnvelope&&['loose','container'].includes(p.kind));
  const dev=upstream.find(m=>m.normalizedName===map.dev)?.maps.find(m=>m.projection==='interactive');
  const profile={version:1,map:map.id,geometrySha256,presets:defaultCutPresets(),regions:[],source:{coordinateSystem:'unity-world-xyz',clientGeometry:manifestPath,geometrySha256,sceneSha256:manifest.sceneSha256,tarkovDev:{path:upstreamPath,sha256:hash(upstreamPath),commit:'97ff6e7a43d03c10f3f7a3165c8dbcdf2193d6b9'},notice:'初始观察预设，尚未逐栋人工校准。客户端结构范围及水平面候选结合 tarkov.dev 楼层区间；不会修改地图模型。'}};
  const bounded=new Map();
  if(!map.skipLegacyRegions)for(const layer of dev?.layers||[]){const number=/^(\d)(?:st|nd|rd|th) Floor$/.exec(layer.name)?.[1];if(!number)continue;for(const extent of layer.extents||[])for(const bound of extent.bounds||[]){if(!Array.isArray(bound[0])||!Array.isArray(bound[1]))continue;const [a,b,name='建筑区域']=bound,r={minX:Math.min(a[0],b[0]),maxX:Math.max(a[0],b[0]),minZ:Math.min(a[1],b[1]),maxZ:Math.max(a[1],b[1])},id=JSON.stringify([r,name]);if(!bounded.has(id))bounded.set(id,{...r,name,levels:[]});bounded.get(id).levels.push({level:Number(number),low:extent.height[0],high:extent.height[1]});}}
  for(const r of bounded.values()){
    const cuts={};for(const level of r.levels){const below=['','first','second','third','fourth'][level.level-1],current=['','','second','third','fourth','fifth'][level.level];if(below&&Number.isFinite(level.low))cuts[below]=level.low-.6;if(current&&level.high<1000)cuts[current]=level.high-.6;else if(current&&Number.isFinite(level.low))cuts[current]=level.low+1.8;}
    for(const id of Object.keys(cuts))if(!profile.presets.some(p=>p.id===id))profile.presets.push({id,name:{fourth:'四楼',fifth:'五楼'}[id]||id});
    const contained=labels.filter(l=>inCutRect(l.position,r)&&l.kind!=='road');
    const name=sourceNames[r.name]||(contained.length===1?contained[0].name:`建筑区域 ${profile.regions.length+1}`);
    profile.regions.push({id:`layer-${profile.regions.length+1}`,name,...Object.fromEntries(['minX','maxX','minZ','maxZ'].map(k=>[k,r[k]])),cuts,source:{kind:'layer-height-initial',label:r.name,levels:r.levels,review:'needs-visual-calibration'}});
  }
  // Interior maps have one continuous structure; retain their already calibrated
  // global cuts as a bounded, individually editable region rather than a world plane.
  const indoor={factory:{first:3.28,second:6.85,third:10.4,basement:-.86},interchange:{first:30.2,second:39.45,basement:25.1},labs:{first:2.4,second:5.4,basement:-1.2},icebreaker:{first:20.9,second:23.8,third:26.8,basement:17.8}}[map.id];
  if(indoor){profile.regions=[];const b=map.id==='interchange'?{min:[-222,0,-327],max:[120,0,218]}:manifest.bounds;profile.regions.push({id:'main-interior',name:{factory:'厂房与办公区',interchange:'商场',labs:'实验室',icebreaker:'船体'}[map.id],minX:b.min[0],maxX:b.max[0],minZ:b.min[2],maxZ:b.max[2],cuts:indoor,source:{kind:['factory','interchange'].includes(map.id)?'existing-display-presets':'layer-height-initial',review:'needs-visual-calibration'}});}
  const byMesh=new Map(),groups=new Map();
  for(const row of scene.instances){if(row.drop||row.renON===false||row.aih===false)continue;const key=groupFor(map.id,row);if(!key)continue;if(!byMesh.has(row.mesh))byMesh.set(row.mesh,new Map());byMesh.get(row.mesh).set(matrixKey(row.m),{row,key});}
  const fd=fs.openSync(path.join(root,path.dirname(manifestPath),manifest.binary),'r');
  try{for(const mesh of manifest.meshes){const rows=byMesh.get(mesh.name);if(!rows||['decal','cutout','glass','water'].includes(manifest.materials[mesh.material].role))continue;
    const matrices=raw(fd,mesh.matrixOffset,mesh.instances*12),positions=raw(fd,mesh.positionOffset,mesh.vertices*3),indices=raw(fd,mesh.indexOffset,mesh.indices,true);
    for(let i=0;i<mesh.instances;i++){const m=matrices.slice(i*12,i*12+12),match=rows.get(matrixKey(m));if(!match)continue;const {row,key}=match;
      if(!groups.has(key))groups.set(key,{key,names:new Set(),minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity,minY:Infinity,maxY:-Infinity,planes:new Map(),renderers:new Set()});const g=groups.get(key);g.names.add(row.gameObjectName);g.renderers.add(`${row.rendererSource}:${row.rendererPathId}`);
      const points=[];for(let j=0;j<positions.length;j+=3){const [x,y,z]=positions.slice(j,j+3),p=[m[0]*x+m[1]*y+m[2]*z+m[3],m[4]*x+m[5]*y+m[6]*z+m[7],m[8]*x+m[9]*y+m[10]*z+m[11]];points.push(p);g.minX=Math.min(g.minX,p[0]);g.maxX=Math.max(g.maxX,p[0]);g.minZ=Math.min(g.minZ,p[2]);g.maxZ=Math.max(g.maxZ,p[2]);g.minY=Math.min(g.minY,p[1]);g.maxY=Math.max(g.maxY,p[1]);}
      for(let j=0;j<indices.length;j+=3){const a=points[indices[j]],b=points[indices[j+1]],c=points[indices[j+2]];if(Math.max(a[1],b[1],c[1])-Math.min(a[1],b[1],c[1])>.08)continue;const area=Math.abs((b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]))/2;if(area<.03)continue;const h=Math.round((a[1]+b[1]+c[1])/3*10)/10;g.planes.set(h,(g.planes.get(h)||0)+area);}
    }
  }}finally{fs.closeSync(fd);}
  const candidates=[...groups.values()].filter(g=>rectArea(g)>=12&&rectArea(g)<50000&&g.maxY-g.minY>=2&&g.maxX-g.minX<300&&g.maxZ-g.minZ<300);
  const evidence=[];
  for(const g of candidates){
    const center={x:(g.minX+g.maxX)/2,z:(g.minZ+g.maxZ)/2};if(profile.regions.some(r=>inCutRect(center,r)))continue;
    const duplicate=profile.regions.some(r=>{const ix=Math.max(0,Math.min(r.maxX,g.maxX)-Math.max(r.minX,g.minX)),iz=Math.max(0,Math.min(r.maxZ,g.maxZ)-Math.max(r.minZ,g.minZ));return ix*iz/Math.min(rectArea(r),rectArea(g))>.75;});if(duplicate)continue;
    const points=loot.filter(p=>inCutRect(p.position,g)).map(p=>p.position.y).sort((a,b)=>a-b),ceiling=points.length?points.at(-1)+.4:g.maxY-1.5;
    const peaks=[...g.planes].filter(([h,area])=>area>=Math.max(3,rectArea(g)*.03)&&h<=ceiling).sort((a,b)=>a[0]-b[0]);
    const floors=[];for(const peak of peaks){if(!floors.length||peak[0]-floors.at(-1)[0]>=1.9)floors.push(peak);else if(peak[1]>floors.at(-1)[1])floors[floors.length-1]=peak;}
    // These warehouse shells stand directly on separately rendered railway
    // platforms. Their wall bases are observable in the current model; keep
    // this explicitly different from a measured horizontal floor triangle.
    const shellBase=!floors.length&&[...g.names].every(n=>/^Stuff_storage/i.test(n))&&points.length;
    if(shellBase)floors.push([g.minY,0]);
    if(!floors.length)continue;
    const first=points.length?floors.filter(f=>f[0]<=points[Math.floor(points.length*.15)]+.15).at(-1)||floors[0]:floors[0],start=floors.indexOf(first),levels=floors.slice(start,Math.min(start+3,floors.length));
    const cuts={};levels.forEach((f,i)=>cuts[['first','second','third'][i]]=Math.min(g.maxY-.15,f[0]+1.65));if(start>0)cuts.basement=floors[start-1][0]+1.65;
    // A one-storey building keeps the same roof opening in higher presets.
    for(const id of ['second','third'])if(!Number.isFinite(cuts[id]))cuts[id]=cuts.first;
    if([...g.names].every(n=>/basement|underground/i.test(n))){const basement=cuts.first;for(const k of Object.keys(cuts))delete cuts[k];cuts.basement=basement;}
    const explicitFloors=[...g.names].map(n=>Number(/_(\d)(?:Floor|F)(?:_|$)/i.exec(n)?.[1]));
    if(explicitFloors.every(n=>n>=2&&n<=3)&&new Set(explicitFloors).size===1){const high=cuts.first;for(const k of Object.keys(cuts))delete cuts[k];cuts[['','first','second','third'][explicitFloors[0]]]=high;}
    const containing=labels.filter(l=>inCutRect(l.position,g)&&l.kind!=='road').sort((a,b)=>b.priority-a.priority),name=containing[0]?.name||`建筑区域 ${profile.regions.length+1}`;
    const record={id:'structure-'+createHash('sha256').update(g.key).digest('hex').slice(0,12),name,minX:g.minX,maxX:g.maxX,minZ:g.minZ,maxZ:g.maxZ,cuts,source:{kind:shellBase?'client-shell-base-initial':'client-horizontal-plane-initial',review:'needs-visual-calibration',sceneRoot:g.key,structureNames:[...g.names],renderers:[...g.renderers],floorCandidates:floors,selectedFirst:first[0],lootHeightSamples:points.length}};
    profile.regions.push(record);evidence.push(record.source);
  }
  // Keep individually named structures editable even where a reference extent
  // groups multiple buildings under one floor range.
  const envelopes=json(`site/data/volumes/${map.id}.json`).regions;
  for(const [id,volumes] of Object.entries(envelopes))for(const v of volumes){if(v.type!=='prism')continue;const label=labels.find(l=>l.id===id);if(!label)continue;
    const parent=profile.regions.filter(r=>inCutRect(label.position,r)).sort((a,b)=>rectArea(a)-rectArea(b))[0];
    const cuts=parent?{...parent.cuts}:{first:Math.min(v.maxY-.15,v.minY+1.65)};
    profile.regions.push({id:'named-'+id,name:label.name,minX:Math.min(...v.polygon.map(p=>p.x)),maxX:Math.max(...v.polygon.map(p=>p.x)),minZ:Math.min(...v.polygon.map(p=>p.z)),maxZ:Math.max(...v.polygon.map(p=>p.z)),cuts,source:{kind:'named-envelope-initial',review:'needs-visual-calibration',envelope:v.source.evidence,inherited:parent?.id||null}});
  }
  if(!map.skipLegacyRegions&&!indoor)for(const layer of dev?.layers||[])if(/underground|bunkers|tunnels|garage/i.test(layer.name))for(const extent of layer.extents||[])for(const bound of extent.bounds||[]){if(!Array.isArray(bound[0])||!Array.isArray(bound[1]))continue;const [a,b,name='地下区域']=bound;
    profile.regions.push({id:'basement-'+profile.regions.length,name:sourceNames[name]||'地下区域 '+(profile.regions.length+1),minX:Math.min(a[0],b[0]),maxX:Math.max(a[0],b[0]),minZ:Math.min(a[1],b[1]),maxZ:Math.max(a[1],b[1]),cuts:{basement:extent.height[1]-.6},source:{kind:'layer-height-initial',label:name,review:'needs-visual-calibration'}});
  }
  for(const r of profile.regions)for(const k of Object.keys(r.cuts))r.cuts[k]=Math.round(r.cuts[k]*100)/100;
  const valid=validateBuildingCuts(profile,{map:map.id,geometrySha256});for(const preset of valid.presets)createCutPlan(valid,preset.id);
  fs.writeFileSync(path.join(out,map.id+'.json'),JSON.stringify(valid,null,2)+'\n');
  summary.push({map:map.id,regions:valid.regions.length,first:valid.regions.filter(r=>Number.isFinite(r.cuts.first)).length,clientCandidates:groups.size,acceptedClient:evidence.length,reviewed:false});
  audit.push({map:map.id,inputs:[manifestPath,scenePath,`site/data/${map.id}-regions.json`,'site/'+map.data].map(p=>({path:p,sha256:hash(p)})),evidence});console.log(JSON.stringify(summary.at(-1)));
}
fs.writeFileSync(path.join(root,work,'seed-audit.json'),JSON.stringify({summary,audit,limits:['Automatic horizontal-plane choices are editable visual seeds, not verified playable storeys.','Rectangles enclose selected architecture and can include adjacent outdoor space.','No claim of exhaustive building coverage or exact tarkov.dev image reproduction.']},null,2)+'\n');
