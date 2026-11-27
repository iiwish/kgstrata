// 效果页的演示数据（中文界面默认）：三国。从上到下 战役 / 势力 / 人物。
// 势力之间是联盟、敌对、取代；人物之间是君臣、亲属、夫妻、交情、对手；人物效力于哪一方是映射——
// 三国人物常常先后效力好几方（刘备依附过公孙瓒、曹操、袁绍、刘表），多对多是现成的。家族（曹氏、孙氏、袁氏、司马氏）收着成员。
// 第一版按正史《三国志》，第二版按小说《三国演义》：加了貂蝉、周仓、桃园结义，斩华雄的人从孙坚改成关羽，多了“三英战吕布”。
// 都是为演示挑的，关系按大家熟悉的说法简化过。黄巾军在人物层里有意没放人，华佗哪一方都不算：映射审计会把它们标出来。

import { eid, makeSaga, pid, sid, type SagaSpec } from './saga'

const spec: SagaSpec = {
  title: ['三国知识图谱', 'Three Kingdoms knowledge graph'],
  layers: { event: ['战役', 'Battles'], side: ['势力', 'Factions'], person: ['人物', 'People'] },
  groupingName: ['阵营', 'Camp'],
  groups: [
    { id: 'wei', name: ['魏', 'Wei'], color: '#58c6ff' },
    { id: 'shu', name: ['蜀', 'Shu'], color: '#46d8a8' },
    { id: 'wu', name: ['吴', 'Wu'], color: '#ee9772' },
    { id: 'warlord', name: ['群雄', 'Warlords'], color: '#ecb556' },
    { id: 'han', name: ['汉室', 'Han court'], color: '#a590ff' },
    { id: 'jin', name: ['晋', 'Jin'], color: '#dd94c2' },
  ],
  sides: [
    ['han', ['东汉朝廷', 'Han court'], 'han'],
    ['yellow', ['黄巾军', 'Yellow Turbans'], 'han'],
    ['dongzhuo', ['董卓军', "Dong Zhuo's army"], 'warlord'],
    ['yuanshao', ['袁绍军', "Yuan Shao's army"], 'warlord'],
    ['yuanshu', ['袁术军', "Yuan Shu's army"], 'warlord'],
    ['gongsunzan', ['公孙瓒军', "Gongsun Zan's army"], 'warlord'],
    ['lvbu', ['吕布军', "Lü Bu's army"], 'warlord'],
    ['liubiao', ['荆州刘表', 'Jing (Liu Biao)'], 'warlord'],
    ['liuzhang', ['益州刘璋', 'Yi (Liu Zhang)'], 'warlord'],
    ['zhanglu', ['汉中张鲁', 'Hanzhong (Zhang Lu)'], 'warlord'],
    ['wei', ['曹魏', 'Wei'], 'wei'],
    ['shu', ['蜀汉', 'Shu'], 'shu'],
    ['wu', ['东吴', 'Wu'], 'wu'],
    ['jin', ['西晋', 'Jin'], 'jin'],
  ],
  sideLinks: [
    ['han', 'yellow', 'rival'],
    ['wei', 'yellow', 'rival'],
    ['yuanshao', 'dongzhuo', 'rival'],
    ['yuanshu', 'dongzhuo', 'rival'],
    ['wei', 'dongzhuo', 'rival'],
    ['wu', 'dongzhuo', 'rival'],
    ['yuanshao', 'gongsunzan', 'rival'],
    ['yuanshao', 'yuanshu', 'rival'],
    ['yuanshu', 'gongsunzan', 'ally'],
    ['wei', 'lvbu', 'rival'],
    ['wei', 'yuanshu', 'rival'],
    ['wei', 'yuanshao', 'rival'],
    ['wu', 'liubiao', 'rival'],
    ['liuzhang', 'zhanglu', 'rival'],
    ['wei', 'zhanglu', 'rival'],
    ['shu', 'liuzhang', 'replace'],
    ['wu', 'shu', 'ally'],
    ['wu', 'shu', 'rival'],
    ['wei', 'shu', 'rival'],
    ['wei', 'wu', 'rival'],
    ['wei', 'han', 'replace'],
    ['jin', 'wei', 'replace'],
    ['jin', 'wu', 'rival'],
  ],
  families: [
    ['cao', ['曹氏', 'Cao clan']],
    ['sun', ['孙氏', 'Sun clan']],
    ['yuan', ['袁氏', 'Yuan clan']],
    ['sima', ['司马氏', 'Sima clan']],
  ],
  people: [
    // 魏
    ['caocao', ['曹操', 'Cao Cao'], ['wei', 'han'], 'cao'],
    ['caopi', ['曹丕', 'Cao Pi'], ['wei'], 'cao'],
    ['caozhi', ['曹植', 'Cao Zhi'], ['wei'], 'cao'],
    ['xiahoudun', ['夏侯惇', 'Xiahou Dun'], ['wei']],
    ['xiahouyuan', ['夏侯渊', 'Xiahou Yuan'], ['wei']],
    ['zhangliao', ['张辽', 'Zhang Liao'], ['wei', 'lvbu', 'dongzhuo']],
    ['xuchu', ['许褚', 'Xu Chu'], ['wei']],
    ['dianwei', ['典韦', 'Dian Wei'], ['wei']],
    ['guojia', ['郭嘉', 'Guo Jia'], ['wei', 'yuanshao']],
    ['xunyu', ['荀彧', 'Xun Yu'], ['wei', 'yuanshao']],
    ['simayi', ['司马懿', 'Sima Yi'], ['wei', 'jin'], 'sima'],
    ['simazhao', ['司马昭', 'Sima Zhao'], ['wei', 'jin'], 'sima'],
    // 蜀
    ['liubei', ['刘备', 'Liu Bei'], ['shu', 'gongsunzan', 'wei', 'yuanshao', 'liubiao']],
    ['guanyu', ['关羽', 'Guan Yu'], ['shu', 'wei']],
    ['zhangfei', ['张飞', 'Zhang Fei'], ['shu']],
    ['zhugeliang', ['诸葛亮', 'Zhuge Liang'], ['shu']],
    ['zhaoyun', ['赵云', 'Zhao Yun'], ['shu', 'gongsunzan']],
    ['machao', ['马超', 'Ma Chao'], ['shu', 'zhanglu']],
    ['huangzhong', ['黄忠', 'Huang Zhong'], ['shu', 'liubiao']],
    ['pangtong', ['庞统', 'Pang Tong'], ['shu', 'wu']],
    ['fazheng', ['法正', 'Fa Zheng'], ['shu', 'liuzhang']],
    ['jiangwei', ['姜维', 'Jiang Wei'], ['shu', 'wei']],
    ['liushan', ['刘禅', 'Liu Shan'], ['shu']],
    // 吴
    ['sunjian', ['孙坚', 'Sun Jian'], ['wu', 'yuanshu'], 'sun'],
    ['sunce', ['孙策', 'Sun Ce'], ['wu', 'yuanshu'], 'sun'],
    ['sunquan', ['孙权', 'Sun Quan'], ['wu'], 'sun'],
    ['ladysun', ['孙夫人', 'Lady Sun'], ['wu'], 'sun'],
    ['zhouyu', ['周瑜', 'Zhou Yu'], ['wu']],
    ['lusu', ['鲁肃', 'Lu Su'], ['wu']],
    ['lvmeng', ['吕蒙', 'Lü Meng'], ['wu']],
    ['luxun', ['陆逊', 'Lu Xun'], ['wu']],
    ['huanggai', ['黄盖', 'Huang Gai'], ['wu']],
    ['ganning', ['甘宁', 'Gan Ning'], ['wu', 'liubiao']],
    ['zhugejin', ['诸葛瑾', 'Zhuge Jin'], ['wu']],
    // 群雄
    ['dongzhuo', ['董卓', 'Dong Zhuo'], ['dongzhuo']],
    ['huaxiong', ['华雄', 'Hua Xiong'], ['dongzhuo']],
    ['lvbu', ['吕布', 'Lü Bu'], ['lvbu', 'dongzhuo']],
    ['chengong', ['陈宫', 'Chen Gong'], ['lvbu', 'wei']],
    ['dingyuan', ['丁原', 'Ding Yuan'], ['han']],
    ['yuanshao', ['袁绍', 'Yuan Shao'], ['yuanshao'], 'yuan'],
    ['yuanshu', ['袁术', 'Yuan Shu'], ['yuanshu'], 'yuan'],
    ['gongsunzan', ['公孙瓒', 'Gongsun Zan'], ['gongsunzan']],
    ['liubiao', ['刘表', 'Liu Biao'], ['liubiao']],
    ['huangzu', ['黄祖', 'Huang Zu'], ['liubiao']],
    ['liuzhang', ['刘璋', 'Liu Zhang'], ['liuzhang']],
    ['zhanglu', ['张鲁', 'Zhang Lu'], ['zhanglu', 'wei']],
    // 哪一方都不算
    ['huatuo', ['华佗', 'Hua Tuo'], []],
  ],
  personLinks: [
    // 君臣
    ['liubei', 'zhugeliang', 'lord'], ['liubei', 'zhaoyun', 'lord'], ['liubei', 'machao', 'lord'], ['liubei', 'huangzhong', 'lord'],
    ['liubei', 'pangtong', 'lord'], ['liubei', 'fazheng', 'lord'], ['liushan', 'jiangwei', 'lord'],
    ['caocao', 'xiahoudun', 'lord'], ['caocao', 'xiahouyuan', 'lord'], ['caocao', 'zhangliao', 'lord'], ['caocao', 'xuchu', 'lord'],
    ['caocao', 'dianwei', 'lord'], ['caocao', 'guojia', 'lord'], ['caocao', 'xunyu', 'lord'], ['caocao', 'simayi', 'lord'],
    ['sunce', 'zhouyu', 'lord'], ['sunquan', 'lusu', 'lord'], ['sunquan', 'lvmeng', 'lord'], ['sunquan', 'luxun', 'lord'],
    ['sunquan', 'huanggai', 'lord'], ['sunquan', 'ganning', 'lord'], ['sunquan', 'zhugejin', 'lord'],
    ['dongzhuo', 'huaxiong', 'lord'], ['dingyuan', 'lvbu', 'lord'], ['lvbu', 'chengong', 'lord'], ['lvbu', 'zhangliao', 'lord'],
    ['liubiao', 'huangzu', 'lord'], ['yuanshu', 'sunce', 'lord'],
    // 亲属、夫妻
    ['caocao', 'caopi', 'kin'], ['caocao', 'caozhi', 'kin'], ['sunjian', 'sunce', 'kin'], ['sunjian', 'sunquan', 'kin'],
    ['sunjian', 'ladysun', 'kin'], ['yuanshao', 'yuanshu', 'kin'], ['simayi', 'simazhao', 'kin'], ['liubei', 'liushan', 'kin'],
    ['zhugeliang', 'zhugejin', 'kin'], ['liubei', 'ladysun', 'marriage'],
    // 交情（正史说刘关张“恩若兄弟”）
    ['liubei', 'guanyu', 'friend'], ['liubei', 'zhangfei', 'friend'], ['sunce', 'zhouyu', 'friend'], ['lusu', 'zhugeliang', 'friend'],
    ['zhouyu', 'lusu', 'friend'], ['liubei', 'gongsunzan', 'friend'],
    // 对手、斩杀
    ['lvbu', 'dingyuan', 'slew'], ['lvbu', 'dongzhuo', 'slew'], ['caocao', 'lvbu', 'slew'], ['sunjian', 'huaxiong', 'slew'],
    ['huangzu', 'sunjian', 'slew'], ['huangzhong', 'xiahouyuan', 'slew'], ['caocao', 'huatuo', 'slew'],
    ['lvmeng', 'guanyu', 'foe'], ['luxun', 'liubei', 'foe'], ['simayi', 'zhugeliang', 'foe'], ['caocao', 'yuanshao', 'foe'],
    ['caocao', 'liubei', 'foe'], ['zhouyu', 'caocao', 'foe'], ['yuanshao', 'gongsunzan', 'foe'], ['liuzhang', 'zhanglu', 'foe'],
  ],
  events: [
    ['yellowturban', ['黄巾之乱', 'Yellow Turban Rebellion'], ['yellow', 'han', 'wei']],
    ['antidong', ['讨伐董卓', 'Campaign against Dong Zhuo'], ['dongzhuo', 'yuanshao', 'yuanshu', 'wei', 'wu']],
    ['xiapi', ['下邳之战', 'Battle of Xiapi'], ['lvbu', 'wei']],
    ['guandu', ['官渡之战', 'Battle of Guandu'], ['yuanshao', 'wei']],
    ['chibi', ['赤壁之战', 'Battle of Red Cliffs'], ['wei', 'wu', 'shu']],
    ['yizhou', ['刘备取益州', 'Liu Bei takes Yi'], ['shu', 'liuzhang']],
    ['dingjun', ['定军山之战', 'Battle of Mount Dingjun'], ['shu', 'wei']],
    ['fancheng', ['襄樊之战', 'Battle of Fancheng'], ['shu', 'wei', 'wu']],
    ['yiling', ['夷陵之战', 'Battle of Yiling'], ['shu', 'wu']],
    ['north', ['诸葛亮北伐', 'Northern Expeditions'], ['shu', 'wei']],
  ],
  eventLinks: [
    ['xiapi', 'guandu'], ['guandu', 'chibi'], ['chibi', 'yizhou'], ['yizhou', 'dingjun'], ['dingjun', 'fancheng'],
    ['fancheng', 'yiling'], ['yiling', 'north'],
  ],
}

