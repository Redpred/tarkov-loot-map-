// Resolve task images for both the website and the isolated desktop origin.
export function taskAssetUrl(value, base = globalThis.location?.href) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const page = new URL(base), url = new URL(value, page);
    const allowed = ['http:', 'https:'].includes(page.protocol) || (page.protocol === 'tarkov:' && page.host === 'app');
    if (!allowed || url.protocol !== page.protocol || url.host !== page.host || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}
