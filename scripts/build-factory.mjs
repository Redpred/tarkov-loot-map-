import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { looseCandidates, joinContainers, atlasToUnity, coordinateEnvelope, outsideEnvelope } from './lib/factory-data.mjs';
import { handbookLootFamily } from '../site/atlas-loot-category-policy.js';
import { ATLAS_MAPS } from '../site/atlas-maps.js';
import {SPT_DB,SPT_SOURCE,SPT_LABEL,hasMapLoot} from './lib/spt-source.mjs';

const root = path.resolve(import.meta.dirname, '..');
const db = SPT_DB;
const mapArg=process.argv.indexOf('--map');
const map=ATLAS_MAPS[mapArg>=0?process.argv[mapArg+1]:'factory'];
if(!map)throw new Error('Unknown Atlas map');
const loc = map.spt?path.join(db, 'locations',map.spt):null;
const read = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const hasSptLoot=hasMapLoot(map);
const loose = hasSptLoot?read(path.join(loc, 'looseLoot.json')):{spawnpoints:[],spawnpointsForced:[]};
const containers = hasSptLoot?read(path.join(loc, 'staticContainers.json')):{staticContainers:[],staticForced:[]};
const staticLoot = hasSptLoot?read(path.join(loc, 'staticLoot.json')):{};
const statics = hasSptLoot?read(path.join(loc, 'statics.json')):{};
const templates = read(path.join(db, 'templates/items.json'));
const ch = read(path.join(db, 'locales/global/ch.json'));
const en = read(path.join(db, 'locales/global/en.json'));
const handbook = read(path.join(db, 'templates/handbook.json'));
const atlasPath = path.join(root, `work/tarkmap/out/${map.atlas}/gamedata.json`);
const atlas = fs.existsSync(atlasPath) ? read(atlasPath) : { containers: [] };
const metaPath = path.join(root, `data/atlas/${map.id}-source.json`);
const meta = fs.existsSync(metaPath) ? read(metaPath) : {};
const categoryNames = {'5b47574386f77428ca22b33f':'装备与容器','5b47574386f77428ca22b342':'钥匙','5b47574386f77428ca22b346':'弹药','5b47574386f77428ca22b345':'工具','6564b96a189fe36f356d177c':'护甲','5b619f1a86f77450a702a6f3':'贵重品','5b5f71a686f77447ed5636ab':'武器配件','5b47574386f77428ca22b341':'情报','5b47574386f77428ca22b340':'食品饮料','5b47574386f77428ca22b343':'地图','5b5f78b786f77447ed5636af':'货币','5b5f78dc86f77409407a7f8e':'武器','5b47574386f77428ca22b33e':'电子与材料','5b47574386f77428ca22b344':'医疗'};
const categories = new Map(handbook.Categories.map(c => [c.Id, c]));
const itemCategories = new Map(handbook.Items.map(it => [it.Id, it.ParentId]));
const categoryOf = tpl => {
  let id = itemCategories.get(tpl); const seen = new Set();
  while (categories.get(id)?.ParentId && !seen.has(id)) { seen.add(id); id = categories.get(id).ParentId; }
  return categoryNames[id] || '其他';
};
const items = {}, issues = [];
const addItem = tpl => {
  if (!tpl || items[tpl]) return;
  items[tpl] = { tpl, zh: ch[`${tpl} Name`] || en[`${tpl} Name`] || templates[tpl]?._name || tpl,
    en: en[`${tpl} Name`] || templates[tpl]?._name || tpl, category: categoryOf(tpl), markerFamily:handbookLootFamily(tpl,templates,categories,itemCategories) };
};
const points = [];
for (const [list, forced] of [[loose.spawnpointsForced, true], [loose.spawnpoints, false]]) {
  for (const [i, sp] of list.entries()) {
    const { candidates, unresolved } = looseCandidates(sp);
    if (unresolved.length) issues.push({ sourceId: sp.template.Id, unresolved });
    for (const it of candidates) { addItem(it.tpl); it.included.forEach(c => addItem(c.tpl)); }
    points.push({ id: `${forced ? 'forced' : 'loose'}:${i}:${sp.template.Id}`,
      sourceId: sp.template.Id, locationId: sp.locationId, kind: 'loose', position: sp.template.Position,
      positionSource: `spt-${SPT_SOURCE.eftBuild}`, coordinateValidation: `not-individually-verified-in-${meta.eftBuild}`,
      sourceWeight: sp.probability ?? null, forced, alwaysSpawn: Boolean(sp.template.IsAlwaysSpawn),
      groupPositions: sp.template.GroupPositions || [], candidates });
  }
}
const pools = {};
for (const [tpl, pool] of Object.entries(staticLoot)) {
  addItem(tpl);
  pools[tpl] = { countDistribution: pool.itemcountDistribution,
    items: pool.itemDistribution.map(it => { addItem(it.tpl); return { tpl: it.tpl, weight: it.relativeProbability, included: [] }; }) };
}
const joined = joinContainers(containers.staticContainers, atlas.containers, statics);
for (const p of joined) {
  p.forcedItems = containers.staticForced.filter(x => x.containerId === p.sourceId).map(x => ({ tpl: x.itemTpl }));
  p.forcedItems.forEach(it => addItem(it.tpl));
  points.push(p);
}
// Current-client-only containers have a real position, but no invented SPT pool.
const known = new Set(joined.map(p => `${p.sourceId}:${p.containerTpl}`));
// A reused ID with a different current-client template is a different pool.
// Keep the SPT mismatch unresolved and show the real container with an unknown pool.
const clientOnly = [...new Map((atlas.containers || []).filter(p => p.id && !known.has(`${p.id}:${p.template}`)&&p.active!==false&&atlasToUnity(p.pos)).map(p=>[`${p.id}:${p.pos.join(',')}`,p])).values()];
for (const row of clientOnly) {
  addItem(row.template);
  points.push({ id: `client-only:${row.id}:${row.pos.join(',')}`, sourceId: row.id, kind: 'container',
    position: atlasToUnity(row.pos), positionSource: 'atlas-client-only', joinStatus: 'client-only',
    containerTpl: row.template, pool: null, sourceWeight: null, sceneActive: row.active,
    sceneLevel: row.lv, forcedItems: [] });
}
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const levelBorder = (atlas.level_border || []).map(atlasToUnity).filter(Boolean);
const clientPositions = points.filter(p => p.kind === 'container' && p.positionSource.startsWith('atlas')).map(p => p.position);
const envelope = coordinateEnvelope([...levelBorder, ...clientPositions]);
for (const p of points.filter(p => p.kind === 'loose')) {
  p.outsideClientEnvelope = outsideEnvelope(p.position, envelope);
  if (p.outsideClientEnvelope) p.coordinateValidation = 'outside-client-envelope';
}
const provenanceFiles = ['looseLoot.json','staticContainers.json','staticLoot.json','statics.json'];
const out = {
  schemaVersion: 1, map: map.spt||map.id, name: map.name, generatedAt: new Date().toISOString(),
  sources: { spt: hasSptLoot?{ ...SPT_SOURCE,
    files: Object.fromEntries(provenanceFiles.map(f => [f, hash(path.join(loc, f))])) }:null,
    atlas: { ...meta, gameDataSha256: fs.existsSync(atlasPath) ? hash(atlasPath) : null },
    versionMatch: hasSptLoot&&meta.eftBuild === SPT_SOURCE.eftBuild, clientOnly:!hasSptLoot,
    note: hasSptLoot?`${SPT_LABEL} 物品池；${meta.eftBuild===SPT_SOURCE.eftBuild?'适配客户端版本一致':'客户端版本存在差异'}，散落坐标未逐点核验；权重不是每局出货率。`:'未载入适配此图的 SPT 物资；仅显示当前客户端容器，物品池未知。' },
  stats: { loose: points.filter(p => p.kind === 'loose').length, forced: loose.spawnpointsForced.length,
    containers: joined.length, matchedContainers: joined.filter(p => p.joinStatus === 'matched').length,
    unlocatedContainers: joined.filter(p => !p.position).length, clientOnlyContainers: clientOnly.length,
    unresolvedCandidates: issues.length, itemTemplates: Object.keys(items).length },
  coordinateAudit: { envelope, paddingMetres: 10, levelBorder,
    outsideLoose: points.filter(p => p.outsideClientEnvelope).length,
    method: 'Client level-border and container X/Z envelope, padded 10 m; an outlier check only, not surface validation.' },
  heightBands: map.heightBands,
  floorNote: '按世界高度分段，尚未做逐房间的语义楼层核验。',
  spawnpointCount: loose.spawnpointCount, containerGroups: statics.containersGroups,
  points, pools, items, clientOnlyContainers: clientOnly, issues,
};
const output = path.join(root, `site/data/${map.id}-atlas.json`);
fs.writeFileSync(output, JSON.stringify(out));
fs.mkdirSync(path.join(root, 'site/vendor'), {recursive:true});
for (const f of ['three.module.js','three.core.js']) fs.copyFileSync(path.join(root,'node_modules/three/build',f),path.join(root,'site/vendor',f));
fs.copyFileSync(path.join(root,'node_modules/three/examples/jsm/controls/OrbitControls.js'),path.join(root,'site/vendor/OrbitControls.js'));
fs.copyFileSync(path.join(root,'node_modules/three/LICENSE'),path.join(root,'site/vendor/three-LICENSE.txt'));
fs.copyFileSync(path.join(root,'scripts/lib/factory-data.mjs'),path.join(root,'site/factory-data.js'));
console.log(JSON.stringify(out.stats, null, 2));