export const {
  groups, panorama, layered, diffAfter, DIFF_REPLACES, paths, layeredPaths, NODE_STYLES, AUDIT, messages,
} = makeSaga({
  spec,
  // 第二版：小说《三国演义》
  edit: (d, lang, { rel, person }) => {
    const zh = lang === 'zh'
    // 新增：貂蝉（演义里王允的义女，连环计），周仓（关羽的部将）
    person('diaochan', ['貂蝉', 'Diaochan'], 'warlord')
    d.relations.push(
      { source: pid('lvbu'), target: pid('diaochan'), ...rel('marriage', lang) },
      { source: pid('diaochan'), target: pid('dongzhuo'), ...rel('foe', lang) },
    )
    person('zhoucang', ['周仓', 'Zhou Cang'], 'shu')
    d.relations.push({ source: pid('guanyu'), target: pid('zhoucang'), ...rel('lord', lang) }, { source: pid('zhoucang'), target: sid('shu'), ...rel('serves', lang), weight: 2 })
    // 新增：桃园结义
    d.relations.push(
      { source: pid('liubei'), target: pid('guanyu'), ...rel('sworn', lang) },
      { source: pid('liubei'), target: pid('zhangfei'), ...rel('sworn', lang) },
      { source: pid('guanyu'), target: pid('zhangfei'), ...rel('sworn', lang) },
    )
    // 关系改向：斩华雄的人从孙坚改成关羽（温酒斩华雄）
    for (const r of d.relations) if (r.source === pid('sunjian') && r.target === pid('huaxiong') && r.type === 'slew') r.source = pid('guanyu')
    // 新增战役：三英战吕布（只在有战役层的数据里）
    if (d.layers.some((l) => l.id === 'event')) {
      d.nodes.push({ id: eid('hulao'), layer: 'event', label: zh ? '三英战吕布' : 'Three heroes vs Lü Bu', type: 'event', groups: { camp: 'shu' } })
      d.relations.push(
        { source: eid('hulao'), target: sid('dongzhuo'), ...rel('involves', lang), weight: 2 },
        { source: eid('hulao'), target: sid('shu'), ...rel('involves', lang) },
      )
    }
  },
  paths: [
    {
      id: 'zhuge-brothers',
      question: ['诸葛亮和诸葛瑾是亲兄弟，各在哪一方？', 'Zhuge Liang and Zhuge Jin were brothers. Which side was each on?'],
      nodes: [sid('shu'), pid('zhugeliang'), pid('zhugejin'), sid('wu')],
    },
    {
      id: 'guanyu-sides',
      question: ['关羽先后效力过哪两方？', 'Which two sides did Guan Yu serve?'],
      nodes: [sid('wei'), pid('guanyu'), sid('shu')],
    },
    {
      id: 'guanyu-death',
      question: ['关羽败在谁手里？', 'Who brought Guan Yu down?'],
      nodes: [pid('guanyu'), pid('lvmeng'), sid('wu')],
    },
  ],
  layeredPath: {
    id: 'red-cliffs',
    question: ['赤壁之战，孙刘两家是谁牵的线？', 'At Red Cliffs, who brought Sun and Liu together?'],
    nodes: [eid('chibi'), sid('wu'), sid('shu'), pid('zhugeliang'), pid('lusu')],
  },
  audit: {
    zh: {
      'ui.audit-relations': '势力关系 {n} 条，人物里接得上 {ok} 条',
      'ui.audit-joins': '人物关系 {n} 条，有势力关系对应 {ok} 条',
      'ui.audit-group.broken': '人物里接不上的势力关系',
      'ui.audit-group.unused': '没有势力关系对应的人物关系',
      'ui.audit-group.via-path': '只被路径用到的人物关系',
      'ui.audit-unreachable': '两边都有人，{n} 层关系内连不上',
      'ui.audit-unused-relation': '两边效力的势力之间没有关系',
      'ui.audit-unused-unmapped': '有一头没有效力任何一方',
      'ui.audit-blocks': '{n} 条势力关系因此接不上',
    },
    en: {
      'ui.audit-relations': '{ok} of {n} faction relations connect through people',
      'ui.audit-joins': '{ok} of {n} relations between people match a faction relation',
      'ui.audit-group.broken': 'Faction relations no one connects',
      'ui.audit-group.unused': 'Ties with no faction relation behind them',
      'ui.audit-group.via-path': 'Ties only a path uses',
      'ui.audit-unreachable': 'People on both sides, no chain within {n} steps',
      'ui.audit-unused-relation': 'The factions at its ends are not related',
      'ui.audit-unused-unmapped': 'One end serves no faction',
      'ui.audit-blocks': '{n} faction relations cannot connect because of it',
    },
  },
})
