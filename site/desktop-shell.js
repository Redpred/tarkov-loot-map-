import {createDesktopUpdateUI} from './desktop-updates.js';
// Desktop window chrome only; every product page remains the shared website page.
if (globalThis.tarkovDesktop && window.top === window) {
  document.documentElement.dataset.desktopShell = '';
  const bar = document.createElement('div'); bar.id = 'desktopTitlebar'; bar.setAttribute('aria-label', '应用标题栏');
  bar.innerHTML = `<button type="button" aria-label="应用菜单" aria-expanded="false" popovertarget="desktopAppMenu"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14M5 12h14M5 18h14"/></svg></button><img src="app-icon-192.png" alt=""><span class="desktop-title">塔科夫物资地图</span><span class="desktop-edition">桌面版</span>`;
  const menu = document.createElement('div'); menu.id = 'desktopAppMenu'; menu.setAttribute('popover', 'auto'); menu.setAttribute('aria-label', '应用菜单');
  menu.innerHTML = `<button data-action="updates"><span class="desktop-menu-icon" aria-hidden="true">↗</span>检查更新</button><hr><button data-action="reload"><span class="desktop-menu-icon" aria-hidden="true">↻</span>重新加载<kbd>Ctrl R</kbd></button><button data-action="fullscreen"><span class="desktop-menu-icon" aria-hidden="true">⛶</span>切换全屏<kbd>F11</kbd></button><hr><button data-action="data"><span class="desktop-menu-icon" aria-hidden="true">▱</span>用户数据文件夹</button><button data-action="about"><span class="desktop-menu-icon" aria-hidden="true">ⓘ</span>关于</button><div class="desktop-menu-footer">本地保存 · 与网站共用界面</div>`;
  document.documentElement.append(bar, menu);
  const updates = createDesktopUpdateUI(globalThis.tarkovDesktop, bar);
  // Keep fixed chrome outside the transformed, scrolling page body.
  const footer = document.querySelector('body > .site-footer');
  if (footer) document.documentElement.append(footer);
  const toggle = bar.querySelector('button');
  menu.addEventListener('toggle', event => { toggle.setAttribute('aria-expanded', String(event.newState === 'open')); if (event.newState === 'open') menu.querySelector('button').focus(); });
  menu.addEventListener('keydown', event => {
    const buttons = [...menu.querySelectorAll('button')], at = buttons.indexOf(document.activeElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus(); }
  });
  menu.addEventListener('click', event => { const action = event.target.closest('button')?.dataset.action; if (!action) return; menu.hidePopover(); toggle.focus(); if (action === 'updates') void updates.open(); else void globalThis.tarkovDesktop.action(action); });
  globalThis.tarkovDesktop.onFullscreen(full => { document.documentElement.toggleAttribute('data-desktop-fullscreen', full); });
}
