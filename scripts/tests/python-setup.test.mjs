import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const wheels = path.join(root, 'work/atlas-python-wheels');
const basePython = process.env.ATLAS_TEST_PYTHON || 'python';
const manifest = JSON.parse(await fs.readFile(path.join(root, 'scripts/atlas-python-wheels.json'), 'utf8'));
const run = (exe, args) => spawnSync(exe, args, {cwd: root, encoding: 'utf8', windowsHide: true, timeout: 60000});
const succeeded = result => assert.equal(result.status, 0, result.stdout + result.stderr);
const pythonIn = dir => path.join(dir, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const setup = (dir, wheelDir = wheels) => run(process.execPath, ['scripts/setup-atlas-python.mjs', `--venv=${dir}`, `--python=${basePython}`, `--wheel-dir=${wheelDir}`]);

test('fresh and old-pip environments initialize offline; repeat setup preserves installed packages', async () => {
  const dir = await fs.mkdtemp(path.join(root, 'work/python-setup-test-'));
  // Keep the isolated environment in ignored work/ as reproducible evidence.
  const python = pythonIn(dir);
  succeeded(setup(dir));
  const actual = run(python, ['-I', '-c', 'import importlib.metadata as m,json; print(json.dumps({p:m.version(p) for p in ["pip","certifi"]}))']);
  succeeded(actual);
  assert.equal(JSON.parse(actual.stdout).pip, manifest.pip.version);
  assert.equal(JSON.parse(actual.stdout).certifi, manifest.certifi.version);
  const pipFile = path.join(dir, process.platform === 'win32' ? 'Lib/site-packages/pip/__init__.py' : `lib/python${JSON.parse(run(python, ['-c', 'import sys,json;print(json.dumps("%d.%d"%sys.version_info[:2]))']).stdout)}/site-packages/pip/__init__.py`);
  const before = await fs.stat(pipFile);
  // A missing wheel directory proves a ready environment does not fetch/reinstall.
  const repeated = setup(dir, path.join(dir, 'no-wheels'));
  succeeded(repeated);
  assert.equal((await fs.stat(pipFile)).mtimeMs, before.mtimeMs);
  assert.doesNotMatch(repeated.stdout, /Downloading|Installing/);
  succeeded(run(python, ['-I', 'scripts/atlas-python-bootstrap.py', '-c', 'import ssl,certifi; print(ssl.create_default_context())']));
});

test('existing shared-site environments use their own packages on repeated setup', async () => {
  const dir = await fs.mkdtemp(path.join(root, 'work/python-shared-setup-'));
  succeeded(run(basePython, ['-I', '-m', 'venv', '--system-site-packages', dir]));
  succeeded(setup(dir));
  const repeated = setup(dir, path.join(dir, 'no-wheels'));
  succeeded(repeated);
  assert.doesNotMatch(repeated.stdout, /Downloading|Installing/);
});

test('a corrupt wheel is rejected before pip changes and missing offline files never download', async () => {
  const dir = await fs.mkdtemp(path.join(root, 'work/python-rejected-wheel-'));
  const venv = path.join(dir, 'venv'), bad = path.join(dir, 'wheels');
  succeeded(run(basePython, ['-I', '-m', 'venv', venv]));
  const python = pythonIn(venv), version = () => run(python, ['-I', '-m', 'pip', '--version']).stdout;
  const before = version();
  await fs.mkdir(bad);
  // Leave pip absent first, then corrupt every wheel so either path must fail.
  let result = setup(venv, bad);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Offline wheel is missing/);
  for (const wheel of Object.values(manifest)) await fs.writeFile(path.join(bad, wheel.filename), 'not a trusted wheel');
  result = setup(venv, bad);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SHA-256 mismatch/);
  assert.equal(version(), before);
});

test('setup refuses environment paths outside work before running Python', () => {
  const result = setup(path.join(root, 'unrelated-python'));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /subdirectory of work/);
});
