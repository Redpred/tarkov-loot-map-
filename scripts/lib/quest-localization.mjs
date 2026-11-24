const nonemptyText=value=>typeof value==='string'&&value.trim()?value:null;

// SPT 5 carries task-specific strings inside each quest. Resolve one language
// at a time so a missing Chinese value cannot be recorded as an English translation.
export function resolveQuestLocale(quest,key,language,locales={}){
  const questText=nonemptyText(quest?.localization?.[language]?.[key]);
  if(questText!==null)return {key,language,text:questText,source:'quest'};
  const globalText=nonemptyText(locales?.[language]?.[key]);
  return {key,language,text:globalText,source:globalText===null?null:'global'};
}
