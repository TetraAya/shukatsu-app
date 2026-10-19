'use strict';

// ---------- 定数 ----------
const INDUSTRIES = ['IT・通信', 'メーカー', '商社', '金融', 'コンサル', '広告・マスコミ', '小売・流通',
  '不動産・建設', 'インフラ・エネルギー', '医療・製薬', '公務員・団体', 'その他', '未設定'];
const INDUSTRY_COLORS = ['#3b5bdb', '#2f9e44', '#e8590c', '#7048e8', '#0c8599', '#d6336c', '#f08c00',
  '#5c7080', '#1971c2', '#c2255c', '#087f5b', '#868e96', '#adb5bd'];
const PRIORITY_COLORS = { '高': '#e03131', '中': '#f08c00', '低': '#4c6ef5' };
const TYPE_LABEL = { es: 'ES締切', interview: '面接', test: '適性検査' };
const TYPE_ICON = { es: '📝', interview: '🗣', test: '💻' };
const STATUSES = ['未応募', 'ES提出済み', '適性検査', '一次面接', '二次面接', '三次面接', '最終面接', '内定', '内定承諾', 'お見送り', '辞退'];

const state = { user: null, month: startOfMonth(new Date()), colorMode: 'industry', companies: [] };

// ---------- ユーティリティ ----------
const $ = (s, el = document) => el.querySelector(s);
const view = () => $('#view');
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function pad(n) { return String(n).padStart(2, '0'); }
function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function daysBetween(a, b) { return Math.round((parseYmd(b) - parseYmd(a)) / 86400000); }
function fmtDate(s) {
  const d = parseYmd(s);
  return `${d.getMonth() + 1}/${d.getDate()}(${'日月火水木金土'[d.getDay()]})`;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 2600);
}
async function api(path, method = 'GET', body) {
  const res = await fetch('/api' + path, {
    method, headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.user) { state.user = null; showAuth(); }
  if (!res.ok) throw new Error(data.error || 'エラーが発生しました');
  return data;
}
function colorFor(item) {
  if (state.colorMode === 'priority') return PRIORITY_COLORS[item.priority] || '#868e96';
  const i = INDUSTRIES.indexOf(item.industry);
  return INDUSTRY_COLORS[i >= 0 ? i : INDUSTRIES.length - 1];
}
function options(list, selected) {
  return list.map((v) => `<option value="${esc(v)}" ${v === selected ? 'selected' : ''}>${esc(v)}</option>`).join('');
}
// 簡易Markdown（AIの出力表示用。先にエスケープしてから変換）
function md(text) {
  const lines = esc(text).split('\n');
  let html = '', inList = false;
  for (const raw of lines) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    const li = line.match(/^\s*(?:[-*・]|\d+[.)])\s+(.*)/);
    if (li) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${li[1]}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    const h = line.match(/^#{1,4}\s+(.*)/);
    if (h) html += `<h4>${h[1]}</h4>`;
    else if (line.trim()) html += `<p>${line}</p>`;
  }
  if (inList) html += '</ul>';
  return html;
}
async function loadCompanies() { state.companies = await api('/companies'); return state.companies; }

// ---------- 認証 ----------
let registerMode = false;
function showAuth() { $('#app').classList.add('hidden'); $('#auth').classList.remove('hidden'); }
function showApp() {
  $('#auth').classList.add('hidden'); $('#app').classList.remove('hidden');
  $('#whoami').textContent = state.user.username;
  route();
}
$('#auth-toggle').onclick = () => {
  registerMode = !registerMode;
  $('#auth-submit').textContent = registerMode ? 'アカウント作成' : 'ログイン';
  $('#auth-toggle').textContent = registerMode ? 'ログイン画面に戻る' : 'アカウントを新規作成する';
  $('#a-pass').autocomplete = registerMode ? 'new-password' : 'current-password';
  $('#auth-err').textContent = '';
};
$('#auth-form').onsubmit = async (e) => {
  e.preventDefault();
  const btn = $('#auth-submit'); btn.disabled = true;
  try {
    const r = await api(registerMode ? '/register' : '/login', 'POST',
      { username: $('#a-user').value, password: $('#a-pass').value });
    const me = await api('/me');
    state.user = me.user || { username: r.username };
    $('#a-pass').value = '';
    showApp();
  } catch (err) { $('#auth-err').textContent = err.message; }
  btn.disabled = false;
};
$('#logout').onclick = async () => { await api('/logout', 'POST'); state.user = null; showAuth(); };

