// 效果页的演示数据（英文界面默认）：特洛伊战争。从上到下 事件 / 阵营 / 人物。
// 阵营是希腊各城邦、特洛伊和它的盟友、奥林匹斯诸神；人物效力（站在）哪一方是映射——众神本来就分边站，
// 雅典娜既是奥林匹斯神，又护着伊萨卡的奥德修斯；海伦从斯巴达到了特洛伊。家族（阿特柔斯家族、普里阿摩斯家族、珀琉斯家族）收着成员。
// 第一版按荷马史诗和史诗诗系，第二版按 2004 年的电影《特洛伊》：众神都拿掉了，墨涅拉俄斯、埃阿斯死在赫克托耳手里，
// 阿伽门农死在布里塞伊斯手里，帕特洛克罗斯从阿喀琉斯的挚友改成表弟。
// 色雷斯在人物层里有意没放人，厄里斯哪一方都不算：映射审计会把它们标出来。

import { eid, makeSaga, pid, sid, type SagaSpec } from './saga'

const spec: SagaSpec = {
  title: ['特洛伊战争知识图谱', 'Trojan War knowledge graph'],
  layers: { event: ['事件', 'Events'], side: ['阵营', 'Sides'], person: ['人物', 'Figures'] },
  groupingName: ['阵营', 'Camp'],
  groups: [
    { id: 'greek', name: ['希腊联军', 'Achaeans'], color: '#58c6ff' },
    { id: 'trojan', name: ['特洛伊', 'Trojans'], color: '#ee9772' },
    { id: 'ally', name: ['特洛伊的盟友', 'Trojan allies'], color: '#dd94c2' },
    { id: 'god', name: ['众神', 'Gods'], color: '#ecb556' },
  ],
  sides: [
    ['mycenae', ['迈锡尼', 'Mycenae'], 'greek'],
    ['sparta', ['斯巴达', 'Sparta'], 'greek'],
    ['ithaca', ['伊萨卡', 'Ithaca'], 'greek'],
    ['phthia', ['弗提亚', 'Phthia'], 'greek'],
    ['pylos', ['皮洛斯', 'Pylos'], 'greek'],
    ['salamis', ['萨拉米斯', 'Salamis'], 'greek'],
    ['troy', ['特洛伊', 'Troy'], 'trojan'],
    ['dardania', ['达耳达尼亚', 'Dardania'], 'ally'],
    ['lycia', ['吕基亚', 'Lycia'], 'ally'],
    ['amazons', ['亚马逊', 'Amazons'], 'ally'],
    ['aethiopia', ['埃塞俄比亚', 'Aethiopia'], 'ally'],
    ['thrace', ['色雷斯', 'Thrace'], 'ally'],
    ['olympus', ['奥林匹斯', 'Olympus'], 'god'],
  ],
  sideLinks: [
    ['mycenae', 'sparta', 'ally'], ['mycenae', 'ithaca', 'ally'], ['mycenae', 'phthia', 'ally'], ['mycenae', 'pylos', 'ally'], ['mycenae', 'salamis', 'ally'],
    ['mycenae', 'troy', 'rival'], ['sparta', 'troy', 'rival'], ['phthia', 'troy', 'rival'], ['ithaca', 'troy', 'rival'], ['salamis', 'troy', 'rival'],
    ['troy', 'dardania', 'ally'], ['troy', 'lycia', 'ally'], ['troy', 'amazons', 'ally'], ['troy', 'aethiopia', 'ally'], ['troy', 'thrace', 'ally'],
  ],
  families: [
    ['atreus', ['阿特柔斯家族', 'House of Atreus']],
    ['priam', ['普里阿摩斯家族', 'House of Priam']],
    ['peleus', ['珀琉斯家族', 'House of Peleus']],
  ],
  people: [
    // 希腊
    ['agamemnon', ['阿伽门农', 'Agamemnon'], ['mycenae'], 'atreus'],
    ['menelaus', ['墨涅拉俄斯', 'Menelaus'], ['sparta'], 'atreus'],
    ['helen', ['海伦', 'Helen'], ['sparta', 'troy']],
    ['peleus', ['珀琉斯', 'Peleus'], ['phthia'], 'peleus'],
    ['achilles', ['阿喀琉斯', 'Achilles'], ['phthia'], 'peleus'],
    ['neoptolemus', ['涅俄普托勒摩斯', 'Neoptolemus'], ['phthia'], 'peleus'],
    ['patroclus', ['帕特洛克罗斯', 'Patroclus'], ['phthia']],
    ['odysseus', ['奥德修斯', 'Odysseus'], ['ithaca']],
    ['ajax', ['埃阿斯', 'Ajax'], ['salamis']],
    ['nestor', ['涅斯托耳', 'Nestor'], ['pylos']],
    // 特洛伊和盟友
    ['priam', ['普里阿摩斯', 'Priam'], ['troy'], 'priam'],
    ['hector', ['赫克托耳', 'Hector'], ['troy'], 'priam'],
    ['paris', ['帕里斯', 'Paris'], ['troy'], 'priam'],
    ['cassandra', ['卡珊德拉', 'Cassandra'], ['troy'], 'priam'],
    ['andromache', ['安德洛玛刻', 'Andromache'], ['troy']],
    ['briseis', ['布里塞伊斯', 'Briseis'], ['troy']],
    ['aeneas', ['埃涅阿斯', 'Aeneas'], ['dardania', 'troy']],
    ['sarpedon', ['萨耳珀冬', 'Sarpedon'], ['lycia']],
    ['penthesilea', ['彭忒西勒亚', 'Penthesilea'], ['amazons']],
    ['memnon', ['门农', 'Memnon'], ['aethiopia']],
    // 众神：既是奥林匹斯神，又站在一边
    ['zeus', ['宙斯', 'Zeus'], ['olympus']],
    ['hera', ['赫拉', 'Hera'], ['olympus', 'mycenae']],
    ['athena', ['雅典娜', 'Athena'], ['olympus', 'ithaca']],
    ['poseidon', ['波塞冬', 'Poseidon'], ['olympus']],
    ['apollo', ['阿波罗', 'Apollo'], ['olympus', 'troy']],
    ['aphrodite', ['阿佛洛狄忒', 'Aphrodite'], ['olympus', 'troy']],
    ['ares', ['阿瑞斯', 'Ares'], ['olympus', 'troy']],
    ['thetis', ['忒提斯', 'Thetis'], ['phthia']],
    // 哪一方都不算
    ['eris', ['厄里斯', 'Eris'], []],
  ],
  personLinks: [
    // 亲属、夫妻
    ['agamemnon', 'menelaus', 'kin'], ['priam', 'hector', 'kin'], ['priam', 'paris', 'kin'], ['priam', 'cassandra', 'kin'],
    ['peleus', 'achilles', 'kin'], ['achilles', 'neoptolemus', 'kin'], ['thetis', 'achilles', 'kin'],
    ['zeus', 'athena', 'kin'], ['zeus', 'apollo', 'kin'], ['zeus', 'ares', 'kin'], ['zeus', 'aphrodite', 'kin'], ['zeus', 'poseidon', 'kin'],
    ['zeus', 'sarpedon', 'kin'], ['aphrodite', 'aeneas', 'kin'], ['ares', 'eris', 'kin'],
    ['menelaus', 'helen', 'marriage'], ['paris', 'helen', 'marriage'], ['hector', 'andromache', 'marriage'], ['zeus', 'hera', 'marriage'],
    ['peleus', 'thetis', 'marriage'],
    // 交情、庇护、俘获
    ['achilles', 'patroclus', 'friend'], ['athena', 'odysseus', 'patron'], ['aphrodite', 'paris', 'patron'], ['apollo', 'hector', 'patron'],
    ['achilles', 'briseis', 'captive'],
    // 对手、斩杀
    ['hector', 'patroclus', 'slew'], ['achilles', 'hector', 'slew'], ['paris', 'achilles', 'slew'], ['achilles', 'penthesilea', 'slew'],
    ['achilles', 'memnon', 'slew'], ['patroclus', 'sarpedon', 'slew'], ['neoptolemus', 'priam', 'slew'],
    ['agamemnon', 'achilles', 'foe'], ['menelaus', 'paris', 'foe'], ['ajax', 'hector', 'foe'],
  ],
  events: [
    ['judgement', ['帕里斯的裁判', 'Judgement of Paris'], ['olympus', 'troy']],
    ['abduction', ['海伦去了特洛伊', 'Helen goes to Troy'], ['sparta', 'troy']],
    ['aulis', ['舰队在奥利斯集结', 'The fleet gathers at Aulis'], ['mycenae', 'sparta', 'ithaca', 'phthia', 'pylos', 'salamis']],
    ['wrath', ['阿喀琉斯之怒', 'Wrath of Achilles'], ['phthia', 'mycenae']],
    ['patroclus', ['帕特洛克罗斯之死', 'Death of Patroclus'], ['phthia', 'troy']],
    ['hector', ['赫克托耳之死', 'Death of Hector'], ['phthia', 'troy']],
    ['allies', ['盟军来援', 'The allies arrive'], ['amazons', 'aethiopia', 'troy']],
    ['horse', ['木马屠城', 'The wooden horse'], ['ithaca', 'troy', 'mycenae']],
    ['odyssey', ['奥德修斯归乡', 'The voyage home'], ['ithaca', 'olympus']],
  ],
  eventLinks: [
    ['judgement', 'abduction'], ['abduction', 'aulis'], ['aulis', 'wrath'], ['wrath', 'patroclus'], ['patroclus', 'hector'],
    ['hector', 'allies'], ['allies', 'horse'], ['horse', 'odyssey'],
  ],
}

