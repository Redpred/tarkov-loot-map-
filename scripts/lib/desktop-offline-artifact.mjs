import {createReadStream} from 'node:fs';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

export async function fileDigest(file, algorithm = 'sha256', encoding = 'hex', range) {
  const digest = createHash(algorithm);
  for await (const bytes of createReadStream(file, range)) digest.update(bytes);
  return digest.digest(encoding);
}

// NSIS stores this already-compressed File verbatim. 7-Zip's EXE inspection
// finds the app's first 7z stream and does not test this second embedded stream.
export async function verifyEmbeddedArchive(installer, archive) {
  assert(/^[a-f0-9]{128}$/.test(archive.headerHex) && /^[a-f0-9]{64}$/.test(archive.sha256));
  assert(Number.isSafeInteger(archive.bytes) && archive.bytes > 64);
  const prefix = Buffer.from(archive.headerHex, 'hex'), positions = new Set();
  let tail = Buffer.alloc(0), offset = 0;
  for await (const chunk of createReadStream(installer)) {
    const bytes = Buffer.concat([tail, chunk]);
    for (let at = bytes.indexOf(prefix); at !== -1; at = bytes.indexOf(prefix, at + 1)) positions.add(offset - tail.length + at);
    assert(positions.size <= 4, 'Ambiguous embedded resource archive');
    offset += chunk.length; tail = bytes.subarray(-63);
  }
  const size = (await fs.stat(installer)).size, matches = [];
  for (const start of positions) if (start + archive.bytes <= size && await fileDigest(installer, 'sha256', 'hex', {start, end: start + archive.bytes - 1}) === archive.sha256) matches.push(start);
  assert.equal(matches.length, 1, 'Embedded resource archive is missing or corrupt');
  return {offset: matches[0], bytes: archive.bytes, sha256: archive.sha256};
}