// ---------- ルーター ----------
window.addEventListener('hashchange', () => state.user && route());
function route() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [, page, arg] = h.split('/');
  const name = page || 'calendar';
  document.querySelectorAll('#nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.r === (name === 'company' ? 'companies' : name));
  });
  const pages = { calendar: pageCalendar, companies: pageCompanies, company: () => pageCompany(arg),
    list: pageList, todo: pageTodo, settings: pageSettings };
  (pages[name] || pageCalendar)().catch((e) => { view().innerHTML = `<div class="card error">${esc(e.message)}</div>`; });
}

// ---------- モーダル ----------
function openModal(html, onMount) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-bg"><div class="modal">${html}</div></div>`;
  root.firstChild.addEventListener('mousedown', (e) => { if (e.target === root.firstChild) closeModal(); });
  onMount && onMount(root.firstChild);
}
function closeModal() { $('#modal-root').innerHTML = ''; }

// 予定追加モーダル（企業名を入力→新規企業なら自動作成）
async function openAddEvent(date, fixedCompany) {
  await loadCompanies();
  openModal(`
    <h3>予定を追加</h3>
    <form id="ev-form">
      <label>企業名
        <input id="ev-company" list="co-list" required placeholder="企業名を入力（既存の企業は候補から選択）"
          value="${esc(fixedCompany?.name || '')}" ${fixedCompany ? 'readonly' : ''}>
        <datalist id="co-list">${state.companies.map((c) => `<option value="${esc(c.name)}">`).join('')}</datalist>
      </label>
      <div class="grid2" id="new-co-fields">
        <label>業界<select id="ev-industry">${options(INDUSTRIES, '未設定')}</select></label>
        <label>志望度<select id="ev-priority">${options(['高', '中', '低'], '中')}</select></label>
      </div>
      <p class="muted" id="new-co-note">※新しい企業名は、業界・志望度とともに自動で登録されます</p>
      <label>種類<select id="ev-type">${Object.entries(TYPE_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <div class="grid2">
        <label>日付<input id="ev-date" type="date" required value="${esc(date)}"></label>
        <label>時刻（任意）<input id="ev-time" type="time"></label>
      </div>
      <label>メモ（任意）<input id="ev-title" placeholder="例：1次面接 / 設問3つ"></label>
      <p class="error" id="ev-err"></p>
      <div class="row"><button class="btn primary inline" type="submit">追加</button>
        <button class="btn" type="button" id="ev-cancel">キャンセル</button></div>
    </form>`, (m) => {
    const sync = () => {
      const exists = state.companies.some((c) => c.name === $('#ev-company', m).value.trim());
      $('#new-co-fields', m).classList.toggle('hidden', exists);
      $('#new-co-note', m).classList.toggle('hidden', exists);
    };
    $('#ev-company', m).oninput = sync; sync();
    $('#ev-cancel', m).onclick = closeModal;
    $('#ev-form', m).onsubmit = async (e) => {
      e.preventDefault();
      try {
        const name = $('#ev-company', m).value.trim();
        let co = state.companies.find((c) => c.name === name);
        if (!co) co = await api('/companies', 'POST', { name, industry: $('#ev-industry', m).value, priority: $('#ev-priority', m).value });
        await api('/events', 'POST', { company_id: co.id, type: $('#ev-type', m).value, due_date: $('#ev-date', m).value,
          due_time: $('#ev-time', m).value, title: $('#ev-title', m).value });
        closeModal(); toast('追加しました'); route();
      } catch (err) { $('#ev-err', m).textContent = err.message; }
    };
  });
}

