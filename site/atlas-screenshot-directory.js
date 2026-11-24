import {createScreenshotDirectoryStore} from './atlas-screenshot-location.js';

export function createScreenshotDirectoryAccess({desktop=globalThis.tarkovDesktop, store=createScreenshotDirectoryStore(), picker=globalThis.showDirectoryPicker}={}) {
  const native = typeof desktop?.screenshots === 'function';
  async function call(action, id) {
    const result = await desktop.screenshots(action, id);
    if (!result.ok) throw new DOMException(result.message, result.name || 'Error');
    return result.value;
  }
  function handle(info) {
    if (!info) return null;
    return {kind: 'directory', name: info.name, displayPath: info.path,
      queryPermission: async () => 'granted', requestPermission: async () => 'granted',
      async *values() {
        for (const entry of await call('list', info.id)) yield {kind: 'file', name: entry.name, getFile: async () => ({lastModified: entry.lastModified})};
      },
    };
  }
  async function descend(root) {
    // A browser may start in Documents. Reuse that explicit grant to find the
    // known child; never request broad filesystem access or create directories.
    for (const parts of [['Escape from Tarkov', 'Screenshots'], ['Screenshots']]) {
      try { let folder=root; for (const name of parts) folder=await folder.getDirectoryHandle(name); return folder; }
      catch (error) { if (!['NotFoundError', 'TypeMismatchError'].includes(error.name)) throw error; }
    }
    return root;
  }
  return {
    native,
    supported: native || (typeof picker === 'function' && globalThis.isSecureContext),
    restore: async () => native ? handle(await call('info')) : store.read(),
    detect: async () => native ? handle(await call('detect')) : null,
    async choose() {
      if (native) return handle(await call('choose'));
      return descend(await picker({id:'eft-screenshots',mode:'read',startIn:'documents'}));
    },
    save: directory => native ? Promise.resolve() : store.write(directory),
    forget: () => native ? call('forget') : store.write(null),
  };
}
