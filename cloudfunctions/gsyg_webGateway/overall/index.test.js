'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { teacherChoices, itemContext } = require('./index');

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
