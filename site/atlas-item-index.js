const asArray = value => Array.isArray(value) ? value : [];
const text = value => typeof value === 'string' ? value.trim() : '';
const normalized = value => text(value).toLocaleLowerCase().replace(/\s+/gu, ' ');
const hasPosition = point => point?.position
  && ['x', 'y', 'z'].every(axis => Number.isFinite(point.position[axis]));
const compareText = new Intl.Collator('zh-CN', {numeric: true, sensitivity: 'base'}).compare;

function addCandidate(target, candidate) {
  if (!candidate || (candidate.weight != null && !(candidate.weight > 0))) return;
  const tpl = text(candidate.tpl);
  if (tpl) target.add(tpl);
  // Included entries are attached contents, not independent weighted candidates.
  for (const included of asArray(candidate.included)) {
    const includedTpl = text(included?.tpl);
    if (includedTpl) target.add(includedTpl);
  }
}

/** Build once after the map's loot and quest data have been merged. */
export function createItemIndex(data = {}, prepared = null) {
  if (prepared) return restoreItemIndex(data, prepared);
  const pointItems = new WeakMap();
  const poolItems = new Map();
  const occurrences = new Map();
  const seenPoints = new WeakSet();

  const getPool = key => {
    if (!poolItems.has(key)) {
      const ids = new Set();
      for (const candidate of asArray(data?.pools?.[key]?.items)) addCandidate(ids, candidate);
      poolItems.set(key, ids);
    }
    return poolItems.get(key);
  };

  for (const point of asArray(data?.points)) {
    if (!point || typeof point !== 'object' || seenPoints.has(point)
      || !hasPosition(point) || point.outsideClientEnvelope) continue;
    seenPoints.add(point);
    let ids;
    if (point.kind === 'container') {
      const shared = getPool(point.pool);
      const forced = asArray(point.forcedItems);
      ids = forced.length ? new Set(shared) : shared;
      for (const candidate of forced) addCandidate(ids, candidate);
    } else if (point.kind === 'loose') {
      ids = new Set();
      for (const candidate of asArray(point.candidates)) addCandidate(ids, candidate);
    } else if (point.kind === 'poi' && asArray(point.poiTypes).includes('quest_item') && text(point.itemId)) {
      ids = new Set([text(point.itemId)]);
    } else {
      continue;
    }
    pointItems.set(point, ids);
    // Containers sharing a pool also share its set and are counted in one pass.
    occurrences.set(ids, (occurrences.get(ids) || 0) + 1);
  }

  const byId = new Map();
  for (const [ids, count] of occurrences) {
    for (const tpl of ids) {
      let item = byId.get(tpl);
      if (!item) {
        const meta = data?.items?.[tpl];
        item = {tpl, name: text(meta?.zh) || text(meta?.en) || tpl, en: text(meta?.en), count: 0};
        byId.set(tpl, item);
      }
      item.count += count;
    }
  }
  const items = [...byId.values()].sort((a, b) => compareText(a.name, b.name) || a.tpl.localeCompare(b.tpl));
  return finishIndex(data, items, pointItems);
}

function finishIndex(data, items, pointItems) {
  const byId = new Map(items.map(item => [item.tpl, item]));
  const searchable = items.map(item => {
    const fields = [item.name, item.en, item.tpl].map(normalized);
    return {item, fields, haystack: fields.join(' ')};
  });

  return {
    items,
    byId,
    serialize() {
      const sets = [], ids = new Map(), templates = new Map(items.map((item,i) => [item.tpl,i]));
      const points = asArray(data?.points).map(point => {
        const values = pointItems.get(point);
        if (!values) return -1;
        const compact = [...values].map(tpl=>templates.get(tpl)).sort((a,b)=>a-b), key=compact.join(',');
        if (!ids.has(key)) { ids.set(key, sets.length); sets.push(compact); }
        return ids.get(key);
      });
      return {version: 2, items, sets, points};
    },
    search(query, {limit = 30} = {}) {
      const q = normalized(query);
      if (!q) return {items: [], total: 0};
      const tokens = q.split(' ');
      const found = [];
      for (const entry of searchable) {
        if (!tokens.every(token => entry.haystack.includes(token))) continue;
        const rank = entry.fields.some(field => field === q) ? 0
          : entry.fields.some(field => field.startsWith(q)) ? 1 : 2;
        found.push({item: entry.item, rank});
      }
      // Equal relevance retains the index's deterministic name/template order.
      found.sort((a, b) => a.rank - b.rank);
      const size = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 30;
      return {items: found.slice(0, size).map(entry => entry.item), total: found.length};
    },
    matches(point, ids) {
      const available = pointItems.get(point);
      if (!available?.size || !ids || typeof ids[Symbol.iterator] !== 'function') return false;
      for (const tpl of ids) if (available.has(tpl)) return true;
      return false;
    },
  };
}

function restoreItemIndex(data, prepared) {
  if (prepared.version !== 2 || !Array.isArray(prepared.items) || !Array.isArray(prepared.sets)
      || prepared.points?.length !== data.points?.length) throw new Error('物品索引版本不符');
  const sets = prepared.sets.map(values => {
    if (!Array.isArray(values) || values.some(value => !Number.isInteger(value) || value<0 || value>=prepared.items.length)) throw new Error('物品索引损坏');
    return new Set(values.map(i=>prepared.items[i].tpl));
  });
  const pointItems = new WeakMap();
  prepared.points.forEach((id, i) => {
    if (!Number.isInteger(id) || id < -1 || id >= sets.length) throw new Error('物品索引点位不符');
    if (id >= 0) pointItems.set(data.points[i], sets[id]);
  });
  return finishIndex(data, prepared.items, pointItems);
}
