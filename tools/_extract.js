/**
 * 共享抽取库：解析 DOC 的 docx / xlsx（含 x: 命名空间知识库）。
 * 仅供 tools/build_*.js 使用；小程序运行时不依赖。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

function unzipTo(file) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xdz-'));
  execSync('unzip -o "' + file + '" -d "' + tmp + '"', { stdio: 'ignore' });
  return tmp;
}

/** docx → 段落文本数组（非空） */
function docxParas(file) {
  const dir = unzipTo(file);
  const xml = fs.readFileSync(path.join(dir, 'word', 'document.xml'), 'utf8');
  const paras = [];
  xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (m) => {
    let t = '';
    m.replace(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g, (mm, x) => { t += x; return ''; });
    paras.push(t);
    return '';
  });
  return paras.map((p) => decodeEntities(p)).filter((p) => p.trim());
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)))
    .replace(/&apos;/g, "'");
}

/** 通用 xlsx（标准命名空间，无前缀）→ { sheetName: rows[][] } */
function xlsxSheets(file) {
  return readSheets(file, false);
}
/** 知识库 xlsx（x: 命名空间 + 内联 t="str"）→ { sheetName: rows(每行 {col:val}) } */
function xlsxSheetsX(file) {
  return readSheets(file, true);
}

function readSheets(file, isX) {
  const dir = unzipTo(file);
  const wb = fs.readFileSync(path.join(dir, 'xl', 'workbook.xml'), 'utf8');
  const rels = fs.readFileSync(path.join(dir, 'xl', '_rels', 'workbook.xml.rels'), 'utf8');
  const p = isX ? 'x:' : '';

  // sharedStrings（标准 xlsx 用；x: 版内联，不需要）
  let shared = [];
  const ssPath = path.join(dir, 'xl', 'sharedStrings.xml');
  if (!isX && fs.existsSync(ssPath)) {
    const ss = fs.readFileSync(ssPath, 'utf8');
    ss.replace(/<si>([\s\S]*?)<\/si>/g, (m, inner) => {
      let t = '';
      inner.replace(/<t[^>]*>([\s\S]*?)<\/t>/g, (mm, x) => { t += x; return ''; });
      shared.push(decodeEntities(t));
      return '';
    });
  }

  const idToFile = {};
  rels.replace(/<Relationship\b[^>]*?>/g, (tag) => {
    const id = (tag.match(/Id="([^"]+)"/) || [])[1];
    const tgt = (tag.match(/Target="([^"]*)"/) || [])[1];
    if (id && tgt && /worksheets\/sheet\d+\.xml/.test(tgt)) idToFile[id] = tgt.replace(/^.*worksheets\//, '');
    return '';
  });
  const nameToFile = {};
  const sheetRe = new RegExp('<' + p + 'sheet name="([^"]*)"[^>]*?r:id="([^"]+)"', 'g');
  wb.replace(sheetRe, (m, n, id) => { nameToFile[n] = idToFile[id]; return ''; });

  const out = {};
  Object.keys(nameToFile).forEach((name) => {
    const f = nameToFile[name];
    if (!f) return;
    out[name] = isX
      ? parseSheetX(path.join(dir, 'xl', 'worksheets', f))
      : parseSheetStd(path.join(dir, 'xl', 'worksheets', f), shared);
  });
  return out;
}

/** x: 命名空间 sheet → rows(按行号 r 定位；rows[i] 对应第 i+1 行) */
function parseSheetX(file) {
  const xml = fs.readFileSync(file, 'utf8');
  const rows = [];
  xml.replace(/<x:row[^>]*?r="(\d+)"[^>]*>([\s\S]*?)<\/x:row>/g, (m, rn, inner) => {
    const cells = {};
    inner.replace(/<x:c\b[^>]*r="([A-Z]+)\d+"[^>]*?(\/>|>([\s\S]*?)<\/x:c>)/g, (mm, col, tail, cont) => {
      let v = '';
      if (cont) { const vm = cont.match(/<x:v>([\s\S]*?)<\/x:v>/); if (vm) v = decodeEntities(vm[1]); }
      if (v !== '') cells[col] = v;
      return '';
    });
    rows[Number(rn) - 1] = cells;
    return '';
  });
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = {};
  return rows;
}

/** 标准 sheet → rows(每行 { A:val ... })，t="s" 走 sharedStrings */
function parseSheetStd(file, shared) {
  const xml = fs.readFileSync(file, 'utf8');
  const rows = [];
  xml.replace(/<row[^>]*?r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g, (m, rn, inner) => {
    const cells = {};
    inner.replace(/<c\b[^>]*r="([A-Z]+)\d+"([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g, (mm, col, attrs, tail, cont) => {
      let v = '';
      if (cont) {
        const vm = cont.match(/<v>([\s\S]*?)<\/v>/);
        if (vm) v = /t="s"/.test(attrs) ? shared[Number(vm[1])] : decodeEntities(vm[1]);
      }
      if (v !== '' && v != null) cells[col] = v;
      return '';
    });
    rows[Number(rn) - 1] = cells;
    return '';
  });
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = {};
  return rows;
}

/* ---- 文本解析工具 ---- */
function parseEcodes(text) {
  if (!text) return [];
  const set = [];
  // 展开 E1-E7 区间
  text.replace(/E(\d)\s*[-—~]\s*E(\d)/g, (m, a, b) => {
    for (let i = Number(a); i <= Number(b); i++) set.push('E' + i);
    return '';
  });
  (text.match(/E[1-7]/g) || []).forEach((e) => set.push(e));
  return uniq(set);
}
function parseTcodes(text) {
  return uniq((text || '').match(/T[1-7]/g) || []);
}
/** Q 脚本码：Q1..Q7 / Q-stop；Q2-D / Q2-Aculture / Q1-Afirst 等后缀归一到基码 Q2/Q1。忽略 S 码。 */
function parseQcodes(text) {
  if (!text) return [];
  const out = [];
  const re = /Q-stop|Q\d(?:-[A-Za-z]+)?/g;
  let m;
  while ((m = re.exec(text))) {
    let code = m[0];
    if (code !== 'Q-stop') code = code.replace(/-[A-Za-z]+$/, '');
    out.push(code);
  }
  return uniq(out);
}
function prioNum(text) {
  const t = text || '';
  if (t.indexOf('低') >= 0) return 1; // 低 / 低/中
  if (t.indexOf('中高') >= 0) return 3;
  if (t.indexOf('高') >= 0) return 4;
  if (t.indexOf('中') >= 0) return 2;
  return 2;
}
/** 评分锚点「必要证据点」文本 → {required, weak}（含「不足/较弱/缺」的子句归 weak） */
function parseAnchorReq(text) {
  const required = [];
  const weak = [];
  (text || '').split(/[；;]/).forEach((clause) => {
    const codes = parseEcodes(clause);
    if (/不足|较弱|缺失|缺/.test(clause)) weak.push(...codes);
    else required.push(...codes);
  });
  return { required: uniq(required), weak: uniq(weak) };
}
function firstLetter(text) {
  const m = (text || '').match(/^\s*([A-D])[：:]/);
  return m ? m[1] : null;
}
function uniq(arr) {
  const seen = {};
  const out = [];
  arr.forEach((x) => { if (!seen[x]) { seen[x] = 1; out.push(x); } });
  return out;
}

module.exports = {
  docxParas, xlsxSheets, xlsxSheetsX,
  parseEcodes, parseTcodes, parseQcodes, prioNum, parseAnchorReq, firstLetter, uniq
};
