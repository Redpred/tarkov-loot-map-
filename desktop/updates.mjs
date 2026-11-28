import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {findServerDesktopRelease, isNewerVersion, validateUpdateInfo} from './update-release.mjs';

export function createDesktopUpdates({updater, currentVersion, settingsFile, canInstall, enabled = true,
  findRelease = findServerDesktopRelease, notify = () => {}, beforeInstall = () => {}, now = Date.now,
  startupDelay = 5000, checkInterval = 6 * 60 * 60 * 1000}) {
  let state = {phase: enabled ? 'idle' : 'unsupported', currentVersion, version: '', percent: 0, transferred: 0, total: 0,
    autoUpdate: true, canInstall, message: '', checkedAt: null, noticeVersion: ''};
  let operation, preferenceWrite = Promise.resolve(), timer, interval, selected, info, downloadedFile, disposed = false;
  let announcedVersion = '';
  const snapshot = () => ({...state, retryDownload: Boolean(info && selected && canInstall && state.phase === 'error')});
  const change = patch => { state = {...state, ...patch}; if (!disposed) notify(snapshot()); return snapshot(); };
  const errorText = error => {
    if (['INVALID_UPDATE', 'RATE_LIMIT'].includes(error?.code)) return error.message;
    if (/sha512|checksum|signature/i.test(String(error?.message))) return '更新文件校验失败，请重新检查并下载。';
    if (error?.code === 'ENOSPC') return '磁盘空间不足，请释放空间后重试。';
    return state.phase === 'checking' ? '暂时无法检查更新，请检查网络后重试。' : '更新未完成，请检查网络和磁盘空间后重试。';
  };
  const fail = error => change({phase: 'error', message: errorText(error)});
  updater.autoDownload = false; // Validate the selected release before downloading.
  updater.autoInstallOnAppQuit = false; // Closing the app never implicitly installs.
  updater.allowPrerelease = currentVersion.includes('-');
  updater.channel = 'latest';
  updater.allowDowngrade = false; // Setting channel would otherwise enable downgrades.
  updater.disableWebInstaller = true;
  updater.disableDifferentialDownload = true;
  const onProgress = progress => {
    if (state.phase !== 'downloading') return;
    change({percent: Math.max(0, Math.min(100, Number(progress.percent) || 0)), transferred: progress.transferred, total: progress.total});
  };
  const onError = error => fail(error);
  updater.on('download-progress', onProgress);
  updater.on('error', onError);
  const ready = (async () => {
    try {
      const saved = JSON.parse(await fs.readFile(settingsFile, 'utf8'));
      if (typeof saved.autoUpdate === 'boolean') state.autoUpdate = saved.autoUpdate;
    } catch (error) {
      if (error.code !== 'ENOENT') state.message = '更新偏好无法读取，可重新设置自动更新。';
    }
    return snapshot();
  })();
  async function download() {
    if (!canInstall || !selected || !info) throw Error('请先安装客户端，再使用自动更新。');
    validateUpdateInfo(info, selected, currentVersion);
    change({phase: 'downloading', message: '', percent: 0, transferred: 0, total: selected.size});
    const files = await updater.downloadUpdate();
    if (!Array.isArray(files) || typeof files[0] !== 'string') throw Error('没有下载文件');
    downloadedFile = files[0];
    change({phase: 'downloaded', percent: 100, transferred: selected.size, total: selected.size});
  }
  async function exclusive(fn) {
    if (operation) return snapshot();
    operation = Promise.resolve().then(fn).catch(fail).finally(() => { operation = null; });
    await operation;
    return snapshot();
  }
  const service = {
    async status() { await ready; return snapshot(); },
    async check({automatic = false} = {}) {
      await ready;
      if (!enabled || disposed || operation || ['downloaded', 'installing'].includes(state.phase)) return snapshot();
      if (automatic && (!state.autoUpdate || state.checkedAt != null && now() - state.checkedAt < 30000)) return snapshot();
      return exclusive(async () => {
        selected = null; info = null; downloadedFile = null;
        change({phase: 'checking', message: '', version: '', noticeVersion: '', percent: 0, transferred: 0, total: 0});
        selected = await findRelease(currentVersion);
        change({checkedAt: now()});
        if (!selected) { change({phase: 'unpublished'}); return; }
        if (!isNewerVersion(selected.version, currentVersion)) { change({phase: 'up-to-date', version: selected.version}); return; }
        updater.setFeedURL({provider: 'generic', url: selected.baseUrl, channel: 'latest', useMultipleRangeRequest: false});
        const result = await updater.checkForUpdates();
        const validated = validateUpdateInfo(result?.updateInfo, selected, currentVersion);
        if (result.isUpdateAvailable === false) throw Object.assign(Error('新版暂时无法用于当前客户端，请稍后重试。'), {code: 'INVALID_UPDATE'});
        info = validated;
        const noticeVersion = automatic && state.autoUpdate && selected.version !== announcedVersion ? selected.version : '';
        change({phase: 'available', version: selected.version, total: selected.size, noticeVersion});
      });
    },
    async acknowledge(version) {
      await ready;
      if (!version || version !== state.noticeVersion) return snapshot();
      announcedVersion = version;
      return change({noticeVersion: ''});
    },
    async download() {
      await ready;
      if (!enabled || !canInstall || !['available', 'error'].includes(state.phase) || !info) return snapshot();
      return exclusive(download);
    },
    async install() {
      await ready;
      if (!canInstall || state.phase !== 'downloaded' || !downloadedFile) return snapshot();
      return exclusive(async () => {
        change({phase: 'installing', message: ''});
        // Recheck cached bytes immediately before execution, including after a long wait.
        try {
          const stat = await fs.lstat(downloadedFile);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== selected.size) throw Error('checksum mismatch');
          const hash = createHash('sha512');
          for await (const chunk of createReadStream(downloadedFile)) hash.update(chunk);
          if (hash.digest('base64') !== info.files[0].sha512) throw Error('sha512 mismatch');
        } catch (error) {
          // Force the library's persisted-cache validation on retry; its in-memory
          // fast path only tests file existence after a successful download.
          updater.downloadedUpdateHelper = null; downloadedFile = null;
          throw error;
        }
        await beforeInstall();
        updater.quitAndInstall(true, true);
      });
    },
    async preference(value) {
      await ready;
      if (typeof value !== 'boolean') throw Error('无效更新设置');
      const write = preferenceWrite.then(async () => {
        await fs.mkdir(path.dirname(settingsFile), {recursive: true});
        const temporary = settingsFile + '.tmp';
        await fs.writeFile(temporary, JSON.stringify({autoUpdate: value}) + '\n');
        await fs.rename(temporary, settingsFile);
        return change({autoUpdate: value, ...(!value && {noticeVersion: ''})});
      });
      preferenceWrite = write.catch(() => {});
      return write;
    },
    async start() {
      await ready;
      if (!enabled || timer || disposed) return;
      timer = setTimeout(() => { void service.check({automatic: true}); }, startupDelay); timer.unref?.();
      interval = setInterval(() => { void service.check({automatic: true}); }, checkInterval); interval.unref?.();
    },
    dispose() { disposed = true; clearTimeout(timer); clearInterval(interval); updater.removeListener('download-progress', onProgress); updater.removeListener('error', onError); },
  };
  return service;
}
