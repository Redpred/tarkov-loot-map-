import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {parseScreenshotFilename} from '../site/atlas-screenshot-location.js';

// Only this service holds paths. The renderer receives names and timestamps,
// never image bytes or an arbitrary filesystem read endpoint.
export function createScreenshotAccess({documentsPaths, settingsFile, selectDirectory}) {
  let current = null, disabled = false, loaded;
  const candidates = [...new Set(documentsPaths.map(root => path.join(root, 'Escape from Tarkov', 'Screenshots')))];
  async function exists(folder) {
    try { return (await fs.stat(folder)).isDirectory(); }
    catch (error) { if (['ENOENT', 'ENOTDIR'].includes(error.code)) return false; throw error; }
  }
  function connect(folder) { current = {id: randomUUID(), path: folder, name: path.basename(folder)}; return {...current}; }
  async function save(value) {
    await fs.mkdir(path.dirname(settingsFile), {recursive: true});
    await fs.writeFile(settingsFile, JSON.stringify(value) + '\n');
  }
  async function load() {
    if (!loaded) loaded = (async () => {
      try {
        const saved = JSON.parse(await fs.readFile(settingsFile, 'utf8'));
        disabled = saved.disabled === true;
        if (!disabled && typeof saved.path === 'string' && path.isAbsolute(saved.path)) connect(saved.path);
      } catch (error) { if (error.code !== 'ENOENT') throw Error('无法读取截图目录设置，请重新选择目录。'); }
    })();
    return loaded;
  }
  async function detect() {
    for (const folder of candidates) if (await exists(folder)) {
      await save({path: folder}); disabled = false; return connect(folder);
    }
    return null;
  }
  const service = {
    async info() { await load(); return current ? {...current} : disabled ? null : detect(); },
    async detect() { await load(); return detect(); },
    async choose() {
      // Recover from a corrupt saved setting through an explicit selection.
      await load().catch(() => {});
      const folder = await selectDirectory(current?.path || candidates[0] || documentsPaths[0]);
      if (!folder) return null;
      if (!path.isAbsolute(folder) || !await exists(folder)) throw Error('截图目录不存在，请重新选择。');
      await save({path: folder}); disabled = false; loaded = Promise.resolve(); return connect(folder);
    },
    async forget() { await save({disabled: true}); current = null; disabled = true; loaded = Promise.resolve(); },
    async list(id) {
      await load();
      const directory = current;
      if (!directory || id !== directory.id) throw new DOMException('截图目录已更换，请重新连接。', 'NotFoundError');
      try {
        const entries = await fs.readdir(directory.path, {withFileTypes: true}), result = [];
        for (const entry of entries) {
          if (!entry.isFile() || !parseScreenshotFilename(entry.name)) continue;
          try {
            const stat = await fs.lstat(path.join(directory.path, entry.name));
            if (stat.isFile()) result.push({name: entry.name, lastModified: stat.mtimeMs});
          } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        return result;
      } catch (error) {
        if (['ENOENT', 'ENOTDIR'].includes(error.code)) throw new DOMException('截图目录不存在，请先在游戏中截图，或更换目录。', 'NotFoundError');
        throw error;
      }
    },
  };
  // Startup discovery and an explicit choice can overlap across IPC calls.
  // Finish them in order so late discovery cannot overwrite a chosen folder.
  let pending = Promise.resolve();
  for (const action of ['info', 'detect', 'choose', 'forget']) {
    const run = service[action];
    service[action] = (...args) => {
      const result = pending.then(() => run(...args));
      pending = result.catch(() => {}); return result;
    };
  }
  return service;
}
