import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..'), require = createRequire(path.join(root, 'desktop/package.json'));
const script = process.argv.includes('--check-updates') ? 'scripts/desktop-published-update-smoke.mjs' : 'scripts/desktop-installed-smoke.mjs';
const child = spawn(require('electron'), [path.join(root, script), ...process.argv.slice(2)],
  {cwd: root, stdio: 'inherit', windowsHide: true});
const timeout = setTimeout(() => { console.error('Installed desktop check timed out'); child.kill(); }, 2400000);
child.on('error', error => { clearTimeout(timeout); console.error(error); process.exitCode = 1; });
child.on('exit', code => { clearTimeout(timeout); process.exitCode = code ?? 1; });
