import {pageRoute} from '../site/atlas-page-routes.js';

export const APP_ORIGIN = 'tarkov://app';
export const RESOURCE_ORIGIN = 'https://tarkovlootmap.com';
export const RELEASES_URL = 'https://github.com/Redpred/tarkov-loot-map/releases';
export function appUrl(value) {
  try { const u = new URL(value); return u.protocol === 'tarkov:' && u.hostname === 'app' && !u.port && !u.username && !u.password; }
  catch { return false; }
}
export function appPermission(permission, pageUrl, requestOrigin, details) {
  if (!appUrl(pageUrl) || !appUrl(requestOrigin)) return false;
  if (permission === 'pointerLock') {
    return details?.isMainFrame === true && details.requestingUrl === pageUrl && pageRoute(pageUrl, APP_ORIGIN)?.kind === 'map';
  }
  return ['fileSystem', 'clipboard-sanitized-write', 'persistent-storage'].includes(permission);
}
export function externalUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.port && ['github.com', 'afdian.com', 'tarkovlootmap.com', 'steamcommunity.com', 'beian.miit.gov.cn', 'beian.mps.gov.cn', 'tarkov.dev', 'creativecommons.org', 'space.bilibili.com'].includes(u.hostname); }
  catch { return false; }
}
export function resourcePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || /[%?#:\u0000-\u001f]/.test(value) || value.split('/').some(p => !p || p === '.' || p === '..')) throw Error('无效的资源路径');
  return value;
}
export function validQuality(value) {
  return value && ['original', 'medium', 'low'].includes(value.geometry) && ['original', 'medium', 'low'].includes(value.texture) && ['full', 'simple'].includes(value.scenery) && Object.keys(value).length === 3;
}
