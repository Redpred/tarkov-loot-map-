import fs from 'node:fs/promises';
import path from 'node:path';

// Resolve only the locked production dependency closure, never the builder tree.
export async function runtimePackages(desktopRoot) {
  const lock = JSON.parse(await fs.readFile(path.join(desktopRoot, 'package-lock.json'), 'utf8'));
  const packages = new Map();
  async function visit(directory) {
    const pkg = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
    for (const name of Object.keys(pkg.dependencies || {})) {
      let current = directory, found;
      while (current === desktopRoot || current.startsWith(desktopRoot + path.sep)) {
        const candidate = path.join(current, 'node_modules', name);
        if (await fs.stat(path.join(candidate, 'package.json')).then(stat => stat.isFile(), () => false)) { found = candidate; break; }
        current = path.dirname(current);
      }
      if (!found) throw Error(`Missing runtime dependency: ${name}`);
      const relative = path.relative(desktopRoot, found).replaceAll('\\', '/');
      if (packages.has(relative)) continue;
      const dependency = JSON.parse(await fs.readFile(path.join(found, 'package.json'), 'utf8'));
      if (lock.packages[relative]?.version !== dependency.version || lock.packages[relative]?.dev) throw Error(`Unlocked runtime dependency: ${relative}`);
      packages.set(relative, {directory: relative, name: dependency.name, version: dependency.version});
      await visit(found);
    }
  }
  await visit(desktopRoot);
  return [...packages.values()].sort((a, b) => a.directory.localeCompare(b.directory));
}

export async function stageRuntimePackages(desktopRoot, stage, packages) {
  for (const pkg of packages) {
    async function copy(relative) {
      const source = path.join(desktopRoot, relative), target = path.join(stage, relative), stat = await fs.lstat(source);
      if (stat.isSymbolicLink()) throw Error(`Linked runtime dependency: ${relative}`);
      if (stat.isDirectory()) {
        await fs.mkdir(target, {recursive: true});
        for (const name of await fs.readdir(source)) if (name !== 'node_modules') await copy(path.join(relative, name));
      } else if (stat.isFile()) await fs.copyFile(source, target);
      else throw Error(`Unexpected dependency file: ${relative}`);
    }
    await copy(pkg.directory);
  }
}
