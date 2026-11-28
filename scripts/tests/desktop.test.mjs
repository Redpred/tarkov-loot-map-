import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {APP_ORIGIN, appPermission, appUrl, externalUrl, resourcePath} from '../../desktop/policy.mjs';
import {createDesktopResources} from '../../desktop/resources.mjs';
import {pageRoute} from '../../site/atlas-page-routes.js';
import {createClientResourceStore} from '../../desktop/local-resources.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
async function fixture(t, files = {}, geometry = {}, fetcher = async () => { throw Error('offline'); }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tarkov-desktop-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const siteRoot = path.join(root, 'site'), cacheRoot = path.join(root, 'cache'); await fs.mkdir(siteRoot);
  return {siteRoot, cacheRoot, lock: {schemaVersion: 1, files, geometry}, fetcher};
}
test('desktop origin and browser links reject lookalikes and dangerous schemes', () => {
  assert.ok(appUrl('tarkov://app/map.html?map=woods'));
  for (const url of ['file:///C:/secret', 'tarkov://app.evil/', 'tarkov://user@app/', 'https://app/']) assert.equal(appUrl(url), false);
  assert.ok(externalUrl('https://github.com/Redpred/tarkov-loot-map/releases'));
  assert.ok(externalUrl('https://beian.miit.gov.cn/'));
  assert.ok(externalUrl('https://space.bilibili.com/434445528?spm_id_from=333.788.0.0'));
  for (const url of ['http://space.bilibili.com/434445528', 'https://space.bilibili.com.evil/434445528', 'https://space.bilibili.com@evil.com/', 'https://space.bilibili.com:8443/', 'https://user@space.bilibili.com/']) assert.equal(externalUrl(url), false);
  assert.ok(externalUrl('https://beian.mps.gov.cn/#/query/webSearch?code=31011202023890'));
  assert.equal(externalUrl('https://beian.mps.gov.cn.evil/'),false);
  for (const url of ['https://tarkov.dev/api', 'https://creativecommons.org/licenses/by-nc-sa/4.0/']) assert.ok(externalUrl(url));
  for (const url of ['http://tarkov.dev/api', 'https://tarkov.dev.evil/api', 'https://tarkov.dev@evil.com/', 'https://creativecommons.org.evil/', 'https://creativecommons.org:8443/', 'https://user@creativecommons.org/']) assert.equal(externalUrl(url), false);
  for (const url of ['javascript:alert(1)', 'https://github.com.evil/', 'https://user@github.com/', 'http://afdian.com/', 'file:///x', 'http://beian.miit.gov.cn/', 'https://beian.miit.gov.cn.evil/', 'https://beian.miit.gov.cn@evil.com/']) assert.equal(externalUrl(url), false);
});
test('resource paths cannot leave the site root or use Windows alternate streams', () => {
  for (const value of ['../private', '/data/file', 'data//file', 'data/../../x', 'C:/x', 'data\\file', 'data/x:secret', 'data/%2e%2e/x', 'x\0']) assert.throws(() => resourcePath(value));
});

test('desktop pointer lock is available only to the main frame of a map page', () => {
  const map = `${APP_ORIGIN}/map.html?map=woods#location`;
  const main = {requestingUrl: map, isMainFrame: true};
  for (const route of ['factory.html', 'streets.html', 'map.html?map=woods#location']) {
    const url = `${APP_ORIGIN}/${route}`;
    const details = {requestingUrl: url, isMainFrame: true};
    assert.equal(appPermission('pointerLock', url, APP_ORIGIN, details), true);
    assert.equal(appPermission('pointerLock', url, url, details), true);
  }
  for (const route of ['index.html', 'tasks.html', 'map.html?map=unknown']) {
    const url = `${APP_ORIGIN}/${route}`;
    assert.equal(appPermission('pointerLock', url, APP_ORIGIN, {requestingUrl: url, isMainFrame: true}), false);
  }
  assert.equal(appPermission('pointerLock', map, APP_ORIGIN, {...main, isMainFrame: false}), false);
  assert.equal(appPermission('pointerLock', map, APP_ORIGIN, {isMainFrame: true}), false);
  assert.equal(appPermission('pointerLock', map, APP_ORIGIN, {...main, requestingUrl: `${APP_ORIGIN}/factory.html`}), false);
  assert.equal(appPermission('pointerLock', map, 'https://tarkovlootmap.com', main), false);
  assert.equal(appPermission('pointerLock', 'tarkov://app.evil/factory.html', APP_ORIGIN, main), false);
  for (const permission of ['fileSystem', 'clipboard-sanitized-write', 'persistent-storage']) {
    assert.equal(appPermission(permission, map, APP_ORIGIN), true);
  }
  assert.equal(appPermission('media', map, APP_ORIGIN, main), false);
});

