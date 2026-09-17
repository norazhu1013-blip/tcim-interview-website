'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { combineImport, validRanking } = require('./importer');

async function workbook(rows) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Sheet1');
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await book.xlsx.writeBuffer()).toString('base64');
}

test('ranking must contain A-D once each', () => {
  assert.equal(validRanking('B>D>A>C'), 'BDAC');
  assert.equal(validRanking('AAAA'), '');
  assert.equal(validRanking('ABC'), '');
});

test('imports a headered process workbook and links known question aliases', async () => {
  const result = await workbook([
    ['导出答题结果'],
    ['测评计划', '姓名', 'userID', '所属幼儿园', '答题时长', 'XXXX0110'],
    ['计划', '张老师', 'u1', '一幼', 123000, 'DCAB']
  ]);
  const process = await workbook([
    ['答题过程记录'],
    ['测评计划', '姓名', '手机号', '所属幼儿园', 'corpid', '所在地区', '题号', '题干', '具体操作', '答题结果', '操作端口', '操作时间'],
    ['计划', '张老师', '', '一幼', '', '', 'XXXX0110', '', '拖拽选项D：提供不同材料（答题结果：DCAB）', '', '网页', '2026-09-17 10:00:00'],
    ['计划', '张老师', '', '一幼', '', '', 'XXXX0110', '', '保存答题结果（答题结果：DCAB）', '', '网页', '2026-09-17 10:00:10']
  ]);
  const imported = await combineImport(result, process);
  assert.equal(imported.stats.teacherCount, 1);
  assert.equal(imported.stats.matchedQuestionCount, 1);
  assert.equal(imported.teachers[0].items[0].canonicalItemId, 'T11');
  assert.equal(imported.teachers[0].items[0].topOptionText, '提供不同材料');
});

test('accepts the documented headerless process export', async () => {
  const result = await workbook([
    ['导出答题结果'],
    ['测评计划', '姓名', 'userID', '所属幼儿园', '答题时长', 'Bnew0824'],
    ['计划', '李老师', 'u2', '二幼', 90000, 'ABCD']
  ]);
  const process = await workbook([
    ['计划', '李老师', '', '二幼', '', '', 'Bnew0824', '跳转第1题', '保存答题结果（答题结果：ABCD）', '', '移动端', '2026-09-17 10:00:00']
  ]);
  const imported = await combineImport(result, process);
  assert.equal(imported.teachers[0].items[0].canonicalItemId, 'T24');
  assert.deepEqual(imported.teachers[0].items[0].process.rankingPath, ['ABCD']);
});

test('recognizes the legacy export ids for all ten released questions', async () => {
  const aliases = ['XXXX0108', 'XXXX05232', 'XXXX0304', 'XXXX0609', 'XXXX02032', 'XXXX05152', 'XXXX0310', 'XXXX02082', 'XXXX0303', 'XXXX0825'];
  const result = await workbook([
    ['导出答题结果'],
    ['测评计划', '姓名', 'userID', '所属幼儿园', '答题时长', ...aliases],
    ['计划', '陈老师', 'u3', '三幼', 100, ...aliases.map(() => 'ABCD')]
  ]);
  const process = await workbook([['计划', '陈老师', '', '三幼', '', '', aliases[0], '', '保存答题结果（答题结果：ABCD）', '', '网页', '2026-09-17 10:00:00']]);
  const imported = await combineImport(result, process);
  assert.equal(imported.stats.matchedQuestionCount, 10);
  assert.deepEqual(imported.teachers[0].items.map((item) => item.canonicalItemId), ['Q1','Q2','Q3','Q4','Q5','Q6','Q7','Q8','Q9','Q10']);
});

test('marks duplicate teacher names instead of allowing ambiguous name-only entry', async () => {
  const result = await workbook([
    ['导出答题结果'],
    ['测评计划', '姓名', 'userID', '所属幼儿园', '答题时长', 'Q1'],
    ['计划', '王老师', 'u1', '一幼', 100, 'ABCD'],
    ['计划', '王老师', 'u2', '二幼', 100, 'BACD']
  ]);
  const process = await workbook([['计划', '王老师', '', '一幼', '', '', 'Q1', '', '保存答题结果（答题结果：ABCD）', '', '网页', '2026-09-17 10:00:00']]);
  const imported = await combineImport(result, process);
  assert.equal(imported.stats.duplicateNameCount, 1);
  assert.ok(imported.teachers.every((teacher) => teacher.duplicateName));
});