// ---------- カレンダー ----------
async function pageCalendar() {
  const first = state.month;
  const gridStart = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
  const gridEnd = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + 41);
  const events = await api(`/events?from=${ymd(gridStart)}&to=${ymd(gridEnd)}`);
  const byDay = {};
  events.forEach((e) => (byDay[e.due_date] ||= []).push(e));
  const today = ymd(new Date());

  let cells = ['日', '月', '火', '水', '木', '金', '土'].map((d) => `<div class="dow">${d}</div>`).join('');
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    const key = ymd(d);
    const chips = (byDay[key] || []).map((e) => `
      <a class="chip ${e.done ? 'done' : ''}" style="background:${colorFor(e)}" href="#/company/${e.company_id}" data-chip="1"
         title="${esc(e.company_name)} / ${TYPE_LABEL[e.type]} / ${esc(e.status)}">
        ${TYPE_ICON[e.type]} ${esc(e.company_name)}<small>${TYPE_LABEL[e.type]}${e.due_time ? ' ' + e.due_time : ''}・${esc(e.status)}</small>
      </a>`).join('');
    cells += `<div class="day ${d.getMonth() !== first.getMonth() ? 'other' : ''} ${key === today ? 'today' : ''}" data-date="${key}">
      <span class="num">${d.getDate()}</span>${chips}</div>`;
  }
  const legend = state.colorMode === 'industry'
    ? INDUSTRIES.slice(0, -1).map((n, i) => `<span><i style="background:${INDUSTRY_COLORS[i]}"></i>${n}</span>`).join('')
    : Object.entries(PRIORITY_COLORS).map(([n, c]) => `<span><i style="background:${c}"></i>志望度 ${n}</span>`).join('');

  view().innerHTML = `
    <div class="card">
      <div class="cal-head">
        <button class="btn small" id="prev">◀</button>
        <h2>${first.getFullYear()}年${first.getMonth() + 1}月</h2>
        <button class="btn small" id="next">▶</button>
        <button class="btn small" id="today">今日</button>
        <span class="spacer"></span>
        <div class="seg" id="mode">
          <button data-m="industry" class="${state.colorMode === 'industry' ? 'on' : ''}">業界別</button>
          <button data-m="priority" class="${state.colorMode === 'priority' ? 'on' : ''}">志望度別</button>
        </div>
        <button class="btn small primary inline" id="add">＋ 予定を追加</button>
      </div>
      <div class="cal">${cells}</div>
      <div class="legend">${legend}</div>
      <p class="muted">日付をタップで予定追加、企業名をタップでその企業のマイページへ移動します。</p>
    </div>`;
  $('#prev').onclick = () => { state.month = new Date(first.getFullYear(), first.getMonth() - 1, 1); pageCalendar(); };
  $('#next').onclick = () => { state.month = new Date(first.getFullYear(), first.getMonth() + 1, 1); pageCalendar(); };
  $('#today').onclick = () => { state.month = startOfMonth(new Date()); pageCalendar(); };
  $('#add').onclick = () => openAddEvent(today);
  $('#mode').onclick = (e) => { const m = e.target.dataset.m; if (m) { state.colorMode = m; pageCalendar(); } };
  view().querySelectorAll('.day').forEach((el) => {
    el.onclick = (e) => { if (!e.target.closest('[data-chip]')) openAddEvent(el.dataset.date); };
  });
}

