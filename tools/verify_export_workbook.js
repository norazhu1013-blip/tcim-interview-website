#!/usr/bin/env node
// 用管理员 full.json 生成整理版 Excel，并回读核对工作表与行数。
const fs = require('fs');
const path = require('path');
const ExcelJS = require('../cloudfunctions/gsyg_exportData/node_modules/exceljs');
const { buildWorkbookBuffer, SHEET_NAMES } = require('../cloudfunctions/gsyg_exportData/workbook');

async function main() {
  const input = process.argv[2];
  const output = process.argv[3] || path.resolve(process.cwd(), 'gsyg-readable-export-test.xlsx');
  if (!input) throw new Error('用法: node tools/verify_export_workbook.js <full.json> [output.xlsx]');
  const bundle = JSON.parse(fs.readFileSync(input, 'utf8'));
  const buffer = await buildWorkbookBuffer(bundle);
  fs.writeFileSync(output, buffer);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const actualNames = workbook.worksheets.map((ws) => ws.name);
  const missing = SHEET_NAMES.filter((name) => !actualNames.includes(name));
  if (missing.length) throw new Error('缺少工作表: ' + missing.join(', '));

  const sessions = (bundle.data && bundle.data.sessions) || [];
  const interviews = (bundle.data && bundle.data.interviews) || [];
  const expectedAnswers = sessions.reduce((n, s) => n + Object.keys(s.answers || {}).length, 0);
  const expectedSelections = sessions.reduce((n, s) => n + (((s.selection || {}).final || []).length), 0);
  const expectedScenarios = interviews.reduce((n, i) => n + Object.keys(i.transcripts || {}).length, 0);
  const expectedTranscriptRows = interviews.reduce((n, i) => n + Object.values(i.transcripts || {}).reduce((m, tr) => m + Math.max(((tr || {}).turns || []).length, 1), 0), 0);
  const expectedTaskCards = sessions.reduce((n, s) => n + (((s.selection || {}).final || []).filter((f) => f && f.task_card && Object.keys(f.task_card).length).length), 0);
  const checks = {
    '测验访谈汇总': sessions.length,
    '作答明细': expectedAnswers,
    '情境筛选': expectedSelections,
    '访谈逐字稿': expectedTranscriptRows,
    '访谈编码': expectedScenarios,
    '访谈任务卡': expectedTaskCards,
    '访谈反馈': interviews.length
  };
  Object.entries(checks).forEach(([name, expected]) => {
    const actual = workbook.getWorksheet(name).rowCount - 1;
    if (actual !== expected) throw new Error(name + ' 行数不符: expected=' + expected + ', actual=' + actual);
  });

  console.log(JSON.stringify({ ok: true, output, bytes: buffer.length, sheets: actualNames, dataRows: checks }, null, 2));
}

main().catch((error) => {
  console.error(error && (error.stack || error.message) || error);
  process.exit(1);
});
