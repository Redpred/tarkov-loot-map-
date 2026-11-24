export function createDesktopUpdateUI(bridge, titlebar) {
  const dialog = document.createElement('dialog'); dialog.id = 'desktopUpdateDialog';
  dialog.setAttribute('aria-labelledby', 'desktopUpdateTitle');
  dialog.innerHTML = `<header><h2 id="desktopUpdateTitle">客户端更新</h2><button type="button" data-close aria-label="关闭">×</button></header>
    <p class="desktop-update-version"></p><p data-update-status role="status" aria-live="polite"></p>
    <progress max="100" value="0" aria-label="更新下载进度" hidden></progress><p data-progress-text hidden></p>
    <label class="desktop-update-preference"><input type="checkbox">自动检查并下载更新</label>
    <p class="desktop-update-hint">下载完成后由你选择重启安装。地图资源、设置和任务进度会保留。</p>
    <p class="desktop-update-portable" hidden>当前为免安装运行。请先通过安装包安装客户端，再使用自动安装更新。</p>
    <p data-update-error role="alert" hidden></p><footer><button type="button" data-release>打开发布页</button><button type="button" data-update-primary>检查更新</button></footer>`;
  document.documentElement.append(dialog);
  const badge = document.createElement('button'); badge.className = 'desktop-update-badge'; badge.hidden = true; titlebar.append(badge);
  const primary = dialog.querySelector('[data-update-primary]'), check = dialog.querySelector('input'), progress = dialog.querySelector('progress');
  let state, pending = false;
  const descriptions = {
    idle: '可随时检查客户端的新版本。', checking: '正在检查更新…', 'up-to-date': '当前已是最新可用版本。',
    unpublished: '暂未找到公开的客户端更新。', available: '发现新版本，可以下载更新。', downloading: '正在后台下载更新…',
    downloaded: '新版已准备好，重启后即可使用。', installing: '正在校验并准备安装…',
    unsupported: '开发运行时不安装更新，请使用安装版客户端。', error: '更新未完成。',
  };
  function render(value) {
    state = value;
    dialog.querySelector('.desktop-update-version').textContent = `当前版本 ${state.currentVersion}${state.version ? ` → ${state.version}` : ''}`;
    dialog.querySelector('[data-update-status]').textContent = state.message || descriptions[state.phase] || '';
    check.checked = state.autoUpdate; check.disabled = state.phase === 'unsupported';
    progress.hidden = state.phase !== 'downloading'; progress.value = state.percent;
    const progressText = dialog.querySelector('[data-progress-text]'); progressText.hidden = progress.hidden;
    progressText.textContent = `${Math.floor(state.percent)}% · ${(state.transferred / 2 ** 20).toFixed(1)} / ${(state.total / 2 ** 20).toFixed(1)} MB`;
    dialog.querySelector('.desktop-update-portable').hidden = state.canInstall || state.phase === 'unsupported';
    primary.textContent = state.phase === 'downloaded' ? '重启并安装' : state.retryDownload ? '重试下载' : state.phase === 'available' && state.canInstall ? '下载更新' : state.phase === 'checking' ? '检查中…' : state.phase === 'downloading' ? '下载中…' : state.phase === 'installing' ? '准备安装…' : '检查更新';
    primary.disabled = pending || ['unsupported', 'checking', 'downloading', 'installing'].includes(state.phase);
    badge.hidden = !['available', 'downloading', 'downloaded'].includes(state.phase);
    badge.textContent = state.phase === 'downloaded' ? '更新已就绪' : state.phase === 'downloading' ? `更新 ${Math.floor(state.percent)}%` : '发现新版';
  }
  async function request(action, value) {
    const error = dialog.querySelector('[data-update-error]'); error.hidden = true;
    try { const result = await bridge.updates(action, value); if (!result.ok) throw Error(result.message); render(result.value); }
    catch (reason) { error.textContent = reason.message || '操作未完成，请重试。'; error.hidden = false; }
  }
  async function open() {
    if (!dialog.open) dialog.showModal();
    await request('status');
  }
  badge.addEventListener('click', open);
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
  dialog.querySelector('[data-release]').addEventListener('click', () => { void bridge.action('updates'); });
  check.addEventListener('change', async () => { check.disabled = true; await request('preference', check.checked); check.disabled = false; });
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