test('first parallel native downloads can share newly created object and model directories', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'tarkov-parallel-cache-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const store=createClientResourceStore(path.join(root,'map-resources'));
  const files=Array.from({length:48},(_,i)=>Buffer.from('parallel resource '+i));
  await Promise.all(files.flatMap(bytes=>[store.putObject(hash(bytes),bytes),store.putChunk(hash(bytes),0,bytes,bytes.length)]));
  for(const bytes of files){assert.deepEqual(await store.getObject(hash(bytes),bytes.length),bytes);assert.deepEqual(await store.getChunk(hash(bytes),0,bytes.length,bytes.length),bytes);}
});
test('a denied native replacement succeeds only if the requested bytes are already saved', async t => {
  const options=await fixture(t),store=createClientResourceStore(path.join(options.siteRoot,'..','map-resources'));
  const bytes=Buffer.from('same texture'),sha=hash(bytes),folder=path.join(store.root,'objects');
  await store.putObject(sha,bytes);
  const rename=fs.rename,target=path.join(folder,sha);
  t.mock.method(fs,'rename',async(from,to)=>{
    if(to===target)throw Object.assign(Error('file is in use'),{code:'EPERM'});
    return rename(from,to);
  });
  await store.putObject(sha,bytes);
  assert.deepEqual(await store.getObject(sha,bytes.length),bytes);
  await fs.writeFile(target,Buffer.alloc(bytes.length));
  await assert.rejects(store.putObject(sha,bytes),/无法保存/);
  assert.deepEqual(await fs.readdir(folder),[sha]);
});
test('retained map navigation supports desktop without accepting another custom origin', () => {
  assert.equal(pageRoute('tasks.html', 'tarkov://app/factory.html').kind, 'tasks');
  assert.equal(pageRoute('tarkov://evil/tasks.html', 'tarkov://app/factory.html'), null);
  assert.equal(pageRoute('file:///tasks.html', 'file:///factory.html'), null);
});
test('bundled pages work without a server or network and have JPEG/CSP headers', async t => {
  const options = await fixture(t), service = createDesktopResources(options);
  await fs.writeFile(path.join(options.siteRoot, 'index.html'), '<h1>Local</h1>');
  await fs.writeFile(path.join(options.siteRoot, 'sponsor.jpg'), 'image');
  const response = await service.handle(new Request('tarkov://app/'));
  assert.match(await response.text(), /Local/); assert.match(response.headers.get('content-security-policy'), /object-src 'none'/);
  assert.equal((await service.handle(new Request('tarkov://app/sponsor.jpg'))).headers.get('content-type'), 'image/jpeg');
  assert.equal((await service.handle(new Request('tarkov://evil/index.html'))).status, 403);
});
test('metadata downloads are pinned, deduplicated and survive a new offline process', async t => {
  const data = Buffer.from('{"map":"factory"}'), file = 'data/geometry-quality/factory/manifest.json'; let calls = 0;
  const options = await fixture(t, {[file]: [hash(data), data.length]}, {}, async (url, init) => {
    calls++; assert.match(url, new RegExp('^https://tarkovlootmap.com/desktop-resources/[a-f0-9]{64}/' + file + '$')); assert.equal(init.redirect, 'error'); return new Response(data);
  });
  const service = createDesktopResources(options);
  await Promise.all([service.read(file), service.read(file)]); assert.equal(calls, 1);
  const offline = createDesktopResources({...options, fetcher: async () => { throw Error('offline'); }});
  assert.deepEqual(await offline.read(file), data);
  await fs.writeFile(path.join(options.cacheRoot, hash(data)), 'corrupted');
  await assert.rejects(offline.read(file), /offline/);
  assert.deepEqual(await service.read(file), data); assert.equal(calls, 2);
});
test('unknown files, changed bytes and oversized remote bodies are never cached', async t => {
  const data = Buffer.from('expected'), file = 'data/model-quality/factory/manifest.json'; let calls = 0;
  const options = await fixture(t, {[file]: [hash(data), data.length]}, {}, async () => { calls++; return new Response('wrong'); });
  const service = createDesktopResources(options);
  await assert.rejects(service.read('data/unlisted.json'), /当前版本/); assert.equal(calls, 0);
  await assert.rejects(service.read(file), /校验失败/);
  const oversized = createDesktopResources({...options, fetcher: async () => new Response('x'.repeat(100))});
  await assert.rejects(oversized.read(file), /超过预期/);
  await assert.rejects(fs.stat(path.join(options.cacheRoot, hash(data))));
});
test('legacy live catalogs can restore a pinned desktop tier after an archive miss', async t => {
  for (const [kind,tier,indent] of [['geometry-quality','low'],['model-quality','medium',2],['scenery-details','low']]) {
    const file = `data/${kind}/factory/manifest.json`;
    const selected = {file: 'selected.json', stats: {bytes: 42}};
    const catalog = {schemaVersion: 1, mapId: 'factory', variants: {[tier]: selected}};
    const pinned = Buffer.from(JSON.stringify(catalog,null,indent)+'\n');
    let requests = 0, changed = false;
    const options = await fixture(t, {[file]:[hash(pinned),pinned.length]}, {}, async url => {
      requests++;
      if (new URL(url).pathname.startsWith('/desktop-resources/')) return new Response(null,{status:404});
      const variant = changed ? {...selected, file:'different.json'} : selected;
      return Response.json({...catalog,variants:{original:{file:'original.json'},[tier]:variant}});
    });
    const service = createDesktopResources(options);
    assert.deepEqual(await service.read(file),pinned);assert.equal(requests,2);
    changed = true;
    assert.deepEqual(await service.read(file),pinned);assert.equal(requests,2);
    const fresh = createDesktopResources({...options,cacheRoot:path.join(options.cacheRoot,'other')});
    await assert.rejects(fresh.read(file),/当前客户端版本不一致/);
    assert.equal(requests,4);
  }
});
test('desktop protocol preserves a website diagnostic after an archive miss',async t=>{
  const bytes=Buffer.from('fixture texture'),file='data/model-quality/factory/medium/sample.webp';
  const options=await fixture(t,{[file]:[hash(bytes),bytes.length]}, {},async url=>{
    if(new URL(url).pathname.startsWith('/desktop-resources/'))return new Response(null,{status:404});
    return new Response(null,{status:503,headers:{'X-Map-Error-Code':'SERVER-FILE-PERMISSION'}});
  });
  const response=await createDesktopResources(options).handle(new Request('tarkov://app/'+file));
  assert.equal(response.status,503);
  assert.equal(response.headers.get('X-Map-Error-Code'),'CLIENT-WEBSITE-HTTP-503');
  assert.equal(response.headers.get('X-Map-Upstream-Error-Code'),'SERVER-FILE-PERMISSION');
});
test('geometry gateway validates locked version, chunk range, total and checksum', async t => {
  const data = Buffer.from('geometry'), version = hash(data), route = 'api/factory-geometry/low'; let calls = 0;
  const options = await fixture(t, {}, {[route]: [version, data.length]}, async () => { calls++; return new Response(JSON.stringify({offset: 0, total: data.length, encoding: 'base64', sha256: version, data: data.toString('base64')})); });
  const service = createDesktopResources(options), url = `tarkov://app/${route}?offset=0&length=${data.length}&version=${version}`;
  assert.equal((await service.handle(new Request(url))).status, 200);
  assert.equal((await service.handle(new Request(url.replace('offset=0', 'offset=1')))).status, 400);
  assert.equal((await service.handle(new Request(url.replace(version, '0'.repeat(64))))).status, 400); assert.equal(calls, 1);
  const bad = createDesktopResources({...options, fetcher: async () => new Response(JSON.stringify({offset: 0, total: 999, data: data.toString('base64')}))});
  assert.equal((await bad.handle(new Request(url))).status, 503);
});
test('cache plan rejects invalid map and quality before accessing the network', async t => {
  let requests=0;
  const service=createDesktopResources(await fixture(t, {}, {}, async()=>{requests++;throw Error('offline');}));
  const plan='tarkov://app/api/cache-plan/';
  for(const [map,geometry] of [['unknown','low'],['factory','ultra']]){
    const response=await service.handle(new Request(`${plan}${map}?geometry=${geometry}&texture=medium&scenery=full`));
    assert.equal(response.status,400);
    assert.match((await response.json()).error,/无效/);
  }
  assert.equal(requests,0);
});

