'use strict';

const ExcelJS = require('exceljs');
const { createHash } = require('crypto');
const { findItem } = require('./question-bank');

const RESULT_META = new Set(['测评计划', '姓名', 'userID', '所属幼儿园', 'corpid', '幼儿园性质', '所在地区', '答题时长']);
const PROCESS_HEADERS = ['测评计划', '姓名', '手机号', '所属幼儿园', 'corpid', '所在地区', '题号', '题干', '具体操作', '答题结果', '操作端口', '操作时间'];

function text(value) {
  if (value && typeof value === 'object') {
    if (Array.isArray(value.richText)) value = value.richText.map((part) => part.text || '').join('');
    else if (Object.hasOwn(value, 'result')) value = value.result;
    else if (Object.hasOwn(value, 'text')) value = value.text;
  }
  return String(value == null ? '' : value).normalize('NFKC').trim();
}

function normalizeName(value) {
  return text(value).replace(/\s+/g, '').toLocaleLowerCase('zh-CN');
}

function validRanking(value) {
  const ranking = text(value).toUpperCase().replace(/[^A-D]/g, '');
  return ranking.length === 4 && new Set(ranking).size === 4 ? ranking : '';
}

async function workbookRows(base64) {
  if (!base64 || typeof base64 !== 'string') throw new Error('missing_workbook');
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error('workbook_size_invalid');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('workbook_has_no_sheet');
  const rows = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    const values = [];
    for (let index = 1; index <= sheet.columnCount; index += 1) values.push(row.getCell(index).value ?? '');
    rows.push(values);
  });
  return rows;
}

function findHeader(rows, required) {
  return rows.findIndex((row) => required.every((name) => row.map(text).includes(name)));
}

async function parseResults(base64) {
  const rows = await workbookRows(base64);
  const headerIndex = findHeader(rows.slice(0, 12), ['姓名', '答题时长']);
  if (headerIndex < 0) throw new Error('result_header_not_found');
  const headers = rows[headerIndex].map(text);
  const nameIndex = headers.indexOf('姓名');
  const questionColumns = headers
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => header && !RESULT_META.has(header));
  if (!questionColumns.length) throw new Error('result_questions_not_found');

  const teachers = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const name = text(row[nameIndex]);
    if (!name) continue;
    const answers = {};
    for (const { header, index } of questionColumns) {
      const ranking = validRanking(row[index]);
      if (ranking) answers[header] = ranking;
    }
    if (!Object.keys(answers).length) continue;
    const values = Object.fromEntries(headers.map((header, index) => [header, text(row[index])]));
    teachers.push({
      name,
      nameKey: normalizeName(name),
      externalRef: createHash('sha256').update(`${values.userID || ''}|${name}|${values['所属幼儿园'] || ''}`).digest('hex').slice(0, 24),
      profile: {
        kindergarten: values['所属幼儿园'] || '',
        kindergartenType: values['幼儿园性质'] || '',
        region: values['所在地区'] || ''
      },
      totalDurationMs: Number(values['答题时长'] || 0) || 0,
      answers
    });
  }
  if (!teachers.length) throw new Error('result_has_no_teacher_rows');
  return { teachers, questionIds: questionColumns.map((column) => column.header) };
}

function processLayout(rows) {
  const headerIndex = findHeader(rows.slice(0, 12), ['姓名', '题号']);
  if (headerIndex >= 0) {
    const headers = rows[headerIndex].map(text);
    return {
      start: headerIndex + 1,
      index: Object.fromEntries(PROCESS_HEADERS.map((header) => [header, headers.indexOf(header)]))
    };
  }
  // Some exported combined files omit the header entirely. Their documented
  // 12-column order is stable and is also the order used by the headered file.
  return { start: 0, index: Object.fromEntries(PROCESS_HEADERS.map((header, index) => [header, index])) };
}

function parseDate(value) {
  const date = value instanceof Date ? value : new Date(text(value).replace(' ', 'T'));
  return Number.isFinite(date.getTime()) ? date.getTime() : 0;
}

