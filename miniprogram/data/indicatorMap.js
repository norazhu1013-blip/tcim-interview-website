/**
 * 指标映射 —— 全 10 题主/次二级、三级指标 + 观测点 + 访谈诊断焦点。
 * 取自各题知识库 01基本信息，指标名→规范编码；与 0000 指标框架 §5 口径一致。禁「五维」。
 *   A 对游戏的特点、价值的理解：A1 特点 / A2 价值(游戏中的学习) / A3 价值实现
 *   B 游戏条件的保障：B1 环境创设 / B2 教师角色
 *   C 游戏支持与指导：C1 观察 / C2 分析与回应
 * 由 tools/build_indicatorMap.js 生成。
 */
const VERSION = 'DOC-10题';

const SECONDARY_NAME = {
  A: '对游戏的特点、价值的理解',
  B: '游戏条件的保障',
  C: '游戏支持与指导'
};

const TERTIARY_NAME = {
  A1: '对游戏特点的理解',
  A2: '对游戏价值的理解（游戏中的学习）',
  A3: '对游戏价值实现的认识',
  B1: '游戏环境创设',
  B2: '教师在幼儿游戏中的角色',
  C1: '游戏中的观察',
  C2: '对游戏行为的分析与回应'
};

const MAP = {
  Q1: {
    primary: {
      secondary: 'C',
      tertiary: 'C2',
      observation_points: [
        '介入时机的把握',
        '介入方式的适宜有效性'
      ]
    },
    secondary_ind: {
      secondary: 'A',
      tertiary: 'A1',
      observation_points: [
        '对游戏本质特征的理解'
      ]
    },
    interview_focus: '考察教师能否在幼儿自主生成的玩水游戏与规则、安全、场地适宜性之间作出专业判断：既不简单禁止，也不放任风险，而是顺应游戏兴趣并以适宜方式回应。'
  },
  Q2: {
    primary: {
      secondary: 'C',
      tertiary: 'C2',
      observation_points: [
        '对幼儿游戏行为的分析判断',
        '介入方式的适宜有效性'
      ]
    },
    secondary_ind: {
      secondary: 'C',
      tertiary: 'C1',
      observation_points: [
        '观察游戏的意识和角度',
        '对幼儿游戏状态的观察与识别'
      ]
    },
    interview_focus: '考察教师能否透过“我不会、帮帮我”的表面求助，判断幼儿真实需要，并以小目标、提问或材料支架支持其自主尝试，而不是直接代做或过度示范。'
  },
  Q3: {
    primary: {
      secondary: 'C',
      tertiary: 'C1',
      observation_points: [
        '观察游戏的意识和角度',
        '对幼儿游戏状态的观察与识别'
      ]
    },
    secondary_ind: {
      secondary: 'C',
      tertiary: 'C2',
      observation_points: [
        '对幼儿游戏行为的分析判断',
        '介入时机的把握'
      ]
    },
    interview_focus: '考察教师能否持续观察幼儿频繁转换区域背后的原因，识别其是否真正投入、有无游戏目标或材料困难，再决定是否需要陪伴、任务支架或环境调整。'
  },
  Q4: {
    primary: {
      secondary: 'C',
      tertiary: 'C2',
      observation_points: [
        '对幼儿游戏行为的分析判断',
        '介入方式的适宜有效性'
      ]
    },
    secondary_ind: {
      secondary: 'B',
      tertiary: 'B2',
      observation_points: [
        '基本定位：支持者',
        '合作者与引导者'
      ]
    },
    interview_focus: '考察教师能否理解幼儿个体兴趣与小组共同任务之间的关系，并以支持者、合作者的方式把个人发现转化为共同建构资源。'
  },
  Q5: {
    primary: {
      secondary: 'A',
      tertiary: 'A1',
      observation_points: [
        '对游戏本质特征的理解'
      ]
    },
    secondary_ind: {
      secondary: 'A',
      tertiary: 'A3',
      observation_points: [
        '对游戏价值发挥机制和规律的认识'
      ]
    },
    interview_focus: '考察教师能否区分幼儿游戏中的角色体验、情节表达与成人现实价值判断，先理解游戏意义，再以发展适宜的方式进行安全和价值澄清。'
  },
  Q6: {
    primary: {
      secondary: 'B',
      tertiary: 'B1',
      observation_points: [
        '对游戏材料的分析和投放'
      ]
    },
    secondary_ind: {
      secondary: 'C',
      tertiary: 'C2',
      observation_points: [
        '对幼儿游戏行为的分析判断',
        '介入方式的适宜有效性'
      ]
    },
    interview_focus: '考察教师能否从幼儿发展和学习经验角度分析任务材料的层次，动态调整材料呈现方式，并通过适度挑战支持幼儿在游戏中继续发展。'
  },
  Q7: {
    primary: {
      secondary: 'C',
      tertiary: 'C2',
      observation_points: [
        '对幼儿游戏行为的分析判断',
        '介入方式的适宜有效性'
      ]
    },
    secondary_ind: {
      secondary: 'A',
      tertiary: 'A2',
      observation_points: [
        '对游戏独特的学习和发展价值的认识'
      ]
    },
    interview_focus: '考察教师能否理解幼儿角色兴趣和审美经验，并把“艾莎公主”的游戏兴趣转化为符合年龄特点的运动参与，而不是简单要求儿童回到运动任务。'
  },
  Q8: {
    primary: {
      secondary: 'C',
      tertiary: 'C2',
      observation_points: [
        '介入时机的把握',
        '介入方式的适宜有效性'
      ]
    },
    secondary_ind: {
      secondary: 'B',
      tertiary: 'B1',
      observation_points: [
        '对游戏材料的分析和投放'
      ]
    },
    interview_focus: '考察教师能否在幼儿探究兴趣减弱时，判断困难来源，选择适当介入时机，并通过材料、问题或示范支架恢复探索，而不是急于替幼儿完成。'
  },
  Q9: {
    primary: {
      secondary: 'C',
      tertiary: 'C2',
      observation_points: [
        '介入时机的把握',
        '介入方式的适宜有效性'
      ]
    },
    secondary_ind: {
      secondary: 'C',
      tertiary: 'C1',
      observation_points: [
        '对幼儿游戏框架的观察与理解'
      ]
    },
    interview_focus: '考察教师能否理解幼儿对共同游戏规则的实际体验水平，通过短时体验、反思提问和规则协商帮助幼儿理解共同规则的意义。'
  },
  Q10: {
    primary: {
      secondary: 'C',
      tertiary: 'C2',
      observation_points: [
        '介入时机的把握',
        '介入方式的适宜有效性'
      ]
    },
    secondary_ind: {
      secondary: 'B',
      tertiary: 'B2',
      observation_points: [
        '基本定位：支持者',
        '合作者与引导者'
      ]
    },
    interview_focus: '考察教师能否在集体游戏秩序和安全风险中作出适时回应，并引导幼儿参与规则形成，逐步建立安全、公平、可持续的共同游戏文化。'
  }
};

module.exports = { VERSION, SECONDARY_NAME, TERTIARY_NAME, MAP };
