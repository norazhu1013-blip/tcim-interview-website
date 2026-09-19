const app = document.querySelector('#app');
const api = async (path, options = {}) => {
  const { timeoutMs = 20000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch('./api/' + path, {
      credentials: 'include',
      ...fetchOptions,
      signal: controller.signal,
      headers: { ...(fetchOptions.body ? { 'Content-Type': 'application/json' } : {}), ...(fetchOptions.headers || {}) }
    });
    const data = await response.json().catch(() => ({ ok: false, error: 'invalid_response' }));
    if (!response.ok) throw Object.assign(new Error(data.error || 'request_failed'), { code: data.error, status: response.status });
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') throw Object.assign(new Error('request_timeout'), { code: 'request_timeout' });
    if (!error?.code) throw Object.assign(error, { code: 'network_error' });
    throw error;
  } finally { clearTimeout(timer); }
};
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const errors = {
  teacher_not_found: '没有找到对应的测验资料，请重新输入姓名或联系研究人员。',
  duplicate_teacher_name: '存在同名教师，请从姓名下方的候选名单中选择本人。',
  dataset_not_ready: '研究人员尚未上传访谈资料，请稍后再试。',
  session_not_found: '本次访谈登录已失效，请重新选择姓名。',
  interview_generation_failed: '问题暂未生成成功，请点击重试。',
  model_generation_failed: 'AI本轮没有成功返回，请点击重试。',
  request_timeout: '本轮等待时间过长，请点击重试。您的回答仍会使用同一轮次继续生成。',
  network_error: '网络连接暂时中断，请点击重试。',
  admin_login_required: '请先在“研究数据工作台”登录管理员账号。'
};
let state = { session: null, busy: false, timer: null, selectedTeacher: null, searchTimer: null };

