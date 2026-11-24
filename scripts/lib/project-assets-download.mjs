import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {releaseDownloadUrl} from '../../desktop/release-resources.mjs';
import {assertNoLinks} from './desktop-offline-profile.mjs';
import {fileDigest} from './desktop-offline-artifact.mjs';
import {validateProjectAssets} from './project-assets.mjs';

export function validateAssetRelease(lock, release) {
  const lockId = validateProjectAssets(lock);
  assert(release?.schemaVersion === 1 && release.lockId === lockId, 'Asset release does not match the source lock');
  assert(/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(release.repository) && /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,127}$/.test(release.tag), 'Invalid asset release location');
  assert(release.index?.name === 'project-assets-index.json' && /^[a-f0-9]{64}$/.test(release.index.sha256) && Number.isSafeInteger(release.index.bytes) && release.index.bytes > 0 && release.index.bytes <= 32 * 2**20, 'Invalid asset index identity');
  return lockId;
}

// Only pinned public GitHub assets. No credentials, website fallback or unverified cache writes.
export async function downloadProjectAssets({lock, release, cache, group = 'all', fetcher = fetch}) {
  const lockId = validateAssetRelease(lock, release);
  assert(['runtime', 'inputs', 'all'].includes(group), 'Invalid asset group');
  await assertNoLinks(cache); await fs.mkdir(cache, {recursive: true});
  const base = `https://github.com/${release.repository}/releases/download/${release.tag}/`;
  const downloaded = [], reused = [];
  async function download(entry) {
    const target = await assertNoLinks(path.join(cache, entry.name));
    const existing = await fs.stat(target).catch(error => {if (error.code !== 'ENOENT') throw error; return null;});
    if (existing) {
      assert(existing.isFile() && existing.size === entry.bytes && await fileDigest(target) === entry.sha256, `Cached asset differs; preserve or remove it before retrying: ${entry.name}`);
      reused.push(entry.name); return;
    }
    let url = base + entry.name, response;
    const signal = AbortSignal.timeout(15 * 60 * 1000);
    for (let redirects = 0; redirects <= 5; redirects++) {
      assert(releaseDownloadUrl(url), 'Asset redirect must stay on an approved HTTPS GitHub host');
      response = await fetcher(url, {redirect: 'manual', credentials: 'omit', headers: {'Accept-Encoding': 'identity'}, signal});
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location'); await response.body?.cancel();
      assert(location && redirects < 5, 'Invalid or excessive asset redirects');
      url = new URL(location, url).href;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw Error(response.status === 404 ? 'Pinned project resource Release is not publicly available (404). Use assets:restore --from with an approved local bundle.' : `Project resource download failed (${response.status})`);
    }
    const length = response.headers.get('content-length');
    if (length !== null && Number(length) !== entry.bytes) {
      await response.body?.cancel(); throw Error('Asset download size does not match the pinned identity');
    }
    assert(response.body, 'Empty asset response');
    const temporary = path.join(cache, `.download-${randomUUID()}.tmp`);
    const handle = await fs.open(temporary, 'wx'), hash = createHash('sha256');
    let size = 0;
    try {
      for await (const chunk of response.body) {
        size += chunk.byteLength; assert(size <= entry.bytes, 'Asset download exceeds the pinned size');
        hash.update(chunk); let offset = 0;
        while (offset < chunk.byteLength) {
          const result = await handle.write(chunk, offset, chunk.byteLength - offset); assert(result.bytesWritten > 0); offset += result.bytesWritten;
        }
      }
      assert(size === entry.bytes && hash.digest('hex') === entry.sha256, 'Asset download checksum or size mismatch');
      await handle.close(); await assertNoLinks(target);
      // Exclusive copy preserves any file created by another process while downloading.
      await fs.copyFile(temporary, target, fs.constants.COPYFILE_EXCL);
      downloaded.push(entry.name);
    } finally {
      await handle.close(); await fs.unlink(temporary);
    }
  }
  await download(release.index);
  const index = JSON.parse(await fs.readFile(path.join(cache, release.index.name), 'utf8'));
  assert(index.schemaVersion === 1 && index.lockId === lockId && Array.isArray(index.packs) && index.objects, 'Invalid project asset index');
  const packs = new Map();
  for (const entry of lock.files.filter(e => group === 'all' || e.group === group)) {
    const member = index.objects[entry.sha256], pack = index.packs.find(p => p.name === member?.pack);
    assert(pack && /^project-assets-(runtime|inputs)\.zip$/.test(pack.name) && /^[a-f0-9]{64}$/.test(pack.sha256) && Number.isSafeInteger(pack.bytes) && pack.bytes > 0 && pack.bytes < 2**31, 'Invalid project asset archive');
    assert(Number.isSafeInteger(member.offset) && member.offset >= 0 && member.bytes === entry.bytes && member.offset + member.bytes <= pack.bytes, 'Invalid project asset object');
    packs.set(pack.name, pack);
  }
  for (const pack of packs.values()) await download(pack);
  return {cache, lockId, downloaded, reused};
}
