const downloadLink = document.querySelector('a.client-download');

if (downloadLink && /^https?:$/.test(location.protocol) && typeof HTMLDialogElement !== 'undefined' &&
    typeof HTMLDialogElement.prototype.showModal === 'function') {
  const dialog = document.createElement('dialog');
  dialog.id = 'clientDownloadDialog';
  dialog.className = 'client-download-dialog';
  dialog.setAttribute('aria-labelledby', 'clientDownloadTitle');
  dialog.innerHTML = `
    <div class="client-download-dialog-head">
      <h2 id="clientDownloadTitle">下载 Windows 客户端</h2>
      <button type="button" aria-label="关闭下载窗口" autofocus>×</button>
    </div>
    <div class="client-download-options">
      <a data-quark target="_blank" rel="noopener noreferrer">夸克网盘下载</a>
      <a href="https://github.com/Redpred/tarkov-loot-map/releases/tag/desktop-v1.4.0-alpha.20" target="_blank" rel="noopener noreferrer">GitHub Release 下载</a>
    </div>`;
  dialog.querySelector('[data-quark]').href = downloadLink.href;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = downloadLink.className;
  button.setAttribute('aria-label', '下载客户端');
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-controls', dialog.id);
  button.setAttribute('aria-expanded', 'false');
  button.append(...downloadLink.childNodes);
  document.body.append(dialog);
  downloadLink.replaceWith(button);

  button.addEventListener('click', () => {
    dialog.showModal();
    button.setAttribute('aria-expanded', 'true');
  });
  dialog.querySelector('button').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    button.setAttribute('aria-expanded', 'false');
    button.focus({preventScroll: true});
  });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') event.stopPropagation();
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) {
      dialog.close();
    }
  });
}