test('client folder persists textures, metadata and model chunks across offline processes without browser storage',async t=>{
  const model=Buffer.from('client model'),texture=Buffer.from('client texture'),metadata=Buffer.from('{"test":true}');let calls=0;
  const route='api/factory-geometry/low',file='data/model-quality/factory/medium/test.webp',meta='data/model-quality/factory/manifest.json';
  const options=await fixture(t,{[file]:[hash(texture),texture.length],[meta]:[hash(metadata),metadata.length]},{[route]:[hash(model),model.length]},async url=>{
    calls++;return new Response(url.includes(route)?JSON.stringify({offset:0,total:model.length,encoding:'base64',sha256:hash(model),data:model.toString('base64')}):url.endsWith(meta)?metadata:texture);
  });
  options.localRoot=path.join(options.siteRoot,'..','map-resources');
  const request=name=>new Request('tarkov://app/'+name,{headers:{'X-Tarkov-Storage':'client'}});
  const geometry=`${route}?offset=0&length=${model.length}&version=${hash(model)}`,service=createDesktopResources(options);
  assert.equal((await service.handle(request(file))).status,200);assert.equal((await service.handle(request(meta))).status,200);assert.equal((await service.handle(request(geometry))).status,200);assert.equal(calls,3);
  const offline=createDesktopResources({...options,fetcher:async()=>assert.fail('Saved resources must not use the network')});
  assert.deepEqual(Buffer.from(await (await offline.handle(request(file))).arrayBuffer()),texture);
  assert.deepEqual(Buffer.from(await (await offline.handle(request(meta))).arrayBuffer()),metadata);
  const response=await offline.handle(request(geometry));assert.equal(response.status,200);assert.equal(response.headers.get('X-Resource-Source'),'local');
  assert.equal((await response.json()).data,model.toString('base64'));
  await fs.writeFile(path.join(options.localRoot,'objects',hash(texture)),'corrupt');
  assert.equal((await service.handle(request(file))).status,200);assert.equal(calls,4);
  // A self-consistent chunk still has to match the pinned whole model.
  const wrong=Buffer.from('wrong  model');assert.equal(wrong.length,model.length);
  await fs.writeFile(path.join(options.localRoot,'models',hash(model),`0-${model.length}`),Buffer.concat([Buffer.from(hash(wrong)),wrong]));
  const repaired=createDesktopResources(options);assert.equal((await repaired.handle(request(geometry))).status,200);assert.equal(calls,5);
  assert.equal((await repaired.handle(request(geometry))).status,200);assert.equal(calls,5);
});

test('client store refuses foreign folders and directory links without modifying unrelated files',async t=>{
  const options=await fixture(t),folder=path.join(options.siteRoot,'resources');await fs.mkdir(folder);await fs.writeFile(path.join(folder,'personal.txt'),'keep');
  const foreign=createClientResourceStore(folder);assert.equal((await foreign.status()).available,false);assert.equal(await fs.readFile(path.join(folder,'personal.txt'),'utf8'),'keep');
  const clean=createClientResourceStore(path.join(options.siteRoot,'clean'));assert.equal((await clean.status()).available,true);
  await fs.symlink(folder,path.join(clean.root,'objects'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(clean.putObject(hash(Buffer.from('x')),Buffer.from('x')),/链接|联接/);
  assert.deepEqual(await fs.readdir(folder),['personal.txt']);
});
