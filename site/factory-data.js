// Keep Unity world coordinates throughout. Atlas gamedata alone uses (-x,y,z).
export function atlasToUnity(pos) {
  if (!Array.isArray(pos) || pos.length !== 3 || !pos.every(Number.isFinite)) return null;
  return { x: -pos[0], y: pos[1], z: pos[2] };
}

// A deliberately loose envelope, not proof that a point is on a valid surface.
export function coordinateEnvelope(positions, padding = 10) {
  if (!positions.length) return null;
  return Object.fromEntries(['x', 'z'].map(axis => [axis, {
    min: Math.min(...positions.map(p => p[axis])) - padding,
    max: Math.max(...positions.map(p => p[axis])) + padding,
  }]));
}

export function outsideEnvelope(position, envelope) {
  return Boolean(envelope && position && ['x', 'z'].some(axis =>
    position[axis] < envelope[axis].min || position[axis] > envelope[axis].max));
}

export function looseCandidates(spawn) {
  const items = spawn.template?.Items || [];
  const byId = new Map(items.map(it => [it._id, it]));
  const descendants = root => {
    const found = [], pending = [root._id], seen = new Set(pending);
    while (pending.length) {
      const parent = pending.shift();
      for (const it of items) if (it.parentId === parent && !seen.has(it._id)) {
        seen.add(it._id); pending.push(it._id);
        found.push({ tpl: it._tpl, count: it.upd?.StackObjectsCount ?? 1, slot: it.slotId || null });
      }
    }
    return found;
  };
  const distribution = spawn.itemDistribution || [];
  const unresolved = [];
  const candidates = distribution.map(d => {
    const key = String(d.composedKey?.key);
    const root = items.find(it => it.composedKey != null && String(it.composedKey) === key);
    if (!root) { unresolved.push(key); return null; }
    return { tpl: root._tpl, key, weight: d.relativeProbability ?? null,
      count: root.upd?.StackObjectsCount ?? 1, included: descendants(root) };
  }).filter(Boolean);
  if (!distribution.length) {
    // A forced item tree has one root, not a pool made of all its attachments.
    const root = byId.get(spawn.template?.Root) || items.find(it => !it.parentId);
    if (root) candidates.push({ tpl: root._tpl, key: root.composedKey ?? null,
      weight: null, count: root.upd?.StackObjectsCount ?? 1, included: descendants(root) });
  }
  return { candidates, unresolved };
}

export function joinContainers(spt, atlasContainers, statics = {}) {
  const atlasById = new Map();
  for (const row of atlasContainers || []) {
    if (!row.id) continue;
    const values = atlasById.get(row.id) || [];
    values.push(row); atlasById.set(row.id, values);
  }
  return spt.map((row, i) => {
    const t = row.template, tpl = t.Items.find(it => it._id === t.Root)?._tpl || t.Items[0]?._tpl;
    const matches = (atlasById.get(t.Id) || []).filter(a => a.template === tpl);
    const unique = [...new Map(matches.map(a => [JSON.stringify(a.pos), a])).values()];
    const match = unique.length === 1 ? unique[0] : null;
    const rawPosition = t.Position;
    // All-zero SPT container coordinates are placeholders, never plot them as real.
    const nonzero = rawPosition && Object.values(rawPosition).every(Number.isFinite)
      && Object.values(rawPosition).some(v => v !== 0);
    const position = match ? atlasToUnity(match.pos) : (nonzero ? rawPosition : null);
    return { id: `container:${t.Id}`, sourceId: t.Id, kind: 'container', index: i,
      position, rawPosition, positionSource: match ? 'atlas-id-and-template' : nonzero ? 'spt' : 'unresolved',
      joinStatus: match ? 'matched' : unique.length > 1 ? 'ambiguous' : 'unmatched',
      containerTpl: tpl, pool: tpl, sourceWeight: row.probability ?? null,
      alwaysSpawn: Boolean(t.IsAlwaysSpawn), groupId: statics.containers?.[t.Id]?.groupId || null,
      sceneActive: match?.active ?? null, sceneLevel: match?.lv ?? null };
  });
}

export function candidatesFor(point, data) {
  if(point.kind!=='container')return point.candidates||[];
  const pool=data.pools[point.pool]?.items||[];
  return point.forcedItems?.length?[...pool,...point.forcedItems.map(it=>({...it,weight:null,included:[],forced:true}))]:pool;
}

// Resolve the matching templates once per search rather than re-joining names
// for every candidate in thousands of street points and repeated container pools.
export function createPointFilter(data,query,category=''){
  const q=query.trim().toLocaleLowerCase(),matches=new Set();
  if(!q&&!category)return ()=>true;
  for(const [tpl,it] of Object.entries(data.items))if((!category||it.category===category)&&(!q||`${tpl} ${it.zh} ${it.en}`.toLocaleLowerCase().includes(q)))matches.add(tpl);
  const pools=new Map();
  const candidateMatches=c=>(c.weight==null||c.weight>0)&&(matches.has(c.tpl)||c.included?.some(i=>matches.has(i.tpl)));
  return point=>{
    const container=data.items[point.containerTpl];
    if(!category&&q&&`${point.sourceId} ${container?.zh||''} ${container?.en||''}`.toLocaleLowerCase().includes(q))return true;
    if(point.forcedItems?.some(i=>matches.has(i.tpl)))return true;
    if(point.kind==='container'){
      if(!pools.has(point.pool))pools.set(point.pool,(data.pools[point.pool]?.items||[]).some(candidateMatches));
      return pools.get(point.pool);
    }
    return (point.candidates||[]).some(candidateMatches);
  };
}

export function pointMatches(point, data, query, category = '') {
  const q = query.trim().toLocaleLowerCase();
  const itemMatch = tpl => {
    const it = data.items[tpl];
    return it && (!category || it.category === category)
      && (!q || `${tpl} ${it.zh} ${it.en}`.toLocaleLowerCase().includes(q));
  };
  const container = data.items[point.containerTpl];
  if (!category && q && `${point.sourceId} ${container?.zh || ''} ${container?.en || ''}`.toLocaleLowerCase().includes(q)) return true;
  if (!q && !category) return true;
  return candidatesFor(point, data).some(c => (c.weight == null || c.weight > 0)
    && (itemMatch(c.tpl) || c.included?.some(it => itemMatch(it.tpl))))
    || point.forcedItems?.some(it => itemMatch(it.tpl));
}
