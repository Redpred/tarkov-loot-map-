import {spawn} from 'node:child_process';
import path from 'node:path';
import {createRequire} from 'node:module';
const root = path.resolve(import.meta.dirname, '..'), require = createRequire(path.join(root, 'desktop/package.json'));
const child = spawn(require('electron'), [path.join(root, 'scripts/desktop-smoke.mjs'), ...process.argv.slice(2)], {cwd: root, stdio: 'inherit', windowsHide: true});
const timeout = setTimeout(() => { console.error('Desktop smoke process timeout'); child.kill(); }, process.argv.includes('--map') || process.argv.includes('--integration') ? 600000 : 200000);
child.on('error', error => { clearTimeout(timeout); console.error(error); process.exitCode = 1; });
child.on('exit', code => { clearTimeout(timeout); process.exitCode = code ?? 1; });
