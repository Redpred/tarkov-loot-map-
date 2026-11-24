import {execFileSync} from 'node:child_process';

// Inspect the index: this catches files already tracked before .gitignore changed.
const git=(...args)=>execFileSync('git',['--no-pager',...args],{maxBuffer:20*1024*1024,encoding:'utf8'});
const paths=git('ls-files','-z').split('\0').filter(Boolean);
const ignored=git('ls-files','-z','--cached','--ignored','--exclude-standard').split('\0').filter(Boolean);
const findings=ignored.map(file=>({file,reason:'Tracked file matches ignore rules'}));
const local=/(^|\/)(?:AGENTS(?:\.local)?\.md|CLAUDE\.md|GEMINI\.md|\.(?:local|agent|codex|claude|cursor|agents|windsurf|ssh)|\.aider[^/]*)(?:\/|$)|(^|\/)\.github\/(?:copilot-instructions\.md|instructions\/|prompts\/)/i;
const privatePaths=/^(?:docs\/|CHANGELOG\.md$|更新计划\.txt$)|(?:^|\/)(?:known_hosts(?:\.old)?|authorized_keys|\.netrc|\.git-credentials)(?:$|\/)|\.(?:pem|key|p12|pfx|ppk)$/i;
for(const file of paths)if((local.test(file)||privatePaths.test(file))&&!ignored.includes(file))findings.push({file,reason:'Local documentation, AI state or credential file'});
// Game payloads stay outside the source tree even when ignore rules are changed.
const metadata = new Set(['data/spt-source.json','data/task-source.json','data/spt-audit.json']);
for(const file of paths){
  const payload = /^(?:site\/(?:data|previews)\/|data\/)/i.test(file) || /^icon\/.*\.(?:png|webp|jpe?g|gif|bmp|ico|avif)$/i.test(file);
  const notice = /(?:^|\/)(?:[\w.-]*LICENSE[\w.-]*|README(?:\.md)?)$/i.test(file) && !/^site\/previews\//i.test(file);
  if(payload && !metadata.has(file) && !notice)findings.push({file,reason:'External asset payload belongs in a resource bundle, not source Git'});
}
const records=git('ls-files','--stage','-z').split('\0').filter(Boolean).map(line=>{const match=/^\d+ ([0-9a-f]+) 0\t([\s\S]+)$/.exec(line);if(!match)throw Error('Unresolved index entries');return {sha:match[1],file:match[2]};});
const sizes=execFileSync('git',['cat-file','--batch-check=%(objectname) %(objectsize)'],{input:[...new Set(records.map(r=>r.sha))].join('\n')+'\n',encoding:'utf8',maxBuffer:2*1024*1024}).trim().split('\n');
const byHash=new Map(sizes.map(line=>line.split(' ')));
for(const row of records)if(Number(byHash.get(row.sha))>=95*1024*1024)findings.push({file:row.file,reason:'Blob is at least 95 MiB; keep large assets outside Git'});
// Narrow high-confidence signatures. Print filenames only, never matched secrets.
const signature='(^|[^A-Za-z0-9_])('+['-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----','gh[pousr]_[A-Za-z0-9]{36,}','github_pat_[A-Za-z0-9_]{50,}','AKIA[0-9A-Z]{16}','xox[baprs]-[0-9A-Za-z-]{20,}'].join('|')+')([^A-Za-z0-9_]|$)';
try{const matches=git('grep','--cached','-I','-l','-z','-E','-e',signature,'--',':!scripts/check-repository.mjs').split('\0').filter(Boolean);for(const file of matches)findings.push({file,reason:'Potential credential signature; inspect locally'});}catch(error){if(error.status!==1)throw error;}
// Environment metadata must be relative or redacted in published records.
const environmentSignature=[
  String.raw`["'](sourceDirectory|previousDatabasePath|packageRoot|rawRoot)["'][[:space:]]*:[[:space:]]*["'][A-Za-z]:[\\/]`,
  String.raw`[A-Za-z]:[\\/]+Users[\\/]+[[:alnum:]_.-]+`,
  String.raw`["']origin["'][[:space:]]*:[[:space:]]*["']https?://[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+`,
  String.raw`[A-Za-z]:[\\/]+Git[\\/]+[[:alnum:]_.-]+`,
  String.raw`(^|[^[:alnum:]_])/(home|Users)/[[:alnum:]_.-]+/`,
  String.raw`(^|[^[:alnum:]_])(ssh|scp|sftp)(\.exe)?[[:space:]]+[^[:cntrl:]]{0,240}[[:alnum:]_.-]+@([[:alnum:]_-]+\.)+[[:alnum:]_-]+`,
  String.raw`["'](sshHost|sshUser|sshKeyPath|serverIp|deployHost|originIp)["'][[:space:]]*:[[:space:]]*["'][^"'$<]{2,}["']`,
].join('|');
try{const matches=git('grep','--cached','-I','-l','-z','-E','-e',environmentSignature,'--',':!scripts/check-repository.mjs').split('\0').filter(Boolean);for(const file of matches)findings.push({file,reason:'Machine path or server connection details in published metadata'});}catch(error){if(error.status!==1)throw error;}
console.log(JSON.stringify({checkedFiles:paths.length,originalManifestExceptions:0,findings},null,2));
if(findings.length)process.exitCode=1;
