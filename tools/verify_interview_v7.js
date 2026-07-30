'use strict';

const assert = require('assert');
const Module = require('module');

let mockModelText = '';
process.env.NODE_ENV = 'test';
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'wx-server-sdk') {
    return {
      DYNAMIC_CURRENT_ENV: 'test',
      init() {},
      extend: {
        AI: {
          createModel() {
            return { async generateText() { return { text: mockModelText }; } };
          }
        }
      }
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const interview = require('../cloudfunctions/gsyg_interviewChat/index.js');
Module._load = originalLoad;
const t = interview.__test;

const checks = [];
const asyncChecks = [];
function check(label, fn) {
  try { fn(); checks.push(['PASS', label]); }
  catch (error) { checks.push(['FAIL', label + ' — ' + error.message]); }
}
function checkAsync(label, fn) { asyncChecks.push([label, fn]); }

function historyWithQuestions(count, lastAnswer) {
  const history = [];
  for (let i = 1; i <= count; i += 1) {
    history.push({ role: 'ai', text: `问题${i}？` });
    history.push({ role: 'teacher', text: i === count && lastAnswer ? lastAnswer : `回答${i}` });
  }
  return history;
}

function modelTurn({
  question = '您会怎样理解孩子此时的表现？',
  done = false,
  completion = 'INCOMPLETE',
  move = 'DEEPEN',
  closing = ''
} = {}) {
  return JSON.stringify({
    understanding: {
      teacher_quote: '教师最近的原话',
      meaning: '教师明确表达的意思',
      confidence: 'HIGH'
    },
    state: {
      active_thread: '当前教育判断',
      latest_new_point: '本轮新增内容',
      next_move: move,
      purpose: done ? '主线已经完整' : '继续理解判断依据',
      completion
    },
    next_question: done ? '' : question,
    done,
    closing_message: closing
  });
}

check('首问由AI根据情境自主选择', () => {
  assert(t.INTERVIEW_POLICY.includes('首问不使用固定模板'));
  assert(t.INTERVIEW_POLICY.includes('根据本题选择'));
  assert(!t.INTERVIEW_POLICY.includes('grounded_opening'));
});

check('正常访谈至少八问且第八问不是自动结束点', () => {
  assert(t.INTERVIEW_POLICY.includes('正常访谈至少提出8个可回答问题'));
  assert(t.INTERVIEW_POLICY.includes('不是自动结束点'));
  assert(t.INTERVIEW_POLICY.includes('不存在固定最高问数') ||
    t.buildUserPrompt({ history: historyWithQuestions(11), remainingMs: 180000 }, null)
      .includes('不存在固定最高问数'));
});

check('提示词以理解和推进为核心而非填槽', () => {
  assert(t.INTERVIEW_POLICY.includes('答案是否可能改变你对教师思考的理解'));
  assert(t.INTERVIEW_POLICY.includes('排序只是线索，不是访谈主线'));
  assert(!t.INTERVIEW_POLICY.includes('distinguishing_value'));
  assert(!t.INTERVIEW_POLICY.includes('三类结束证据'));
});

check('保持效果较好的V7简洁决策结构', () => {
  assert(t.INTERVIEW_POLICY.includes('选择此刻最自然、最有信息价值的一步'));
  assert(t.INTERVIEW_POLICY.includes('教师刚提出新的区别、修正、矛盾、价值或条件时，优先处理这一点'));
  assert(!t.INTERVIEW_POLICY.includes('information_gain'));
  assert(!t.INTERVIEW_POLICY.includes('thread_status'));
  assert(!t.INTERVIEW_POLICY.includes('pending_point'));
});

check('动态输入把知识材料用于准备而非逐项覆盖', () => {
  const prompt = t.buildUserPrompt({ history: historyWithQuestions(4), remainingMs: 180000 }, {
    ability_focus: { interview_main_focus: '理解儿童行为', interview_secondary_focus: '观察与介入的关系' },
    must_obtain_evidence: ['行为可能原因', '观察依据', '介入条件']
  });
  assert(prompt.includes('知识库给出的专业准备'));
  assert(prompt.includes('帮助准备，不要求逐项覆盖'));
  assert(!prompt.includes('pending_point'));
});

check('教育语境中的“重复”不会被服务器标记成元反馈', () => {
  const prompt = t.buildUserPrompt({
    history: [
      { role: 'ai', text: '您怎么看孩子反复玩同一种游戏？' },
      { role: 'teacher', text: '有的幼儿享受重复，有的其实是低水平重复。' }
    ],
    remainingMs: 180000
  }, null);
  assert(prompt.includes('有的幼儿享受重复，有的其实是低水平重复'));
  assert(prompt.includes('结合完整句子和上下文'));
  assert(!prompt.includes('进入 REPAIR'));
});

check('一般的没听懂要求AI修复，只有明确拒绝才停止', () => {
  assert(!t.isStrongFrustrationText('我没懂你在问什么'));
  assert(!t.isExplicitStopText('我没懂你在问什么'));
  assert(t.isExplicitStopText('别问了，到这里吧'));
  assert(t.INTERVIEW_POLICY.includes('用更直接的问题继续'));
});

checkAsync('空历史时返回模型自主生成的首问', async () => {
  mockModelText = modelTurn({
    question: '阳阳说“着火了，好开心”，您听到这句话时最先注意到什么？',
    completion: 'BEFORE_MINIMUM',
    move: 'OPEN'
  });
  const result = await interview.main({
    itemContext: { title: '娃娃家着火了', stem: '阳阳说娃娃家着火了，好开心。' },
    history: [], remainingMs: 600000
  });
  assert.strictEqual(result.done, false);
  assert.strictEqual(result.question, '阳阳说“着火了，好开心”，您听到这句话时最先注意到什么？');
  assert.strictEqual(result.questionStrategy.next_move, 'OPEN');
});

checkAsync('少于八问时拒绝模型提前结束', async () => {
  mockModelText = JSON.stringify({
    understanding: { teacher_quote: '回答7', meaning: '教师观点', confidence: 'HIGH' },
    state: {
      active_thread: '当前主线', latest_new_point: '新观点', next_move: 'CLOSE',
      purpose: '模型误判已完整', completion: 'BEFORE_MINIMUM'
    },
    next_question: '在什么情况下，您的这个判断会改变？',
    done: true,
    closing_message: '感谢您的分享。'
  });
  const result = await interview.main({ history: historyWithQuestions(7), remainingMs: 180000 });
  assert.strictEqual(result.done, false);
  assert.strictEqual(result.question, '在什么情况下，您的这个判断会改变？');
  assert.strictEqual(result.questionStrategy.guard_reason, 'continued_before_minimum_eight');
});

checkAsync('八问后内容不完整仍继续', async () => {
  mockModelText = JSON.stringify({
    understanding: { teacher_quote: '回答8', meaning: '教师提出了新区别', confidence: 'HIGH' },
    state: {
      active_thread: '游戏与现实', latest_new_point: '提出新区别', next_move: 'DEEPEN',
      purpose: '新区别尚未理解', completion: 'INCOMPLETE'
    },
    next_question: '您会怎样判断孩子是在享受游戏，还是把火灾本身当成好事？',
    done: true,
    closing_message: '感谢您的分享。'
  });
  const result = await interview.main({ history: historyWithQuestions(8), remainingMs: 180000 });
  assert.strictEqual(result.done, false);
  assert(result.question.includes('怎样判断'));
  assert.strictEqual(result.questionStrategy.guard_reason, 'continued_because_content_incomplete');
});

checkAsync('八问后内容完整才自然结束', async () => {
  mockModelText = modelTurn({
    done: true,
    completion: 'COMPLETE',
    move: 'CLOSE',
    closing: '您既重视孩子在游戏中的情绪体验，也会在需要时帮助他理解现实火灾的后果。感谢您的分享。'
  });
  const result = await interview.main({ history: historyWithQuestions(8), remainingMs: 180000 });
  assert.strictEqual(result.done, true);
  assert(result.question.includes('情绪体验'));
  assert.strictEqual(result.questionStrategy.guard_reason, 'content_complete_after_minimum');
});

checkAsync('超过十一问也没有硬截断', async () => {
  mockModelText = modelTurn({
    question: '如果孩子后来把这种理解带到真实情境中，您会怎样调整做法？',
    completion: 'INCOMPLETE',
    move: 'BOUNDARY'
  });
  const result = await interview.main({ history: historyWithQuestions(12), remainingMs: 180000 });
  assert.strictEqual(result.done, false);
  assert(result.question.includes('真实情境'));
});

checkAsync('“没懂”后的直接澄清不会被规则改写或结束', async () => {
  mockModelText = modelTurn({
    question: '我想了解的是：您判断孩子是否需要现实火灾教育时，主要看什么？',
    completion: 'BEFORE_MINIMUM',
    move: 'CLARIFY'
  });
  const history = historyWithQuestions(3, '我没懂你在问什么');
  const result = await interview.main({ history, remainingMs: 180000 });
  assert.strictEqual(result.done, false);
  assert.strictEqual(result.question, '我想了解的是：您判断孩子是否需要现实火灾教育时，主要看什么？');
});

(async () => {
  for (const [label, fn] of asyncChecks) {
    try { await fn(); checks.push(['PASS', label]); }
    catch (error) { checks.push(['FAIL', label + ' — ' + error.message]); }
  }
  checks.forEach(([status, label]) => console.log(`${status}  ${label}`));
  const failed = checks.filter(([status]) => status === 'FAIL');
  if (failed.length) process.exit(1);
  console.log(`\n${checks.length} 项 v7 检查全部通过。`);
})();

