import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {runtimePackages, stageRuntimePackages} from './lib/desktop-runtime-dependencies.mjs';
import {verifyProjectAssets} from './lib/project-assets.mjs';
const root = path.resolve(import.meta.dirname, '..'), stage = path.join(root, 'work/desktop-stage/app');
const lock = JSON.parse(await fs.readFile(path.join(root,'desktop/resources.lock.json'),'utf8'));
const release = JSON.parse(await fs.readFile(path.join(root,'desktop/resource-release.json'),'utf8'));
if (release.resourceLockId !== createHash('sha256').update(JSON.stringify(lock)).digest('hex')) throw Error('Resource Release does not match the desktop resource lock');
// Only this generated staging directory may be replaced. Never walk work/ or .local/.
if (path.relative(root, stage) !== path.join('work', 'desktop-stage', 'app')) throw Error('Unsafe staging path');
await fs.rm(stage, {recursive: true, force: true});
await fs.mkdir(stage, {recursive: true});
const tracked = execFileSync('git', ['ls-files', '-z', '--', 'site'], {cwd: root}).toString().split('\0').filter(Boolean);
const deleted = new Set(execFileSync('git', ['ls-files', '-z', '--deleted', '--', 'site'], {cwd: root}).toString().split('\0').filter(Boolean));
const exclude = /^(?:site\/(?:loot|encyclopedia)\.html|site\/vendor\/ocr\/|site\/data\/(?:encyclopedia|loot-scanner)\/)/;
const files = tracked.filter(f => !deleted.has(f) && !exclude.test(f));
// Runtime assets are intentionally untracked; build only the locked allowlist.
const assetLock = JSON.parse(await fs.readFile(path.join(root, 'resources/project-assets.lock.json'), 'utf8'));
await verifyProjectAssets(root, assetLock, 'runtime');
files.push(...assetLock.files.filter(entry => entry.group === 'runtime' && !exclude.test(entry.path)).map(entry => entry.path));
for (const name of ['main.mjs', 'policy.mjs', 'resources.mjs', 'local-resources.mjs', 'release-resources.mjs', 'release-pack-cache.mjs', 'screenshot-access.mjs', 'updates.mjs', 'update-release.mjs', 'preload.cjs', 'resources.lock.json', 'resource-release.json']) files.push('desktop/' + name);
for (const name of ['map-cache-plan.mjs', 'market-prices.mjs']) files.push('scripts/lib/' + name);
for (const name of ['desktop-shell.js', 'desktop-shell.css', 'desktop-updates.js', 'atlas-screenshot-directory.js', 'filing-footer.js', 'images/police-filing.png']) if (!files.includes('site/' + name)) files.push('site/' + name);
files.push('THIRD_PARTY_NOTICES.txt', 'data/spt/5.0.0-1ee2b75/LICENSE.txt', 'data/tasks/20261013-901f569/raw/spt/LICENSE');
files.push('LICENSE', 'NOTICE', 'desktop/runtime-NOTICES.txt');
files.push('site/task-asset-url.js', 'site/task-access-data.js', 'site/atlas-map-entry.js', 'site/atlas-resource-request.js', 'site/atlas-map-diagnostics.js', 'site/atlas-measurement.js');
const inventory = [];
for (const relative of [...new Set(files)].sort()) {
  const source = path.join(root, relative), target = path.join(stage, relative), stat = await fs.lstat(source);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error(`Not a regular file: ${relative}`);
  const data = await fs.readFile(source);
  await fs.mkdir(path.dirname(target), {recursive: true}); await fs.writeFile(target, data);
  inventory.push({path: relative, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex')});
}
const {devDependencies, scripts, ...pkg} = JSON.parse(await fs.readFile(path.join(root, 'desktop/package.json'), 'utf8'));
pkg.main = 'desktop/main.mjs';
await fs.writeFile(path.join(stage, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
const runtimeDependencies = await runtimePackages(path.join(root, 'desktop'));
await stageRuntimePackages(path.join(root, 'desktop'), stage, runtimeDependencies);
await fs.writeFile(path.join(stage, 'build-inventory.json'), JSON.stringify({version: pkg.version, files: inventory, runtimeDependencies}, null, 2) + '\n');
console.log(`Staged ${inventory.length} files and ${runtimeDependencies.length} runtime packages. No build dependencies or private work files.`);
