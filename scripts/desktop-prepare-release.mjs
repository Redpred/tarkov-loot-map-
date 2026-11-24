// Prepare a reviewable local release directory. No GitHub writes or publication.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {projectNoticeText} from '../site/project-notice.js';
const root = path.resolve(import.meta.dirname, '..'), output = path.resolve(root, process.argv[2] || 'dist/desktop');
const pkg = JSON.parse(await fs.readFile(path.join(root, 'desktop/package.json'), 'utf8'));
const resourceRelease = JSON.parse(await fs.readFile(path.join(root,'desktop/resource-release.json'),'utf8'));
assert.match(pkg.version, /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/);
execFileSync(process.execPath, [path.join(root, 'scripts/desktop-verify-package.mjs'), output, process.argv[3] || output], {cwd: root, stdio: 'inherit', windowsHide: true});
const verification = JSON.parse(await fs.readFile(path.join(output, 'package-verification.json'), 'utf8'));
assert.equal(verification.version, pkg.version); assert.equal(verification.installerPayloadMatched, true);
const directory = path.join(output, 'releases', pkg.version);
await fs.mkdir(path.dirname(directory), {recursive: true});
// An existing release is immutable: use a new version instead of overwriting it.
await fs.mkdir(directory);
await fs.copyFile(path.join(output, verification.installerName), path.join(directory, verification.installerName), fs.constants.COPYFILE_EXCL);
const checksums = [`${verification.installerSha256}  ${verification.installerName}`];
for (const name of ['latest.yml', verification.installerName + '.blockmap', ...(verification.offlineResources ? ['offline-bundle.json', 'offline-profile.json'] : [])]) {
  const data = await fs.readFile(path.join(output, name));
  await fs.writeFile(path.join(directory, name), data, {flag: 'wx'});
  checksums.push(`${createHash('sha256').update(data).digest('hex')}  ${name}`);
}
await fs.writeFile(path.join(directory, 'SHA256SUMS.txt'), checksums.join('\n') + '\n', {flag: 'wx'});
await fs.copyFile(path.join(output, 'package-verification.json'), path.join(directory, 'package-verification.json'), fs.constants.COPYFILE_EXCL);
const notes = `# 塔科夫物资地图 ${pkg.version} · Windows 预览版

支持 Windows 10/11 x64，与网站共用首页、三维地图、任务和设置界面。本版包含现代标题栏、离线地图下载、截图定位、微信/支付宝/爱发电赞助入口、关于声明和 ICP 备案页脚，并移除了旧二维功能。

${verification.offlineResources ? '本安装包已内置 13 张地图的默认资源：低档模型、中档贴图、完整场景。只下载这一个 EXE，安装后即可离线使用，无需另外下载资源包。其他画质选项继续保留，使用前需补充对应资源。安装及临时解压建议预留 10 GiB。' : '这是仅含程序与基础数据的开发构建，未预装地图模型和贴图，使用前需要取得匹配资源；面向普通用户的主要下载应选择默认资源离线版。'}

安装包和可选资源以 GitHub Releases 为主要下载渠道。旧资源 Release 须长期保留；未公开时不能保证其他画质在线补齐。

需要手动补齐其他画质时，见[地图资源整合包](https://github.com/${resourceRelease.repository}/releases/tag/${resourceRelease.tag})：先下载 shared 公共包，再下载所需地图的全部编号 ZIP。关闭客户端，将各 ZIP 内的 map-resources 合并到安装目录即可，无需导入工具。默认画质不需要这一步。

## 安装与更新

1. 下载同页的 \`${verification.installerName}\`；可选下载 \`SHA256SUMS.txt\` 核验文件。
2. 在 PowerShell 中运行 \`Get-FileHash .\\${verification.installerName} -Algorithm SHA256\`，与校验文件比较。
3. 首次运行安装包，或从 alpha.8 及更早版本手动覆盖安装。安装本版后可在应用菜单“检查更新”中使用自动更新。无需额外安装 Node.js 或 Python。
4. 默认使用程序同目录下的 map-resources 文件夹，无需选择位置。${verification.offlineResources ? '默认画质资源已安装；首次使用直接打开地图即可。已有用户若曾更改目录或画质，请切回客户端目录及低模型/中贴图。' : '通过设置或应用菜单“离线地图”完成所需地图和画质的下载，再断网使用。'}

设置和任务进度保存在本机用户目录，卸载默认保留。地图资源默认位于程序旁的 map-resources 文件夹，升级和卸载保留；可在设置中更改位置。截图定位只读取文件名和修改时间，不上传截图。

安装版默认启动后检查更新，每 6 小时再次检查，发现新版后自动下载；由用户点击“重启并安装”完成升级，普通关闭不触发安装。可关闭自动检查与下载并使用手动检查。免安装运行只检查版本，自动安装需要先运行安装包。更新文件由 GitHub Releases 提供并校验 SHA-512；资源 Release 不参与应用版本检查。公开发布本 Release 时必须一并提供安装包、latest.yml 和 blockmap，草稿或私有仓库不能作为普通用户的更新源。

## 版权与来源

${projectNoticeText()}

## 预览范围

自有源码采用 MIT，安装包内附 LICENSE、NOTICE 和第三方说明；游戏模型、贴图、图标、任务数据及其他第三方内容不在这项授权内。安装包尚未代码签名。当前文件用于本地审查；第三方资源分发范围和正式公开流程仍待确定，准备此目录不代表已经发布。

已通过的检查以随附 \`package-verification.json\` 为准。原生目录授权、真实游戏截图、不同电脑安装及签名还需单独验收；实时价格和外部链接需要网络。

第三方来源与许可证见随包 \`THIRD_PARTY_NOTICES.txt\`。
`;
await fs.writeFile(path.join(directory, 'RELEASE_NOTES.md'), notes, {flag: 'wx'});
console.log(JSON.stringify({version: pkg.version, directory, installer: verification.installerName, sha256: verification.installerSha256, published: false}));
