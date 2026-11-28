import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {gunzip} from 'node:zlib';
import {promisify} from 'node:util';
import {mapLoadError} from '../site/atlas-map-diagnostics.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const decompress = promisify(gunzip);
const MARKER = 'client-resources.json', TYPE = 'tarkov-client-resources';
const validHash = value => /^[a-f0-9]{64}$/.test(value);

// The native cache is private to this application. No renderer-supplied path,
// deletion API, or recursive cleanup is accepted here.
export function createClientResourceStore(root) {
  root = path.resolve(root);
  let opening;
  const invalidModels = new Set();
  const modelChecks = new Map(), replacements = new Map();
  async function checkModel(sha,total) {
    if(modelChecks.has(sha))return modelChecks.get(sha);
    const pending=(async()=>{const digest=createHash('sha256');
      for(let offset=0;offset<total;offset+=4*2**20){const length=Math.min(4*2**20,total-offset),part=await chunkBytes(sha,offset,length,total);if(!part)return null;digest.update(part);}
      return digest.digest('hex')===sha;
    })();
    modelChecks.set(sha,pending);
    try { const result=await pending;if(result===null)modelChecks.delete(sha);return result; }
    catch(error){modelChecks.delete(sha);throw error;}
  }
  async function safe(relative, create = false) {
    const parts = relative.split('/');
    if (parts.some(part => !/^[a-zA-Z0-9.-]+$/.test(part) || part === '.' || part === '..')) throw Error('资源路径无效');
    let current = root;
    for (const part of ['', ...parts]) {
      if (part) current = path.join(current, part);
      let stat;
      try { stat = await fs.lstat(current); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (create && current !== path.join(root, ...parts)) {
          // Another parallel download may have created this directory since
          // lstat. Recheck it below, including the existing link protection.
          try { await fs.mkdir(current); } catch (mkdirError) { if (mkdirError.code !== 'EEXIST') throw mkdirError; }
          stat = await fs.lstat(current);
        }
      }
      if (stat?.isSymbolicLink()) throw Error('资源目录不能使用链接或联接点，请选择普通文件夹');
      if (stat && current !== path.join(root, ...parts) && !stat.isDirectory()) throw Error('资源目录被其他文件占用');
    }
    return current;
  }
  async function initialize() {
    const marker = await safe(MARKER, true);
    try {
      const value = JSON.parse(await fs.readFile(marker, 'utf8'));
      if (value.schemaVersion !== 1 || value.type !== TYPE) throw Error('客户端资源目录标识无效');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if ((await fs.readdir(root)).length) throw Error('客户端资源目录已有其他文件，请选择其他空目录');
      await fs.writeFile(marker, JSON.stringify({schemaVersion: 1, type: TYPE}) + '\n', {flag: 'wx'});
    }
  }
  const ready = () => opening ||= initialize().catch(error => { opening = null; throw error; });
  async function read(relative, limit = 64*2**20) {
    // An absent cache is a miss; a foreign or redirected cache is an error.
    try { await fs.lstat(root); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    await ready();
    try { const file=await safe(relative);if((await fs.stat(file)).size>limit)return null;return await fs.readFile(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async function write(relative, bytes) {
    await ready();
    const file = await safe(relative, true), tempRelative = relative + '.' + randomUUID() + '.tmp';
    const temp = await safe(tempRelative);
    try { await fs.writeFile(temp, bytes, {flag: 'wx'}); await safe(relative); await fs.rename(temp, file); }
    catch(error){
      // A parallel request may already have saved these bytes while Windows
      // prevents replacing the file being read by another request.
      if(error.code==='EACCES'||error.code==='EPERM'){
        const saved=await read(relative,bytes.length).catch(()=>null);
        if(saved?.equals(bytes))return;
      }
      if(error.code==='ENOSPC')throw mapLoadError('CLIENT-DISK-FULL', '客户端资源目录所在磁盘空间不足', {cause:error});
      if(['EACCES','EPERM'].includes(error.code))throw mapLoadError('CLIENT-DISK-PERMISSION', '无法保存到客户端资源目录，请检查权限或更改资源位置后重试。', {cause:error});
      throw error;
    }
    finally { await fs.rm(temp, {force: true}); }
  }
  function objectName(sha) { if (!validHash(sha)) throw Error('资源版本无效'); return 'objects/' + sha; }
  function chunkName(sha, offset, length) {
    if (!validHash(sha) || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1) throw Error('模型分块无效');
    return `models/${sha}/${offset}-${length}`;
  }
  async function chunkBytes(sha, offset, length, total) {
    const name = chunkName(sha, offset, length), bytes = await read(name, length+64);
    if (bytes?.length === length+64) {
      const body = bytes.subarray(64), checksum = bytes.subarray(0,64).toString();
      if (validHash(checksum) && hash(body) === checksum) return body;
    }
    // Release ZIPs can be merged directly into map-resources. Keep their gzip
    // chunks compressed on disk; do not expand a second complete resource copy.
    const limit = Math.ceil(length/3)*4+1024;
    const compressed = await read(`chunks/${sha}/${offset}-${length}.gz`, limit+4096);
    if (!compressed) return null;
    try {
      const value = JSON.parse(await decompress(compressed, {maxOutputLength: limit}));
      const body = Buffer.from(value.data || '', 'base64');
      return value.offset === offset && value.total === total && value.encoding === 'base64' && body.length === length && hash(body) === value.sha256 ? body : null;
    } catch { return null; }
  }
  return {
    root,
    async status() {
      try { await ready(); return {path: root, available: true, error: ''}; }
      catch (error) { return {path: root, available: false, code:error.diagnosticCode||'CLIENT-DIRECTORY-UNAVAILABLE', error: `客户端资源目录不可用：${error.message}。请在资源设置中选择其他位置。`}; }
    },
    async getObject(sha, size) { const bytes = await read(objectName(sha),size); return bytes?.length === size && hash(bytes) === sha ? bytes : null; },
    async putObject(sha, bytes) { if (hash(bytes) !== sha) throw Error('资源校验失败'); await write(objectName(sha), bytes); },
    async getChunk(sha, offset, length, total) {
      if (invalidModels.has(sha)) return null;
      const body = await chunkBytes(sha, offset, length, total);
      if (!body) return null;
      // When all chunks exist, bind them to the locked complete-model hash.
      // A self-consistent but wrong cached chunk must not poison every restart.
      if (await checkModel(sha,total)===false) { invalidModels.add(sha); return null; }
      return body;
    },
    async putChunk(sha, offset, bytes, total) {
      await write(chunkName(sha, offset, bytes.length), Buffer.concat([Buffer.from(hash(bytes)), bytes]));modelChecks.delete(sha);
      if(invalidModels.has(sha)){if(!replacements.has(sha))replacements.set(sha,new Set());const parts=replacements.get(sha);parts.add(offset);if(parts.size===Math.ceil(total/(4*2**20))){invalidModels.delete(sha);replacements.delete(sha);}}
    }
  };
}
