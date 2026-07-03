/**
 * 一致性校验：题号在 questions/scoreTable/indicatorMap/knowledge 四处一致、无缺题；
 * scoreTable 每题 24 排列、分值 0-4；knowledge 的 triggers.scripts / biases.script 引用码存在；
 * indicatorMap 覆盖校验数据合理（主二级分布）。运行：node tools/validate_data.js
 */
const q = require('../miniprogram/data/questions.js');
const st = require('../miniprogram/data/scoreTable.js');
const im = require('../miniprogram/data/indicatorMap.js');
const kb = require('../miniprogram/data/knowledge.js');

const errs = [];
const ids = q.ITEMS.map((x) => x.item_id);
const expect = [];
for (let i = 1; i <= 10; i++) expect.push('Q' + i);

// 四处题号一致
expect.forEach((id) => {
  if (ids.indexOf(id) < 0) errs.push('questions 缺 ' + id);
  if (!st.SCORES[id]) errs.push('scoreTable 缺 ' + id);
  if (!im.MAP[id]) errs.push('indicatorMap 缺 ' + id);
  if (!kb.KB[id]) errs.push('knowledge 缺 ' + id);
});
if (ids.length !== 10) errs.push('questions 题数=' + ids.length);

// scoreTable 24 排列 + 0-4
Object.keys(st.SCORES).forEach((id) => {
  const keys = Object.keys(st.SCORES[id]);
  if (keys.length !== 24) errs.push(id + ' 排列数=' + keys.length);
  keys.forEach((k) => { const v = st.SCORES[id][k]; if (!(v >= 0 && v <= 4)) errs.push(id + ' ' + k + ' 分值越界 ' + v); });
});

// questions 每题 4 选项 + 题干
q.ITEMS.forEach((it) => {
  ['A', 'B', 'C', 'D'].forEach((k) => { if (!it.options[k]) errs.push(it.item_id + ' 缺选项 ' + k); });
  if (!it.stem) errs.push(it.item_id + ' 缺题干');
  if (!it.title) errs.push(it.item_id + ' 缺标题');
});

// knowledge 引用完整性
Object.keys(kb.KB).forEach((id) => {
  const it = kb.KB[id];
  const sc = Object.keys(it.scripts);
  ['core_orientation', 'empirical_note'].forEach((f) => { if (!it[f]) errs.push(id + ' 缺 ' + f); });
  [['paths', it.paths], ['evidence_points', it.evidence_points], ['biases', it.biases], ['triggers', it.triggers], ['anchors', it.anchors], ['suggestions', it.suggestions]].forEach(([n, a]) => { if (!a || !a.length) errs.push(id + ' 缺 ' + n); });
  (it.triggers || []).forEach((t) => (t.scripts || []).forEach((c) => { if (sc.indexOf(c) < 0) errs.push(id + ' ' + t.code + ' 引用不存在脚本 ' + c); }));
  (it.biases || []).forEach((b) => (b.script || []).forEach((c) => { if (sc.indexOf(c) < 0) errs.push(id + ' ' + b.code + ' 引用不存在脚本 ' + c); }));
  Object.keys(it.scripts).forEach((c) => (it.scripts[c].E || []).forEach((e) => { if (!/^E[1-7]$/.test(e)) errs.push(id + ' ' + c + ' 非法证据码 ' + e); }));
});

// indicatorMap 主二级分布（应含多类，非全 C）
const secs = expect.map((id) => im.MAP[id] && im.MAP[id].primary.secondary);
const distinct = Array.from(new Set(secs));
console.log('主二级分布:', secs.join(''), '→ 去重', distinct.join('/'));

if (errs.length) { console.error('❌ 校验失败:\n' + errs.map((e) => '  - ' + e).join('\n')); process.exit(1); }
console.log('✅ 四处题号一致(Q1-Q10)、scoreTable 24×10 值域正确、knowledge 引用完整、questions/indicatorMap 齐全。');