export const {
  groups, panorama, layered, diffAfter, DIFF_REPLACES, paths, layeredPaths, NODE_STYLES, AUDIT, messages,
} = makeSaga({
  spec,
  // 第二版：2004 年的电影《特洛伊》
  edit: (d, lang, { rel, dropNode, dropRelation }) => {
    // 众神都拿掉了（阿喀琉斯的母亲忒提斯还在），连同奥林匹斯、帕里斯的裁判、奥德修斯归乡
    for (const g of ['zeus', 'hera', 'athena', 'poseidon', 'apollo', 'aphrodite', 'ares', 'eris']) dropNode(pid(g))
    dropNode(sid('olympus'))
    dropNode(eid('judgement'))
    dropNode(eid('odyssey'))
    // 墨涅拉俄斯、埃阿斯死在赫克托耳手里；阿伽门农死在布里塞伊斯手里
    d.relations.push(
      { source: pid('hector'), target: pid('menelaus'), ...rel('slew', lang) },
      { source: pid('hector'), target: pid('ajax'), ...rel('slew', lang) },
      { source: pid('briseis'), target: pid('agamemnon'), ...rel('slew', lang) },
    )
    // 帕特洛克罗斯从阿喀琉斯的挚友改成表弟；布里塞伊斯成了赫克托耳的表妹
    dropRelation(pid('achilles'), pid('patroclus'), 'friend')
    d.relations.push(
      { source: pid('achilles'), target: pid('patroclus'), ...rel('kin', lang) },
      { source: pid('hector'), target: pid('briseis'), ...rel('kin', lang) },
    )
  },
  paths: [
    {
      id: 'helen-sides',
      question: ['海伦先后属于哪两方？', 'Which two sides did Helen belong to?'],
      nodes: [sid('sparta'), pid('helen'), sid('troy')],
    },
    {
      id: 'aeneas',
      question: ['埃涅阿斯是谁的儿子，站在哪一方？', 'Whose son was Aeneas, and which side was he on?'],
      nodes: [pid('aphrodite'), pid('aeneas'), sid('dardania'), sid('troy')],
    },
    {
      id: 'odysseus-patron',
      question: ['奥德修斯背后是哪位神？', 'Which god stood behind Odysseus?'],
      nodes: [sid('ithaca'), pid('odysseus'), pid('athena'), sid('olympus')],
    },
  ],
  layeredPath: {
    id: 'war-start',
    question: ['特洛伊战争是怎么打起来的？', 'How did the Trojan War start?'],
    nodes: [eid('judgement'), sid('olympus'), pid('aphrodite'), sid('troy'), pid('helen'), sid('sparta')],
  },
  audit: {
    zh: {
      'ui.audit-relations': '阵营关系 {n} 条，人物里接得上 {ok} 条',
      'ui.audit-joins': '人物关系 {n} 条，有阵营关系对应 {ok} 条',
      'ui.audit-group.broken': '人物里接不上的阵营关系',
      'ui.audit-group.unused': '没有阵营关系对应的人物关系',
      'ui.audit-group.via-path': '只被路径用到的人物关系',
      'ui.audit-unreachable': '两边都有人，{n} 层关系内连不上',
      'ui.audit-unused-relation': '两边所属的阵营之间没有关系',
      'ui.audit-unused-unmapped': '有一头不属于任何一方',
      'ui.audit-blocks': '{n} 条阵营关系因此接不上',
    },
    en: {
      'ui.audit-relations': '{ok} of {n} relations between sides connect through figures',
      'ui.audit-joins': '{ok} of {n} ties between figures match a relation between sides',
      'ui.audit-group.broken': 'Relations between sides no figure connects',
      'ui.audit-group.unused': 'Ties with no relation between sides behind them',
      'ui.audit-group.via-path': 'Ties only a path uses',
      'ui.audit-unreachable': 'Figures on both sides, no chain within {n} steps',
      'ui.audit-unused-relation': 'The sides at its ends are not related',
      'ui.audit-unused-unmapped': 'One end belongs to no side',
      'ui.audit-blocks': '{n} relations between sides cannot connect because of it',
    },
  },
})
