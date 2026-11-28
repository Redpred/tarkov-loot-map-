import {projectNotice, dataSources} from './project-notice.js';

const footer = document.querySelector('.site-footer');
if (footer && !document.getElementById('openProjectAbout')) {
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet'; stylesheet.href = new URL('./about.css', import.meta.url).href;
  document.head.append(stylesheet);
  const button = document.createElement('button');
  button.id = 'openProjectAbout'; button.className = 'about-button'; button.type = 'button';
  button.textContent = '关于与声明';
  button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-controls', 'projectAboutDialog');
  button.setAttribute('aria-expanded', 'false');
  footer.append(button); footer.setAttribute('aria-label', '网站备案与项目声明');
  document.documentElement.classList.add('has-project-notice');

  const dialog = document.createElement('dialog');
  dialog.id = 'projectAboutDialog'; dialog.className = 'about-dialog';
  dialog.setAttribute('aria-labelledby', 'projectAboutTitle');
  dialog.innerHTML = '<div class="about-dialog-head"><h2 id="projectAboutTitle">关于塔科夫物资地图</h2><button type="button" aria-label="关闭关于窗口" autofocus>×</button></div>';
  const paragraph = text => { const p = document.createElement('p'); p.textContent = text; dialog.append(p); return p; };
  const heading = text => { const h = document.createElement('h3'); h.textContent = text; dialog.append(h); };
  const link = (label, url) => {
    const a = document.createElement('a'); a.textContent = label; a.href = url;
    a.target = '_blank'; a.rel = 'noopener noreferrer'; a.title = `${label}（新窗口）`; return a;
  };
  paragraph('中文三维物资与任务地图，支持地图浏览、任务规划和本地资源。');
  paragraph('').append(link('GitHub 源码仓库', 'https://github.com/Redpred/tarkov-loot-map'));
  paragraph(projectNotice.independence);
  heading('游戏内容与素材'); paragraph(projectNotice.rights);
  heading('数据来源');
  for (const source of dataSources) {
    const p = paragraph(''); p.append(link(source.name, source.url), `：${source.description}`);
  }
  paragraph(projectNotice.client);
  heading('开源许可'); paragraph(projectNotice.license); paragraph(projectNotice.sptLicense);
  const links = paragraph(''); links.className = 'about-links';
  links.append(link('CC BY-NC-SA 4.0', 'https://creativecommons.org/licenses/by-nc-sa/4.0/'));
  document.body.append(dialog);
  button.addEventListener('click', () => { if (!dialog.open) dialog.showModal(); button.setAttribute('aria-expanded', 'true'); });
  dialog.querySelector('button').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { button.setAttribute('aria-expanded', 'false'); button.focus({preventScroll: true}); });
  dialog.addEventListener('keydown', event => { if (event.key === 'Escape') event.stopPropagation(); });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });
}