// ---------- 企業一覧 ----------
async function pageCompanies() {
  const list = await loadCompanies();
  view().innerHTML = `
    <div class="card">
      <div class="row"><h2 class="grow">企業一覧</h2><button class="btn small primary inline" id="add-co">＋ 企業を追加</button></div>
      ${list.length ? list.map((c) => `
        <div class="item">
          <span class="dot" style="background:${colorFor(c)}"></span>
          <div class="main"><a class="company-link" href="#/company/${c.id}">${esc(c.name)}</a>
            <div class="muted">${esc(c.industry)}・志望度 ${esc(c.priority)}</div></div>
          <span class="badge">${esc(c.status)}</span>
        </div>`).join('') : '<p class="muted">まだ企業が登録されていません。</p>'}
    </div>`;
  $('#add-co').onclick = () => openModal(`
    <h3>企業を追加</h3>
    <form id="co-form">
      <label>企業名<input id="c-name" required></label>
      <div class="grid2">
        <label>業界<select id="c-ind">${options(INDUSTRIES, '未設定')}</select></label>
        <label>志望度<select id="c-pri">${options(['高', '中', '低'], '中')}</select></label>
      </div>
      <p class="error" id="c-err"></p>
      <div class="row"><button class="btn primary inline" type="submit">追加</button>
        <button class="btn" type="button" id="c-cancel">キャンセル</button></div>
    </form>`, (m) => {
    $('#c-cancel', m).onclick = closeModal;
    $('#co-form', m).onsubmit = async (e) => {
      e.preventDefault();
      try {
        const c = await api('/companies', 'POST', { name: $('#c-name', m).value, industry: $('#c-ind', m).value, priority: $('#c-pri', m).value });
        closeModal(); location.hash = `#/company/${c.id}`;
      } catch (err) { $('#c-err', m).textContent = err.message; }
    };
  });
}

// ---------- 企業マイページ ----------
async function pageCompany(id) {
  const { company: c, events, ai } = await api(`/companies/${id}`);
  const aiBy = Object.fromEntries(ai.map((a) => [a.kind, a]));
  const when = (a) => (a ? `<p class="muted">前回の結果（${new Date(a.created_at).toLocaleString('ja-JP')}）</p>` : '');

  view().innerHTML = `
    <div class="card">
      <div class="row"><h2 class="grow"><span class="dot" style="background:${colorFor(c)}"></span>${esc(c.name)}</h2>
        <a class="btn small" href="#/">← カレンダーへ</a></div>
      <form id="co-edit">
        <label>企業名<input id="f-name" value="${esc(c.name)}" required></label>
        <div class="grid2">
          <label>選考状況<select id="f-status">${options(STATUSES, c.status)}</select></label>
          <label>業界<select id="f-ind">${options(INDUSTRIES, c.industry)}</select></label>
          <label>志望度<select id="f-pri">${options(['高', '中', '低'], c.priority)}</select></label>
          <label>企業URL<input id="f-url" value="${esc(c.url)}" placeholder="https://"></label>
        </div>
        <label>メモ（企業研究のメモ・OB訪問の内容など）<textarea id="f-memo">${esc(c.memo)}</textarea></label>
        <div class="row"><button class="btn primary inline" type="submit">保存</button>
          <button class="btn danger" type="button" id="del-co">この企業を削除</button></div>
      </form>
    </div>

    <div class="card">
      <h2>選考スケジュール</h2>
      <div id="ev-list">${events.length ? events.map((e) => `
        <div class="item ${e.done ? 'done' : ''}">
          <input type="checkbox" data-done="${e.id}" ${e.done ? 'checked' : ''} aria-label="完了">
          <div class="main"><div class="t">${TYPE_ICON[e.type]} ${TYPE_LABEL[e.type]}${e.title ? '：' + esc(e.title) : ''}</div>
            <div class="muted">${fmtDate(e.due_date)} ${esc(e.due_time)}</div></div>
          <button class="btn small danger" data-del="${e.id}">削除</button>
        </div>`).join('') : '<p class="muted">予定はまだありません。</p>'}</div>
      <form id="ev-add" class="row" style="margin-top:12px">
        <select id="n-type" style="width:auto">${Object.entries(TYPE_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        <input id="n-date" type="date" required style="width:auto">
        <input id="n-time" type="time" style="width:auto">
        <input id="n-title" class="grow" placeholder="メモ（任意）">
        <button class="btn small" type="submit">＋ 追加</button>
      </form>
    </div>

    <div class="card">
      <h2>AIで企業研究</h2>
      <p class="muted">ChatGPT（あなたのAPIキー）を使って、企業研究と志望動機の切り口を整理します。</p>
      <label>調べた情報・気になる点（任意。空欄なら上のメモを使用）<textarea id="r-info"></textarea></label>
      <button class="btn primary inline" id="run-research">企業研究を実行</button>
      <div id="research-out">${aiBy.research ? `${when(aiBy.research)}<div class="ai-out">${md(aiBy.research.result)}</div>` : ''}</div>
    </div>

    <div class="card">
      <h2>ES添削とアピールポイント</h2>
      <p class="muted">企業研究の結果も踏まえて、この企業向けのアピールポイントと修正案を出します。</p>
      <label>設問（任意）<input id="e-q" placeholder="例：学生時代に力を入れたこと（400字）"></label>
      <label>ES本文<textarea id="e-text" style="min-height:180px">${esc(c.es_draft)}</textarea></label>
      <button class="btn primary inline" id="run-es">ESを添削する</button>
      <div id="es-out">${aiBy.es_review ? `${when(aiBy.es_review)}<div class="ai-out">${md(aiBy.es_review.result)}</div>` : ''}</div>
    </div>`;

  $('#co-edit').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api(`/companies/${id}`, 'PUT', { name: $('#f-name').value, status: $('#f-status').value, industry: $('#f-ind').value,
        priority: $('#f-pri').value, url: $('#f-url').value, memo: $('#f-memo').value });
      toast('保存しました'); pageCompany(id);
    } catch (err) { toast(err.message); }
  };
  $('#del-co').onclick = async () => {
    if (!confirm(`「${c.name}」と関連する予定をすべて削除します。よろしいですか？`)) return;
    await api(`/companies/${id}`, 'DELETE'); location.hash = '#/companies';
  };
  $('#ev-add').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/events', 'POST', { company_id: id, type: $('#n-type').value, due_date: $('#n-date').value,
        due_time: $('#n-time').value, title: $('#n-title').value });
      pageCompany(id);
    } catch (err) { toast(err.message); }
  };
  $('#ev-list').onclick = async (e) => {
    if (e.target.dataset.del) { await api(`/events/${e.target.dataset.del}`, 'DELETE'); pageCompany(id); }
  };
  $('#ev-list').onchange = async (e) => {
    if (e.target.dataset.done) { await api(`/events/${e.target.dataset.done}`, 'PUT', { done: e.target.checked }); pageCompany(id); }
  };

  const runAI = (btn, out, path, body) => async () => {
    btn.disabled = true; const label = btn.textContent; btn.textContent = '生成中…（30秒ほどかかる場合があります）';
    try {
      const r = await api(path, 'POST', body());
      out.innerHTML = `<div class="ai-out">${md(r.result)}</div>`;
    } catch (err) { out.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
    btn.disabled = false; btn.textContent = label;
  };
  $('#run-research').onclick = runAI($('#run-research'), $('#research-out'), `/companies/${id}/ai/research`,
    () => ({ info: $('#r-info').value }));
  $('#run-es').onclick = runAI($('#run-es'), $('#es-out'), `/companies/${id}/ai/es-review`,
    () => ({ es: $('#e-text').value, question: $('#e-q').value }));
}

