// Display presets are independent of source height bands used to label data.
const HEIGHT_PRESETS={
  factory:[['third','三层',10.40],['second','二层',6.85],['first','一层',3.28],['basement','地下',-0.86]],
  interchange:[['second','二楼',39.45],['first','一楼',30.20],['outside','室外与车库',25.10]],
  reserve:[['third','三楼',1.62],['second','二楼',-1.47],['first','一楼',-4.25],['basement-upper','地下上层',-8.58],['basement-center','地下中心',-11.98]],
};
export const heightPresetsFor=mapId=>(HEIGHT_PRESETS[mapId]||[]).map(([id,name,max])=>({id,name,max}));
export const heightPresetAbove=(presets,height)=>presets.filter(p=>p.max>height).sort((a,b)=>a.max-b.max)[0];

// Height presets are upper limits. The retained scene's minimum never changes
// when switching presets, dragging the slider, or entering first person.
export function createHeightRange(bounds){
  const min=bounds?.min?.[1],maxHeight=bounds?.max?.[1];
  if(!Number.isFinite(min)||!Number.isFinite(maxHeight)||maxHeight<=min)throw new Error('地图高度范围无效');
  const clamp=value=>Math.max(min,Math.min(maxHeight,Number.isFinite(value)?value:maxHeight));
  return {
    min,max:maxHeight,clamp,
    preset:band=>clamp(band?.max??maxHeight),
    bounds:(cut,firstPerson=false)=>({low:min,high:firstPerson?Math.max(10000,bounds.max[1]+1):clamp(cut)}),
  };
}
