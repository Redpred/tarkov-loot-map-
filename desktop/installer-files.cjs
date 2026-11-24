const fs = require('node:fs/promises');
const path = require('node:path');

// Only shipped files may be removed. Never recursively remove $INSTDIR:
// map-resources and any other user-created files survive updates/uninstalls.
module.exports = async context => {
  const files = [], directories = [], base = path.resolve(context.appOutDir);
  async function walk(relative = '') {
    for (const entry of await fs.readdir(path.join(base, relative), {withFileTypes: true})) {
      const name = path.posix.join(relative, entry.name);
      if (/[\r\n$"\\]/.test(name) || name.split('/').includes('..') || name.split('/')[0] === 'map-resources') throw Error('Unsafe installer payload path');
      if (entry.isSymbolicLink()) throw Error('Installer payload cannot contain links');
      if (entry.isDirectory()) { await walk(name); directories.push(name); }
      else if (entry.isFile()) files.push(name);
      else throw Error('Unknown installer payload entry');
    }
  }
  await walk();
  const lines = ['!macro customRemoveFiles', '  SetOutPath "$TEMP"'];
  // Refuse redirected payload directories rather than deleting through links.
  for (const name of directories) lines.push(`  System::Call 'kernel32::GetFileAttributesW(w "$INSTDIR\\${name.replaceAll('/', '\\')}") i .r0'`, '  IntOp $1 $0 & 0x400', '  ${If} $0 != -1', '  ${AndIf} $1 != 0', '    Abort "Installation contains a directory link; remove the link before uninstalling."', '  ${EndIf}');
  for (const name of files) lines.push(`  Delete "$INSTDIR\\${name.replaceAll('/', '\\')}"`);
  lines.push('  Delete "$INSTDIR\\${UNINSTALL_FILENAME}"');
  for (const name of directories) lines.push(`  RMDir "$INSTDIR\\${name.replaceAll('/', '\\')}"`);
  lines.push('  RMDir "$INSTDIR"', '!macroend', '');
  const target = path.resolve(context.packager.projectDir, '../work/desktop-installer-files.nsh');
  await fs.writeFile(target, '\uFEFF' + lines.join('\r\n'));
};
