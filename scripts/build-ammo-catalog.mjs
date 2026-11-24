import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {SPT_DB,SPT_SOURCE} from './lib/spt-source.mjs';
const root=path.resolve(import.meta.dirname,'..');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const files=['templates/items.json','locales/global/ch.json','locales/global/en.json'];
const [templates,ch,en]=files.map(file=>read(path.join(SPT_DB,file)));
const labels={Caliber762x51:'7.62×51 mm',Caliber545x39:'5.45×39 mm',Caliber127x55:'12.7×55 mm',Caliber40x46:'40×46 mm',Caliber26x75:'26×75 mm',Caliber30x29:'30×29 mm',Caliber12g:'12 号',Caliber23x75:'23×75 mm',Caliber9x21:'9×21 mm',Caliber9x18PM:'9×18 mm PM',Caliber9x39:'9×39 mm',Caliber762x54R:'7.62×54R mm',Caliber762x35:'.300 Blackout',Caliber40mmRU:'40 mm VOG',Caliber366TKM:'.366 TKM',Caliber1143x23ACP:'.45 ACP',Caliber127x108:'12.7×108 mm',Caliber46x30:'4.6×30 mm',Caliber556x45NATO:'5.56×45 mm',Caliber762x25TT:'7.62×25 mm TT',Caliber9x33R:'.357 Magnum',Caliber57x28:'5.7×28 mm',Caliber9x19PARA:'9×19 mm',Caliber86x70:'.338 Lapua Magnum',Caliber20g:'20 号',Caliber762x39:'7.62×39 mm',Caliber68x51:'6.8×51 mm',Caliber127x33:'.50 AE',Caliber127x99:'.50 BMG',Caliber20x1mm:'20×1 mm',Caliber93x64:'9.3×64 mm',Caliber784x49:'.308 Marlin Express',Caliber58x42:'5.8×42 mm'};
const rounds=Object.values(templates).filter(t=>t._parent==='5485a8684bdc2da71d8b4567'&&t._props?.Caliber);
const byId=new Map(rounds.map(t=>[t._id,{tpl:t._id,name:ch[`${t._id} Name`]||en[`${t._id} Name`]||t._name,en:en[`${t._id} Name`]||'',caliber:t._props.Caliber,caliberName:labels[t._props.Caliber]||t._props.Caliber,ammoType:t._props.ammoType,searchIds:[t._id]}]));
// An ammo box belongs to a round only when its actual cartridge slot names it.
for(const t of Object.values(templates))if(t._parent==='543be5cb4bdc2deb348b4568')for(const slot of t._props?.StackSlots||[])for(const f of slot._props?.filters||[])for(const id of f.Filter||[])if(byId.has(id))byId.get(id).searchIds.push(t._id);
const catalog={schemaVersion:1,source:SPT_SOURCE,inputs:files.map(file=>({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(SPT_DB,file))).digest('hex')})),items:[...byId.values()]};
fs.writeFileSync(path.join(root,'site/data/ammo-catalog.json'),JSON.stringify(catalog));
console.log(JSON.stringify({rounds:catalog.items.length,calibers:new Set(catalog.items.map(i=>i.caliber)).size,boxes:new Set(catalog.items.flatMap(i=>i.searchIds.slice(1))).size,source:SPT_SOURCE.commit}));
