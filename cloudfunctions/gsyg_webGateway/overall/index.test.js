'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { teacherChoices, itemContext, INTERVIEW_DURATION_MS, VERSION } = require('./index');

test('new overall interviews use a twenty-five-minute deadline', () => {
  assert.equal(INTERVIEW_DURATION_MS, 25 * 60 * 1000);
  assert.equal(VERSION, 'tcim-overall-interview/0.1.3');
});

test('teacher choices show school only when duplicate names need disambiguation', () => {
  const choices = teacherChoices([
    { _id: 'a', name: '李玲', nameKey: '李玲', duplicateName: true, externalRef: 'teacher-a', profile: { kindergarten: '金牛幼儿园', region: '成都' } },
    { _id: 'b', name: '李玲', nameKey: '李玲', duplicateName: true, externalRef: 'teacher-b', profile: { kindergarten: '成都幼儿园', region: '成都' } },
    { _id: 'c', name: '王芳', nameKey: '王芳', duplicateName: false, profile: { kindergarten: '成都幼儿园' } }
  ]);
  assert.deepEqual(choices.map((choice) => choice.label), ['李玲（金牛幼儿园）', '李玲（成都幼儿园）', '王芳']);
});

test('item context exposes only the questions named by the interviewer', () => {
  const context = itemContext({ items: [
    { itemId: 'legacy-1', canonicalItemId: 'Q1', title: '篮球架玩水', stem: '题干', ranking: 'CABD', options: { A: '甲', B: '乙', C: '丙', D: '丁' } },
    { itemId: 'legacy-2', canonicalItemId: 'Q2', title: '幼儿频繁求助', ranking: 'ABCD', options: {} }
  ] }, ['Q1']);
  assert.equal(context.length, 1);
  assert.equal(context[0].title, '篮球架玩水');
  assert.equal(context[0].ranking, 'CABD');
});

test('overall entry exposes the protected administrator upload route', () => {
  const script = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
  assert.match(script, /管理员上传资料/);
  assert.match(script, /上传前请先登录管理员账号/);
  assert.match(script, /我已登录，显示上传界面/);
  assert.match(script, /api\('admin-status'\)/);
});
