// Access requirements supplement the pinned task objectives and item templates.
// Door and route evidence includes EFT 47965 and https://www.eftarkov.com/.
// Each options entry is one route. Items within a route are used together.
export const taskAccessData = {
  source: {"eftBuild":47965,"sptCommit":"901f5693693c16ee074e0cc8caddc79a06b5facd"},
  tasks: {
    // 救援行动
    '657315e4a6af4ab4b50f3459': {
      '6575a64d3fc09bdfb38b713d': [
        {mapId: "ground_zero", options: [["658199aa38c79576a2569e13"]], location: "TerraGroup 总部二楼科学家办公室", bring: "onSite", note: "先到一楼搜科学家的尸体，再用取到的钥匙上楼开门。"},
      ],
      '65817fbbb454159976c91917': [
        {mapId: "ground_zero", options: [["658199aa38c79576a2569e13"]], location: "TerraGroup 总部二楼科学家办公室", bring: "onSite", note: "先到一楼搜科学家的尸体，再用取到的钥匙上楼开门。"},
      ],
    },
    // 背景调查
    '5936da9e86f7742d65037edf': {
      '5968ec9986f7741ddd6c1012': [
        {mapId: "customs", options: [["5937ee6486f77408994ba448"]], location: "工地油罐车驾驶室", bring: "onSite", note: "可在三层宿舍楼二楼 205 房间的夹克里取机械钥匙。用它打开驾驶室后拾取怀表。"},
      ],
    },
    // 水瓶座行动
    '59689fbd86f7740d137ebfc4': {
      '5a3fb73b86f77458e0324376': [
        {mapId: "customs", options: [["5938603e86f77435642354f4"]], location: "双层宿舍楼二楼 206 房间"},
      ],
    },
    // 罪证
    '5967530a86f77462ba22226b': {
      '5a3fbdb086f7745a554f0c31': [
        {mapId: "factory", options: [["5448ba0b4bdc2d02308b456c"]], location: "工厂办公区三楼的上锁房间"},
      ],
      '5968943f86f7740d137ebfc2': [
        {mapId: "customs", options: [["5938144586f77473c2087145"]], location: "工地的简易工棚", bring: "conditional", note: "进门用简易工棚钥匙，也可从窗外取桌上的文件。取得钥匙仍是单独的任务目标。"},
      ],
    },
    // 敲诈者
    '596b43fb86f77457ca186186': {
      '596b44b686f77457cb50ecca': [
        {mapId: "customs", options: [["593962ca86f774068014d9af"]], location: "吊车附近的铁皮工棚", bring: "onSite", note: "先从信使尸体上拿未知钥匙，再打开藏货的工棚。"},
      ],
      '5a3fbab086f77421593d9bf0': [
        {mapId: "customs", options: [["593962ca86f774068014d9af"]], location: "吊车附近的铁皮工棚", bring: "onSite", note: "先从信使尸体上拿未知钥匙，再打开藏货的工棚。"},
      ],
    },
    // 药剂师
    '5969f9e986f7741dde183a50': {
      '5969fa4886f7741ddb481544': [
        {mapId: "customs", options: [["59387a4986f77401cc236e62"]], location: "双层宿舍楼一楼 114 房间"},
      ],
      '5a3fb92286f77422b46cdb18': [
        {mapId: "customs", options: [["59387a4986f77401cc236e62"]], location: "双层宿舍楼一楼 114 房间"},
      ],
    },
    // 往事速递
    '59674eb386f774539f14813a': {
      '5968929e86f7740d121082d3': [
        {mapId: "customs", options: [["5780d0532459777a5108b9a2"]], location: "海关大红仓库二楼 Tarcone 主管办公室"},
      ],
    },
    // 挖矿
    '5ac3462b86f7741d6118b983': {
      '5ac6248586f77416781dd3a3': [
        {mapId: "customs", options: [["5780d0532459777a5108b9a2"]], location: "海关大红仓库二楼 Tarcone 主管办公室"},
      ],
    },
    // 金色失物
    '5979eee086f774311955e614': {
      '5979ef4586f77431307dc513': [
        {mapId: "customs", options: [["593aa4be86f77457f56379f8"]], location: "三层宿舍楼 303 房间", note: "取镀金打火机和藏普通打火机都在这个房间。"},
      ],
      '5979ef7986f77431307dc514': [
        {mapId: "customs", options: [["593aa4be86f77457f56379f8"]], location: "三层宿舍楼 303 房间", note: "取镀金打火机和藏普通打火机都在这个房间。"},
      ],
    },
    // 货运追踪
    '675c047fa46173572a0bd878': {
      '675c04b3fc6b273a36ed294a': [
        {mapId: "customs", options: [["6761a6f90575f25e020816a4"]], location: "油罐区二楼公司主管办公室", note: "使用油罐区这把钥匙开启办公室，再找货运清单。"},
      ],
    },
    // 探囊取物
    '5967725e86f774601a446662': {
      '5968981986f7740d1648df42': [
        {mapId: "customs", options: [["5938504186f7740991483f30"]], location: "三层宿舍楼二楼 203 房间"},
      ],
      '5a3fc03286f77414d64f9941': [
        {mapId: "customs", options: [["5780cf942459777df90dcb72"]], location: "三层宿舍楼二楼 214 房间"},
      ],
    },
    // 化学品 - 2
    '597a0b2986f77426d66c0633': {
      '597a0be986f774273b74f673': [
        {mapId: "customs", options: [["5780cfa52459777dfb276eb1"]], location: "三层宿舍楼二楼 220 房间", note: "两件任务物品都在这间屋内，可同一趟取齐。"},
      ],
      '597a0bb486f77426d66c0634': [
        {mapId: "customs", options: [["5780cfa52459777dfb276eb1"]], location: "三层宿舍楼二楼 220 房间", note: "两件任务物品都在这间屋内，可同一趟取齐。"},
      ],
    },
    // 这是什么梗？
    '66d9cbb67b491f9d5304f6e6': {
      '66db1f94a147d9840ec0dfba': [
        {mapId: "factory", options: [["5448ba0b4bdc2d02308b456c"]], location: "办公区三楼「阴谋论学家」的房间"},
      ],
    },
    // 妥善保管
    '669fa3a08b4a64b332041ff7': {
      '66a0e692281e56a89b717b7d': [
        {mapId: "factory", options: [["66acd6702b17692df20144c0"]], location: "地下 TerraGroup 仓库"},
      ],
    },
    // 医疗隐私 - 6
    '669fa3a3ad7f1eac2607ed48': {
      '66a0f391676953651bd8b796': [
        {mapId: "factory", options: [["5448ba0b4bdc2d02308b456c"]], location: "医疗帐篷撤离点的门", note: "血样在门内的尸体处。若计划带血样直接转移去实验室，也要带上实验室的两张卡。"},
      ],
      '6a6070549ba7daf0a3ca7ae9': [
        {mapId: "labs", options: [["5efde6b4f5448336730dbd61"]], location: "二楼 Sanitar 的办公室", note: "办公室在绿卡房对面。"},
        {mapId: "labs", options: [["5c94bbff86f7747ee735c08f"]], location: "实验室入场", entry: true, note: "每次入场准备一张白卡。"},
      ],
    },
    // 头号机密
    '626bd75d5bef5d7d590bd415': {
      '63ac19f9de609574d97adf78': [
        {mapId: "lighthouse", options: [["62987c658081af308d7558c6"]], location: "灯塔岛雷达站指挥室", note: "先解锁灯塔商人通行，再上岛打开办公室。"},
      ],
      '62863b9ae5b4f5010e0d30c8': [
        {mapId: "lighthouse", options: [["62987c658081af308d7558c6"]], location: "灯塔岛雷达站指挥室", note: "先解锁灯塔商人通行，再上岛打开办公室。"},
      ],
    },
    // 直播 - 1
    '626bd75e47ea7f506e5493c5': {
      '63ac232087413d64ae0ac23c': [
        {mapId: "lighthouse", options: [["62987da96188c076bc0d8c51"]], location: "水处理厂 1 号厂房录制室"},
      ],
      '626c3158a371ee3a7a3514cc': [
        {mapId: "lighthouse", options: [["62987da96188c076bc0d8c51"]], location: "水处理厂 1 号厂房录制室"},
      ],
    },
    // 化学橱柜
    '5f04886a3937dc337a6b8238': {
      '5f0488c590eea473df674002': [
        {mapId: "shoreline", options: [["5eff09cd30a7dc22fd1ddfed"]], location: "疗养院东楼一楼 110 房间", note: "用贴胶带的钥匙打开 Sanitar 的办公室。"},
      ],
    },
    // 你渴望电力吗
    '5a03296886f774569778596a': {
      '5a3ba65f86f7743af1475f11': [
        {mapId: "shoreline", options: [["5a13ef0686f7746e5a411744"]], location: "疗养院西楼二楼 219 房间"},
      ],
    },
    // 塔科夫式手腕
    '5edaba7c0c502106f869bc02': {
      '5edabbff0880da21347b382b': [
        {mapId: "shoreline", options: [["5a0eb6ac86f7743124037a28"]], location: "别墅的后门", note: "从后门上二楼取检眼镜。"},
      ],
    },
    // 神秘货物
    '5a27bb1e86f7741f27621b7e': {
      '5a28183186f774398675d127': [
        {mapId: "shoreline", options: [["5a145d4786f7744cbb6f4a12"],["5a145d7b86f7744cbb6f4a13"]], location: "疗养院东楼三楼 306 房间", note: "任选一把。用 308 钥匙开门后可经相连的阳台到 306。"},
      ],
    },
    // 医疗隐私 - 2
    '5a68663e86f774501078f78a': {
      '5a68760f86f7743cc55d8709': [
        {mapId: "shoreline", options: [["5a13f46386f7741dd7384b04"]], location: "疗养院西楼三楼 306 房间", note: "研究文件在房间的阳台上。"},
      ],
    },
    // 湿活 - 5
    '5a27bc6986f7741c7358402b': {
      '5a2e958d86f77416be092111': [
        {mapId: "shoreline", options: [["5a0eee1486f77402aa773226"]], location: "疗养院东楼三楼 328 房间"},
      ],
    },
    // 暗藏玄机
    '67a096577e86e067eb045733': {
      '67dbdd4d6a2e4b8e002b647d': [
        {mapId: "shoreline", options: [["679b9716597ba2ed120c3d3f"]], location: "疗养院西楼地下设施外门", note: "入口在地下泳池旁。"},
      ],
    },
    // 损失惨重
    '5ae4493d86f7744b8e15aa8f': {
      '5ae9b5bd86f774307c29df37': [
        {mapId: "interchange", options: [["5ad5cfbd86f7742c825d6104"]], location: "OLI 物流办公室"},
      ],
    },
    // 挑衅
    '63966ff54c3ef01b6f3ffad8': {
      '639a77b97cb1a8023d49f683': [
        {mapId: "interchange", options: [["5ad5d7d286f77450166e0a89","5addaffe86f77470b455f900"]], location: "ULTRA 商场 Kiba 武器商店", note: "先完成击杀目标并给商场通电。外门和内侧格栅各用一把钥匙。"},
      ],
      '639a78046402c537c15d012f': [
        {mapId: "interchange", options: [["5e42c81886f7742a01529f57"]], location: "秘密安全屋", note: "先完成击杀目标并通电，再到餐厅厕所内刷卡，开启地下停车场的安全屋。"},
      ],
      '639a78c27cb1a8023d49f684': [
        {mapId: "interchange", options: [["5e42c83786f7742a021fdf3c"]], location: "商场外的 21WS 集装箱", note: "先完成击杀目标并通电，再在集装箱门口刷卡。"},
      ],
    },
    // 诱人新货
    '671a49f77d49aea42c029b5f': {
      '671a5941cb557f8656561a12': [
        {mapId: "interchange", options: [["5e42c83786f7742a021fdf3c"]], location: "商场外的 21WS 集装箱", note: "先给商场通电，再刷卡进门取武器箱。"},
      ],
    },
    // 抢夺先机
    '63966fccac6f8f3c677b9d89': {
      '6399c929d65735732c6ba766': [
        {mapId: "reserve", options: [["5d9f1fa686f774726974a992"]], location: "白马楼旁维修中心的坦克房", note: "BMP-2 和原始情报都在坦克房里。"},
      ],
      '6399ca5fe101160ce05706ac': [
        {mapId: "reserve", options: [["5d9f1fa686f774726974a992"]], location: "白马楼旁维修中心的坦克房", note: "BMP-2 和原始情报都在坦克房里。"},
      ],
    },
    // 物尽其用
    '6089732b59b92115597ad789': {
      '6092942fb0f07c6ea1246e3a': [
        {mapId: "reserve", options: [["5d9f1fa686f774726974a992"]], location: "白马楼旁维修中心的坦克房"},
      ],
    },
    // 无中生有 - 储备站
    '6086c852c945025d41566124': {
      '608826f3949eb1096c454fd0': [
        {mapId: "reserve", options: [["5d9f1fa686f774726974a992"]], location: "维修中心的坦克房", note: "第三辆 BMP-2 在锁门内，检查和标记都需要到这里。"},
      ],
      '60882714c18cfa2a4e2afe59': [
        {mapId: "reserve", options: [["5d9f1fa686f774726974a992"]], location: "维修中心的坦克房", note: "第三辆 BMP-2 在锁门内，检查和标记都需要到这里。"},
      ],
    },
    // 病历
    '60896e28e4a85c72ef3fa301': {
      '6091698a30bb620b3239874c': [
        {mapId: "reserve", options: [["5d947d4e86f774447b415895"]], location: "医疗楼二楼 RB-KSM 房间"},
      ],
      '60ae12ffb809a474875907aa': [
        {mapId: "reserve", options: [["5d947d3886f774447b415893"]], location: "医疗楼二楼 RB-SMP 房间"},
      ],
    },
    // 储备专家
    '608974af4b05530f55550c21': {
      '608bd2465e0ef91ab810f98a': [
        {mapId: "reserve", options: [["5d80c6c586f77440351beef1"]], location: "兵营东楼（黑兵）三楼值班室"},
      ],
      '608bd0c20637f21f9934b6e4': [
        {mapId: "reserve", options: [["5d80cd1a86f77402aa362f42"]], location: "兵营东楼（黑兵）二楼军械库"},
      ],
      '608bd136c61c4b541b381da3': [
        {mapId: "reserve", options: [["5d80ccac86f77470841ff452"]], location: "兵营南楼（白兵）四楼军械库"},
      ],
      '608bd149f597ad0a33574d74': [
        {mapId: "reserve", options: [["5d80ccdd86f77474f7575e02"]], location: "兵营南楼（白兵）二楼军械库"},
      ],
    },
    // 失踪的线人
    '63966fbeea19ac7ed845db2e': {
      '63a7cee004d3dc28a52a20f8': [
        {mapId: "streets", options: [["6398fd8ad3de3849057f5128"]], location: "线人的备用藏身处", bring: "onSite", note: "可先去线人原来的藏身处拿钥匙，再去备用藏身处找日记。"},
      ],
      '63990a1ddcdd126fef1771c1': [
        {mapId: "streets", options: [["6398fd8ad3de3849057f5128"]], location: "线人的备用藏身处", bring: "onSite", note: "可先去线人原来的藏身处拿钥匙，再去备用藏身处找日记。"},
      ],
    },
    // 你被盯上了
    '639136fa9444fb141f4e6eee': {
      '63a7d8665199ab1f7d4a7747': [
        {mapId: "streets", options: [["63a39f08cd6db0635c197600"]], location: "松木酒店 215 房间"},
      ],
      '639136fa9444fb141f4e6eef': [
        {mapId: "streets", options: [["63a39f08cd6db0635c197600"]], location: "松木酒店 215 房间"},
      ],
    },
    // 好吃到上瘾
    '64f5e20652fc01298e2c61e3': {
      '64f6a9e6dd44b6417729b535': [
        {mapId: "streets", options: [["64ccc1fe088064307e14a6f7"]], location: "白鲸餐厅三楼经理办公室", bring: "conditional", note: "经理办公室是候选刷新点之一。二楼的吧台和三楼的酒吧、厨房也可搜寻。"},
      ],
    },
    // 观察员
    '6396700fea19ac7ed845db32': {
      '63a7d315f32fa1316250c3d2': [
        {mapId: "streets", options: [["63a39e1d234195315d4020bd"]], location: "Primorsky 大街邮局旁的芭蕾舞演员公寓", note: "这个点既要踩点，也要在房内藏热成像瞄准镜。"},
      ],
      '639c39807c1532d85b0162a9': [
        {mapId: "streets", options: [["63a39e1d234195315d4020bd"]], location: "Primorsky 大街邮局旁的芭蕾舞演员公寓", note: "这个点既要踩点，也要在房内藏热成像瞄准镜。"},
      ],
    },
    // 秘制食谱
    '64f6aafd67e11a7c6206e0d0': {
      '64f6aafd67e11a7c6206e0d1': [
        {mapId: "streets", options: [["64ccc206793ca11c8f450a38"]], location: "TerraGroup 大楼一楼会议室", bring: "conditional", note: "只在搜锁住的一楼会议室时使用。安全哨所和大楼内的其他办公区也有候选刷新点。"},
      ],
    },
    // 公司福报
    '65733403eefc2c312a759ddb': {
      '65733403eefc2c312a759ddc': [
        {mapId: "streets", options: [["6582dbe43a2e5248357dbe9a"]], location: "IT 公司调解室"},
      ],
      '65801ad655315fdce2096bec': [
        {mapId: "streets", options: [["6582dbe43a2e5248357dbe9a"]], location: "IT 公司调解室"},
      ],
    },
    // 老赖
    '639dbaf17c898a131e1cffff': {
      '6a5a9710671cbfe928bbfde2': [
        {mapId: "streets", options: [["63a39fc0af870e651d58e6ae"]], location: "Chekannaya 15 号公寓二楼看守住处"},
      ],
    },
    // 芭蕾舞者
    '639135a7e705511c8a4a1b78': {
      '63a7da6f5199ab1f7d4a774a': [
        {mapId: "streets", options: [["63a39e1d234195315d4020bd"]], location: "Primorsky 大街邮局旁的芭蕾舞演员公寓"},
      ],
    },
    // 软禁
    '639135c3744e452011470807': {
      '63a7d767f32fa1316250c3da': [
        {mapId: "streets", options: [["63a39f6e64283b5e9c56b289"]], location: "Chekannaya 15 号公寓三楼的关押点"},
      ],
    },
    // 高效秘诀
    '6573382e557ff128bf3da536': {
      '6573382e557ff128bf3da537': [
        {mapId: "streets", options: [["6582dbf0b8d7830efc45016f"]], location: "剧院与污水河之间的 IT 公司休息室"},
      ],
    },
    // 兽医也是医
    '64f731ab83cfca080a361e42': {
      '64f732240e186112c4455d84': [
        {mapId: "streets", options: [["64ccc246ff54fb38131acf29"]], location: "兽医诊所二楼 X 光工作间"},
      ],
    },
    // 探望
    '639135e8c115f907b14700aa': {
      '639135e8c115f907b14700ab': [
        {mapId: "streets", options: [["63a39c7964283b5e9c56b280"]], location: "Concordia 地下停车场安保室"},
      ],
    },
    // 你的车该洗了
    '639135534b15ca31f76bc317': {
      '639135534b15ca31f76bc318': [
        {mapId: "streets", options: [["63a397d3af870e651d58e65b","63a399193901f439517cafb6"]], location: "车行二楼负责人办公室", note: "先开车行封闭区域，再用办公室钥匙打开内门。"},
      ],
    },
    // 财不外露
    '6573397ef3f8344c4575cd87': {
      '6581676e7a18ff402fd23e68': [
        {mapId: "streets", options: [["6582dc5740562727a654ebb1"]], location: "不动产管理处办公室"},
      ],
    },
    // 高保真
    '639135bbc115f907b14700a6': {
      '63a7d8f404d3dc28a52a2104': [
        {mapId: "streets", options: [["63a39e1d234195315d4020bd"]], location: "Primorsky 46–48 号天桥后的音乐人集会点", note: "过天桥后打开通往公寓的门，进屋找吉他拨片。"},
      ],
      '639135bbc115f907b14700a7': [
        {mapId: "streets", options: [["63a39e1d234195315d4020bd"]], location: "Primorsky 46–48 号天桥后的音乐人集会点", note: "过天桥后打开通往公寓的门，进屋找吉他拨片。"},
      ],
    },
    // 神秘的门
    '64ee9df4496db64f9b7a4432': {
      '64ee9df4496db64f9b7a4433': [
        {mapId: "streets", options: [["64d4b23dc1b37504b41ac2b6"]], location: "宇航员壁画楼四楼神秘房间", note: "这把钥匙只能开一次。调查和室内摄像头可同一趟做。"},
      ],
      '64ee9df4496db64f9b7a4435': [
        {mapId: "streets", options: [["64d4b23dc1b37504b41ac2b6"]], location: "宇航员壁画楼四楼神秘房间", note: "这把钥匙只能开一次。调查和室内摄像头可同一趟做。"},
      ],
    },
    // 直播 - 4
    '6391372c8ba6894d155e77d7': {
      '63a7d6d61f06d111271f5aeb': [
        {mapId: "streets", options: [["63a3a93f8a56922e82001f5d"]], location: "剧院旁废弃工厂三楼符号房"},
      ],
    },
    // 直播 - 5
    '64ee99639878a0569d6ec8c9': {
      '64ee9a979878a0569d6ec8cb': [
        {mapId: "streets", options: [["64ccc25f95763a1ae376e447"]], location: "Chekannaya 大街宠物医院附近的符号房", note: "完成击杀祭司目标后，再进屋藏刀。"},
      ],
      '64ee9b5a1a5f313cb144bf87': [
        {mapId: "streets", options: [["64ccc25f95763a1ae376e447"]], location: "Chekannaya 大街宠物医院附近的符号房", note: "完成击杀祭司目标后，再进屋藏刀。"},
      ],
    },
    // 街区之下
    '66aba85403e0ee3101042877': {
      '66aba85403e0ee310104287a': [
        {mapId: "streets", options: [["5c94bbff86f7747ee735c08f"]], location: "塔科夫街区通往实验室的转移点", entry: true, note: "出发前带一张白卡供转移使用，进入实验室后同一局查完三个地点。"},
      ],
    },
    // 按图索骥
    '639670029113f06a7c3b2377': {
      '63a7cf9f04d3dc28a52a20fa': [
        {mapId: "labs", options: [["5c94bbff86f7747ee735c08f"]], location: "实验室入场", entry: true, note: "每次入场准备一张白卡。"},
        {mapId: "labs", options: [["5c1e2d1f86f77431e9280bee"]], location: "武器测试区"},
      ],
      '63a7cfe104d3dc28a52a20fc': [
        {mapId: "labs", options: [["5c94bbff86f7747ee735c08f"]], location: "实验室入场", entry: true, note: "每次入场准备一张白卡。"},
        {mapId: "labs", options: [["5c1d0f4986f7744bb01837fa"]], location: "人体实验室", note: "刷黑卡入内，再进中央的玻璃房踩点。"},
      ],
      '639ae49a5e3c9b787264d675': [
        {mapId: "labs", options: [["5c94bbff86f7747ee735c08f"]], location: "实验室入场", entry: true, note: "每次入场准备一张白卡。"},
        {mapId: "labs", options: [["5c1e2a1e86f77431ea0ea84c"]], location: "经理办公室", bring: "conditional", note: "只有办公室内的候选点需要钥匙；接待台和椭圆桌附近也有候选点。"},
      ],
    },
    // TerraGroup 雇员
    '5edac63b930f5454f51e128b': {
      '5eec9d054110547f1f545c99': [
        {mapId: "labs", options: [["5c94bbff86f7747ee735c08f"]], location: "实验室入场", entry: true, note: "每次入场准备一张白卡。"},
        {mapId: "labs", options: [["5efde6b4f5448336730dbd61"]], location: "二楼 Sanitar 的工作室"},
      ],
      '5eff5674befb6436ce3bbaf7': [
        {mapId: "labs", options: [["5c94bbff86f7747ee735c08f"]], location: "实验室入场", entry: true, note: "每次入场准备一张白卡。"},
        {mapId: "labs", options: [["5efde6b4f5448336730dbd61"]], location: "二楼 Sanitar 的工作室"},
      ],
    },
    // 质量标准
    '666314b696a9349baa021bac': {
      '6672e47f25ab92726912c3e5': [
        {mapId: "labs", options: [["5c94bbff86f7747ee735c08f"]], location: "实验室入场", entry: true, note: "白卡用于入场，任务的 LEDX 在圆顶帐篷内。"},
      ],
    },
    // 逐光而行 - 审慎信任
    '6a880acc9216d0f5aa078305': {
      '6a880bd44001082437c05d53': [
        {mapId: "labs", options: [["5c94bbff86f7747ee735c08f"]], location: "实验室入场", entry: true, note: "携带一张白卡入场。埋好硬盘后，须在同一局从通风管道撤离。"},
      ],
    },
    // 武装侦察
    '67a0970744893b9f3f0d9b68': {
      '67dbe0f532ff08bfa13237a8': [
        {mapId: "labyrinth", options: [["679b9716597ba2ed120c3d3f","679b9819a2f2dd4da9023512"]], location: "海岸线疗养院西楼地下的迷宫转移点", entry: true, note: "设施钥匙开外门，Labrys 卡用于转移进入迷宫。"},
      ],
    },
    // 守望者箴言
    '67a09761e720611a6a01f288': {
      '67a0e4df8cddbe2df31dd1d9': [
        {mapId: "labyrinth", options: [["679b9716597ba2ed120c3d3f","679b9819a2f2dd4da9023512"]], location: "海岸线疗养院西楼地下的迷宫转移点", entry: true, note: "设施钥匙开外门，Labrys 卡用于转移进入迷宫。"},
      ],
      '67a0e4e399e34c9ffcdc6e00': [
        {mapId: "labyrinth", options: [["679b9716597ba2ed120c3d3f","679b9819a2f2dd4da9023512"]], location: "海岸线疗养院西楼地下的迷宫转移点", entry: true, note: "设施钥匙开外门，Labrys 卡用于转移进入迷宫。"},
      ],
      '67a0e4e64cb065811d95c6d9': [
        {mapId: "labyrinth", options: [["679b9716597ba2ed120c3d3f","679b9819a2f2dd4da9023512"]], location: "海岸线疗养院西楼地下的迷宫转移点", entry: true, note: "设施钥匙开外门，Labrys 卡用于转移进入迷宫。"},
        {mapId: "labyrinth", options: [["679bab714e9ca6b3d80586b4"]], location: "迷宫停尸房", note: "第三把刀藏在停尸房内。"},
      ],
    },
    // 这带子糟透了
    '67a0972e77dd677f600804bd': {
      '67a0de6954c67082e9148328': [
        {mapId: "labyrinth", options: [["679b9716597ba2ed120c3d3f","679b9819a2f2dd4da9023512"]], location: "海岸线疗养院西楼地下的迷宫转移点", entry: true, note: "设施钥匙开外门，Labrys 卡用于转移。入场后在行刑室门外调查和取证。"},
      ],
      '67a0de84e8e35296a13500c8': [
        {mapId: "labyrinth", options: [["679b9716597ba2ed120c3d3f","679b9819a2f2dd4da9023512"]], location: "海岸线疗养院西楼地下的迷宫转移点", entry: true, note: "设施钥匙开外门，Labrys 卡用于转移。入场后在行刑室门外调查和取证。"},
      ],
    },
    // 检验假说
    '67a0970f05d1611ed90be75d': {
      '67dbe16ece16a02860ed9d33': [
        {mapId: "labyrinth", options: [["679b9716597ba2ed120c3d3f","679b9819a2f2dd4da9023512"]], location: "海岸线疗养院西楼地下的迷宫转移点", entry: true, note: "设施钥匙开外门，Labrys 卡用于转移进入迷宫。"},
      ],
    },
    // 绝对威信
    '67a097379f2068e74603c6ac': {
      '67a0df619fb6c42b9a08e8e9': [
        {mapId: "labyrinth", options: [["679b9716597ba2ed120c3d3f","679b9819a2f2dd4da9023512"]], location: "海岸线疗养院西楼地下的迷宫转移点", entry: true, note: "设施钥匙开外门，Labrys 卡用于转移进入迷宫。"},
      ],
      '67a0df7f2cd4d4413cd29b45': [
        {mapId: "labyrinth", options: [["679b9716597ba2ed120c3d3f","679b9819a2f2dd4da9023512"]], location: "海岸线疗养院西楼地下的迷宫转移点", entry: true, note: "设施钥匙开外门，Labrys 卡用于转移进入迷宫。"},
      ],
    },
    // 探秘"迷宫"
    '68e3a35002661eb2d30ce387': {
      '68e4dc6ce8f4a928b9c97683': [
        {mapId: "shoreline", options: [["679b9716597ba2ed120c3d3f"]], location: "疗养院西楼地下设施外门"},
      ],
      '6907cf0a8bade80b86f79c5d': [
        {mapId: "shoreline", options: [["679b9716597ba2ed120c3d3f","679b9819a2f2dd4da9023512"]], location: "疗养院西楼地下的迷宫转移点", entry: true, note: "设施钥匙开外门，Labrys 卡用于转移。可按剧情提示向 Jaeger 领取卡。"},
      ],
      '68e4e8b45fae2c907a1c4343': [
        {mapId: "labyrinth", options: [["679baace4e9ca6b3d80586b2"]], location: "迷宫的观察室", bring: "onSite", note: "钥匙可在迷宫内的科学家尸体处搜得，再打开办公室听录音带。"},
      ],
      '68e4e97ed2c83e861e65119c': [
        {mapId: "labyrinth", options: [["679baace4e9ca6b3d80586b2"]], location: "迷宫的观察室", bring: "onSite", note: "钥匙可在迷宫内的科学家尸体处搜得，再打开办公室听录音带。"},
      ],
    },
    // 塔科夫之旅
    '68cbd33676fe74b1e80bfd91': {
      '68c6afd2e48214ee402ccc2a': [
        {mapId: "labs", options: [["5c94bbff86f7747ee735c08f"]], location: "从工厂或塔科夫街区转移进入实验室", entry: true, note: "剧情这一步需要从转移点进入。携带一张白卡，可任选上述起始地图。"},
      ],
    },
    // 他们已经来了
    '6903d779fdfc4078740a4bd0': {
      '68e3b6156e7f1964549c75d4': [
        {mapId: "customs", options: [["5780cf7f2459777de4559322"]], location: "三层宿舍楼 314 符号房", bring: "conditional", note: "在海关、街区或储备站选择一个符号房，找到并阅读祭司笔记即可。"},
        {mapId: "streets", options: [["63a3a93f8a56922e82001f5d"]], location: "剧院旁废弃工厂三楼符号房", bring: "conditional", note: "在海关、街区或储备站选择一个符号房，找到并阅读祭司笔记即可。"},
        {mapId: "reserve", options: [["5d80c62a86f7744036212b3f"],["5d80c60f86f77440373c4ece"],["5ede7a8229445733cb4c18e2"]], location: "兵营、机侧楼或地堡控制室的符号房", bring: "conditional", note: "在海关、街区或储备站选择一个符号房，找到并阅读祭司笔记即可。"},
      ],
    },
  },
  items: {
    '5448ba0b4bdc2d02308b456c': {name: "工厂紧急出口钥匙", en: "Factory emergency exit key", icon: "data/icons/items/5448ba0b4bdc2d02308b456c.webp"},
    '5780cf7f2459777de4559322': {name: "宿舍楼 314 房间符号钥匙", en: "Dorm room 314 marked key", icon: "data/icons/items/5780cf7f2459777de4559322.webp"},
    '5780cf942459777df90dcb72': {name: "宿舍214房间钥匙", en: "Dorm room 214 key", icon: "data/icons/items/5780cf942459777df90dcb72.webp"},
    '5780cfa52459777dfb276eb1': {name: "宿舍220房间钥匙", en: "Dorm room 220 key", icon: "data/icons/items/5780cfa52459777dfb276eb1.webp"},
    '5780d0532459777a5108b9a2': {name: "海关 Tarcone 主管办公室钥匙", en: "Tarcone Director's office key", icon: "data/icons/items/5780d0532459777a5108b9a2.webp"},
    '5937ee6486f77408994ba448': {name: "机械钥匙", en: "Machinery key", icon: "data/icons/items/5937ee6486f77408994ba448.webp"},
    '5938144586f77473c2087145': {name: "简易工棚钥匙", en: "Portable bunkhouse key", icon: "data/icons/items/5938144586f77473c2087145.webp"},
    '5938504186f7740991483f30': {name: "宿舍203房间钥匙", en: "Dorm room 203 key", icon: "data/icons/items/5938504186f7740991483f30.webp"},
    '5938603e86f77435642354f4': {name: "宿舍206房间钥匙", en: "Dorm room 206 key", icon: "data/icons/items/5938603e86f77435642354f4.webp"},
    '59387a4986f77401cc236e62': {name: "宿舍114房间钥匙", en: "Dorm room 114 key", icon: "data/icons/items/59387a4986f77401cc236e62.webp"},
    '593962ca86f774068014d9af': {name: "未知钥匙", en: "Unknown key", icon: "data/icons/items/593962ca86f774068014d9af.webp"},
    '593aa4be86f77457f56379f8': {name: "宿舍303房间钥匙", en: "Dorm room 303 key", icon: "data/icons/items/593aa4be86f77457f56379f8.webp"},
    '5a0eb6ac86f7743124037a28': {name: "别墅后门钥匙", en: "Cottage back door key", icon: "data/icons/items/5a0eb6ac86f7743124037a28.webp"},
    '5a0eee1486f77402aa773226': {name: "疗养院东楼 328 房间钥匙", en: "Health Resort east wing room 328 key", icon: "data/icons/items/5a0eee1486f77402aa773226.webp"},
    '5a13ef0686f7746e5a411744': {name: "疗养院西楼 219 房间钥匙", en: "Health Resort west wing room 219 key", icon: "data/icons/items/5a13ef0686f7746e5a411744.webp"},
    '5a13f46386f7741dd7384b04': {name: "疗养院西楼 306 房间钥匙", en: "Health Resort west wing room 306 key", icon: "data/icons/items/5a13f46386f7741dd7384b04.webp"},
    '5a145d4786f7744cbb6f4a12': {name: "疗养院东楼 306 房间钥匙", en: "Health Resort east wing room 306 key", icon: "data/icons/items/5a145d4786f7744cbb6f4a12.webp"},
    '5a145d7b86f7744cbb6f4a13': {name: "疗养院东楼 308 房间钥匙", en: "Health Resort east wing room 308 key", icon: "data/icons/items/5a145d7b86f7744cbb6f4a13.webp"},
    '5ad5cfbd86f7742c825d6104': {name: "OLI物流部钥匙", en: "OLI logistics department office key", icon: "data/icons/items/5ad5cfbd86f7742c825d6104.webp"},
    '5ad5d7d286f77450166e0a89': {name: "Kiba 商店外门钥匙", en: "Kiba Arms outer door key", icon: "data/icons/items/5ad5d7d286f77450166e0a89.webp"},
    '5addaffe86f77470b455f900': {name: "Kiba 商店内侧格栅门钥匙", en: "Kiba Arms inner grate door key", icon: "data/icons/items/5addaffe86f77470b455f900.webp"},
    '5c1d0f4986f7744bb01837fa': {name: "实验室钥匙卡·黑", en: "TerraGroup Labs keycard (Black)", icon: "data/icons/items/5c1d0f4986f7744bb01837fa.webp"},
    '5c1e2a1e86f77431ea0ea84c': {name: "TerraGroup 实验室经理办公室钥匙", en: "TerraGroup Labs manager's office room key", icon: "data/icons/items/5c1e2a1e86f77431ea0ea84c.webp"},
    '5c1e2d1f86f77431e9280bee': {name: "TerraGroup 实验室武器测试区域钥匙", en: "TerraGroup Labs weapon testing area key", icon: "data/icons/items/5c1e2d1f86f77431e9280bee.webp"},
    '5c94bbff86f7747ee735c08f': {name: "TerraGroup实验室访问钥匙卡", en: "TerraGroup Labs access keycard", icon: "data/icons/items/5c94bbff86f7747ee735c08f.webp"},
    '5d80c60f86f77440373c4ece': {name: "RB-BK 符号钥匙", en: "RB-BK marked key", icon: "data/icons/items/5d80c60f86f77440373c4ece.webp"},
    '5d80c62a86f7744036212b3f': {name: "RB-VO 符号钥匙", en: "RB-VO marked key", icon: "data/icons/items/5d80c62a86f7744036212b3f.webp"},
    '5d80c6c586f77440351beef1': {name: "RB-OB钥匙", en: "RB-OB key", icon: "data/icons/items/5d80c6c586f77440351beef1.webp"},
    '5d80ccac86f77470841ff452': {name: "RB-ORB1钥匙", en: "RB-ORB1 key", icon: "data/icons/items/5d80ccac86f77470841ff452.webp"},
    '5d80ccdd86f77474f7575e02': {name: "RB-ORB2钥匙", en: "RB-ORB2 key", icon: "data/icons/items/5d80ccdd86f77474f7575e02.webp"},
    '5d80cd1a86f77402aa362f42': {name: "RB-ORB3钥匙", en: "RB-ORB3 key", icon: "data/icons/items/5d80cd1a86f77402aa362f42.webp"},
    '5d947d3886f774447b415893': {name: "RB-SMP钥匙", en: "RB-SMP key", icon: "data/icons/items/5d947d3886f774447b415893.webp"},
    '5d947d4e86f774447b415895': {name: "RB-KSM钥匙", en: "RB-KSM key", icon: "data/icons/items/5d947d4e86f774447b415895.webp"},
    '5d9f1fa686f774726974a992': {name: "RB-ST钥匙", en: "RB-ST key", icon: "data/icons/items/5d9f1fa686f774726974a992.webp"},
    '5e42c81886f7742a01529f57': {name: "Object #11SR 钥匙卡", en: "Object #11SR keycard", icon: "data/icons/items/5e42c81886f7742a01529f57.webp"},
    '5e42c83786f7742a021fdf3c': {name: "Object #21WS 钥匙卡", en: "Object #21WS keycard", icon: "data/icons/items/5e42c83786f7742a021fdf3c.webp"},
    '5ede7a8229445733cb4c18e2': {name: "RB-PKPM 符号钥匙", en: "RB-PKPM marked key", icon: "data/icons/items/5ede7a8229445733cb4c18e2.webp"},
    '5efde6b4f5448336730dbd61': {name: "蓝色记号钥匙卡", en: "Keycard with a blue marking", icon: "data/icons/items/5efde6b4f5448336730dbd61.webp"},
    '5eff09cd30a7dc22fd1ddfed': {name: "粘有胶带的疗养院办公室钥匙", en: "Health Resort office key with a blue tape", icon: "data/icons/items/5eff09cd30a7dc22fd1ddfed.webp"},
    '62987c658081af308d7558c6': {name: "雷达站指挥室钥匙", en: "Radar station commandant room key", icon: "data/icons/items/62987c658081af308d7558c6.webp"},
    '62987da96188c076bc0d8c51': {name: "手术室钥匙", en: "Operating room key", icon: "data/icons/items/62987da96188c076bc0d8c51.webp"},
    '6398fd8ad3de3849057f5128': {name: "备用藏身处钥匙", en: "Backup hideout key", icon: "data/icons/items/6398fd8ad3de3849057f5128.webp"},
    '63a397d3af870e651d58e65b': {name: "车行封闭区域钥匙", en: "Car dealership closed section key", icon: "data/icons/items/63a397d3af870e651d58e65b.webp"},
    '63a399193901f439517cafb6': {name: "车行负责人办公室钥匙", en: "Car dealership director's office room key", icon: "data/icons/items/63a399193901f439517cafb6.webp"},
    '63a39c7964283b5e9c56b280': {name: "Concordia 安保处钥匙", en: "Concordia security room key", icon: "data/icons/items/63a39c7964283b5e9c56b280.webp"},
    '63a39e1d234195315d4020bd': {name: "Primorsky 46-48号天桥钥匙", en: "Primorsky 46-48 skybridge key", icon: "data/icons/items/63a39e1d234195315d4020bd.webp"},
    '63a39f08cd6db0635c197600': {name: "酒店215房间钥匙", en: "Pinewood hotel room 215 key", icon: "data/icons/items/63a39f08cd6db0635c197600.webp"},
    '63a39f6e64283b5e9c56b289': {name: "铁门钥匙", en: "Iron gate key", icon: "data/icons/items/63a39f6e64283b5e9c56b289.webp"},
    '63a39fc0af870e651d58e6ae': {name: "Chekannaya 15号公寓钥匙", en: "Chekannaya 15 apartment key", icon: "data/icons/items/63a39fc0af870e651d58e6ae.webp"},
    '63a3a93f8a56922e82001f5d': {name: "废弃工厂符号钥匙", en: "Abandoned factory marked key", icon: "data/icons/items/63a3a93f8a56922e82001f5d.webp"},
    '64ccc1fe088064307e14a6f7': {name: "“白鲸”餐厅经理办公室钥匙", en: "Beluga restaurant director key", icon: "data/icons/items/64ccc1fe088064307e14a6f7.webp"},
    '64ccc206793ca11c8f450a38': {name: "TerraGroup会议室钥匙", en: "TerraGroup meeting room key", icon: "data/icons/items/64ccc206793ca11c8f450a38.webp"},
    '64ccc246ff54fb38131acf29': {name: "X光检查室钥匙", en: "X-ray room key", icon: "data/icons/items/64ccc246ff54fb38131acf29.webp"},
    '64ccc25f95763a1ae376e447': {name: "神秘房间符号钥匙", en: "Mysterious room marked key", icon: "data/icons/items/64ccc25f95763a1ae376e447.webp"},
    '64d4b23dc1b37504b41ac2b6': {name: "生锈的带血钥匙", en: "Rusted bloody key", icon: "data/icons/items/64d4b23dc1b37504b41ac2b6.webp"},
    '658199aa38c79576a2569e13': {name: "TerraGroup科学家办公室钥匙", en: "TerraGroup science office key", icon: "data/icons/items/658199aa38c79576a2569e13.webp"},
    '6582dbe43a2e5248357dbe9a': {name: "\"调解室\"钥匙", en: "\"Negotiation\" room key", icon: "data/icons/items/6582dbe43a2e5248357dbe9a.webp"},
    '6582dbf0b8d7830efc45016f': {name: "休息室钥匙", en: "Relaxation room key", icon: "data/icons/items/6582dbf0b8d7830efc45016f.webp"},
    '6582dc5740562727a654ebb1': {name: "不动产管理处办公室钥匙", en: "Real estate agency office room key", icon: "data/icons/items/6582dc5740562727a654ebb1.webp"},
    '66acd6702b17692df20144c0': {name: "TerraGroup 仓库钥匙卡", en: "TerraGroup storage room keycard", icon: "data/icons/items/66acd6702b17692df20144c0.webp"},
    '6761a6f90575f25e020816a4': {name: "公司主管办公室钥匙", en: "Company director's room key", icon: "data/icons/items/6761a6f90575f25e020816a4.webp"},
    '679b9716597ba2ed120c3d3f': {name: "Knossos LLC 设施钥匙", en: "Knossos LLC facility key", icon: "data/icons/items/679b9716597ba2ed120c3d3f.webp"},
    '679b9819a2f2dd4da9023512': {name: "Labrys 访问钥匙卡", en: "Labrys access keycard", icon: "data/icons/items/679b9819a2f2dd4da9023512.webp"},
    '679baace4e9ca6b3d80586b2': {name: "观察室钥匙", en: "Observation room key", icon: "data/icons/items/679baace4e9ca6b3d80586b2.webp"},
    '679bab714e9ca6b3d80586b4': {name: "停尸房钥匙", en: "Corpse room key", icon: "data/icons/items/679bab714e9ca6b3d80586b4.webp"},
  },
};
