import {gzip} from 'node:zlib';
import {promisify} from 'node:util';
const zip = promisify(gzip);

export function acceptsGzip(value = '') {
  const encodings = String(value).split(',').map(part => {
    const [name, ...params] = part.trim().toLowerCase().split(';');
    const q = params.find(p => p.trim().startsWith('q='));
    return [name, q ? Number(q.trim().slice(2)) : 1];
  });
  return (encodings.find(([name]) => name === 'gzip') || encodings.find(([name]) => name === '*') || ['', 0])[1] > 0;
}
export function matchesEtag(value, etag) {
  return String(value || '').split(',').some(tag => tag.trim() === '*' || tag.trim().replace(/^W\//, '') === etag.replace(/^W\//, ''));
}

// Bound resident response bytes and coalesce simultaneous requests. Gzip runs
// off the event loop; only four uncached bodies are built at once.
export function createResponseCache(maxBytes = 64 * 2 ** 20) {
  const entries = new Map(), pending = new Map(), queue = [];
  let bytes = 0, active = 0;
  async function slot(fn) {
    if (active >= 4) await new Promise(resolve => queue.push(resolve));
    else active++;
    try { return await fn(); }
    finally { if (queue.length) queue.shift()(); else active--; }
  }
  return async function body(key, build, compressed) {
    key += compressed ? ':gzip' : ':identity';
    if (entries.has(key)) { const value = entries.get(key); entries.delete(key); entries.set(key, value); return value; }
    if (pending.has(key)) return pending.get(key);
    const promise = slot(async () => {
      const source = await build();
      const result = compressed ? await zip(source, {level: 4}) : source;
      if (result.length <= maxBytes) {
        while (bytes + result.length > maxBytes && entries.size) {
          const oldest = entries.keys().next().value; bytes -= entries.get(oldest).length; entries.delete(oldest);
        }
        entries.set(key, result); bytes += result.length;
      }
      return result;
    }).finally(() => pending.delete(key));
    pending.set(key, promise); return promise;
  };
}