async function parseProcesses(base64) {
  const rows = await workbookRows(base64);
  const layout = processLayout(rows);
  const byTeacher = new Map();
  for (const row of rows.slice(layout.start)) {
    const name = text(row[layout.index['姓名']]);
    const itemId = text(row[layout.index['题号']]);
    const operation = text(row[layout.index['具体操作']]);
    if (!name || !itemId || !operation) continue;
    const nameKey = normalizeName(name);
    if (!byTeacher.has(nameKey)) byTeacher.set(nameKey, { name, items: {} });
    const teacher = byTeacher.get(nameKey);
    if (!teacher.items[itemId]) teacher.items[itemId] = { events: [], optionTexts: {} };
    const item = teacher.items[itemId];
    const at = parseDate(row[layout.index['操作时间']]);
    const answerMatch = operation.match(/答题结果[：:]\s*([A-D]{4})/i);
    const dragMatch = operation.match(/拖拽选项\s*([A-D])[：:]\s*(.*?)(?:（答题结果|\(答题结果|$)/i);
    if (dragMatch) item.optionTexts[dragMatch[1].toUpperCase()] = text(dragMatch[2]);
    item.events.push({
      at,
      kind: dragMatch ? 'move' : (/保存答题结果/.test(operation) ? 'save' : (/跳转第/.test(operation) ? 'navigate' : 'other')),
      ranking: answerMatch ? validRanking(answerMatch[1]) : '',
      option: dragMatch ? dragMatch[1].toUpperCase() : ''
    });
  }

  for (const teacher of byTeacher.values()) {
    for (const item of Object.values(teacher.items)) {
      item.events.sort((a, b) => a.at - b.at);
      const times = item.events.map((event) => event.at).filter(Boolean);
      item.durationMs = times.length > 1 ? Math.max(0, times[times.length - 1] - times[0]) : 0;
      item.reviseCount = item.events.filter((event) => event.kind === 'move').length;
      item.rankingPath = item.events.map((event) => event.ranking).filter(Boolean).filter((value, index, list) => index === 0 || value !== list[index - 1]);
      delete item.events;
    }
  }
  return byTeacher;
}

function compactItem(itemId, ranking, process) {
  const bank = findItem(itemId);
  const optionTexts = { ...(bank?.options || {}), ...(process?.optionTexts || {}) };
  const top = ranking[0];
  return {
    itemId,
    canonicalItemId: bank?.item_id || itemId,
    title: bank?.title || itemId,
    stem: bank?.stem || '',
    indicator: bank?.indicator || '',
    ranking,
    topOption: top,
    topOptionText: optionTexts[top] || '',
    options: optionTexts,
    process: {
      durationMs: process?.durationMs || 0,
      reviseCount: process?.reviseCount || 0,
      rankingPath: process?.rankingPath || []
    },
    bankMatched: Boolean(bank)
  };
}

async function combineImport(resultBase64, processBase64) {
  const [results, processes] = await Promise.all([parseResults(resultBase64), parseProcesses(processBase64)]);
  const teachers = results.teachers.map((teacher) => {
    const process = processes.get(teacher.nameKey);
    const items = Object.entries(teacher.answers).map(([itemId, ranking]) => compactItem(itemId, ranking, process?.items?.[itemId]));
    return {
      ...teacher,
      items,
      importWarnings: [
        ...(!process ? ['未找到同名过程记录'] : []),
        ...(items.some((item) => !item.bankMatched) ? ['部分题号尚未匹配20题题库'] : [])
      ]
    };
  });
  const names = new Map();
  for (const teacher of teachers) names.set(teacher.nameKey, (names.get(teacher.nameKey) || 0) + 1);
  for (const teacher of teachers) teacher.duplicateName = names.get(teacher.nameKey) > 1;
  return {
    teachers,
    stats: {
      teacherCount: teachers.length,
      duplicateNameCount: [...names.values()].filter((count) => count > 1).length,
      questionCount: results.questionIds.length,
      matchedQuestionCount: new Set(teachers.flatMap((teacher) => teacher.items.filter((item) => item.bankMatched).map((item) => item.itemId))).size,
      processTeacherCount: processes.size
    }
  };
}

module.exports = { combineImport, normalizeName, parseProcesses, parseResults, validRanking };
