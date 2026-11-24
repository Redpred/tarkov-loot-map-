import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';

// The app-only uninstall inventory deliberately excludes retained map resources.
export async function writeOfflineInstallerConfig({root, workRoot, output, prepackaged, inventory, archive, sourceTar}) {
for(const value of [root,workRoot,output,prepackaged,archive.archive,archive.sevenZip,sourceTar])assert(!/["$\r\n]/.test(value),'NSIS build paths cannot contain quotes, dollar signs or newlines');
const source=inventory,require=createRequire(path.join(root,'desktop/package.json'));
await fs.mkdir(path.join(workRoot,'work'),{recursive:true});
await require(path.join(root,'desktop/installer-files.cjs'))({appOutDir:prepackaged,packager:{projectDir:path.join(workRoot,'desktop')}});
const win=p=>p.replaceAll('/','\\');
const lines=[
  '!include LogicLib.nsh',
  '!include "'+win(path.join(workRoot,'work/desktop-installer-files.nsh'))+'"',
  '!include FileFunc.nsh',
  '!macro customWelcomePage',
  '  !define MUI_WELCOMEPAGE_TITLE "塔科夫物资地图 · 离线版"',
  '  !define MUI_WELCOMEPAGE_TEXT "已包含 13 张地图的默认资源（低档模型、中档贴图、完整场景）。安装后可直接使用，无需另外下载资源包。$\\r$\\n$\\r$\\n其他画质选项仍然保留，使用时需要补充对应资源。$\\r$\\n$\\r$\\n安装及临时解压建议预留 10 GiB 可用空间。安装完成后，可从桌面快捷方式打开。"',
  '  !insertmacro MUI_PAGE_WELCOME',
  '!macroend',
  '!macro customInit',
  '  SectionSetSize 0 '+Math.ceil((source.bytes+700*2**20)/1024),
  '!macroend',
  '!ifndef BUILD_UNINSTALLER',
  'Function OfflineCheckPath',
  '  Pop $R0',
  '  System::Call \'kernel32::GetFileAttributesW(w rR0) i .r0\'',
  '  IntOp $1 $0 & 0x400',
  '  ${If} $0 != -1',
  '  ${AndIf} $1 != 0',
  '    MessageBox MB_OK|MB_ICONSTOP "安装目标含目录链接或文件链接，请改选普通文件夹。" /SD IDOK',
  '    SetErrorLevel 3',
  '    Abort',
  '  ${EndIf}',
  'FunctionEnd',
  '!endif',
  '!macro customInstall',
  '  System::Call \'kernel32::GetDiskFreeSpaceExW(w "$INSTDIR", *l.r0, *l, *l) i.r1\'',
  '  ${If} $1 == 0',
  '    SetErrorLevel 3',
  '    Abort "无法读取目标磁盘可用空间。"',
  '  ${EndIf}',
  '  System::Int64Op $0 < '+(source.bytes+archive.bytes+512*2**20),
  '  Pop $1',
  '  ${If} $1 != 0',
  '    MessageBox MB_OK|MB_ICONSTOP "目标磁盘空间不足。安装及临时解压建议预留 10 GiB 可用空间。" /SD IDOK',
  '    SetErrorLevel 3',
  '    Abort',
  '  ${EndIf}',
  '  InitPluginsDir',
  '  System::Call \'kernel32::GetDiskFreeSpaceExW(w "$PLUGINSDIR", *l.r0, *l, *l) i.r1\'',
  '  System::Int64Op $0 < '+(archive.bytes+256*2**20),
  '  Pop $2',
  '  ${If} $1 == 0',
  '  ${OrIf} $2 != 0',
  '    MessageBox MB_OK|MB_ICONSTOP "系统临时目录空间不足，请先释放系统磁盘空间。" /SD IDOK',
  '    SetErrorLevel 3',
  '    Abort',
  '  ${EndIf}',
  '  StrCpy $R2 "$INSTDIR"',
  '  ${DoWhile} $R2 != ""',
  '    Push $R2',
  '    Call OfflineCheckPath',
  '    ${GetParent} "$R2" $R2',
  '  ${Loop}',
];
const paths=new Set(['map-resources']);
for(const entry of source.entries){let rel=entry.path;while(rel&&rel!=='.'){paths.add(rel);rel=path.posix.dirname(rel);}}
const sevenRoot=path.dirname(path.dirname(archive.sevenZip));
const licenseFiles=[
  [path.join(sevenRoot,'LICENSE.txt'),'7zip-LICENSE.txt'],
  [path.join(sevenRoot,'COPYING'),'7zip-COPYING.txt'],
  [sourceTar,'7z2409-src.tar.xz'],
];
const licenseDir='map-resources/licenses/offline-installer';
for(let rel=licenseDir;rel!=='.';rel=path.posix.dirname(rel))paths.add(rel);
for(const [,name] of licenseFiles)paths.add(licenseDir+'/'+name);
for(const rel of [...paths].sort())lines.push('  Push "$INSTDIR\\'+win(rel)+'"','  Call OfflineCheckPath');
lines.push(
  '  IfFileExists "$INSTDIR\\map-resources\\*.*" 0 offline_resource_directory_ok',
  '    ${StdUtils.HashFile} $R0 "SHA2-256" "$INSTDIR\\map-resources\\client-resources.json"',
  '    ${If} $R0 != "'+source.entries.find(e=>e.path==='map-resources/client-resources.json').sha256+'"',
  '      MessageBox MB_OK|MB_ICONSTOP "map-resources 已存在但不是本客户端资源目录，请改选安装位置。" /SD IDOK',
  '      SetErrorLevel 3',
  '      Abort',
  '    ${EndIf}',
  '  offline_resource_directory_ok:',
  '  DetailPrint "正在准备离线地图资源……"',
  '  SetCompress off',
  '  File /oname=$PLUGINSDIR\\map-resources.7z "'+win(archive.archive)+'"',
  '  File /oname=$PLUGINSDIR\\offline-7za.exe "'+win(archive.sevenZip)+'"',
  '  ${StdUtils.HashFile} $R0 "SHA2-256" "$PLUGINSDIR\\map-resources.7z"',
  '  ${If} $R0 != "'+archive.sha256+'"',
  '    MessageBox MB_OK|MB_ICONSTOP "离线资源校验失败，请重新下载安装程序。" /SD IDOK',
  '    SetErrorLevel 2',
  '    Abort',
  '  ${EndIf}',
  '  DetailPrint "正在安装 13 张地图的默认资源，请稍候……"',
  '  nsExec::ExecToStack \'"$PLUGINSDIR\\offline-7za.exe" x "$PLUGINSDIR\\map-resources.7z" "-o$INSTDIR" -y -bd -bso0 -bse1\'',
  '  Pop $R0',
  '  Pop $R1',
  '  ${If} $R0 != "0"',
  '    MessageBox MB_OK|MB_ICONSTOP "地图资源未能完整安装。请检查磁盘空间、写入权限后重新安装。$\\r$\\n$R1" /SD IDOK',
  '    SetErrorLevel 4',
  '    Abort',
  '  ${EndIf}',
  '  Delete "$PLUGINSDIR\\map-resources.7z"',
  '  SetCompress auto',
  '  SetOutPath "$INSTDIR\\'+win(licenseDir)+'"',
);
for(const [file,name] of licenseFiles){await fs.access(file);lines.push('  File /oname='+name+' "'+win(file)+'"');}
lines.push('  SetOutPath "$INSTDIR"','  WriteRegDWORD SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "EstimatedSize" '+Math.ceil((source.bytes+650*2**20)/1024),'  DetailPrint "离线地图资源已安装。"','!macroend','');
await fs.writeFile(path.join(workRoot,'offline.nsh'),'\uFEFF'+lines.join('\r\n'));
const config=JSON.parse(await fs.readFile(path.join(root,'desktop/builder.json'),'utf8'));
config.directories={app:path.join(root,'work/desktop-stage/app'),output};
delete config.afterPack;
config.win.icon=path.join(root,'site/app-icon-512.png');
config.nsis.include=path.join(workRoot,'offline.nsh');
await fs.writeFile(path.join(workRoot,'builder.json'),JSON.stringify(config,null,2)+'\n');

return path.join(workRoot,'builder.json');
}
