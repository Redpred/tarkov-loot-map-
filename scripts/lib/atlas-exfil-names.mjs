const normalize=value=>String(value??'').trim().toLocaleLowerCase('en-US');
const chinese=value=>typeof value==='string'&&/[\u3400-\u9fff]/u.test(value);
const code=value=>/^(?:ZB-\d+|D-\d+)$/i.test(String(value));

export function createExfilLocalizer(locales={}){
  const en=locales.en||{},ch=locales.ch||{},byKey=new Map(),byEnglish=new Map();
  for(const key of new Set([...Object.keys(en),...Object.keys(ch)])){
    const normalized=normalize(key);
    if(!byKey.has(normalized))byKey.set(normalized,[]);
    byKey.get(normalized).push(key);
    if(en[key]&&chinese(ch[key])){
      const english=normalize(en[key]);if(!byEnglish.has(english))byEnglish.set(english,[]);
      byEnglish.get(english).push({key,label:ch[key]});
    }
  }
  function findKey(value){
    if(Object.hasOwn(en,value)||Object.hasOwn(ch,value))return value;
    const matches=byKey.get(normalize(value))||[];
    return matches.length===1?matches[0]:null;
  }
  return row=>{
    // Prefer the actual locale ID over English text: two exits can share an
    // English name but have different Chinese labels (e.g. Sewer Manhole).
    let key=findKey(row.name)||findKey(row.display_name_en);
    const originalLabel=en[key]||row.display_name_en||row.name||'Extraction';
    let translated=ch[key];
    if(!chinese(translated)&&!code(translated)){
      const matches=byEnglish.get(normalize(originalLabel))||[];
      if(new Set(matches.map(m=>m.label)).size===1){translated=matches[0].label;key=matches[0].key;}
    }
    const label=chinese(translated)||code(translated)?translated:originalLabel;
    return {label,originalLabel,localeKey:key||null,searchText:[label,originalLabel,row.name].filter(Boolean).join(' ')};
  };
}
