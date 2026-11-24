export const ATLAS_MAPS={
  factory:{id:'factory',spt:'factory4_day',atlas:'factory_rework',name:'工厂',en:'FACTORY',
    data:'data/factory-atlas.json',geometry:'data/atlas/factory-geometry.json',textureBase:'data/atlas/',endpoint:'api/factory-geometry',
    settingsKey:'factory-marker-icons-v1',cut:3.25,minHeight:-20,maxHeight:40,
    heightBands:[{id:'underground',name:'地下',min:-20,max:-.75},{id:'ground',name:'地面',min:-.75,max:3.25},{id:'upper',name:'上层',min:3.25,max:6.75},{id:'office',name:'高层',min:6.75,max:40}]},
  streets:{id:'streets',spt:'tarkovstreets',atlas:'streets',name:'塔科夫街区',en:'STREETS OF TARKOV',
    data:'data/streets-atlas.json',geometry:'data/atlas/streets/streets-sectors.json',textureBase:'data/atlas/streets/',endpoint:'api/streets-geometry',
    settingsKey:'streets-marker-icons-v1',cut:4,minHeight:-15,maxHeight:60,streamed:true,initialSpan:240,maxViewSpan:420,
    heightBands:[{id:'underground',name:'地下',min:-15,max:-.75},{id:'ground',name:'地面',min:-.75,max:4},{id:'upper',name:'4–7.5 m',min:4,max:7.5},{id:'third',name:'7.5–11 m',min:7.5,max:11},{id:'fourth',name:'11–15 m',min:11,max:15},{id:'high',name:'15 m 以上',min:15,max:60}]},
};

