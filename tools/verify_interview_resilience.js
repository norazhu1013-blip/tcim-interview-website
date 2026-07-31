'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
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

function modelTurn(question, closing = '') {
  return JSON.stringify({
    understanding: { teacher_quote: '教师原话', meaning: '教师明确表达的意思', confidence: 'HIGH' },
    state: {
      active_thread: '当前主线', latest_new_point: '新观点', next_move: 'DEEPEN',
      purpose: '继续理解', completion: 'BEFORE_MINIMUM'
    },
    next_question: question,
    done: false,
    closing_message: closing,
    covered_evidence: []
  });
}

const checks = [];
function check(label, fn) {
  try { fn(); checks.push(['PASS', label]); }
  catch (error) { checks.push(['FAIL', label + ' — ' + error.message]); }
}
async function checkAsync(label, fn) {
  try { await fn(); checks.push(['PASS', label]); }
  catch (error) { checks.push(['FAIL', label + ' — ' + error.message]); }
}

check('网页端不再把云端失败切换为旧规则脚本', () => {
  const page = fs.readFileSync(path.join(__dirname, '../web/src/views/InterviewView.vue'), 'utf8');
  assert(!page.includes('fallbackNext'));
  assert(!page.includes('buildScriptQueue'));
  assert(page.includes('generationPaused.value = true'));
  assert(page.includes('retryQuestion'));
});

check('网页失败界面明确保留回答并提供重试', () => {
  const view = fs.readFileSync(path.join(__dirname, '../web/src/views/InterviewView.vue'), 'utf8');
  assert(view.includes('您的回答已经保存'));
  assert(view.includes('@click="retryQuestion"'));
  assert(view.includes('@click="endAfterError"'));
  assert(view.includes('generationFailures.value.push'));
  assert(view.includes('durationMs: Date.now() - requestedAt'));
});

check('错误姓氏、英文残词和多问题可在发送前清理', () => {
  const cleaned = t.normalizeVisibleQuestion(
    '张老师，您觉得这种space有什么不同？您还会怎么做？',
    '李娟'
  );
  assert.strictEqual(cleaned, '您觉得这种空间有什么不同？');
  assert.strictEqual(t.visibleQuestionIssue(cleaned), '');
});

check('专业指标标签不会作为教师可见问题放行', () => {
  const issue = t.visibleQuestionIssue('这个情境主要涉及“对游戏行为的分析与回应”，您为什么这样选择？');
  assert.strictEqual(issue, 'internal_analysis_exposed');
});

check('恢复V7动态输入，姓名保护留在可见文本层', () => {
  const named = t.buildUserPrompt({ teacherName: '李娟', history: [], remainingMs: 300000 }, null);
  const unnamed = t.buildUserPrompt({ history: [], remainingMs: 300000 }, null);
  assert(!named.includes('【教师称呼】'));
  assert(!unnamed.includes('【教师称呼】'));
});

check('本地安全收束只引用教师最后原话，不虚构已覆盖内容', () => {
  const closing = t.closingFromLatestTeacher('我主要会考虑介入方式');
  assert(closing.includes('我主要会考虑介入方式'));
  assert(!closing.includes('已经说明了对孩子行为的理解'));
});

(async () => {
  await checkAsync('模型一次生成两个问题时只发送第一个认知任务', async () => {
    mockModelText = modelTurn('您会先看孩子的什么表现？什么情况下您才会介入？');
    const result = await interview.main({ history: [], remainingMs: 300000, teacherName: '李娟' });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.question, '您会先看孩子的什么表现？');
  });

  await checkAsync('内部分析前言被去除但保留模型原本的主问题', async () => {
    mockModelText = modelTurn('这个情境主要涉及“对游戏行为的分析与回应”。从这个角度看，您为什么会优先采用您选择的做法？');
    const result = await interview.main({
      history: [
        { role: 'ai', text: '您看到这个情境时最先注意到什么？' },
        { role: 'teacher', text: '孩子们是在做自己喜欢的游戏。' }
      ],
      remainingMs: 300000,
      teacherName: '李娟'
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.recovered, false);
    assert.strictEqual(result.salvaged, true);
    assert.strictEqual(result.question, '您为什么会优先采用您选择的做法？');
    assert.strictEqual(t.visibleQuestionIssue(result.question), '');
  });

  await checkAsync('JSON格式不完整时抢救模型已经生成的问题', async () => {
    mockModelText = '{"next_question":"您觉得陪伴会怎样影响小明继续搭建？",';
    const result = await interview.main({
      history: [
        { role: 'ai', text: '您怎样理解小明反复求助？' },
        { role: 'teacher', text: '他可能更想要老师陪着。' }
      ],
      remainingMs: 300000
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.recovered, false);
    assert.strictEqual(result.question, '您觉得陪伴会怎样影响小明继续搭建？');
  });

  await checkAsync('模型返回异常时不增加第二次调用，仍用当前主线继续', async () => {
    mockModelText = '这不是JSON';
    const result = await interview.main({
      history: [
        { role: 'ai', text: '您会先考虑什么？' },
        { role: 'teacher', text: '我会先看孩子是不是投入。' }
      ],
      remainingMs: 300000
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.recovered, true);
    assert(result.question.includes('孩子是不是投入'));
    assert(!result.question.includes('接下来最需要考虑什么'));
  });

  await checkAsync('教师没听懂时恢复问题先解释原来的关系', async () => {
    mockModelText = '这不是JSON';
    const result = await interview.main({
      history: [
        { role: 'ai', text: '您觉得陪伴关注和让他自己有内驱力这两件事怎么放在一起的？' },
        { role: 'teacher', text: '我没看懂什么意思' }
      ],
      remainingMs: 300000
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.recovered, true);
    assert(result.question.includes('我刚才想问的是'));
    assert(result.question.includes('实际处理时'));
    assert(!result.question.includes('接下来最需要考虑什么'));
  });

  await checkAsync('最后一分钟即使模型异常也吸收最新原话并安全收束', async () => {
    mockModelText = '这不是JSON';
    const result = await interview.main({
      history: [
        { role: 'ai', text: '您最后最想强调什么？' },
        { role: 'teacher', text: '我最关注孩子真实的游戏兴趣。' }
      ],
      remainingMs: 30000
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.done, true);
    assert(result.question.includes('孩子真实的游戏兴趣'));
    assert(!/[？?]/.test(result.question));
  });

  await checkAsync('最后一分钟由云端吸收最新回答并内容化收束', async () => {
    mockModelText = modelTurn('还要继续问吗？', '请您确认一下，可以吗？');
    const result = await interview.main({
      history: [
        { role: 'ai', text: '您会重点考虑什么？' },
        { role: 'teacher', text: '我主要会考虑介入方式' }
      ],
      remainingMs: 30000,
      teacherName: '李娟'
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.done, true);
    assert(result.question.includes('我主要会考虑介入方式'));
    assert(!/[？?]/.test(result.question));
  });

  checks.forEach(([status, label]) => console.log(`${status}  ${label}`));
  const failed = checks.filter(([status]) => status === 'FAIL');
  if (failed.length) process.exit(1);
  console.log(`\n${checks.length} 项访谈韧性检查全部通过。`);
})();