// ---------- 項目別リスト ----------
let listType = 'es', listOnlyOpen = true;
async function pageList() {
  const all = await api(`/events?type=${listType}`);
  const events = listOnlyOpen ? all.filter((e) => !e.done) : all;
  const today = ymd(new Date());
  view().innerHTML = `
    <div class="card">
      <h2>項目別リスト</h2>
      <div class="tabs" id="tabs">${Object.entries(TYPE_LABEL).map(([k, v]) =>
        `<button data-t="${k}" class="${k === listType ? 'on' : ''}">${TYPE_ICON[k]} ${v}</button>`).join('')}</div>
      <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="only-open" style="width:auto;margin:0" ${listOnlyOpen ? 'checked' : ''}>未完了のみ表示</label>
      ${events.length ? events.map((e) => itemRow(e, today)).join('') : '<p class="muted">該当する予定はありません。</p>'}
    </div>`;
  $('#tabs').onclick = (e) => { if (e.target.dataset.t) { listType = e.target.dataset.t; pageList(); } };
  $('#only-open').onchange = (e) => { listOnlyOpen = e.target.checked; pageList(); };
  bindItemActions(pageList);
}
function itemRow(e, today) {
  const diff = daysBetween(today, e.due_date);
  const badge = e.done ? '' : diff < 0 ? `<span class="badge warn">${-diff}日超過</span>`
    : diff === 0 ? '<span class="badge warn">今日</span>'
    : `<span class="badge ${diff <= 3 ? 'soon' : ''}">あと${diff}日</span>`;
  return `
    <div class="item ${e.done ? 'done' : ''}">
      <input type="checkbox" data-done="${e.id}" ${e.done ? 'checked' : ''} aria-label="完了">
      <span class="dot" style="background:${colorFor(e)}"></span>
      <div class="main"><div class="t"><a class="company-link" href="#/company/${e.company_id}">${esc(e.company_name)}</a>
        <span class="muted">${TYPE_ICON[e.type]} ${TYPE_LABEL[e.type]}${e.title ? '：' + esc(e.title) : ''}</span></div>
        <div class="muted">${fmtDate(e.due_date)} ${esc(e.due_time)}・${esc(e.status)}</div></div>
      ${badge}
    </div>`;
}
function bindItemActions(reload) {
  view().querySelectorAll('[data-done]').forEach((cb) => {
    cb.onchange = async () => { await api(`/events/${cb.dataset.done}`, 'PUT', { done: cb.checked }); reload(); };
  });
}

