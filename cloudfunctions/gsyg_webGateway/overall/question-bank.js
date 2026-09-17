'use strict';

// The first ten records are loaded from the released web/miniprogram bank so
// that this module cannot silently drift from the existing assessment.
const { ITEMS: RELEASED_ITEMS } = require('./released-questions');

const NEW_ITEMS = [
  {
    item_id: 'T11', aliases: ['XXXX0110'], title: '多米诺玩法单一', indicator: 'I5 对游戏材料的分析与投放',
    stem: '大班幼儿澄澄反复把多米诺骨牌排成直线后推倒，兴趣逐渐减弱。',
    options: {
      A: '提醒长龙不局限于直线型，提议摆成圆形、S形。',
      B: '提供多米诺摆放图片和视频，提议模仿。',
      C: '陪同观察同伴玩法，通过同伴互助积累经验。',
      D: '提供大小、轻重不同的骨牌和画纸，请幼儿画出设想并记录。'
    }
  },
  {
    item_id: 'T19', aliases: ['XXXX1022'], title: '假装游戏中的拆台', indicator: 'I3 对游戏价值实现的认识',
    stem: '大班“红蓝军对抗”中，博博强调手榴弹是假的、打不死人，游戏氛围被打破。',
    options: {
      A: '讨论真实与假装的关系，引导体验假装游戏的快乐。',
      B: '强调游戏不一定真实，开心最重要，并思考都不守规则会怎样。',
      C: '肯定观察力，解释共同规则对其他孩子的意义。',
      D: '暂停游戏，请博博提出改进意见，全班协商共建规则。'
    }
  },
  {
    item_id: 'T7', aliases: ['Bnew0820'], title: '互动墙形同虚设', indicator: 'I4 游戏场地、环境布置和时间保证',
    stem: '教师设置游戏互动墙，但幼儿在游戏中很少注意或使用。',
    options: {
      A: '强调使用方式和作用，及时表扬记录的幼儿。',
      B: '把互动墙设计成游戏任务看板，在游戏中引导关注。',
      C: '询问幼儿想放什么内容，依据兴趣和想法共同改版。',
      D: '暂时撤下，先观察口头分享效果再决定调整。'
    }
  },
  {
    item_id: 'T14', aliases: ['XXXX0301'], title: '角色游戏中不承担角色任务', indicator: 'I8 对幼儿游戏框架的观察与理解',
    stem: '小班餐厅游戏中，丹莉只顾反复翻炒，没有回应等待点单的顾客。',
    options: {
      A: '视为自然的反复行为，暂不干预并持续观察。',
      B: '扮演客人互动，示范询问需求和提供服务。',
      C: '提醒有顾客等待，引导换位思考。',
      D: '增加菜单和点单本，并邀请一名幼儿扮演服务员。'
    }
  },
  {
    item_id: 'T15', aliases: ['XXXX0415', 'XXXX04152'], title: '教师反思自己的观察能力', indicator: 'I7 观察游戏的意识和角度',
    stem: '小班教师多次未及时看到幼儿冲突的关键细节，常到争吵扩大后才察觉。',
    options: {
      A: '冲突后询问经过并反思遗漏的细节。',
      B: '确定一周观察重点，采用事件观察持续记录。',
      C: '活动中多巡视，等声音变大或争抢时及时赶到。',
      D: '用照片、录像和便签记录，逐步积累观察经验。'
    }
  },
  {
    item_id: 'T27', aliases: ['XXXX0225'], title: '幼儿冒险行为', indicator: 'I9 对幼儿游戏状态的观察与识别',
    stem: '大班幼儿平稳走过桥的扶手后，准备再从另一头走回来。',
    options: {
      A: '分析危险，建议去走更安全的平衡木。',
      B: '询问为什么这样做，共同探索如何降低风险。',
      C: '相信幼儿对能力的判断，靠近观察并准备及时帮助。',
      D: '认可探索并增加麻绳、绳网等材料支持挑战。'
    }
  },
  {
    item_id: 'T30', aliases: ['T30', 'NEW30', 'XXXX1027'], title: '反复调整动物园建构', indicator: 'I10 对游戏行为的分析判断',
    stem: '中班幼儿为了让长颈鹿站稳，反复拆搭并调整“长颈鹿的家”。',
    options: {
      A: '围绕幼儿正在解决的问题询问改了哪里、现在是否合适。',
      B: '建议先完成长颈鹿的家，再加入同伴喂动物。',
      C: '提醒比较长颈鹿与其他动物的不同，再思考哪里要改。',
      D: '提供真实动物园图片供观察。'
    }
  },
  {
    item_id: 'T24', aliases: ['Bnew0824'], title: '给娃娃穿衣遇到困难', indicator: 'I12 介入方式的适宜有效性',
    stem: '小班幼儿反复拉背带裤肩带，却没发现娃娃臀部被卡住，最后生气。',
    options: {
      A: '安慰并用动作提示观察被卡部位，鼓励再试。',
      B: '还原穿衣过程，引导观察为什么没有穿好。',
      C: '肯定努力，请成功的同伴示范。',
      D: '平行介入并用夸张动作示范正确顺序。'
    }
  },
  {
    item_id: 'T20', aliases: ['Bnew0804'], title: '幼儿不允许同伴换角色', indicator: 'I2 对游戏价值的理解',
    stem: '中班角色游戏中，丰丰不允许同伴把厨师角色让给另一名幼儿。',
    options: {
      A: '请三名幼儿说明想法，支持轮换、分工或新增角色。',
      B: '暂不介入，小结时讨论下次如何公平轮换。',
      C: '启发分享和轮流，表扬让出角色的行为。',
      D: '安抚情绪，并与三名幼儿共同协商分配角色。'
    }
  },
  {
    item_id: 'T26', aliases: ['Bnew0819'], title: '幼儿逆爬滑梯', indicator: 'I11 介入时机的把握',
    stem: '中班幼儿从滑道下端逆爬并短暂停在中间，最终爬到顶端。',
    options: {
      A: '暂停游戏，明确滑道只下不上并建议去攀爬器械。',
      B: '下来后讲解危险，并观察其他幼儿如何玩。',
      C: '肯定探索新玩法，再邀请像小飞机一样滑下。',
      D: '暂不介入，活动后全班讨论正确玩法及风险。'
    }
  }
];

const RELEASED_ALIASES = {
  Q1: ['XXXX0108'], Q2: ['XXXX05232'], Q3: ['XXXX0304'], Q4: ['XXXX0609'], Q5: ['XXXX02032'],
  Q6: ['XXXX05152'], Q7: ['XXXX0310'], Q8: ['XXXX02082'], Q9: ['XXXX0303'], Q10: ['XXXX0825']
};
const RELEASED = RELEASED_ITEMS.map((item) => ({ ...item, aliases: [item.item_id, ...(RELEASED_ALIASES[item.item_id] || [])] }));
const ITEMS = [...RELEASED, ...NEW_ITEMS];
const BY_ID = new Map();
for (const item of ITEMS) {
  for (const id of [item.item_id, ...(item.aliases || [])]) BY_ID.set(String(id).toUpperCase(), item);
}

function findItem(id) {
  return BY_ID.get(String(id || '').trim().toUpperCase()) || null;
}

module.exports = { VERSION: 'TCIM-20题/2026-09-17', ITEMS, findItem };
