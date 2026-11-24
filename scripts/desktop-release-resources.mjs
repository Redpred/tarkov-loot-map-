import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ATLAS_MAPS} from '../site/atlas-maps.js';
import {projectNoticeText} from '../site/project-notice.js';
import {buildDesktopArchive} from './desktop-archive.mjs';
import {ARCHIVE_CHUNK, archiveDigest as hash, archiveId} from './lib/desktop-resource-archive.mjs';
import {createReleaseZip} from './lib/release-zip.mjs';
import {resourceDownloadScript} from './lib/resource-download-script.mjs';

export const RELEASE_PACK_LIMIT = 1900 * 2**20;
export async function buildReleaseResources({archiveRoot, lock, out, repository = 'Redpred/tarkov-loot-map', tag = `resources-${archiveId(lock)}-r2`, onProgress = () => {}, packLimit = RELEASE_PACK_LIMIT}) {
  if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,127}$/.test(tag)) throw Error('Invalid release destination');
  if (!Number.isSafeInteger(packLimit) || packLimit < 1024 || packLimit > RELEASE_PACK_LIMIT) throw Error('Invalid pack limit');
  const archive = await buildDesktopArchive({siteRoot: path.join(path.dirname(path.resolve(archiveRoot)), 'unused-verification-site'), archiveRoot, lock, verifyOnly: true, onProgress});
  await fs.mkdir(out); // Immutable output: do not overwrite an already prepared release.
  const id = archiveId(lock), groups = new Map(), objects = new Set(), models = new Set();
  function add(group, entry) { if (!groups.has(group)) groups.set(group, []); groups.get(group).push(entry); }
  const maps = Object.values(ATLAS_MAPS).sort((a,b) => b.textureBase.length-a.textureBase.length);
  const owners = new Map();
  const fileGroup = name => (name.startsWith('data/atlas/') ? maps.find(map => name.startsWith(map.textureBase))?.id : /^data\/(?:model-quality|geometry-quality|scenery-details)\/([a-z_]+)\//.exec(name)?.[1]) || 'shared';
  for (const [name, [version]] of Object.entries(lock.files)) {
    if (!owners.has(version)) owners.set(version, new Set()); owners.get(version).add(fileGroup(name));
  }
  for (const [name, [version, size]] of Object.entries(lock.files)) {
    if (objects.has(version)) continue; objects.add(version);
    const group = owners.get(version).size > 1 ? 'shared' : fileGroup(name);
    add(group, {key: version, file: `objects/${version}`, expectedHash: version, expectedSize: size, kind: 'objects'});
  }
  const modelOwners = new Map();
  for (const [route, [version]] of Object.entries(lock.geometry)) {
    if (!modelOwners.has(version)) modelOwners.set(version, new Set()); modelOwners.get(version).add(/^api\/([a-z_]+)-geometry/.exec(route)[1]);
  }
  for (const [route, [version, total]] of Object.entries(lock.geometry)) {
    if (models.has(version)) continue; models.add(version);
    const mapId = /^api\/([a-z_]+)-geometry/.exec(route)[1];
    for (let offset = 0; offset < total; offset += ARCHIVE_CHUNK) {
      const key = `${version}/${offset}-${Math.min(ARCHIVE_CHUNK,total-offset)}`;
      add(modelOwners.get(version).size > 1 ? 'shared' : mapId, {key, file: `chunks/${key}.gz`, kind: 'chunks'});
    }
  }
  const index = {schemaVersion: 1, resourceLockId: id, layout: 'client-directory-gzip-v1', packs: [], objects: {}, chunks: {}};
  const extras = [
    ['map-resources/client-resources.json', Buffer.from('{"schemaVersion":1,"type":"tarkov-client-resources"}\n')],
    ['map-resources/RESOURCE_README.txt', Buffer.from(`塔科夫物资地图资源\n\n适用于 1.4.0-alpha.14 及以后兼容版本。先安装客户端。关闭客户端后，把所有所需 ZIP 中的 map-resources 合并到客户端安装目录；不要额外套一层文件夹。\n公共包 shared 必须下载一次；选中的地图若有多个编号，须全部下载并逐个解压到同一位置。每个 ZIP 都可独立解压，不是 7z 分卷。全部地图/全部画质请下载全部 ZIP。无需下载或复制索引文件。原有默认资源保留，同名内容可覆盖。\n\n资源版本：${id}\n\n${projectNoticeText()}\n`)]
  ];
  const extraSize = extras.reduce((n,[name,data]) => n+data.length+76+2*Buffer.byteLength(name),22);
  for (const [group, entries] of [...groups].sort(([a],[b]) => a.localeCompare(b))) {
    let zip, name, number = 0, indexId, overhead = 22;
    async function finish() {
      if (!zip) return;
      index.packs.push({name, group, ...await zip.finish()}); zip = null;
      if (index.packs.at(-1).bytes > packLimit) throw Error('ZIP exceeded release pack limit');
      onProgress({phase: 'packs', completed: index.packs.length, group});
    }
    try {
      for (const entry of entries) {
        const bytes = await fs.readFile(path.join(archiveRoot, entry.file)), sha256 = hash(bytes);
        if (entry.expectedHash && (sha256 !== entry.expectedHash || bytes.length !== entry.expectedSize)) throw Error('Archive object changed during packaging');
        const memberName = 'map-resources/' + entry.file;
        const needed = bytes.length + 76 + 2*Buffer.byteLength(memberName);
        if (needed + extraSize > packLimit) throw Error(`Resource exceeds pack limit: ${entry.file}`);
        if (zip && zip.size + overhead + needed > packLimit) { await finish(); overhead = 22; }
        if (!zip) {
          if (index.packs.length >= 950) throw Error('Too many GitHub release assets');
          name = `resources-${group}-${String(++number).padStart(3,'0')}.zip`; indexId = index.packs.length;
          zip = await createReleaseZip(path.join(out, name));
          for (const [extraName, data] of extras) { await zip.add(extraName,data); overhead += 46 + Buffer.byteLength(extraName); }
        }
        const offset = await zip.add(memberName, bytes); overhead += 46 + Buffer.byteLength(memberName);
        index[entry.kind][entry.key] = [indexId, offset, bytes.length, sha256];
      }
      await finish();
    } finally { await zip?.close(); }
  }
  const bytes = Buffer.from(JSON.stringify(index) + '\n'), descriptor = {schemaVersion: 1, resourceLockId: id, repository, tag, index: {name: 'resources-index.json', sha256: hash(bytes), bytes: bytes.length}};
  await fs.writeFile(path.join(out, 'resources-index.json'), bytes, {flag: 'wx'});
  await fs.writeFile(path.join(out, 'resource-release.json'), JSON.stringify(descriptor,null,2)+'\n', {flag: 'wx'});
  await fs.writeFile(path.join(out, 'SHA256SUMS.txt'), [...index.packs.map(pack=>`${pack.sha256}  ${pack.name}`),`${descriptor.index.sha256}  resources-index.json`].join('\n')+'\n', {flag: 'wx'});
  const base = `https://github.com/${repository}/releases/download/${tag}/`;
  const rows = [...groups.keys()].sort().map(group => {
    const packs=index.packs.filter(pack=>pack.group===group);
    const label = ATLAS_MAPS[group]?.name || (group === 'shared' ? '公共资源' : group);
    return `| ${label} (${group}) | ${packs.length} | ${(packs.reduce((n,p)=>n+p.bytes,0)/2**30).toFixed(2)} GiB | ${packs.map(p=>`[${p.name}](${base}${p.name})`).join('、')} |`;
  });
  await fs.writeFile(path.join(out,'Download-Resources.ps1'), resourceDownloadScript(index.packs,base), {flag:'wx'});
  const notes = `# 地图资源整合包\n\n普通使用只需下载桌面版离线 EXE，默认资源已包含在安装包中。本页用于补齐其他画质或离线保存全部资源。\n\n## 手动下载与安装\n\n可直接点击下面的 ZIP 链接。需要一次下载全部时，可保存同页 [Download-Resources.ps1](${base}Download-Resources.ps1)，右键“使用 PowerShell 运行”；支持断点续传，自动核验 SHA-256，已下载且完整的文件会跳过。也可用 -Map factory 等参数只下载公共包和所选地图。脚本只下载到旁边的 downloaded-resources，不安装或删除文件。\n\n1. 公共资源 shared 下载一次，再下载所需地图的全部编号 ZIP；下载全部地图则保存下表全部 ZIP。\n2. 安装 1.4.0-alpha.14 或以后兼容客户端，并关闭客户端。\n3. 逐个解压 ZIP，将其中的 map-resources 文件夹合并到客户端安装目录；例如最终应为 安装目录/map-resources/client-resources.json。不要额外套一层同名文件夹。同名资源可覆盖。若已更改资源位置，将 ZIP 内 map-resources 的内容合并到设置显示的资源目录。\n4. 打开客户端即可读取；无需 Node.js、Python 或额外导入工具，也无需手动下载索引和校验清单。\n\n每个 ZIP 可独立解压，最大 1,900 MiB，下载不齐只影响未补齐的资源。客户端自动按需下载仍然可用。\n\n| 地图 | ZIP 数量 | 下载大小 | 下载链接 |\n| --- | ---: | ---: | --- |\n${rows.join('\n')}\n\n资源版本：\`${id}\`。ZIP 和索引均有 SHA-256 校验；资源布局为 client-directory-gzip-v1。保留已发布版本，不覆盖旧附件。源码自动 ZIP 不包含这些资源。\n\n## 版权、关系与来源\n\n${projectNoticeText()}\n`;
  await fs.writeFile(path.join(out, 'RELEASE_NOTES.md'), notes, {flag: 'wx'});
  const result = {archive, descriptor, packs: index.packs.length, bytes: index.packs.reduce((n,p)=>n+p.bytes,0), objects: objects.size, chunks: Object.keys(index.chunks).length};
  await fs.writeFile(path.join(out, 'verification.json'), JSON.stringify(result,null,2)+'\n', {flag: 'wx'});
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(import.meta.dirname,'..'), args = process.argv.slice(2), read = (name, fallback) => args.includes(name) ? args[args.indexOf(name)+1] : fallback;
  const lock = JSON.parse(await fs.readFile(path.resolve(read('--lock',path.join(root,'desktop/resources.lock.json'))),'utf8'));
  const tag = read('--tag',`resources-${archiveId(lock)}-r2`);
  let last = 0;
  const result = await buildReleaseResources({lock, tag, repository: read('--repository','Redpred/tarkov-loot-map'), archiveRoot: path.resolve(read('--archive',path.join(root,'work/desktop-resource-archive'))), out: path.resolve(read('--out',path.join(root,'dist',tag))), onProgress: value => { if (Date.now()-last>15000) { console.log(JSON.stringify(value)); last=Date.now(); } }});
  console.log(JSON.stringify(result));
}
