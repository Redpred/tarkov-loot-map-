import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {objectivePreparation} from '../site/task-preparation.js';

const root=path.resolve(import.meta.dirname,'..');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const source=read('data/task-source.json'),catalogue=read('site/data/tasks/catalog.json');
if(source.sptCommit!==catalogue.source.sptCommit)throw new Error('任务来源版本不一致');
const inputs=[`${source.packagePath}/raw/spt/database/templates/items.json`,`${source.packagePath}/raw/spt/database/locales/global/ch.json`,`${source.packagePath}/raw/spt/database/locales/global/en.json`];
const hash=file=>createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
if(hash(source.manifestPath)!==source.manifestSha256)throw new Error('任务来源清单指纹不一致');
const manifest=read(source.manifestPath);
for(const file of inputs){const expected=manifest.files.find(entry=>`${source.packagePath}/${entry.path}`===file);if(!expected||hash(file)!==expected.sha256)throw new Error('任务输入指纹不一致：'+file);}
const [templates,ch,en]=inputs.map(read),items={};
const wanted=new Set(catalogue.tasks.flatMap(t=>t.objectives.flatMap(o=>objectivePreparation(o).flatMap(r=>r.options.flat()))));
for(const id of [...wanted].sort()){
  const icon=`data/icons/items/${id}.webp`;
  items[id]={name:ch[`${id} Name`]||en[`${id} Name`]||catalogue.items[id]?.name||'物品名称待补齐',en:en[`${id} Name`]||'',
    questItem:Boolean(templates[id]?._props?.QuestItem),icon:catalogue.items[id]?.icon||(fs.existsSync(path.join(root,'site',icon))?icon:null)};
}
const outIndex=process.argv.indexOf('--out');
const output=outIndex<0?'site/data/tasks/preparation-items.json':process.argv[outIndex+1];
if(!output||!path.resolve(root,output).startsWith(root+path.sep))throw new Error('输出必须位于本项目内');
if(fs.existsSync(path.join(root,output)))throw new Error('请先备份现有准备物品目录，再移至独立暂存目录生成');
fs.mkdirSync(path.dirname(path.join(root,output)),{recursive:true});
fs.writeFileSync(path.join(root,output),JSON.stringify({schemaVersion:1,source:{sptCommit:source.sptCommit,eftBuild:source.eftBuild,supplements:catalogue.source.supplements||[],inputs:[...inputs,'site/data/tasks/catalog.json'].map(file=>({file,sha256:createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')}))},items}));
console.log(JSON.stringify({output,items:wanted.size,missingNames:Object.values(items).filter(i=>i.name==='物品名称待补齐').length,missingIcons:Object.values(items).filter(i=>!i.icon).length}));
