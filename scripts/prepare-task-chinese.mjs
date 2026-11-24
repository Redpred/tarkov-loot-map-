// Prepare a Chinese-first view of the pinned task snapshot, without changing it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {resolveQuestLocale} from './lib/quest-localization.mjs';

const root=path.resolve(import.meta.dirname,'..');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const pointerToken=value=>String(value).replace(/~/g,'~0').replace(/\//g,'~1');
const hasHan=text=>/\p{Script=Han}/u.test(text||'');
const sourcePath=path.join(root,'data/task-source.json'),entry=read(sourcePath);
const input=path.resolve(root,entry.packagePath),manifestFile=path.resolve(root,entry.manifestPath);
assert.ok(input.startsWith(root+path.sep),'Task snapshot must be inside the project');
assert.equal(hash(manifestFile),entry.manifestSha256,'Source manifest fingerprint changed');
const manifest=read(manifestFile),questFile='raw/spt/database/templates/quests.json';
const sourceFiles=[questFile,'raw/spt/database/locales/global/ch.json','raw/spt/database/locales/global/en.json'];
for(const file of sourceFiles){
  const record=manifest.files.find(record=>record.path===file);
  assert.ok(record,`Missing source fingerprint: ${file}`);
  assert.equal(hash(path.join(input,file)),record.sha256,`Source changed: ${file}`);
}
const quests=read(path.join(input,questFile));
const locales=Object.fromEntries(['ch','en'].map(lang=>[lang,read(path.join(input,`raw/spt/database/locales/global/${lang}.json`))]));
const output=path.join(root,entry.packagePath+'-zh-CN');
const coverage={schemaVersion:1,language:'zh-CN',counts:{},missing:[],sourceTextWithoutHan:[],errors:[]};
const sourceRefs=[];
function text(quest,id,key,field){
  const result=resolveQuestLocale(quest,key,'ch',locales);
  const status=result.text===null?'missing':hasHan(result.text)?'chinese':'source_text_without_han';
  coverage.counts[field]??={chinese:0,source_text_without_han:0,missing:0};coverage.counts[field][status]++;
  let source=null;
  if(result.source){
    const file=result.source==='quest'?questFile:'raw/spt/database/locales/global/ch.json';
    source={file:`${entry.packagePath}/${file}`,pointer:result.source==='quest'?`/${pointerToken(id)}/localization/ch/${pointerToken(key)}`:`/${pointerToken(key)}`};
    sourceRefs.push({source,value:result.text});
  }
  const record={key:key||null,text:result.text,status,source};
  if(status!=='chinese'){
    const report={questId:id,field,...record,english:resolveQuestLocale(quest,key,'en',locales).text};
    (status==='missing'?coverage.missing:coverage.sourceTextWithoutHan).push(report);
  }
  return record;
}
const messageFields=['note','startedMessageText','successMessageText','failMessageText','acceptPlayerMessage','declinePlayerMessage','completePlayerMessage','changeQuestMessageText','whileAvailableMessageText'];
const tasks=Object.entries(quests).map(([id,quest])=>({
  id,raw:{file:`${entry.packagePath}/${questFile}`,pointer:`/${pointerToken(id)}`},
  flags:{isStoryQuest:quest.isStoryQuest,notDisplayedQuest:quest.notDisplayedQuest,secretQuest:quest.secretQuest},
  name:text(quest,id,quest.name,'name'),description:text(quest,id,quest.description,'description'),
  messages:Object.fromEntries(messageFields.filter(field=>typeof quest[field]==='string'&&quest[field].trim()).map(field=>[field,text(quest,id,quest[field],'message')])),
  objectives:(quest.conditions?.AvailableForFinish||[]).map((condition,index)=>({
    id:condition.id,type:condition.conditionType,index:condition.index,
    raw:{file:`${entry.packagePath}/${questFile}`,pointer:`/${pointerToken(id)}/conditions/AvailableForFinish/${index}`},
    ...text(quest,id,condition.id,'objective')
  }))
}));
// Verify every exported string by rereading the raw field referenced in the output.
const documents=new Map(sourceFiles.map(file=>[`${entry.packagePath}/${file}`,read(path.join(input,file))]));
for(const {source,value} of sourceRefs){
  const actual=source.pointer.slice(1).split('/').reduce((node,part)=>node[part.replace(/~1/g,'/').replace(/~0/g,'~')],documents.get(source.file));
  assert.equal(value,actual,`Translation differs from source: ${source.pointer}`);
}
assert.equal(tasks.length,manifest.stats.rawTaskRecords);
assert.equal(tasks.reduce((sum,task)=>sum+task.objectives.length,0),manifest.stats.finishObjectives);
const source={manifestPath:entry.manifestPath,manifestSha256:entry.manifestSha256,sptCommit:entry.sptCommit,eftBuild:entry.eftBuild};
const catalogue={schemaVersion:1,language:'zh-CN',sourceLanguage:'ch',source,
  policy:'逐字使用固定 SPT 快照收录的游戏简体中文：任务内 ch 优先，同版全局 ch 回退。无跨语言替代、社区译文或手工翻译。ch 原值不含汉字者保留并单列复核，不据此断言专名一定未翻译。缺失值保持 null，原始条件与奖励仍以源任务为准。',
  officialSourceLimit:'文本来自 SPT 收录的游戏语言数据，未逐条与当前官服客户端独立验证。',tasks};
coverage.source=source;coverage.taskRecords=tasks.length;coverage.verifiedRawStrings=sourceRefs.length;
coverage.scope='任务名、描述、顶层完成目标及源字段明确引用的消息；空字段不一定是玩家可见内容，不生成主线内部步骤的虚构名称。';
fs.mkdirSync(output,{recursive:true});
function write(name,data){fs.writeFileSync(path.join(output,name),JSON.stringify(data,null,2)+'\n');}
write('tasks.json',catalogue);write('coverage.json',coverage);
const result={schemaVersion:1,language:'zh-CN',status:'prepared_with_source_gaps',source,
  entryPoints:{tasks:'tasks.json',coverage:'coverage.json'},counts:coverage.counts,
  validation:{errors:0,rawStringsCompared:sourceRefs.length,taskIdsPreserved:tasks.length},
  files:['tasks.json','coverage.json'].map(file=>({path:file,bytes:fs.statSync(path.join(output,file)).size,sha256:hash(path.join(output,file))}))};
write('manifest.json',result);
entry.localizations={...entry.localizations,'zh-CN':{packagePath:path.relative(root,output).split(path.sep).join('/'),manifestPath:path.relative(root,path.join(output,'manifest.json')).split(path.sep).join('/'),manifestSha256:hash(path.join(output,'manifest.json')),status:result.status}};
fs.writeFileSync(sourcePath,JSON.stringify(entry,null,2)+'\n');
console.log(JSON.stringify({output,counts:coverage.counts,verifiedRawStrings:sourceRefs.length,validationErrors:0},null,2));
