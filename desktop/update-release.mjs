import semver from 'semver';
import {RESOURCE_ORIGIN} from './policy.mjs';
import {boundedBytes} from './resources.mjs';

export const UPDATE_REPOSITORY = 'Redpred/tarkov-loot-map';
export const UPDATE_RELEASES = `https://github.com/${UPDATE_REPOSITORY}/releases`;
export const SERVER_UPDATE_URL = `${RESOURCE_ORIGIN}/desktop-updates/`;
const invalid = () => Object.assign(Error('更新文件信息不完整，请稍后重试。'), {code: 'INVALID_UPDATE'});
const installerName = version => `TarkovLootMap-${version}-win-x64-setup.exe`;
const validSize = size => Number.isSafeInteger(size) && size > 0 && size < 2 ** 31;
const validSha512 = value => typeof value === 'string' && /^[A-Za-z0-9+/]{86}==$/.test(value);

export async function findServerDesktopRelease(currentVersion, fetcher = fetch) {
  if (!semver.valid(currentVersion)) throw invalid();
  const response = await fetcher(SERVER_UPDATE_URL + 'latest.json', {
    headers: {Accept: 'application/json'}, cache: 'no-store',
    signal: AbortSignal.timeout(12000), redirect: 'error',
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    if (response.status === 404) return null;
    if (response.status === 429) throw Object.assign(Error('检查更新过于频繁，请稍后重试。'), {code: 'RATE_LIMIT'});
    throw Error('暂时无法连接更新服务器，请稍后重试。');
  }
  let manifest;
  try { manifest = JSON.parse((await boundedBytes(response, 16 * 1024)).toString('utf8')); }
  catch { throw invalid(); }
  const {version, installer} = manifest ?? {};
  if (manifest?.schemaVersion !== 1 || manifest.kind !== 'program' || typeof version !== 'string' || semver.valid(version) !== version ||
      installer?.name !== installerName(version) || !validSize(installer.size) || !validSha512(installer.sha512)) throw invalid();
  if (!semver.prerelease(currentVersion) && semver.prerelease(version)) return null;
  return {version, name: installer.name, size: installer.size, sha512: installer.sha512, baseUrl: `${SERVER_UPDATE_URL}${version}/`};
}

// Application and large resource releases share a repository. Never use /latest:
// a newer resource release is not a newer application.
export function selectDesktopRelease(releases, currentVersion) {
  if (!Array.isArray(releases) || !semver.valid(currentVersion)) throw invalid();
  const preview = Boolean(semver.prerelease(currentVersion));
  return releases.flatMap(release => {
    if (!release || release.draft || typeof release.tag_name !== 'string' || !release.tag_name.startsWith('desktop-v')) return [];
    const version = release.tag_name.slice(9);
    if (semver.valid(version) !== version || (!preview && (release.prerelease || semver.prerelease(version)))) return [];
    const name = installerName(version), baseUrl = `${UPDATE_RELEASES}/download/${release.tag_name}/`;
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const installer = assets.find(asset => asset.name === name && asset.browser_download_url === baseUrl + name);
    const metadata = assets.find(asset => asset.name === 'latest.yml' && asset.browser_download_url === baseUrl + 'latest.yml');
    if (!installer || !metadata || !validSize(installer.size)) return [];
    return [{version, name, size: installer.size, baseUrl}];
  }).sort((a, b) => semver.rcompare(a.version, b.version))[0] || null;
}

export async function findDesktopRelease(currentVersion, fetcher = fetch) {
  const releases = [];
  // Bounded, anonymous GitHub API access; no credentials in the distributed app.
  for (let page = 1; page <= 5; page++) {
    const response = await fetcher(`https://api.github.com/repos/${UPDATE_REPOSITORY}/releases?per_page=100&page=${page}`, {
      headers: {Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'},
      signal: AbortSignal.timeout(20000), redirect: 'error',
    });
    if (response.status === 404) return null;
    if (response.status === 403 || response.status === 429) throw Object.assign(Error('检查更新过于频繁，请稍后重试。'), {code: 'RATE_LIMIT'});
    if (!response.ok) throw Error('暂时无法连接更新服务，请检查网络后重试。');
    const content = await response.text();
    if (content.length > 8 * 1024 * 1024) throw invalid();
    const entries = JSON.parse(content);
    if (!Array.isArray(entries)) throw invalid();
    releases.push(...entries);
    if (entries.length < 100) return selectDesktopRelease(releases, currentVersion);
  }
  throw Error('更新列表暂时无法完整读取，请到发布页检查新版。');
}

export function validateUpdateInfo(info, release, currentVersion) {
  const file = info?.files?.[0];
  if (!release || info?.version !== release.version || !semver.gt(info.version, currentVersion) ||
      !Array.isArray(info.files) || info.files.length !== 1 || file?.url !== release.name || file.size !== release.size ||
      !validSha512(file.sha512) || (release.sha512 != null && file.sha512 !== release.sha512) || (info.path != null && info.path !== file.url) ||
      (info.sha512 != null && info.sha512 !== file.sha512) || info.packages || file.packageInfo || file.isAdminRightsRequired) throw invalid();
  return info;
}

export function isNewerVersion(version, current) { return semver.gt(version, current); }
