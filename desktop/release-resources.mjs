import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {gunzip} from 'node:zlib';
import {promisify} from 'node:util';
import {createReleasePackCache} from './release-pack-cache.mjs';
import {mapLoadError} from '../site/atlas-map-diagnostics.js';
const unzip = promisify(gunzip), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const PACK_LIMIT = 1900 * 2**20, MEMBER_LIMIT = 64 * 2**20, hosts = new Set(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
export function releaseDownloadUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && hosts.has(url.hostname) && !url.port && !url.username && !url.password && !url.hash; } catch { return false; }
}
async function bounded(response, limit, source) {
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw mapLoadError(`${source}-HTTP-${response.status}`, `GitHub 资源下载失败（${response.status}）`);
  }
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw Error('资源超过预期大小'); }
  const reader = response.body.getReader(), parts = []; let size = 0;
  try { while (true) { const {done, value} = await reader.read(); if (done) break; size += value.length; if (size > limit) throw Error('资源超过预期大小'); parts.push(value); } }
  catch (error) { await reader.cancel().catch(() => {}); throw error; }
  return Buffer.concat(parts, size);
}
export function createReleaseResources({release, lock, cacheRoot, fetcher = fetch}) {
  if (!release) return null;
  const id = hash(JSON.stringify(lock));
  if (release.schemaVersion !== 1 || release.resourceLockId !== id || !/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(release.repository) || !/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,127}$/.test(release.tag) || release.index?.name !== 'resources-index.json' || !/^[a-f0-9]{64}$/.test(release.index.sha256) || !Number.isSafeInteger(release.index.bytes) || release.index.bytes <= 0 || release.index.bytes > 32*2**20) throw Error('GitHub 资源版本配置无效');
  const base = `https://github.com/${release.repository}/releases/download/${release.tag}/`;
  let catalog, pending, absentUntil = 0;
  const fullPacks = createReleasePackCache(cacheRoot);
  async function request(name, signal, headers = {}, timeout = 120000) {
    let url = base + name;
    const abort = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (!releaseDownloadUrl(url)) throw Error('GitHub 资源下载地址无效');
      const response = await fetcher(url, {redirect: 'manual', credentials: 'omit', headers: {'Accept-Encoding': 'identity', ...headers}, signal: abort});
      if (![301,302,303,307,308].includes(response.status)) return response;
      const location = response.headers.get('location'); await response.body?.cancel();
      if (!location) throw Error('GitHub 资源下载跳转无效');
      url = new URL(location, url).href;
    }
    throw Error('GitHub 资源下载跳转过多');
  }
  async function index() {
    if (catalog) return catalog;
    if (Date.now() < absentUntil) return null;
    if (pending) return pending;
    pending = (async () => {
      const saved = path.join(cacheRoot, 'release-index-' + release.index.sha256);
      let bytes;
      try { bytes = await fs.readFile(saved); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!bytes || bytes.length !== release.index.bytes || hash(bytes) !== release.index.sha256) {
        const response = await request(release.index.name);
        // Local previews can still use the old service before the resource
        // Release is public. Published-but-broken packs never use this fallback.
        if (response.status === 404) { await response.body?.cancel(); absentUntil = Date.now()+60000; return null; }
        bytes = await bounded(response, release.index.bytes, 'CLIENT-GITHUB-INDEX');
        if (bytes.length !== release.index.bytes || hash(bytes) !== release.index.sha256) throw mapLoadError('CLIENT-GITHUB-INDEX-HASH', 'GitHub 资源索引校验失败');
        await fs.mkdir(cacheRoot, {recursive: true}); const temp = `${saved}.${randomUUID()}.tmp`;
        try { await fs.writeFile(temp, bytes, {flag: 'wx'}); await fs.rename(temp, saved); } finally { await fs.rm(temp, {force: true}); }
      }
      const value = JSON.parse(bytes);
      if (value.schemaVersion !== 1 || value.resourceLockId !== id || !Array.isArray(value.packs) || !value.objects || !value.chunks) throw Error('GitHub 资源索引无效');
      catalog = value; return value;
    })();
    try { return await pending; } finally { pending = null; }
  }
  async function member(catalog, entry, signal) {
    signal?.throwIfAborted();
    if (!Array.isArray(entry) || entry.length !== 4) throw Error('GitHub 资源条目不存在');
    const [packId, offset, length, digest] = entry, pack = catalog.packs[packId];
    if (!Number.isSafeInteger(packId) || packId < 0 || !pack || !/^resources-[a-z0-9_-]+\.zip$/.test(pack.name) || !Number.isSafeInteger(pack.bytes) || pack.bytes <= 0 || pack.bytes > PACK_LIMIT || !/^[a-f0-9]{64}$/.test(pack.sha256) || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length <= 0 || offset + length > pack.bytes || !/^[a-f0-9]{64}$/.test(digest)) throw Error('GitHub 资源范围无效');
    if(length>MEMBER_LIMIT)throw Error('GitHub 资源内容超过限制');
    let bytes = await fullPacks.read(pack,offset,length,undefined,signal);
    if (!bytes) {
      const response = await request(pack.name, signal, {Range: `bytes=${offset}-${offset+length-1}`}, 2*60*60*1000);
      if (response.status === 206) {
        if (response.headers.get('content-range') !== `bytes ${offset}-${offset+length-1}/${pack.bytes}`) { await response.body?.cancel(); throw mapLoadError('CLIENT-GITHUB-PACK-RANGE', 'GitHub 资源范围响应无效'); }
        bytes = await bounded(response, length, 'CLIENT-GITHUB-PACK');
      } else if (response.status === 200) {
        // Stream and hash at most one whole pack on disk. RAM remains bounded
        // by the requested member even when a proxy ignores the byte range.
        bytes = await fullPacks.read(pack,offset,length,response,signal);
      } else { await response.body?.cancel(); throw mapLoadError(`CLIENT-GITHUB-PACK-HTTP-${response.status}`, `GitHub 资源包下载失败（${response.status}）`); }
    }
    if (bytes.length !== length || hash(bytes) !== digest) throw mapLoadError('CLIENT-GITHUB-MEMBER-HASH', 'GitHub 资源内容校验失败');
    return bytes;
  }
  return {
    async read(relative, limit, signal) {
      signal?.throwIfAborted();
      const value = await index(); if (!value) return null;
      const url = new URL(relative, 'https://resource.invalid/'), name = url.pathname.slice(1);
      if (Object.hasOwn(lock.files, name)) {
        const version = lock.files[name][0], entry = Object.hasOwn(value.objects, version) ? value.objects[version] : null;
        const bytes = await member(value, entry, signal);
        if (bytes.length > limit || hash(bytes) !== version) throw Error('GitHub 资源版本校验失败');
        return bytes;
      }
      if (Object.hasOwn(lock.geometry, name)) {
        const version = lock.geometry[name][0], key = `${version}/${url.searchParams.get('offset')}-${url.searchParams.get('length')}`;
        const entry = Object.hasOwn(value.chunks,key) ? value.chunks[key] : null;
        return unzip(await member(value,entry,signal), {maxOutputLength: limit});
      }
      throw Error('资源不在当前 GitHub 版本中');
    }
  };
}
