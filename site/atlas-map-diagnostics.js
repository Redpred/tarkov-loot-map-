export function validDiagnosticCode(code) {
  return typeof code === 'string' && code.length <= 80 && /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/.test(code);
}

export function mapLoadError(diagnosticCode, message, {cause, ...details} = {}) {
  return Object.assign(new Error(message, {cause}), details, {diagnosticCode});
}

export function mapErrorMessage(error) {
  return `${error.message} · ${validDiagnosticCode(error.diagnosticCode) ? error.diagnosticCode : 'MAP-UNKNOWN'}`;
}

const DIRECTORY_ERRORS = new Map([
  ['NotAllowedError', 'STORAGE-PERMISSION'],
  ['SecurityError', 'STORAGE-PERMISSION'],
  ['QuotaExceededError', 'STORAGE-QUOTA'],
  ['NotFoundError', 'STORAGE-MISSING']
]);
export function directoryError(cause, message = cause?.message || '资源目录访问失败') {
  if (validDiagnosticCode(cause?.diagnosticCode)) return cause;
  return mapLoadError(DIRECTORY_ERRORS.get(cause?.name) || 'STORAGE-IO', message, {cause});
}

export function formatMapDiagnostic(error, {mapId, sectorId, mode, scenery} = {}) {
  let asset, version, offset, length;
  if (typeof error.url === 'string') {
    try {
      const url = new URL(error.url, 'https://map.invalid/');
      if (['http:', 'https:', 'tarkov:'].includes(url.protocol) &&
          /^\/(?:data\/[a-zA-Z0-9_./-]+|api\/[a-zA-Z0-9_./-]+|[a-zA-Z0-9_-]+\.js)$/.test(url.pathname)) {
        asset = url.pathname;
        const fingerprint = url.searchParams.get('version') || url.searchParams.get('v');
        if (/^[a-f0-9]{64}$/.test(fingerprint || '')) version = fingerprint;
        const start = url.searchParams.get('offset'), size = url.searchParams.get('length');
        if (/^\d{1,16}$/.test(start || '') && /^\d{1,8}$/.test(size || '')) {
          offset = start;
          length = size;
        }
      }
    } catch {}
  }
  const label = value => typeof value === 'string' && /^[a-z0-9_-]{1,32}$/.test(value) ? value : undefined;
  const positiveInteger = value => Number.isSafeInteger(value) && value > 0 ? value : undefined;
  return [
    ['错误码', validDiagnosticCode(error.diagnosticCode) ? error.diagnosticCode : 'MAP-UNKNOWN'],
    ['来源错误码', validDiagnosticCode(error.sourceCode) ? error.sourceCode : undefined],
    ['上游错误码', validDiagnosticCode(error.upstreamCode) ? error.upstreamCode : undefined],
    ['运行环境', globalThis.location?.protocol === 'tarkov:' ? '桌面客户端' : '网页'],
    ['地图', label(mapId)],
    ['分区', label(sectorId)],
    ['资源模式', label(mode)],
    ['所选场景', label(scenery)],
    ['资源', asset],
    ['资源版本', version],
    ['分块偏移', offset],
    ['分块长度', length],
    ['HTTP', positiveInteger(error.status)],
    ['请求次数', positiveInteger(error.attempts)]
  ].filter(([, value]) => value !== undefined).map(([name, value]) => `${name} ${value}`).join('\n');
}

export function createMapDiagnosticCopy() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'map-diagnostic-copy';
  button.textContent = '复制诊断';
  button.hidden = true;
  let report = '', copying = false;
  button.onclick = async () => {
    const text = report;
    if (!text || copying) return;
    copying = true;
    try {
      await navigator.clipboard.writeText(text);
      if (report === text) button.textContent = '已复制';
    } catch {
      if (report !== text || !button.isConnected) return;
      const dialog = document.createElement('dialog');
      dialog.className = 'view-dialog map-diagnostic-dialog';
      dialog.setAttribute('aria-label', '手动复制诊断信息');
      dialog.innerHTML = '<p>请复制下方诊断信息</p><textarea rows="9" readonly aria-label="诊断信息"></textarea><button type="button">关闭</button>';
      document.body.append(dialog);
      const field = dialog.querySelector('textarea');
      field.value = text;
      dialog.querySelector('button').onclick = () => dialog.close();
      dialog.addEventListener('close', () => dialog.remove(), {once: true});
      dialog.showModal();
      field.focus();
      field.select();
    } finally {
      copying = false;
    }
  };
  return {
    button,
    update(text = '') {
      if (report === text) return;
      report = text;
      button.hidden = !text;
      button.textContent = '复制诊断';
    }
  };
}
