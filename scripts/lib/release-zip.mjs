// Stored ZIPs allow both ordinary extraction and independently verified
// HTTP byte-range reads. The indexed payload is never executable archive code.
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {crc32} from 'node:zlib';

export async function createReleaseZip(file) {
  const handle = await fs.open(file, 'wx'), hash = createHash('sha256'), entries = [];
  let offset = 0, closed = false;
  async function write(bytes) { await handle.writeFile(bytes); hash.update(bytes); offset += bytes.length; }
  return {
    get size() { return offset; },
    async add(name, bytes) {
      if (!/^(?:map-resources\/)?(objects\/[a-f0-9]{64}|chunks\/[a-f0-9]{64}\/\d+-\d+\.gz|client-resources\.json|RESOURCE_README\.txt)$/.test(name)) throw Error('Invalid ZIP member');
      if (entries.length >= 65534 || offset + bytes.length + 512 >= 2**32) throw Error('ZIP32 limit exceeded');
      const filename = Buffer.from(name), checksum = crc32(bytes), local = Buffer.alloc(30), start = offset;
      local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
      local.writeUInt16LE(33, 12); local.writeUInt32LE(checksum, 14); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(filename.length, 26);
      await write(local); await write(filename); const dataOffset = offset; await write(bytes);
      entries.push({filename, checksum, start, size: bytes.length});
      return dataOffset;
    },
    async finish() {
      const centralOffset = offset;
      for (const entry of entries) {
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8);
        central.writeUInt16LE(33, 14); central.writeUInt32LE(entry.checksum, 16); central.writeUInt32LE(entry.size, 20); central.writeUInt32LE(entry.size, 24);
        central.writeUInt16LE(entry.filename.length, 28); central.writeUInt32LE(entry.start, 42);
        await write(central); await write(entry.filename);
      }
      const end = Buffer.alloc(22), centralSize = offset-centralOffset;
      end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(centralOffset, 16);
      await write(end); await handle.close(); closed = true;
      return {bytes: offset, sha256: hash.digest('hex')};
    },
    async close() { if (!closed) { await handle.close(); closed = true; } }
  };
}