const band=(id,name,min,max)=>({id,name,min,max});
const additions=[
  {id:'customs',spt:'bigmap',atlas:'customs',folder:'Custom',dev:'customs',name:'海关',en:'CUSTOMS',thumb:'Customs',cut:6.5,minHeight:-30,maxHeight:90,initialSpan:300,maxViewSpan:1300,
    heightBands:[band('underground','地下',-30,-1.75),band('ground','地面',-1.75,6.5),band('upper','上层',6.5,9.5),band('high','高层',9.5,90)]},
  {id:'woods',spt:'woods',atlas:'woods',folder:'Woods',dev:'woods',name:'森林',en:'WOODS',thumb:'Woods',cut:180,minHeight:-100,maxHeight:180,initialSpan:420,maxViewSpan:2200,defaultBand:'all',outdoor:true,
    heightBands:[band('low','低处',-100,0),band('ground','0–30 m',0,30),band('upper','30–60 m',30,60),band('high','60 m 以上',60,180)]},
  {id:'shoreline',spt:'shoreline',atlas:'shoreline',folder:'shorline',dev:'shoreline',name:'海岸线',en:'SHORELINE',thumb:'Shoreline',cut:160,minHeight:-120,maxHeight:160,initialSpan:380,maxViewSpan:2200,defaultBand:'all',outdoor:true,
    heightBands:[band('low','低处',-120,-7),band('underground','-7–-4 m',-7,-4),band('ground','-4–2.5 m',-4,2.5),band('upper','2.5–4 m',2.5,4),band('high','4 m 以上',4,160)]},
  {id:'interchange',spt:'interchange',atlas:'interchange',folder:'Shopping_Mall',dev:'interchange',name:'立交桥',en:'INTERCHANGE',thumb:'Interchange',cut:33,minHeight:-25,maxHeight:100,initialSpan:270,maxViewSpan:1200,defaultBand:'mall',labelHeight:28,
    heightBands:[band('ground','室外与车库',-25,25.5),band('mall','商场一层',25.5,33),band('upper','商场二层',33,39.5),band('high','39.5 m 以上',39.5,100)]},
  {id:'reserve',spt:'rezervbase',atlas:'reserve',folder:'Reserve_Base',dev:'reserve',name:'储备站',en:'RESERVE',thumb:'Reserve',cut:8,minHeight:-80,maxHeight:110,initialSpan:260,maxViewSpan:1200,labelHeight:0,
    heightBands:[band('underground','地下掩体',-80,-7.5),band('ground','地面',-7.5,8),band('upper','8–15 m',8,15),band('high','15 m 以上',15,110)]},
  {id:'labs',spt:'laboratory',atlas:'labs',folder:'Laboratory',dev:'the-lab',name:'实验室',en:'THE LAB',cut:3,minHeight:-30,maxHeight:50,initialSpan:170,maxViewSpan:550,labelHeight:0,
    heightBands:[band('underground','技术层',-30,-.9),band('ground','一层',-.9,3),band('upper','二层',3,7),band('high','7 m 以上',7,50)]},
  {id:'ground_zero',spt:'sandbox',sptAliases:['sandbox_high'],atlas:'ground_zero',folder:'Sandbox',dev:'ground-zero',name:'中心区',en:'GROUND ZERO',thumb:'GroundZero',cut:29.5,minHeight:-20,maxHeight:100,initialSpan:230,maxViewSpan:800,labelHeight:24,
    heightBands:[band('underground','地下',-20,20),band('ground','地面',20,29.5),band('upper','二层',29.5,32),band('high','高层',32,100)]},
  {id:'labyrinth',spt:'labyrinth',atlas:'labyrinth',folder:'Labyrinth',dev:'the-labyrinth',name:'迷宫',en:'THE LABYRINTH',cut:2,minHeight:-40,maxHeight:80,initialSpan:150,maxViewSpan:650,labelHeight:0,
    heightBands:[band('ground','下层',-40,2),band('upper','上层',2,80)]},
  {id:'terminal',spt:'terminal',atlas:'terminal',folder:'Terminal',dev:'terminal',name:'港口终点站',en:'TERMINAL',thumb:'Terminal',cut:140,minHeight:-80,maxHeight:140,initialSpan:280,maxViewSpan:1200,defaultBand:'all',minLootBuild:47242,
    heightBands:[band('underground','-61 m 以下',-80,-61),band('ground','-61–-57 m',-61,-57),band('upper','-57–-53 m',-57,-53),band('high','-53 m 以上',-53,140)]},
  {id:'icebreaker',spt:'icebreaker',atlas:'icebreaker',folder:'Icebreaker',dev:'icebreaker',name:'破冰船',en:'ICEBREAKER',cut:160,minHeight:-80,maxHeight:160,initialSpan:230,maxViewSpan:800,defaultBand:'all',minLootBuild:47242,
    heightBands:[band('underground','下部',-80,0),band('ground','0–8 m',0,8),band('upper','8–16 m',8,16),band('high','16 m 以上',16,160)]},
  {id:'lighthouse',spt:'lighthouse',atlas:'lighthouse',folder:'Lighthouse',dev:'lighthouse',name:'灯塔',en:'LIGHTHOUSE',thumb:'Lighthouse',cut:250,minHeight:-120,maxHeight:250,initialSpan:400,maxViewSpan:2200,defaultBand:'all',outdoor:true,minLootBuild:47242,skipLegacyRegions:true,
    heightBands:[band('low','低处',-120,0),band('ground','0–40 m',0,40),band('upper','40–80 m',40,80),band('high','80 m 以上',80,250)]},
];
for(const map of additions)ATLAS_MAPS[map.id]={...map,data:`data/${map.id}-atlas.json`,geometry:`data/atlas/${map.id}/${map.id}-sectors.json`,textureBase:`data/atlas/${map.id}/`,endpoint:`api/${map.id}-geometry`,settingsKey:`${map.id}-marker-icons-v1`,streamed:true};
Object.assign(ATLAS_MAPS.factory,{dev:'factory',folder:'Factory_Rework',thumb:'Factory'});
Object.assign(ATLAS_MAPS.streets,{dev:'streets-of-tarkov',folder:'City',thumb:'StreetsOfTarkov'});
export const atlasMapHref=id=>['factory','streets'].includes(id)?`${id}.html`:`map.html?map=${encodeURIComponent(id)}`;
