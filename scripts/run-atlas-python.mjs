import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const python = path.join(root, 'work', 'atlas-venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const bootstrap = path.join(root, 'scripts', 'atlas-python-bootstrap.py');
const result = spawnSync(python, [bootstrap, ...process.argv.slice(2)], { cwd: root, stdio: 'inherit', windowsHide: true });
if (result.error) console.error(`Atlas Python environment unavailable: ${result.error.message}`);
process.exit(result.status ?? 1);
