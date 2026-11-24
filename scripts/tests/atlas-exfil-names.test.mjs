import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createExfilLocalizer} from '../lib/atlas-exfil-names.mjs';
import {buildAtlasPois} from '../lib/atlas-pois.mjs';
import {ATLAS_MAPS} from '../../site/atlas-maps.js';
import {SPT_DB} from '../lib/spt-source.mjs';
import {pointSettingKey} from '../../site/factory-icon-settings.js';
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));

test('exfil locale IDs take priority; whitespace/case aliases and unique English fallbacks preserve names',()=>{
  const locales={en:{a:'Sewer Manhole',b:'Sewer Manhole',' V-ex_light':'Road to Military Base V-Ex',heli:'Helicopter',old:'Smugglers Tunnel',c:'Crossroads',d:'Crossroads',number:'ZB-014'},ch:{a:'下水道检修孔',b:'下水道',' V-ex_light':'通往军事基地的载具撤离点',heli:'直升机',old:'走私者隧道',c:'Crossroads',d:'十字路口',number:'ZB-014'}};
  const translate=createExfilLocalizer(locales);
  assert.equal(translate({name:'a',display_name_en:'Sewer Manhole'}).label,'下水道检修孔');
  assert.equal(translate({name:'b',display_name_en:'Sewer Manhole'}).label,'下水道');
  assert.equal(translate({name:'V-Ex_light'}).label,'通往军事基地的载具撤离点');
  assert.equal(translate({name:'Heli'}).label,'直升机');
  assert.equal(translate({name:'renamed',display_name_en:'Smugglers Tunnel'}).label,'走私者隧道');
  assert.equal(translate({name:'c'}).label,'十字路口');
  assert.equal(translate({name:'number'}).label,'ZB-014');
  assert.equal(translate({name:'unmatched',display_name_en:'Sewer Manhole'}).label,'Sewer Manhole','ambiguous translations must not be guessed');
  const atlas={exfils:[{name:'a',pos:[1,2,3],faction:'pmc'}]};
  const before=buildAtlasPois(atlas,{}).points[0],after=buildAtlasPois(atlas,{},locales).points[0];
  assert.equal(after.id,before.id);assert.deepEqual(after.position,before.position);assert.equal(pointSettingKey(after),pointSettingKey(before));
  assert.match(after.searchText,/Sewer Manhole/);assert.match(after.searchText,/下水道检修孔/);
});

test('every exported extraction has a game Chinese label or its original numbered exit code',()=>{
  const chinese=read(path.join(SPT_DB,'locales/global/ch.json'));let count=0;
  for(const map of Object.values(ATLAS_MAPS)){
    const pois=read(new URL(`../../site/data/${map.id}-pois.json`,import.meta.url));
    for(const p of pois.points.filter(p=>p.poiTypes.some(t=>t.startsWith('extract_')))){
      count++;assert.ok(/[\u3400-\u9fff]/u.test(p.label)||/^(?:ZB-\d+|D-\d+)$/i.test(p.label),`${map.id}: ${p.label}`);
      assert.ok(p.originalLabel);assert.equal(chinese[p.localeKey],p.label);
      assert.ok(p.searchText.includes(p.originalLabel));assert.ok(p.searchText.includes(p.label));
    }
  }
  assert.ok(count>100);
});
