const openEvent = 'tarkov:open-client-updates';
const busyPhases = new Set(['checking', 'downloading', 'installing']);
const descriptions = {
  idle: '可随时检查客户端的新版本。', checking: '正在检查更新…', 'up-to-date': '当前已是最新可用版本。',
  unpublished: '服务器暂未发布可用的客户端版本。', available: '发现新版本。', downloading: '正在下载程序更新…',
  downloaded: '程序更新已下载。', installing: '正在校验并准备安装…',
  unsupported: '开发运行时的更新服务未启用。', error: '更新未完成。',
};

export function desktopUpdateBridge() {
  if (globalThis.location?.protocol !== 'tarkov:' || globalThis.location.hostname !== 'app') return null;
  const bridge = globalThis.tarkovDesktop || window.top.tarkovDesktop;
  return typeof bridge?.updates === 'function' ? bridge : null;
}

function versionText({currentVersion, version}) {
  return version && version !== currentVersion ? `当前版本 ${currentVersion} · 服务器版本 ${version}` : `当前版本 ${currentVersion}`;
}

function statusText(state) {
  if (state.message) return state.message;
  if (state.phase === 'available' && state.canInstall) return `发现新版本，程序包 ${(state.total / 1e6).toFixed(1)} MB。`;
  return descriptions[state.phase] || '';
}

async function updateRequest(bridge, action, value) {
  const result = await bridge.updates(action, value);
  if (!result.ok) throw Error(result.message);
  return result.value;
}

export function createDesktopUpdateSettings(container, bridge) {
  container.innerHTML = `<fieldset><legend>客户端版本</legend>
    <p class="hint" data-update-version></p>
    <label class="check"><input type="checkbox" data-update-preference disabled>启动时检查更新</label>
    <p class="hint" data-update-status role="status">正在读取更新设置…</p>
    <p class="hint" data-update-error role="alert" hidden></p>
    <div class="view-actions"><button type="button" data-update-check disabled>检查更新</button>
    <button type="button" data-update-details hidden>查看更新</button></div></fieldset>`;
  const preference = container.querySelector('[data-update-preference]');
  const check = container.querySelector('[data-update-check]');
  const details = container.querySelector('[data-update-details]');
  const error = container.querySelector('[data-update-error]');
  let state, pending = false;
  function render(value) {
    state = value;
    container.querySelector('[data-update-version]').textContent = versionText(state);
    container.querySelector('[data-update-status]').textContent = statusText(state);
    preference.checked = state.autoUpdate;
    preference.disabled = pending || state.phase === 'unsupported';
    check.disabled = pending || busyPhases.has(state.phase) || ['unsupported', 'downloaded'].includes(state.phase);
    details.hidden = !(['available', 'downloading', 'downloaded'].includes(state.phase) || state.retryDownload);
  }
  async function request(action, value) {
    if (pending) return;
    pending = true;
    error.hidden = true;
    preference.disabled = check.disabled = true;
    try { render(await updateRequest(bridge, action, value)); }
    catch (reason) { error.textContent = reason.message || '更新设置暂不可用。'; error.hidden = false; }
    finally { pending = false; if (state) render(state); }
  }
  bridge.onUpdateState(render);
  preference.addEventListener('change', () => { void request('preference', preference.checked); });
  check.addEventListener('click', () => { void request('check'); });
  details.addEventListener('click', () => window.top.dispatchEvent(new Event(openEvent)));
  void request('status');
}

export function createDesktopUpdateUI(bridge, titlebar) {
  const dialog = document.createElement('dialog'); dialog.id = 'desktopUpdateDialog';
  dialog.setAttribute('aria-labelledby', 'desktopUpdateTitle');
  dialog.innerHTML = `<header><h2 id="desktopUpdateTitle">客户端更新</h2><button type="button" data-close aria-label="关闭">×</button></header>
    <p class="desktop-update-version"></p><p data-update-status role="status" aria-live="polite"></p>
    <progress max="100" value="0" aria-label="更新下载进度" hidden></progress><p data-progress-text hidden></p>
    <p class="desktop-update-hint">更新程序时复用已有地图资源，下载完成后可选择重启安装。</p>
    <p class="desktop-update-portable" hidden>当前为免安装运行。请先通过安装包安装客户端，再使用自动安装更新。</p>
    <p data-update-error role="alert" hidden></p><footer><button type="button" data-release hidden>打开官网</button>
    <button type="button" data-update-later>稍后</button><button type="button" data-update-primary>检查更新</button></footer>`;
  document.documentElement.append(dialog);
  const badge = document.createElement('button'); badge.className = 'desktop-update-badge'; badge.hidden = true; titlebar.append(badge);
  const primary = dialog.querySelector('[data-update-primary]'), progress = dialog.querySelector('progress');
  const release = dialog.querySelector('[data-release]');
  let state, pending = false, shownNotice = '';
  function render(value) {
    state = value;
    dialog.querySelector('.desktop-update-version').textContent = versionText(state);
    dialog.querySelector('[data-update-status]').textContent = statusText(state);
    progress.hidden = state.phase !== 'downloading'; progress.value = state.percent;
    const progressText = dialog.querySelector('[data-progress-text]'); progressText.hidden = progress.hidden;
    progressText.textContent = `${Math.floor(state.percent)}% · ${(state.transferred / 1e6).toFixed(1)} / ${(state.total / 1e6).toFixed(1)} MB`;
    dialog.querySelector('.desktop-update-portable').hidden = state.canInstall || state.phase === 'unsupported';
    release.hidden = state.canInstall && !['error', 'unpublished'].includes(state.phase);
    const actionLabels = {downloaded: '重启并安装', checking: '检查中…', downloading: '下载中…', installing: '准备安装…'};
    primary.textContent = actionLabels[state.phase] || (state.retryDownload ? '重试下载' : state.phase === 'available' && state.canInstall ? '下载更新' : '检查更新');
    primary.disabled = pending || state.phase === 'unsupported' || busyPhases.has(state.phase);
    badge.hidden = !['available', 'downloading', 'downloaded'].includes(state.phase);
    badge.textContent = state.phase === 'downloaded' ? '更新已就绪' : state.phase === 'downloading' ? `更新 ${Math.floor(state.percent)}%` : '发现新版';
    if (state.noticeVersion && state.noticeVersion !== shownNotice) {
      shownNotice = state.noticeVersion;
      if (!dialog.open) dialog.showModal();
      void request('acknowledge', shownNotice);
    }
  }
  async function request(action, value) {
    const error = dialog.querySelector('[data-update-error]'); error.hidden = true;
    try { render(await updateRequest(bridge, action, value)); }
    catch (reason) { error.textContent = reason.message || '操作未完成，请重试。'; error.hidden = false; }
  }
  async function open() {
    if (!dialog.open) dialog.showModal();
    await request('status');
  }
  badge.addEventListener('click', open);
  window.addEventListener(openEvent, open);
  for (const button of dialog.querySelectorAll('[data-close], [data-update-later]')) button.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
  release.addEventListener('click', () => { void bridge.action('updates'); });
  primary.addEventListener('click', async () => {
    if (!state || pending) return;
    pending = true; render(state);
    await request(state.phase === 'downloaded' ? 'install' : state.retryDownload || state.phase === 'available' && state.canInstall ? 'download' : 'check');
    pending = false; if (state) render(state);
  });
  bridge.onUpdateState(render);
  void request('status');
  return {open};
}
