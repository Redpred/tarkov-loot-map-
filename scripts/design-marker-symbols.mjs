// Filled, transparent vector artwork for loot categories and world containers.
// Object materials define the palette; light outer edges and dark inner edges
// keep the same symbols readable on both map skins at the default 26 px size.
import fs from 'node:fs/promises';
import path from 'node:path';
import {FAMILIES,CONTAINERS,LEGACY_LOOT_FAMILIES} from '../site/factory-marker-rules.js';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'icon/symbols');
await fs.mkdir(out,{recursive:true});
const ink='#182a32',halo='#fff4de',metal='#b8c7cd',cream='#fff3d5';
const p=(d,fill='none',attrs='')=>`<path d="${d}" fill="${fill}" ${attrs}/>`;
const r=(x,y,w,h,fill,rx=0)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}"/>`;
const c=(x,y,radius,fill)=>`<circle cx="${x}" cy="${y}" r="${radius}" fill="${fill}"/>`;
const e=(x,y,rx,ry,fill)=>`<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}"/>`;
const line=(d,color=ink,width=4)=>p(d,'none',`stroke="${color}" stroke-width="${width}"`);
const cross=(x,y,size,color=cream)=>p(`M${x+size/3} ${y}h${size/3}v${size/3}h${size/3}v${size/3}h-${size/3}v${size/3}h-${size/3}v-${size/3}h-${size/3}v-${size/3}h${size/3}z`,color,'stroke="none"');
const medical=line('M34 27v-9h28v9',metal,7)+r(18,27,60,51,'#d95458',5)+r(23,32,50,10,'#f08378',2)+cross(33,43,30);
const paper=(fill='#f0dfb8',fold='#c9b68c')=>p('M25 14h38l12 13v55H25z',fill)+p('M63 14v15h12',fold)+line('M36 40h28M36 51h28M36 62h21','#527e94',3.5);
const shapes={
  battery:r(28,18,12,13,'#e7c267',2)+r(57,18,12,13,'#e7c267',2)+r(15,27,66,49,'#579960',5)+r(21,32,54,11,'#89c47e',2)+line('M28 54h15M35 47v14M58 54h13',cream,4.5),
  fuel:p('M51 12c10 23-7 27-1 41 6-5 9-11 11-19 18 16 21 31 13 43-10 15-40 14-51-1-11-15-5-31 7-44-1 14 2 21 9 25-7-20 13-25 12-45z','#f58c38')+p('M47 48c3 14 15 19 12 28-3 10-21 10-25 0-4-10 8-17 13-28z','#ffdb69','stroke="none"'),
  materials:r(14,27,68,49,'#c97951',1)+p('M16 29h18v12H16zM52 45h19v13H52zM38 62h21v12H38z','#e9a279','stroke="none"')+line('M14 43h68M14 60h68M36 27v16M61 27v16M25 43v17M50 43v17M73 43v17M36 60v16M61 60v16','#f6d2a4',3),
  electronics:line('M36 15v12M48 15v12M60 15v12M36 69v12M48 69v12M60 69v12M15 36h12M15 48h12M15 60h12M69 36h12M69 48h12M69 60h12','#e6c36f',6)+r(27,27,42,42,'#3b9e89',4)+r(37,37,22,22,'#245b62',2)+line('M44 44h8v8h-8z','#a8e5bf',3),
  household:p('M34 30h28l9 16v36H25V46z','#5caed0')+r(39,18,18,12,metal,2)+line('M39 16h29M65 16v9',metal,6)+r(35,51,26,20,cream,3)+p('M48 55c-3 5-7 8-7 11 0 8 14 8 14 0 0-3-4-6-7-11z','#349eb8','stroke="none"'),
  medical,
  stim:p('m26 68 37-37 12 12-37 37z','#bfe6e8')+p('m29 65 18-18 12 12-18 18z','#42b1b6','stroke="none"')+line('M22 72l-8 8',metal,4)+line('M57 25l18 18M68 28l8-8','#a994d4',7)+line('M70 12l14 14','#c8b9e5',7)+line('M45 49l6 6M36 58l6 6',ink,3),
  key:p('M33 12a19 19 0 1 1 0 38 19 19 0 0 1 0-38zM33 23a8 8 0 1 0 0 16 8 8 0 0 0 0-16z','#eac45f','fill-rule="evenodd"')+p('m45 43 7-7 30 30-8 8-8-8-6 6 8 8-8 8z','#eac45f')+line('M57 52l17 17','#fff0ae',3),
  keycard:r(12,23,72,50,'#9b84d3',5)+r(14,33,68,10,'#53476f')+r(59,51,14,12,'#efca6d',2)+line('M24 53h19M24 62h11',cream,3.5),
  tools:p('M66 13a20 20 0 0 0-24 24L14 65a10 10 0 0 0 15 15l28-28a20 20 0 0 0 25-24L68 40 56 28z',metal)+p('m18 63 18-18 11 11-18 18a8 8 0 0 1-11-11z','#e5a65c','stroke="none"')+c(23,71,2,ink),
  // Preserve the user's diamond silhouette instead of a material/item picture.
  valuable:p('M14 31 27 15h42l13 16-34 49z','#53bddc')+p('M14 31h22L27 15zM36 31l12-16 12 16z','#c7f2f7','stroke="none"')+p('M60 31h22L48 80z','#258ab7','stroke="none"')+p('M14 31h22l12 49z','#6dd7e7','stroke="none"')+line('M14 31h68M27 15l9 16 12 49 12-49 9-16M36 31l12-16 12 16','#287292',2.8),
  weapon:p('M12 40h52v13H38l-5 23H22l5-23H12z','#83939c')+p('M22 54h14l-3 22H22z','#bd9165')+p('m42 53 10 17h10L51 53z','#526976')+r(17,29,18,11,'#526976',1)+line('M64 44h20M78 38v12',metal,6)+line('M15 36h20M40 45h15','#d5dedb',3),
  equipment:p('m32 16-19 13 10 20 10-5v38h30V44l10 5 10-20-19-13c-7 12-25 12-32 0z','#7f9969')+p('M34 27h7v52h-7zM55 27h7v52h-7z','#c8b580','stroke="none"')+r(39,46,18,24,'#55725d',3)+line('M43 53h10','#c2d5a5',3),
  ammo:p('M22 77V31l9-18 9 18v46z','#deb454')+p('M22 31l9-18 9 18z','#bd7850')+p('M51 77V31l9-18 9 18v46z','#e6c36a')+p('M51 31l9-18 9 18z','#c88555')+line('M22 64h18M51 64h18','#9b713e',3.5)+line('M20 82h22M49 82h22','#d2b478',4.5),
  provisions:p('M16 18h6v15h5V18h6v15h5V18h6v24c0 9-8 13-10 13v25h-8V55c-8-1-10-6-10-13z',cream)+p('M68 20C58 40 49 50 49 63a19 19 0 0 0 38 0c0-13-9-23-19-43z','#57afd3')+line('M58 62c0 8 4 12 10 13','#d3f0ef',3.5),
  intel:paper(),
  money:r(10,25,76,46,'#83ad70',3)+r(17,32,62,32,'#b8cc8e',2)+c(48,48,14,'#edcc78')+line('M18 35h9M18 61h9M69 35h9M69 61h9','#538360',3)+line('M48 39v18','#a27e42',4),
  season_document:p('M22 13h39l14 14v55H22z','#c4afe4')+p('M61 13v16h14','#8c72b2')+line('M32 40h28M32 51h18','#594d7b',3.5)+p('m57 56 5 9 10 2-7 7 1 10-9-5-9 5 2-10-7-7 10-2z','#f5d078'),
  other:p('m14 29 34-15 34 15v41L48 85 14 70z','#a9b8b9')+p('m14 29 34 15 34-15-34-15z','#d4ded8')+p('M48 44v41l34-15V29z','#7c9399')+line('M32 22l34 15','#e4ece4',3),
  mixed:r(15,16,25,25,'#de7970',3)+r(56,16,25,25,'#6fb9ce',3)+r(15,56,25,25,'#e8c76a',3)+r(56,56,25,25,'#85af79',3),
};
const chest=({body,lid,band,emblem=''})=>r(13,28,70,51,body,4)+p('M13 32q0-4 4-4h62q4 0 4 4v13H13z',lid)+r(23,29,8,49,band,1)+r(65,29,8,49,band,1)+(emblem||r(40,40,16,13,'#dfc98e',2));
const cases={
  crate:r(15,23,66,59,'#be925c',1)+r(17,25,62,11,'#e0b979')+r(17,68,62,12,'#e0b979')+line('M17 35h62M17 68h62M26 37l44 29M26 66l44-29','#795b3e',5),
  'technical-crate':chest({body:'#5092aa',lid:'#87b6c3',band:metal,emblem:p('m51 43-13 16h10l-4 12 16-18H49l2-10z','#f1d073')}),
  safe:r(19,12,58,72,'#607888',4)+r(27,20,42,56,'#98adba',2)+c(48,48,12,'#d5c18d')+line('M48 38v20M38 48h20','#6d6b60',3.5)+line('M22 28h7M22 67h7',metal,5),
  duffle:line('M35 33V19h26v14','#c6bc8b',7)+p('M27 33h42l15 16v29H12V49z','#739068')+r(25,34,8,43,'#d1bf8c')+r(63,34,8,43,'#d1bf8c')+line('M34 49h28','#385d4b',4.5),
  jacket:p('m33 13 15 9 15-9 17 21-10 35-10-5v20H36V64l-10 5-10-35z','#c9a35d')+p('m33 13 3 24 12-15 12 15 3-24-15 9z','#e9ce8c')+line('M48 25v57','#705c3c',3.5)+r(29,43,10,15,'#9f7e46',2)+r(57,43,10,15,'#9f7e46',2),
  medbag:line('M35 33V20h26v13',cream,7)+p('M26 33h44l12 16v31H14V49z','#ca5359')+p('M20 45h56v12H20z','#ec7d78','stroke="none"')+line('M25 35v43M71 35v43','#f7d5b8',4.5)+cross(35,51,27),
  'grenade-box':chest({body:'#5d7d56',lid:'#8ba370',band:'#3f5848',emblem:p('M43 48h12l5 9v13l-6 5H43l-6-5V57z','#e7b766')+line('M45 48v-6h9v6',cream,3)}),
  toolbox:line('M35 36V21h26v15',metal,7)+r(13,36,70,44,'#de803c',3)+r(15,38,66,13,'#f1ae62',1)+r(42,45,12,15,metal,1)+line('M20 71h56','#a65432',3),
  drawer:r(23,12,50,72,'#8097a3',2)+r(27,16,42,18,'#b8c7cb',1)+r(27,39,42,18,'#a5b9c0',1)+r(27,63,42,17,'#b8c7cb',1)+line('M41 25h14M41 48h14M41 72h14','#445b65',4),
  'weapon-box':chest({body:'#65766b',lid:'#96a48b',band:'#c2ad77',emblem:p('M37 51h22v7H47l-3 13h-7l4-13h-4z',metal)}),
  body:c(48,23,11,'#d8b184')+p('M32 41h32l12 23-9 5-12-17v16l10 16H51L48 72l-3 12H31l10-16V52L29 69l-9-5z','#8c9b6c')+p('M41 60h14v8l10 16H51L48 72l-3 12H31l10-16z','#646e52')+line('M42 44h12M48 44v14','#dbc99a',3),
  'map-container_cash-register':p('M18 44h60l7 35H11z','#87999c')+r(26,17,44,27,'#57717b',2)+r(33,23,30,13,'#81caa0',1)+p('M22 52h51l3 12H19z',cream)+line('M29 56h36M31 61h36M25 70h46','#657b80',3)+line('M32 76h28','#dec587',3),
  'map-container_crate':chest({body:'#75a09a',lid:'#a8c0ad',band:'#d6d5b1'}),
  'map-container_wooden-ammo-box':chest({body:'#c09858',lid:'#dfbc7b',band:'#806747',emblem:p('M39 71V52l5-9 5 9v19zM53 71V52l5-9 5 9v19z','#f0d178')}),
  'map-container_buried-barrel-cache':p('M22 22v52c0 14 52 14 52 0V22z','#ab784c')+e(48,22,26,10,'#cfab76')+p('M23 38h50v9H23zM23 60h50v9H23z','#71877d')+line('M13 85h70','#c7a174',6),
  'map-container_pc-block':r(25,12,46,72,'#5a7381',3)+r(31,18,34,60,'#8aa7b4',2)+line('M36 26h24M36 35h24M36 44h24','#405b69',3.5)+c(48,60,6,'#83c994')+line('M35 73h26','#c3d5d3',3),
  'map-container_medcase':line('M34 27v-9h28v9',metal,7)+r(18,27,60,51,'#f2e6cd',4)+r(20,29,56,11,'#dd7270',1)+cross(33,43,30,'#c94b54')+line('M26 69h11M59 69h11',metal,3),
  'map-container_plastic-suitcase':line('M35 28V16h26v12',metal,7)+r(18,28,60,51,'#6896c3',7)+line('M30 40v27M48 40v27M66 40v27','#b4d4e6',4)+line('M26 79v6M70 79v6','#6c7b85',5),
};
const keys=new Set([...Object.keys(FAMILIES),'mixed',...Object.values(CONTAINERS).map(([key])=>key),'crate',...Object.keys(LEGACY_LOOT_FAMILIES)]);
for(const key of keys){
  const target=LEGACY_LOOT_FAMILIES[key]||key,art=shapes[target]||cases[target];
  if(!art)throw new Error('Missing SVG design: '+key);
  // Open linework is never filled automatically; no opaque background tile.
  const edge=art.replace(/\s(?:fill|stroke|stroke-width)="[^"]*"/g,'');
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none" stroke-linecap="round" stroke-linejoin="round"><g fill="none" stroke="${halo}" stroke-width="7.5">${edge}</g><g stroke="${ink}" stroke-width="4">${art}</g></svg>\n`;
  await fs.writeFile(path.join(out,key+'.svg'),svg);
}
console.log(JSON.stringify({designed:keys.size,active:Object.keys(FAMILIES).length+1+new Set(Object.values(CONTAINERS).map(([key])=>key)).size,directory:'icon/symbols',style:'filled material colors, transparent background, two-tone edges'}));
