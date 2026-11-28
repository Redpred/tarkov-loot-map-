// Shared attribution for the website and the desktop About window.
export const projectAuthor = Object.freeze({
  name: 'Redpred',
  url: 'https://space.bilibili.com/434445528?spm_id_from=333.788.0.0',
});

export const projectNotice = Object.freeze({
  author: `作者：${projectAuthor.name}，B站主页：${projectAuthor.url}`,
  rights: 'Escape from Tarkov 的游戏内容、名称、标识及相关素材，其商标和著作权归 Battlestate Games 及其授权方所有。保留所有权利。',
  independence: '塔科夫物资地图是独立开发的非官方第三方工具，与 Battlestate Games 无关联，未获其认可，也不存在官方合作关系。',
  client: '地图模型、贴图及部分图标、任务素材来自 Escape from Tarkov 客户端。',
  license: '本项目自有源码和文档采用 MIT 许可证。第三方代码、数据和游戏素材保留各自的权利与许可，不随项目源码重新授权。',
  sptLicense: 'SPT 输入由 Archangel / SP-Tushonka 提供，采用 CC BY-NC-SA 4.0（署名—非商业性使用—相同方式共享）。本项目对输入进行了筛选、中文化、索引和地图坐标关联。',
});

export const dataSources = Object.freeze([
  Object.freeze({name: 'SPT / SP-Tushonka', url: 'https://github.com/SP-Tushonka/server-csharp', description: '物资、任务及相关数据的固定版本输入。'}),
  Object.freeze({name: 'tarkov.dev', url: 'https://tarkov.dev/api', description: '部分物品信息、图标、地区标注和价格数据。'}),
]);

export function projectNoticeText() {
  return [`作者声明\n${projectNotice.author}`, projectNotice.rights, projectNotice.independence,
    ...dataSources.map(source => `${source.name}：${source.description}\n${source.url}`),
    projectNotice.client, projectNotice.license, projectNotice.sptLicense].join('\n\n');
}
