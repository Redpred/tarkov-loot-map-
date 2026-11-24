import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';

test('repository gate rejects tracked local instructions and credential signatures without printing values',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'map-repository-policy-'));
  t.after(async()=>{const resolved=path.resolve(root);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('map-repository-policy-'));await fs.rm(resolved,{recursive:true,force:true});});
  const source=path.resolve(import.meta.dirname,'../..');
  await fs.mkdir(path.join(root,'scripts'));await fs.mkdir(path.join(root,'site'));
  for(const file of ['scripts/check-repository.mjs','site/atlas-maps.js'])await fs.copyFile(path.join(source,file),path.join(root,file));
  const git=(...args)=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
  git('init','--quiet');
  await fs.writeFile(path.join(root,'.gitignore'),'AGENTS.md\n');
  await fs.writeFile(path.join(root,'normal.txt'),'ordinary source\n');git('add','.');
  const check=()=>spawnSync(process.execPath,['scripts/check-repository.mjs'],{cwd:root,encoding:'utf8'});
  assert.equal(check().status,0);
  await fs.writeFile(path.join(root,'AGENTS.md'),'Local conversation instructions');git('add','-f','AGENTS.md');
  let result=check();assert.equal(result.status,1);assert.ok(JSON.parse(result.stdout).findings.some(f=>f.file==='AGENTS.md'));
  git('rm','--cached','AGENTS.md');
  // Local folders remain forbidden even if someone removes the ignore rules.
  await fs.writeFile(path.join(root,'.gitignore'),'');git('add','.gitignore');
  for(const file of ['.local/ai/HANDOFF.md','.local/private/original.json','.local/reference/独立项目.md','.github/prompts/review.md','.agent/HANDOFF.md','docs/PROJECT_STRUCTURE.md','CHANGELOG.md','更新计划.txt','.ssh/known_hosts','server.ppk']){
    await fs.mkdir(path.dirname(path.join(root,file)),{recursive:true});
    await fs.writeFile(path.join(root,file),'Local-only record');git('add',file);
    result=check();assert.equal(result.status,1);assert.ok(JSON.parse(result.stdout).findings.some(f=>f.file===file));
    git('rm','--cached',file);
  }
  // External payloads cannot return to source Git by removing .gitignore.
  for(const file of ['site/data/tasks/test.json','site/previews/test.webp','icon/marker.png','data/spt/test.bin']){
    await fs.mkdir(path.dirname(path.join(root,file)),{recursive:true});await fs.writeFile(path.join(root,file),'synthetic asset');git('add',file);
    result=check();assert.equal(result.status,1);assert.ok(JSON.parse(result.stdout).findings.some(f=>f.file===file&&f.reason.includes('External asset')));
    git('rm','--cached',file);
  }
  for(const file of ['data/spt-source.json','data/task-source.json','data/spt-audit.json','data/regions/tarkov-dev-LICENSE','data/spt/example/LICENSE.txt','site/data/README.md','README.md']){
    await fs.mkdir(path.dirname(path.join(root,file)),{recursive:true});await fs.writeFile(path.join(root,file),'synthetic public metadata or notice');git('add',file);
  }
  assert.equal(check().status,0);
  const fake='gh'+'p_'+'A'.repeat(36);
  await fs.writeFile(path.join(root,'example.txt'),'token = "'+fake+'"');git('add','example.txt');
  result=check();assert.equal(result.status,1);assert.ok(JSON.parse(result.stdout).findings.some(f=>f.file==='example.txt'));assert.ok(!result.stdout.includes(fake)&&!result.stderr.includes(fake));
  await fs.writeFile(path.join(root,'example.txt'),'base64='+'AAAA'+'AK'+'IA'+'B'.repeat(40)+'CCCC');git('add','example.txt');assert.equal(check().status,0);
  const privatePath=['Q:','Users','SyntheticUser','snapshot'].join('\\');
  for(const field of ['sourceDirectory','previousDatabasePath','packageRoot','rawRoot']){
    await fs.writeFile(path.join(root,'example.txt'),JSON.stringify({[field]:privatePath}));git('add','example.txt');
    result=check();assert.equal(result.status,1);assert.ok(JSON.parse(result.stdout).findings.some(f=>f.file==='example.txt'));
    assert.ok(!result.stdout.includes('SyntheticUser')&&!result.stderr.includes('SyntheticUser'));
  }
  // Check a Python dictionary as well as serialized JSON, including non-home paths.
  await fs.writeFile(path.join(root,'example.txt'),"manifest={'sourceDirectory':'"+['Q:','Games','Example'].join('/')+"'}");git('add','example.txt');assert.equal(check().status,1);
  const numericOrigin='https://'+[192,0,2,1].join('.');
  await fs.writeFile(path.join(root,'example.txt'),JSON.stringify({origin:numericOrigin}));git('add','example.txt');
  result=check();assert.equal(result.status,1);assert.ok(!result.stdout.includes(numericOrigin)&&!result.stderr.includes(numericOrigin));
  const privateSsh='s'+'sh -i ~/.ssh/example-key user@'+'example.invalid';
  for(const value of [privateSsh,JSON.stringify({sshHost:'example.invalid'}),['/home','synthetic-user','deployment','config'].join('/')]){
    await fs.writeFile(path.join(root,'example.txt'),value);git('add','example.txt');
    result=check();assert.equal(result.status,1);
    assert.ok(JSON.parse(result.stdout).findings.some(f=>f.file==='example.txt'));
    assert.ok(!result.stdout.includes(value)&&!result.stderr.includes(value));
  }
  await fs.writeFile(path.join(root,'example.txt'),JSON.stringify({sourceDirectory:null,sourceDirectoryRedacted:true,packageRoot:'data/tasks/example',rawRoot:'data/tasks/example/raw/spt',origin:'https://example.org'}));git('add','example.txt');assert.equal(check().status,0);
});