function requestId(prefix = 'turn') {
  return `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}
function formatTime(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
function entry(message = '') {
  app.className = 'page';
  app.innerHTML = `<section class="card entry">
    <p class="eyebrow">整体访谈 · 约12分钟</p>
    <h1>找到自己的姓名，开始访谈</h1>
    <p>输入姓名中的一个字，系统会显示匹配结果。请选择本人；同名教师会用幼儿园等信息区分。</p>
    <form id="entry-form">
      <label class="field teacher-search">姓名
        <input id="teacher-name" name="name" maxlength="40" autocomplete="off" placeholder="例如输入“李”" required aria-autocomplete="list" aria-controls="teacher-results">
        <div id="teacher-results" class="teacher-results hidden" role="listbox"></div>
      </label>
      <p class="message" id="entry-message">${esc(message)}</p>
      <button class="button primary" type="submit">开始访谈</button>
    </form>
    <p class="fine">系统会读取已上传的测验结果和答题过程，无需在这里重新做题。</p>
    <div class="admin-entry">
      <div><strong>研究人员入口</strong><p class="fine">上传新的答题结果表和答题过程表；上传前需要登录管理员账号。</p></div>
      <a class="button secondary" href="#admin">管理员上传资料</a>
    </div>
  </section>`;
  const form = document.querySelector('#entry-form');
  const input = document.querySelector('#teacher-name');
  input.addEventListener('input', () => {
    state.selectedTeacher = null;
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => searchTeachers(input.value), 220);
  });
  form.addEventListener('submit', start);
}
async function searchTeachers(query) {
  const box = document.querySelector('#teacher-results');
  const message = document.querySelector('#entry-message');
  if (!box) return;
  if (!query.trim()) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  box.classList.remove('hidden');
  box.innerHTML = '<p class="search-note">正在查找…</p>';
  try {
    const result = await api('teachers/search', { method: 'POST', body: JSON.stringify({ query }) });
    if (!result.teachers.length) {
      box.innerHTML = '<p class="search-note">暂未找到匹配姓名，请继续输入。</p>';
      return;
    }
    box.innerHTML = result.teachers.map((teacher) => `<button type="button" class="teacher-choice" role="option" data-id="${esc(teacher.id)}" data-name="${esc(teacher.name)}" data-label="${esc(teacher.label)}">${esc(teacher.label)}</button>`).join('');
    box.querySelectorAll('.teacher-choice').forEach((button) => button.addEventListener('click', () => {
      state.selectedTeacher = { id: button.dataset.id, name: button.dataset.name, label: button.dataset.label };
      document.querySelector('#teacher-name').value = button.dataset.label;
      box.classList.add('hidden');
      if (message) message.textContent = `已选择：${button.dataset.label}`;
    }));
  } catch (error) {
    box.innerHTML = `<p class="search-note error">${esc(errors[error.code] || '暂时无法查找，请稍后重试。')}</p>`;
  }
}
async function start(event) {
  event.preventDefault();
  if (state.busy) return;
  state.busy = true;
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = '正在读取资料…';
  try {
    const name = new FormData(event.currentTarget).get('name');
    state.session = await api('start', {
      method: 'POST',
      body: JSON.stringify(state.selectedTeacher ? { teacherId: state.selectedTeacher.id } : { name })
    });
    chat();
    state.busy = false;
    if (!state.session.messages.length) await turn('', requestId('opening'));
  } catch (error) {
    entry(errors[error.code] || '暂时无法开始，请检查网络后重试。');
  } finally {
    state.busy = false;
  }
}
function chat() {
  clearInterval(state.timer);
  app.className = 'page wide-page';
  const session = state.session;
  app.innerHTML = `<section class="card chat-page">
    <div class="chat-head"><div><p class="eyebrow">整体访谈</p><h2>${esc(session.teacherName)}老师，您好</h2><p class="fine">AI会结合多道题的选择和答题过程追问；没有标准答案，请按真实想法回答。</p></div><span class="timer" id="timer"></span></div>
    <div class="chat-layout">
      <div class="conversation"><div class="messages" id="messages"></div><form class="composer" id="composer"><textarea name="message" maxlength="4000" placeholder="请输入您的想法…" required></textarea><button class="button primary" type="submit">发送</button></form><div id="chat-status" class="message"></div></div>
      <aside class="item-panel" id="item-context"></aside>
    </div>
  </section>`;
  renderMessages();
  renderContext();
  document.querySelector('#composer')?.addEventListener('submit', send);
  tick();
  state.timer = setInterval(tick, 1000);
}
function renderMessages() {
  const box = document.querySelector('#messages');
  if (!box) return;
  box.innerHTML = (state.session.messages || []).map((message) => `<div class="bubble ${message.role === 'teacher' ? 'teacher' : 'ai'}">${esc(message.text)}</div>`).join('');
  box.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  if (state.session.status === 'done') finishView();
}
function contextCard(item) {
  const ranking = String(item.ranking || '').split('').filter((letter) => item.options?.[letter]);
  return `<article class="item-card"><p class="eyebrow">当前谈到 · ${esc(item.itemId)}</p><h3>${esc(item.title)}</h3>${item.stem ? `<p class="item-stem">${esc(item.stem)}</p>` : ''}<p class="ranking-label">您当时的排序</p><ol class="ranking">${ranking.map((letter) => `<li><strong>${esc(letter)}</strong><span>${esc(item.options[letter])}</span></li>`).join('')}</ol></article>`;
}
function renderContext() {
  const panel = document.querySelector('#item-context');
  if (!panel) return;
  const items = state.session.itemContext || [];
  panel.innerHTML = items.length ? items.map(contextCard).join('') : '<div class="context-empty"><strong>题目回顾</strong><p>AI开始讨论具体情境后，这里会显示题目、选项和您当时的排序，方便回忆。</p></div>';
}
function tick() {
  const element = document.querySelector('#timer');
  if (element) element.textContent = '剩余 ' + formatTime(state.session.deadlineAt - Date.now());
}
async function send(event) {
  event.preventDefault();
  const area = event.currentTarget.message;
  const message = area.value.trim();
  if (!message || state.busy) return;
  area.value = '';
  state.session.messages.push({ role: 'teacher', text: message });
  renderMessages();
  await turn(message, requestId());
}
async function turn(message, id) {
  if (state.busy) return;
  state.busy = true;
  const form = document.querySelector('#composer');
  const button = form?.querySelector('button');
  const status = document.querySelector('#chat-status');
  if (button) { button.disabled = true; button.textContent = '正在思考…'; }
  let lastError;
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (status) status.textContent = attempt ? '刚才连接不稳定，系统正在自动重试…' : '正在结合您的回答和当前题目整理下一个问题…';
      const attemptStartedAt = Date.now();
      try {
        const result = await api('turn', { method: 'POST', body: JSON.stringify({ message, requestId: id }), timeoutMs: 58000 });
        state.session.messages.push({ role: 'ai', text: result.visibleText });
        state.session.turnCount = result.turnCount;
        state.session.status = result.done ? 'done' : 'active';
        state.session.itemContext = result.itemContext || [];
        renderMessages();
        renderContext();
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        const failedQuickly = Date.now() - attemptStartedAt < 12000;
        const transient = ['network_error', 'invalid_response', 'overall_internal_error', 'upstream_function_failed', 'model_generation_failed', 'interview_generation_failed'].includes(error.code);
        // 只自动恢复“很快就失败”的瞬时故障。已经等了较长时间后不再悄悄
        // 开启第二个完整模型请求，避免教师一次发送连续等待两轮。
        if (attempt === 0 && failedQuickly && transient) await new Promise((resolve) => setTimeout(resolve, 700));
        else break;
      }
    }
    if (lastError && status) {
      status.innerHTML = `<span class="error">${esc(errors[lastError.code] || '问题暂未生成成功。')}</span> <button class="button secondary" id="retry" type="button">重新生成</button>`;
      document.querySelector('#retry')?.addEventListener('click', () => turn(message, id));
    }
  } finally {
    state.busy = false;
    if (button && state.session.status !== 'done') { button.disabled = false; button.textContent = '发送'; }
    if (status && state.session.status !== 'done' && !status.querySelector('#retry')) status.textContent = '';
  }
}
function finishView() {
  clearInterval(state.timer);
  const form = document.querySelector('#composer');
  if (form) form.outerHTML = '<div class="finish-panel"><h2>访谈已完成</h2><p>感谢您的分享。本次对话已保存，研究人员后续会统一整理。</p><div class="finish-actions"><button class="button primary" id="choose-another" type="button">选择其他教师</button><a class="button secondary" href="/">返回网站首页</a></div></div>';
  document.querySelector('#choose-another')?.addEventListener('click', leaveCompletedSession);
  const timer = document.querySelector('#timer');
  if (timer) timer.textContent = '已完成';
}
async function leaveCompletedSession() {
  const button = document.querySelector('#choose-another');
  if (button) { button.disabled = true; button.textContent = '正在返回…'; }
  try { await api('logout', { method: 'POST', body: JSON.stringify({}) }); } catch {}
  state.session = null;
  state.selectedTeacher = null;
  entry('已退出上一场访谈，请重新选择教师。');
}
async function fileBase64(file) {
  if (!file) return '';
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.onerror = reject; reader.readAsDataURL(file); });
}
async function adminPage() {
  app.className = 'page';
  let info;
  try { info = await api('admin-status'); } catch { info = { admin: false }; }
  const adminContent = info.admin
    ? `<form id="import-form"><label class="field">本批数据名称<input name="label" maxlength="80" placeholder="如：2026年9月教师整体访谈"></label><div class="upload-row"><label class="upload-box"><strong>答题结果表</strong><span class="fine">一位教师一行、每题一个排序</span><input name="result" type="file" accept=".xlsx" required></label><label class="upload-box"><strong>答题过程表</strong><span class="fine">一项操作一行；有无表头均可</span><input name="process" type="file" accept=".xlsx" required></label></div><p id="import-status" class="message"></p><button class="button primary" type="submit">检查并导入</button></form>`
    : `<div class="admin-login-panel"><strong>上传前请先登录管理员账号</strong><p>点击下方按钮会在新页面打开管理员登录。登录成功后，回到本页点击“我已登录”，即可显示上传资料的界面。</p><div class="button-row"><a class="button primary" href="../research/" target="_blank" rel="noopener">登录管理员账号</a><button class="button secondary" id="admin-recheck" type="button">我已登录，显示上传界面</button></div><p class="message" id="admin-check-message"></p></div>`;
  app.innerHTML = `<section class="card admin-grid"><div><p class="eyebrow">管理员 · 整体访谈</p><h1>上传教师测验资料</h1><p>每次上传一份答题结果表和对应的答题过程表。新上传的数据会成为当前访谈数据，旧数据和旧访谈不会删除。</p></div>${info.dataset ? `<p class="fine">当前数据：${esc(info.dataset.label)} · ${esc(info.dataset.stats?.teacherCount || 0)}位教师 · ${esc(info.dataset.stats?.questionCount || 0)}题</p>` : ''}${adminContent}<a href="./">返回教师入口</a></section>`;
  document.querySelector('#admin-recheck')?.addEventListener('click', async () => {
    const button = document.querySelector('#admin-recheck');
    const message = document.querySelector('#admin-check-message');
    button.disabled = true;
    button.textContent = '正在确认…';
    try {
      const refreshed = await api('admin-status');
      if (!refreshed.admin) {
        message.textContent = '尚未检测到管理员登录，请先完成登录；如果刚登录成功，请再点一次。';
        button.disabled = false;
        button.textContent = '我已登录，重新检查';
        return;
      }
      await adminPage();
    } catch {
      message.textContent = '暂时无法确认登录状态，请检查网络后重试。';
      button.disabled = false;
      button.textContent = '重新检查';
    }
  });
  document.querySelector('#import-form')?.addEventListener('submit', async (event) => {
    event.preventDefault(); const button = event.currentTarget.querySelector('button'); const status = document.querySelector('#import-status'); button.disabled = true; button.textContent = '正在检查表格…';
    try {
      const form = new FormData(event.currentTarget); const [resultBase64, processBase64] = await Promise.all([fileBase64(form.get('result')), fileBase64(form.get('process'))]);
      const result = await api('import', { method: 'POST', body: JSON.stringify({ label: form.get('label'), resultBase64, processBase64 }) });
      status.className = 'message success'; status.textContent = `导入完成：${result.stats.teacherCount}位教师，${result.stats.questionCount}题；其中${result.stats.matchedQuestionCount}个题号已匹配题库。`; button.textContent = '已导入';
    } catch (error) { status.className = 'message error'; status.textContent = errors[error.code] || `导入失败（${error.code || '未知错误'}），原有数据未更改。`; button.disabled = false; button.textContent = '重新检查并导入'; }
  });
}
async function boot() {
  if (location.hash === '#admin') return adminPage();
  try { state.session = await api('session'); chat(); } catch { entry(); }
}
window.addEventListener('hashchange', () => location.reload());
boot();
