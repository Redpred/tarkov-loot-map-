import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {ATLAS_MAPS} from '../site/atlas-maps.js';
import {mapLoadError,validDiagnosticCode} from '../site/atlas-map-diagnostics.js';
import {readMapCachePlan} from '../scripts/lib/map-cache-plan.mjs';
import {createMarketPriceService, MARKET_MODES} from '../scripts/lib/market-prices.mjs';
import {appUrl, resourcePath, validQuality, RESOURCE_ORIGIN} from './policy.mjs';
import {createReleaseResources} from './release-resources.mjs';
import {createClientResourceStore} from './local-resources.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const mime = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.txt': 'text/plain; charset=utf-8'};
export const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; font-src 'self'; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";
function pagePolicy(bytes) {
  const hashes = [...bytes.toString('utf8').matchAll(/<script\s+type="importmap">([\s\S]*?)<\/script>/g)].map(match => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`);
  return CSP.replace("script-src 'self'", ["script-src 'self'", ...hashes].join(' '));
}
const json = (value, status = 200, code, upstream) => new Response(JSON.stringify(value), {status, headers: {
  'Content-Type': mime['.json'], 'Cache-Control': 'no-store',
  ...(validDiagnosticCode(code) ? {'X-Map-Error-Code':code} : {}),
  ...(validDiagnosticCode(upstream) ? {'X-Map-Upstream-Error-Code':upstream} : {})
}});

export async function boundedBytes(response, limit, source = 'CLIENT-RESOURCE') {
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    const status = response.status;
    throw mapLoadError(`${source}-HTTP-${status}`, `资源服务暂不可用（${status}）`, {
      status: status >= 400 ? status : 503, sourceCode: response.headers.get('X-Map-Error-Code')
    });
  }
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel().catch(() => {});
    throw mapLoadError(`${source}-LENGTH`, '资源超过预期大小');
  }
  const reader = response.body.getReader(), parts = []; let size = 0;
  try { while (true) { const {done, value} = await reader.read(); if (done) break; size += value.length; if (size > limit) throw mapLoadError(`${source}-LENGTH`, '资源超过预期大小'); parts.push(value); } }
  catch (error) { await reader.cancel().catch(() => {}); throw error; }
  return Buffer.concat(parts, size);
}

export function createDesktopResources({siteRoot, cacheRoot, localRoot, lock, release, fetcher = fetch}) {
  const site = path.resolve(siteRoot), pending = new Map();
  if (lock.schemaVersion !== 1) throw Error('资源版本清单无效');
  const archive = digest(JSON.stringify(lock));
  const github = createReleaseResources({release, lock, cacheRoot, fetcher});
  let local = localRoot ? createClientResourceStore(localRoot) : null;
  const market = createMarketPriceService({seedDirectory: path.join(site, 'data/market'), avatarManifest: path.join(site, 'data/tasks/assets/manifest.json')});
  async function remote(relative, limit, signal, expectedHash) {
    let source = 'CLIENT-GITHUB';
    try {
      const released = await github?.read(relative, limit, signal);
      if (released != null) return released;
      source = 'CLIENT-ARCHIVE';
      const init = {redirect: 'error', credentials: 'omit', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000)};
      let response = await fetcher(`${RESOURCE_ORIGIN}/desktop-resources/${archive}/${relative}`, init);
      // Only an absent archive can fall back to the live website. The live
      // response must still match the pinned bytes.
      if (response.status === 404) {
        await response.body?.cancel();
        source = 'CLIENT-WEBSITE';
        response = await fetcher(`${RESOURCE_ORIGIN}/${relative}`, init);
        const kind = expectedHash && /^data\/(geometry-quality|model-quality|scenery-details)\/[a-z_]+\/manifest\.json$/.exec(relative)?.[1];
        if (kind) {
          const bytes = await boundedBytes(response, Math.min(64*2**20, limit*4+65536), source);
          if (bytes.length === limit && digest(bytes) === expectedHash) return bytes;
          // Older websites publish all tiers. Installed catalogs use compact
          // JSON, while texture generation also supports pretty JSON.
          let catalog;
          try { catalog = JSON.parse(bytes); }
          catch (cause) { throw mapLoadError('CLIENT-CATALOG-FORMAT', '资源目录格式无效，请检查客户端更新', {cause}); }
          const tier = kind === 'model-quality' ? 'medium' : 'low';
          const value = {...catalog, variants: {[tier]: catalog?.variants?.[tier]}};
          for (const indent of kind === 'model-quality' ? [undefined, 2] : [undefined]) {
            const selected = Buffer.from(JSON.stringify(value, null, indent)+'\n');
            if (selected.length === limit && digest(selected) === expectedHash) return selected;
          }
          throw mapLoadError('CLIENT-CATALOG-HASH', '资源目录与当前客户端版本不一致，请检查客户端更新');
        }
      }
      return await boundedBytes(response, limit, source);
    } catch (cause) {
      signal?.throwIfAborted();
      if (cause.diagnosticCode || cause.name === 'AbortError') throw cause;
      const kind = cause.name === 'TimeoutError' ? 'TIMEOUT' : cause instanceof TypeError ? 'NETWORK' : 'IO';
      throw mapLoadError(`${source}-${kind}`, cause.message, {cause});
    }
  }
  async function read(relative, signal, saveLocal = false) {
    resourcePath(relative);
    const file = path.join(site, relative);
    try { return await fs.readFile(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const entry = Object.hasOwn(lock.files, relative) ? lock.files[relative] : null;
    if (!entry) throw mapLoadError('CLIENT-LOCK-MISSING', '此资源不在当前版本中', {status:404});
    const [hash, size] = entry;
    if (!/^[a-f0-9]{64}$/.test(hash) || !Number.isSafeInteger(size) || size <= 0 || size > 64 * 2**20) throw mapLoadError('CLIENT-LOCK-INVALID', '资源版本清单无效');
    const persist = relative.endsWith('.json'), saved = path.join(cacheRoot, hash);
    const useLocal = local && (persist || saveLocal);
    if (useLocal) { const bytes = await local.getObject(hash, size); if (bytes) return bytes; }
    if (persist) { try { const bytes = await fs.readFile(saved); if (bytes.length === size && digest(bytes) === hash) { if(useLocal)await local.putObject(hash,bytes);return bytes; } } catch (error) { if (error.code !== 'ENOENT') throw error; } }
    // A caller's cancellation must not poison a shared metadata request.
    if (persist && pending.has(hash)) return pending.get(hash);
    const request = (async () => {
      const bytes = await remote(relative, size, persist ? undefined : signal, hash);
      if (bytes.length !== size || digest(bytes) !== hash) throw mapLoadError('CLIENT-ASSET-HASH', '资源版本已变化或校验失败，请检查桌面版更新');
      if (useLocal) await local.putObject(hash, bytes);
      else if (persist) {
        await fs.mkdir(cacheRoot, {recursive: true}); const temp = `${saved}.${randomUUID()}.tmp`;
        try { await fs.writeFile(temp, bytes, {flag: 'wx'}); await fs.rename(temp, saved); }
        finally { await fs.rm(temp, {force: true}); }
      }
      return bytes;
    })();
    if (persist) pending.set(hash, request);
    try { return await request; } finally { if (pending.get(hash) === request) pending.delete(hash); }
  }
  const readManifest = async absolute => JSON.parse((await read(resourcePath(path.relative(site, absolute).replaceAll('\\', '/')))).toString('utf8'));
  async function plan(mapId, quality) {
    if (!Object.hasOwn(ATLAS_MAPS, mapId) || !validQuality(quality)) throw Object.assign(Error('地图或画质无效'), {status: 400});
    return readMapCachePlan(site, ATLAS_MAPS[mapId], quality, readManifest);
  }
  async function handle(request) {
    if (!appUrl(request.url)) return json({error: '不允许的地址'}, 403);
    if (!['GET', 'HEAD'].includes(request.method)) return json({error: '不支持的操作'}, 405);
    try {
      const url = new URL(request.url), relative = resourcePath(decodeURIComponent(url.pathname.slice(1)) || 'index.html');
      if (relative === 'api/client-resources') return json(local ? await local.status() : {available: false, path: '', code: 'CLIENT-DIRECTORY-UNCONFIGURED', error: '客户端资源目录未配置'});
      if (relative === 'api/market-prices') {
        const mode = url.searchParams.get('mode');
        if (!MARKET_MODES.includes(mode) || [...url.searchParams].length !== 1) return json({error: '游戏模式无效'}, 400);
        const value = await market.get(mode); return new Response(request.method === 'HEAD' ? null : value.body, {headers: {'Content-Type': mime['.json']}});
      }
      if (relative.startsWith('api/cache-plan/')) {
        if ([...url.searchParams].length !== 3) return json({error: '画质无效'}, 400);
        return json(await plan(relative.slice('api/cache-plan/'.length), Object.fromEntries(url.searchParams)));
      }
      if (relative.startsWith('api/runtime/')) {
        const mapId = relative.slice('api/runtime/'.length);
        return Object.hasOwn(ATLAS_MAPS, mapId) ? json({version: 1, mapId, map: null, geometry: {}}) : json({error: '地图不存在'}, 404);
      }
      if (Object.hasOwn(lock.geometry, relative)) {
        const [hash, total] = lock.geometry[relative], offset = Number(url.searchParams.get('offset')), length = Number(url.searchParams.get('length'));
        if ([...url.searchParams].length !== 3 || url.searchParams.get('version') !== hash || !/^\d+$/.test(url.searchParams.get('offset') || '') || !/^\d+$/.test(url.searchParams.get('length') || '') || !Number.isSafeInteger(offset) || offset < 0 || offset % (4*2**20) || length !== Math.min(4*2**20, total-offset) || length <= 0) return json({error: '分块版本或范围无效'}, 400, 'CLIENT-MODEL-RANGE');
        const useLocal = local && request.headers.get('X-Tarkov-Storage') === 'client';
        if (useLocal) {
          const data = await local.getChunk(hash, offset, length, total);
          if (data) return new Response(JSON.stringify({offset, total, encoding: 'base64', data: data.toString('base64'), sha256: digest(data)}), {headers: {'Content-Type': mime['.json'], 'Cache-Control': 'no-store', 'X-Resource-Source': 'local'}});
        }
        const bytes = await remote(`${relative}?${new URLSearchParams({offset, length, version: hash})}`, Math.ceil(length / 3)*4 + 1024, request.signal);
        let chunk;
        try { chunk = JSON.parse(bytes); }
        catch (cause) { throw mapLoadError('CLIENT-MODEL-CHUNK-FORMAT', '模型分块格式无效', {cause}); }
        if (chunk?.offset !== offset || chunk.total !== total || chunk.encoding !== 'base64' || typeof chunk.data !== 'string') throw mapLoadError('CLIENT-MODEL-CHUNK-FORMAT', '模型分块格式无效');
        const data = Buffer.from(chunk.data, 'base64');
        if (data.length !== length || digest(data) !== chunk.sha256) throw mapLoadError('CLIENT-MODEL-CHUNK-HASH', '模型分块校验失败');
        if (useLocal) await local.putChunk(hash, offset, data, total);
        return new Response(bytes, {headers: {'Content-Type': mime['.json'], 'Cache-Control': 'no-store'}});
      }
      if (relative.startsWith('api/') || !mime[path.extname(relative)]) return json({error: '资源不存在'}, 404);
      let bytes = await read(relative, request.signal, request.headers.get('X-Tarkov-Storage') === 'client');
      if (relative.endsWith('.html')) bytes = Buffer.from(bytes.toString('utf8').replace('</head>', '<link rel="stylesheet" href="desktop-shell.css"><script type="module" src="desktop-shell.js"></script></head>'));
      return new Response(request.method === 'HEAD' ? null : bytes, {headers: {'Content-Type': mime[path.extname(relative)], 'Content-Security-Policy': relative.endsWith('.html') ? pagePolicy(bytes) : CSP, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache'}});
    } catch (error) {
      const code = error.diagnosticCode || ({
        EACCES:'CLIENT-DISK-PERMISSION', EPERM:'CLIENT-DISK-PERMISSION', ENOSPC:'CLIENT-DISK-FULL', EROFS:'CLIENT-DISK-READONLY'
      })[error.code] || 'CLIENT-RESOURCE-IO';
      return json({error: error.message}, error.status || 503, code, error.sourceCode);
    }
  }
  return {read, handle, setLocalRoot(root) { local = createClientResourceStore(root); }, localStatus: () => local.status()};
}
