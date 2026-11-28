const loading = document.getElementById('loading');
const title = loading.querySelector('strong');
const progress = loading.querySelector('.loading-line');
const message = document.getElementById('loadMessage');
const retry = document.createElement('button');
retry.id = 'retryMapLoading';
retry.type = 'button';
retry.textContent = '重新加载地图';
retry.onclick = () => location.reload();

function showFailure(error, fallbackCode, fallbackMessage, url) {
  const failure = error?.diagnosticCode ? error : {diagnosticCode: fallbackCode, message: fallbackMessage, url};
  loading.style.display = '';
  title.textContent = '场景加载失败';
  message.textContent = `${failure.message} · ${failure.diagnosticCode}`;
  progress.hidden = true;
  const actions = document.createElement('div');
  actions.className = 'map-load-actions';
  actions.append(retry);
  loading.append(actions);
  // Keep the error visible even if a dependency of the map program failed to load.
  void import('./atlas-map-diagnostics.js').then(({createMapDiagnosticCopy,formatMapDiagnostic}) => {
    const mapId = new URLSearchParams(location.search).get('map') || document.documentElement.dataset.map;
    const copy = createMapDiagnosticCopy();
    copy.update(formatMapDiagnostic(failure, {mapId}));
    actions.append(copy.button);
  }, () => {});
}

async function bootMap() {
  const slow = setTimeout(() => {
    message.textContent = '地图程序加载较慢，可以重新加载。';
    loading.append(retry);
  }, 20000);
  let startMap;
  try {
    ({startMap} = await import('./factory.js'));
  } catch (error) {
    console.error(error?.diagnosticCode || 'MAP-PROGRAM-LOAD', error);
    showFailure(error, 'MAP-PROGRAM-LOAD', '地图程序加载失败，请检查网络后重试。', 'factory.js');
    return;
  } finally {
    clearTimeout(slow);
  }
  retry.remove();
  try {
    await startMap();
  } catch (error) {
    console.error(error?.diagnosticCode || 'MAP-START', error?.url || '', error);
    showFailure(error, 'MAP-START', '地图资源暂不可用，请重新加载。');
  }
}

void bootMap();