// ---------- やること（期日が近い順） ----------
let todoUntil = null;
async function pageTodo() {
  const today = ymd(new Date());
  if (!todoUntil) { const d = new Date(); d.setDate(d.getDate() + 14); todoUntil = ymd(d); }
  const items = await api(`/todo?until=${todoUntil}`);
  view().innerHTML = `
    <div class="card">
      <h2>その日までにやること</h2>
      <div class="row">
        <label style="margin:0">いつまで？<input id="until" type="date" value="${todoUntil}" min="${today}" style="width:auto"></label>
        <span class="muted">今日〜この日までの未完了の予定を、期日が近い順に表示します（期限超過を含む）</span>
      </div>
      <div style="margin-top:8px">
        ${items.length ? items.map((e) => itemRow(e, today)).join('') : '<p class="muted">この日までにやることはありません 🎉</p>'}
      </div>
    </div>`;
  $('#until').onchange = (e) => { if (e.target.value) { todoUntil = e.target.value; pageTodo(); } };
  bindItemActions(pageTodo);
}

// ---------- 設定 ----------
async function pageSettings() {
  const { user } = await api('/me');
  state.user = user;
  view().innerHTML = `
    <div class="card">
      <h2>ChatGPT（OpenAI）連携</h2>
      <p class="muted">企業研究・ES添削には、あなた自身のOpenAI APIキーを使います。キーはサーバー側で暗号化して保存され、他のユーザーには使われません。
        <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">APIキーの発行はこちら</a></p>
      <p>状態：${user.hasKey ? '<span class="badge">登録済み</span>' : '<span class="badge warn">未登録</span>'}</p>
      <form id="key-form">
        <label>APIキー${user.hasKey ? '（変更する場合のみ入力）' : ''}
          <input id="k-key" type="password" autocomplete="off" placeholder="sk-..."></label>
        <label>モデル名（候補から選ぶか、使いたいモデル名を直接入力）
          <input id="k-model" list="model-list" value="${esc(user.model || 'gpt-4o-mini')}" autocomplete="off" required>
          <datalist id="model-list">${['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-5-mini', 'gpt-5'].map((m) => `<option value="${m}">`).join('')}</datalist>
        </label>
        <div class="row"><button class="btn primary inline" type="submit">保存</button>
          ${user.hasKey ? '<button class="btn danger" type="button" id="k-del">キーを削除</button>' : ''}</div>
      </form>
    </div>`;
  $('#key-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/settings/openai', 'PUT', { apiKey: $('#k-key').value, model: $('#k-model').value.trim() });
      toast('保存しました'); pageSettings();
    } catch (err) { toast(err.message); }
  };
  const del = $('#k-del');
  if (del) del.onclick = async () => { await api('/settings/openai', 'DELETE'); toast('削除しました'); pageSettings(); };
}

// ---------- 起動 ----------
(async () => {
  try {
    const me = await api('/me');
    if (me.user) { state.user = me.user; showApp(); } else showAuth();
  } catch { showAuth(); }
})();
