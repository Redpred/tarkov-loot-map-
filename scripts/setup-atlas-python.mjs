import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {setGlobalProxyFromEnv} from 'node:http';

const root = path.resolve(import.meta.dirname, '..');
const {values} = parseArgs({options: {
  python: {type: 'string', default: 'python'},
  venv: {type: 'string', default: 'work/atlas-venv'},
  'wheel-dir': {type: 'string'},
}});

async function main() {
  if (process.versions.node !== '24.22.1') throw Error('Run with the project Node.js 24.22.1 runtime.');
  setGlobalProxyFromEnv();
  const venv = path.resolve(root, values.venv), work = path.join(root, 'work');
  const relative = path.relative(work, venv);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('The Atlas environment must be a subdirectory of work/.');
  // Never install through a symlink/junction into another environment.
  let current = root;
  for (const part of path.relative(root, venv).split(path.sep)) {
    current = path.join(current, part);
    try {
      const stat = await fs.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Environment path must contain only real directories.');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const python = path.join(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const run = (executable, args, capture = false) => {
    const result = spawnSync(executable, args, {cwd: root, windowsHide: true, encoding: 'utf8',
      stdio: capture ? 'pipe' : 'inherit', env: {...process.env, PYTHONIOENCODING: 'utf-8', PIP_CONFIG_FILE: process.platform === 'win32' ? 'NUL' : '/dev/null'}});
    if (result.error) throw result.error;
    if (result.status !== 0) throw Error(`Python setup failed (${result.status}): ${capture ? result.stderr.trim() : 'see output above'}`);
    return result.stdout;
  };
  try { await fs.access(python); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // Do not silently adopt an unrelated nonempty directory.
    const entries = await fs.readdir(venv).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    if (entries.length) throw Error('Environment directory is nonempty but has no Python executable. Select a new work/ subdirectory.');
    run(values.python, ['-I', '-m', 'venv', venv]);
  }
  const info = JSON.parse(run(python, ['-I', '-c', 'import json,sys; print(json.dumps({"prefix":sys.prefix,"base":sys.base_prefix,"version":list(sys.version_info[:3])}))'], true));
  if (path.resolve(info.prefix).toLowerCase() !== venv.toLowerCase() || info.prefix === info.base) throw Error('Refusing to install outside the selected virtual environment.');
  if (info.version[0] !== 3 || info.version[1] < 10) throw Error('Atlas setup requires Python 3.10 or newer; Python 3.12 is tested.');
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'scripts/atlas-python-wheels.json'), 'utf8'));
  const packages = Object.entries(manifest).filter(([name]) => name !== 'truststore' || process.platform === 'win32');
  const installed = JSON.parse(run(python, ['-I', '-c', `import importlib.metadata as m,json,pathlib,sys
root=pathlib.Path(sys.prefix).resolve()
packages={}
for d in m.distributions():
    name=d.metadata["Name"].lower()
    local=pathlib.Path(d.locate_file("")).resolve().is_relative_to(root)
    if name not in packages or local:
        packages[name]={"version":d.version,"local":local}
print(json.dumps(packages))`], true));
  const meets = (actual, minimum) => {
    if (!/^\d+(?:\.\d+)*$/.test(actual || '')) return false;
    const a = actual.split('.').map(Number), b = minimum.split('.').map(Number);
    for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
    return true;
  };
  const needed = packages.filter(([name, wheel]) => !installed[name]?.local || !meets(installed[name].version, wheel.version));
  const cache = path.resolve(root, values['wheel-dir'] || 'work/atlas-python-wheels');
  if (!values['wheel-dir']) await fs.mkdir(cache, {recursive: true});
  const wheels = [];
  for (const [, wheel] of needed) {
    const file = path.join(cache, wheel.filename);
    let bytes;
    try { bytes = await fs.readFile(file); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (values['wheel-dir']) throw Error(`Offline wheel is missing: ${wheel.filename}`);
      console.log(`Downloading verified bootstrap wheel: ${wheel.filename}`);
      const response = await fetch(wheel.url, {redirect: 'error', signal: AbortSignal.timeout(60000)})
        .catch(error => { throw Error(`Wheel download failed: ${wheel.filename} (${error.message}). You can provide --wheel-dir for offline setup.`); });
      if (!response.ok) throw Error(`Wheel download failed: ${wheel.filename} (HTTP ${response.status})`);
      bytes = Buffer.from(await response.arrayBuffer());
      if (createHash('sha256').update(bytes).digest('hex') !== wheel.sha256) throw Error(`Wheel SHA-256 mismatch: ${wheel.filename}`);
      await fs.writeFile(file, bytes, {flag: 'wx'});
    }
    if (createHash('sha256').update(bytes).digest('hex') !== wheel.sha256) throw Error(`Wheel SHA-256 mismatch: ${wheel.filename}`);
    wheels.push(file);
  }
  if (wheels.length) {
    if (!installed.pip) run(python, ['-I', '-m', 'ensurepip', '--upgrade']);
    // Old pip is allowed only for these verified local wheels. No index, dependency
    // resolution, source builds, cache or version-check network requests are used.
    run(python, ['-I', '-m', 'pip', '--isolated', '--disable-pip-version-check', 'install',
      '--no-index', '--no-deps', '--no-cache-dir', '--only-binary=:all:', '--upgrade', '--force-reinstall', ...wheels]);
  }
  run(python, ['-I', path.join(root, 'scripts/atlas-python-bootstrap.py'), '-m', 'pip', '--version']);
  run(python, ['-I', path.join(root, 'scripts/atlas-python-bootstrap.py'), '-c', 'import ssl,certifi; print("Atlas TLS environment ready")']);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
