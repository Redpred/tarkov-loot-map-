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
if (!verification.offlineResources) {
  const serverManifest = {schemaVersion: 1, kind: 'program', version: pkg.version,
    installer: {name: verification.installerName, size: verification.installerBytes, sha512: verification.installerSha512}};
  await fs.writeFile(path.join(directory, 'server-latest.json'), JSON.stringify(serverManifest, null, 2) + '\n', {flag: 'wx'});
}
const notes = `# 塔科夫物资地图 ${pkg.version} · Windows 预览版

支持 Windows 10/11 x64，与网站共用首页、三维地图、任务和设置界面。客户端可直接读取随安装包提供的地图资源，并支持截图定位和本地保存设置与任务进度。

${verification.offlineResources ? '本安装包内置 13 张地图的低档模型、长边最多 128 像素的贴图和完整装饰。运行这个 EXE 安装后，即可按默认设置离线打开地图。安装及临时解压建议预留 10 GiB。' : '此程序包用于升级已安装的客户端，复用磁盘上的地图模型和贴图。首次安装请使用完整离线包。'}

需要手动补充缺失资源时，可使用匹配的[地图资源整合包](https://github.com/${resourceRelease.repository}/releases/tag/${resourceRelease.tag})。下载 shared 公共包与所需地图的全部编号 ZIP 后，关闭客户端，将 ZIP 中的 map-resources 合并到安装目录。

## 安装与更新

1. 下载同页的 \`${verification.installerName}\`；可选下载 \`SHA256SUMS.txt\` 核验文件。
2. 在 PowerShell 中运行 \`Get-FileHash .\\${verification.installerName} -Algorithm SHA256\`，与校验文件比较。
3. 从 alpha.18 及更早版本接入服务器更新时，手动覆盖安装一次。之后可在“设置 → 客户端更新”中检查更新。无需额外安装 Node.js 或 Python。
4. 默认从程序同目录下的 map-resources 读取。${verification.offlineResources ? '曾更改资源位置的用户可在设置中选回安装目录。' : '使用前请将匹配的地图资源合并到此目录。'}

设置和任务进度保存在本机用户目录，卸载默认保留。地图资源默认位于程序旁的 map-resources 文件夹，升级和卸载保留；可在设置中更改位置。截图定位只读取文件名和修改时间，不上传截图。

客户端默认启动后向服务器检查版本，有新版时弹窗提示。你可以选择下载更新，下载完成后再点“重启并安装”。在“客户端更新”中关闭启动检查后，仍可手动检查。免安装版可检查版本，自动安装需要先运行安装包。服务器通过独立程序包提供更新，客户端下载后校验 SHA-512。

## 版权与来源

${projectNoticeText()}

## 预览范围

自有源码采用 MIT，安装包内附 LICENSE、NOTICE 和第三方说明；游戏模型、贴图、图标、任务数据及其他第三方内容不在这项授权内。安装包尚未代码签名。当前文件用于本地审查；第三方资源分发范围和正式公开流程仍待确定，准备此目录不代表已经发布。

已通过的检查以随附 \`package-verification.json\` 为准。原生目录授权、真实游戏截图、不同电脑安装及签名还需单独验收；实时价格和外部链接需要网络。

第三方来源与许可证见随包 \`THIRD_PARTY_NOTICES.txt\`。
`;
await fs.writeFile(path.join(directory, 'RELEASE_NOTES.md'), notes, {flag: 'wx'});
console.log(JSON.stringify({version: pkg.version, directory, installer: verification.installerName, sha256: verification.installerSha256, published: false}));
