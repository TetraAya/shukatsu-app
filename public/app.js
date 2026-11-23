'use strict';

// ---------- 定数 ----------
const INDUSTRIES = ['IT・通信', 'メーカー', '商社', '金融', 'コンサル', '広告・マスコミ', '小売・流通',
  '不動産・建設', 'インフラ・エネルギー', '医療・製薬', '公務員・団体', 'その他'];
// 業界の色（INDUSTRIES と同じ順番）
// IT・通信=青 / メーカー=オレンジ / 商社=茶色 / 金融=黒 / コンサル=紫 / 広告・マスコミ=ピンク(薄め)
// 小売・流通=黄色 / 不動産・建設=黄緑 / インフラ・エネルギー=水色 / 医療・製薬=赤 / 公務員・団体=緑 / その他=グレー
const INDUSTRY_COLORS = ['#1c5fd4', '#fd7e14', '#8d5524', '#212529', '#9c36b5', '#e599b3',
  '#fcc419', '#94d82d', '#74c0fc', '#e03131', '#2f9e44', '#868e96'];
// 背景色が明るい色なら黒文字、暗い色なら白文字にする
function textOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 150 ? '#212529' : '#fff';
}
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
function industryKey(item) { return INDUSTRIES.includes(item.industry) ? item.industry : 'その他'; }
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
    list: pageList, todo: pageTodo, settings: pageSettings, import: pageImport };
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
        <label>業界<select id="ev-industry">${options(INDUSTRIES, 'その他')}</select></label>
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

// 予定の更新（サーバーが一部の項目だけ受け取る作りでも、全項目を送る作りでも動くよう、全項目を送る）
function saveEvent(ev, changes) {
  return api(`/events/${ev.id}`, 'PUT', {
    type: ev.type, due_date: ev.due_date, due_time: ev.due_time || '', title: ev.title || '', done: !!ev.done, ...changes,
  });
}
// 予定の編集モーダル（カレンダーの予定をタップしたとき）
function openEditEvent(ev) {
  openModal(`
    <h3>予定を編集</h3>
    <form id="ee-form">
      <p><b>${esc(ev.company_name)}</b>　<a href="#/company/${ev.company_id}" id="ee-co">企業ページを開く →</a></p>
      <label>種類<select id="ee-type">${Object.entries(TYPE_LABEL).map(([k, v]) =>
        `<option value="${k}" ${k === ev.type ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <div class="grid2">
        <label>日付<input id="ee-date" type="date" required value="${esc(ev.due_date)}"></label>
        <label>時刻（任意）<input id="ee-time" type="time" value="${esc(ev.due_time)}"></label>
      </div>
      <label>メモ（任意）<input id="ee-title" value="${esc(ev.title)}"></label>
      <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="ee-done" style="width:auto;margin:0" ${ev.done ? 'checked' : ''}>完了にする</label>
      <p class="error" id="ee-err"></p>
      <div class="row"><button class="btn primary inline" type="submit">保存</button>
        <button class="btn danger" type="button" id="ee-del">削除</button>
        <button class="btn" type="button" id="ee-cancel">キャンセル</button></div>
    </form>`, (m) => {
    $('#ee-cancel', m).onclick = closeModal;
    $('#ee-co', m).onclick = closeModal;
    $('#ee-del', m).onclick = async () => {
      if (!confirm('この予定を削除しますか？')) return;
      try { await api(`/events/${ev.id}`, 'DELETE'); closeModal(); toast('削除しました'); route(); }
      catch (err) { $('#ee-err', m).textContent = err.message; }
    };
    $('#ee-form', m).onsubmit = async (e) => {
      e.preventDefault();
      try {
        await saveEvent(ev, { type: $('#ee-type', m).value, due_date: $('#ee-date', m).value,
          due_time: $('#ee-time', m).value, title: $('#ee-title', m).value, done: $('#ee-done', m).checked });
        closeModal(); toast('保存しました'); route();
      } catch (err) { $('#ee-err', m).textContent = err.message; }
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
    // 色をそのままベタ塗りにし、明るい色は黒文字・暗い色は白文字に自動で切り替える
    const chips = (byDay[key] || []).map((e) => {
      const c = colorFor(e), fg = textOn(c);
      return `
      <a class="chip ${e.done ? 'done' : ''}" style="background:${c};color:${fg};cursor:grab" href="#/company/${e.company_id}" data-chip="1" data-id="${e.id}" draggable="true"
         title="${esc(e.company_name)} / ${esc(e.industry)} / ${TYPE_LABEL[e.type]} / ${esc(e.status)}">
        ${TYPE_ICON[e.type]} ${esc(e.company_name)}<small style="color:${fg};opacity:.85">${TYPE_LABEL[e.type]}${e.due_time ? ' ' + e.due_time : ''}・${esc(e.status)}</small>
      </a>`;
    }).join('');
    cells += `<div class="day ${d.getMonth() !== first.getMonth() ? 'other' : ''} ${key === today ? 'today' : ''}" data-date="${key}">
      <span class="num">${d.getDate()}</span>${chips}</div>`;
  }
  // 凡例は、表示中のカレンダーに実際に出てくる業界だけを表示
  const usedInd = new Set(events.map(industryKey));
  const legendInd = INDUSTRIES.map((n, i) => ({ n, c: INDUSTRY_COLORS[i] }))
    .filter((x) => !usedInd.size || usedInd.has(x.n));
  const legend = state.colorMode === 'industry'
    ? legendInd.map((x) => `<span><i style="background:${x.c}"></i>${x.n}</span>`).join('')
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
        <a class="btn small" href="#/import">📥 取り込み</a>
        <button class="btn small primary inline" id="add">＋ 予定を追加</button>
      </div>
      <div class="cal">${cells}</div>
      <div class="legend">${legend}</div>
      <p class="muted">日付をタップで予定追加、予定をタップで編集できます。パソコンでは、予定をドラッグして別の日に移動できます。</p>
    </div>`;
  $('#prev').onclick = () => { state.month = new Date(first.getFullYear(), first.getMonth() - 1, 1); pageCalendar(); };
  $('#next').onclick = () => { state.month = new Date(first.getFullYear(), first.getMonth() + 1, 1); pageCalendar(); };
  $('#today').onclick = () => { state.month = startOfMonth(new Date()); pageCalendar(); };
  $('#add').onclick = () => openAddEvent(today);
  $('#mode').onclick = (e) => { const m = e.target.dataset.m; if (m) { state.colorMode = m; pageCalendar(); } };
  const byId = Object.fromEntries(events.map((e) => [String(e.id), e]));
  // 予定をタップ→編集画面 / ドラッグ開始
  view().querySelectorAll('[data-chip]').forEach((el) => {
    const ev = byId[el.dataset.id];
    el.onclick = (e) => { e.preventDefault(); openEditEvent(ev); };
    el.ondragstart = (e) => {
      e.dataTransfer.setData('text/plain', String(ev.id));
      e.dataTransfer.effectAllowed = 'move';
    };
  });
  view().querySelectorAll('.day').forEach((el) => {
    el.onclick = (e) => { if (!e.target.closest('[data-chip]')) openAddEvent(el.dataset.date); };
    // ドロップ先の日付を枠で強調し、落としたらその日に移動する
    el.ondragover = (e) => {
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      el.style.outline = '3px solid #4c6ef5'; el.style.outlineOffset = '-3px';
    };
    el.ondragleave = () => { el.style.outline = ''; };
    el.ondrop = async (e) => {
      e.preventDefault(); el.style.outline = '';
      const ev = byId[e.dataTransfer.getData('text/plain')];
      if (!ev || ev.due_date === el.dataset.date) return;
      try {
        await saveEvent(ev, { due_date: el.dataset.date });
        toast(`${ev.company_name}を${fmtDate(el.dataset.date)}に移動しました`);
        pageCalendar();
      } catch (err) { toast(err.message); }
    };
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
        <label>業界<select id="c-ind">${options(INDUSTRIES, 'その他')}</select></label>
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
          <label>業界<select id="f-ind">${options(INDUSTRIES, INDUSTRIES.includes(c.industry) ? c.industry : 'その他')}</select></label>
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
      <p class="muted">Gemini（あなたのAPIキー）を使って、企業研究と志望動機の切り口を整理します。</p>
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

// ---------- カレンダーから取り込み（.ics） ----------
// TimeTree・Googleカレンダーなどから書き出した .ics を読み込み、月ごとに選んで予定として登録する
const IMPORT_JOB_RE = /面接|面談|GD|グループディスカッション|ES|エントリー|締切|締め切り|適性|SPI|Webテスト|WEBテスト|玉手箱|テストセンター|テスト|試験|説明会|インターン|選考|OB|OG|座談会/;
function guessType(s) {
  if (/面接|面談|GD|グループディスカッション/.test(s)) return 'interview';
  if (/適性|SPI|Webテスト|WEBテスト|玉手箱|テストセンター|筆記|テスト|試験/.test(s)) return 'test';
  return 'es';
}
// 予定名から「面接」「ES」などの言葉を取り除いて、企業名の候補にする（あとで自分で直せる）
function guessCompany(s) {
  let t = s.replace(/[【】\[\]（）()「」『』]/g, ' ')
    .replace(/(一次|二次|三次|最終|1次|2次|3次)?(面接|面談)|グループディスカッション|GD|ES(提出|締切|締め切り)?|エントリーシート|エントリー|締切|締め切り|適性検査|Webテスト|WEBテスト|SPI|玉手箱|テストセンター|テスト|試験|筆記|説明会|選考|インターン(シップ)?|座談会/g, ' ')
    .replace(/\s+/g, ' ').trim();
  t = t.replace(/^[-ー・:：/／\s]+|[-ー・:：/／\s]+$/g, '');
  return t || s.trim();
}
function icsUnescape(s) { return s.replace(/\\[nN]/g, ' ').replace(/\\([,;\\])/g, '$1'); }
function icsDate(val) {
  const m = val.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return {};
  const [, y, mo, d, h, mi, , z] = m;
  if (h === undefined) return { date: `${y}-${mo}-${d}` };            // 終日の予定
  if (z) {                                                             // UTC表記は、この端末の時刻（日本なら日本時間）に直す
    const dt = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi));
    return { date: ymd(dt), time: `${pad(dt.getHours())}:${pad(dt.getMinutes())}` };
  }
  return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}` };
}
function parseIcs(text) {
  const lines = text.replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const out = []; let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur && cur.date) out.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(':'); if (i < 0) continue;
    const key = line.slice(0, i).split(';')[0].toUpperCase();
    const val = line.slice(i + 1);
    if (key === 'SUMMARY') cur.summary = icsUnescape(val);
    else if (key === 'DTSTART') Object.assign(cur, icsDate(val));
    else if (key === 'RRULE') cur.recurring = true;
  }
  return out;
}

const imp = { rows: [], onlyFuture: true, industry: 'その他', priority: '中', result: '', fails: [] };

async function pageImport() {
  await loadCompanies();
  const today = ymd(new Date());
  const visible = (r) => !r.imported && (!imp.onlyFuture || r.date >= today);
  view().innerHTML = `
    <div class="card">
      <h2>カレンダーから予定を取り込む</h2>
      <p class="muted">TimeTreeやGoogleカレンダーなどから書き出した <b>.ics ファイル</b>を読み込み、月ごとに選んで就活の予定として取り込みます。</p>
      <details style="margin:8px 0 14px">
        <summary class="muted" style="cursor:pointer">.ics ファイルの用意のしかた</summary>
        <p class="muted">Googleカレンダーは、設定の「インポート/エクスポート」から .ics で書き出せます。TimeTreeは公式の書き出し機能が見当たらないため、有志の非公式ツール（timetree-exporter など）で .ics に変換する方法があります。非公式ツールは仕様変更で使えなくなることがあり、自己責任での利用になります。</p>
      </details>
      <input type="file" id="im-file" accept=".ics,text/calendar">
      <div id="im-body"></div>
    </div>`;
  const body = $('#im-body');
  const updateCount = () => { const n = $('#im-n'); if (n) n.textContent = imp.rows.filter((r) => visible(r) && r.checked).length; };
  const syncMonth = (m) => {
    const mc = body.querySelector(`[data-mon="${m}"]`);
    if (mc) mc.checked = imp.rows.filter((r) => visible(r) && r.date.startsWith(m)).every((r) => r.checked);
  };

  function rowHtml(r) {
    return `
      <div style="padding:10px 0;border-bottom:1px solid #e9ecef">
        <label style="display:flex;gap:8px;align-items:baseline;margin:0">
          <input type="checkbox" data-i="${r.i}" ${r.checked ? 'checked' : ''} style="width:auto;margin:0">
          <span><b>${fmtDate(r.date)}</b> ${esc(r.time)}　${esc(r.summary)}${r.recurring ? ' <span class="muted">（くり返し予定・最初の1回のみ）</span>' : ''}</span>
        </label>
        <div style="display:flex;gap:8px;margin:6px 0 0 28px;flex-wrap:wrap">
          <input data-co="${r.i}" list="im-co-list" value="${esc(r.company)}" placeholder="企業名" style="flex:1;min-width:140px">
          <select data-ty="${r.i}" style="width:auto">${Object.entries(TYPE_LABEL).map(([k, v]) =>
            `<option value="${k}" ${k === r.type ? 'selected' : ''}>${v}</option>`).join('')}</select>
        </div>
      </div>`;
  }

  function render() {
    const rows = imp.rows.filter(visible);
    const byMonth = {};
    rows.forEach((r) => (byMonth[r.date.slice(0, 7)] ||= []).push(r));
    const months = Object.keys(byMonth).sort();
    body.innerHTML = `
      ${imp.result ? `<p style="background:#ebfbee;padding:12px;border-radius:8px;margin:14px 0">${esc(imp.result)} <a href="#/">カレンダーを見る →</a></p>` : ''}
      ${imp.fails.length ? `<div class="error"><p>取り込めなかった予定：</p><ul>${imp.fails.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></div>` : ''}
      <datalist id="im-co-list">${state.companies.map((c) => `<option value="${esc(c.name)}">`).join('')}</datalist>
      <div class="row" style="gap:12px;flex-wrap:wrap;margin:14px 0 0;align-items:center">
        <label style="display:flex;gap:6px;align-items:center;margin:0"><input type="checkbox" id="im-future" style="width:auto;margin:0" ${imp.onlyFuture ? 'checked' : ''}>今日以降のみ表示</label>
        <label style="margin:0">新しい企業の業界<select id="im-ind" style="width:auto">${options(INDUSTRIES, imp.industry)}</select></label>
        <label style="margin:0">志望度<select id="im-pri" style="width:auto">${options(['高', '中', '低'], imp.priority)}</select></label>
      </div>
      <p class="muted">「面接」「ES」「説明会」などが入った予定は、自動でチェックを入れています。企業名と種類は、取り込む前に直せます。</p>
      <div class="row" style="gap:12px;align-items:center;margin:12px 0">
        <button class="btn primary inline" type="button" id="im-go">選択した予定を取り込む（<span id="im-n">0</span>件）</button>
        <button class="btn" type="button" id="im-clear">すべて解除</button>
        <span class="muted">表示中 ${rows.length}件</span>
      </div>
      ${months.length ? months.map((m) => {
        const [y, mo] = m.split('-');
        return `<div style="display:flex;align-items:center;gap:8px;margin:18px 0 6px;padding-bottom:6px;border-bottom:2px solid #4c6ef5;font-weight:700">
          <input type="checkbox" data-mon="${m}" style="width:auto;margin:0" aria-label="${y}年${+mo}月をすべて選ぶ">
          ${y}年${+mo}月 <span class="muted" style="font-weight:400">${byMonth[m].length}件</span></div>`
          + byMonth[m].map(rowHtml).join('');
      }).join('') : '<p class="muted">表示できる予定がありません。「今日以降のみ表示」を外すと、過去の予定も表示されます。</p>'}`;
    months.forEach(syncMonth); updateCount();

    $('#im-future').onchange = (e) => { imp.onlyFuture = e.target.checked; render(); };
    $('#im-ind').onchange = (e) => { imp.industry = e.target.value; };
    $('#im-pri').onchange = (e) => { imp.priority = e.target.value; };
    $('#im-clear').onclick = () => { imp.rows.forEach((r) => { r.checked = false; }); render(); };
    $('#im-go').onclick = doImport;
    body.querySelectorAll('[data-i]').forEach((cb) => {
      cb.onchange = () => { const r = imp.rows[cb.dataset.i]; r.checked = cb.checked; syncMonth(r.date.slice(0, 7)); updateCount(); };
    });
    body.querySelectorAll('[data-mon]').forEach((mc) => {
      mc.onchange = () => {
        imp.rows.filter((r) => visible(r) && r.date.startsWith(mc.dataset.mon)).forEach((r) => { r.checked = mc.checked; });
        body.querySelectorAll('[data-i]').forEach((cb) => { cb.checked = imp.rows[cb.dataset.i].checked; });
        updateCount();
      };
    });
    body.querySelectorAll('[data-co]').forEach((el) => { el.onchange = () => { imp.rows[el.dataset.co].company = el.value; }; });
    body.querySelectorAll('[data-ty]').forEach((el) => { el.onchange = () => { imp.rows[el.dataset.ty].type = el.value; }; });
  }

  async function doImport() {
    const sel = imp.rows.filter((r) => visible(r) && r.checked);
    if (!sel.length) return toast('取り込む予定を選んでください');
    if (sel.some((r) => !r.company.trim())) return toast('企業名が空の予定があります');
    const btn = $('#im-go'); btn.disabled = true; btn.textContent = '取り込み中…';
    const dates = sel.map((r) => r.date).sort();
    let ok = 0, skip = 0; const fails = [];
    try {
      // すでに同じ企業・日付・種類の予定があれば、二重登録しない
      const existing = await api(`/events?from=${dates[0]}&to=${dates[dates.length - 1]}`);
      const seen = new Set(existing.map((e) => `${e.company_name}|${e.due_date}|${e.type}`));
      const cos = Object.fromEntries((await loadCompanies()).map((c) => [c.name, c]));
      for (const r of sel) {
        const name = r.company.trim(), key = `${name}|${r.date}|${r.type}`;
        if (seen.has(key)) { skip++; r.imported = true; continue; }
        try {
          let co = cos[name];
          if (!co) co = cos[name] = await api('/companies', 'POST', { name, industry: imp.industry, priority: imp.priority });
          await api('/events', 'POST', { company_id: co.id, type: r.type, due_date: r.date, due_time: r.time || '', title: r.summary });
          seen.add(key); ok++; r.imported = true;
        } catch (err) { fails.push(`${r.summary}（${err.message}）`); }
      }
    } catch (err) { fails.push(err.message); }
    if (ok) state.month = startOfMonth(parseYmd(dates[0]));
    imp.result = `${ok}件を取り込みました${skip ? `（${skip}件は登録済みのためスキップ）` : ''}`;
    imp.fails = fails;
    await loadCompanies();
    render();
  }

  $('#im-file').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const list = parseIcs(await f.text());
      if (!list.length) { body.innerHTML = '<p class="error">予定が見つかりませんでした。.ics ファイルか確認してください。</p>'; return; }
      list.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
      imp.rows = list.map((ev, i) => {
        const sm = ev.summary || '（無題）';
        return { i, date: ev.date, time: ev.time || '', summary: sm, recurring: !!ev.recurring,
          checked: IMPORT_JOB_RE.test(sm), company: guessCompany(sm), type: guessType(sm) };
      });
      imp.result = ''; imp.fails = [];
      render();
    } catch (err) { body.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
  };
  if (imp.rows.length) render();
}

// ---------- 項目別リスト ----------
// ES締切・面接・適性検査は種類で絞り込み、業界別・志望度別・月別は全種類をグループ表示する
const GROUP_TABS = { industry: '🏢 業界別', priority: '⭐ 志望度別', month: '🗓 月別' };
const PRIORITY_ORDER = ['高', '中', '低'];
let listType = 'es', listOnlyOpen = true;

function sortByDate(a, b) {
  return (a.due_date + (a.due_time || '')).localeCompare(b.due_date + (b.due_time || ''));
}
function groupEvents(events, by) {
  const map = new Map();
  for (const e of events) {
    let key;
    if (by === 'industry') key = industryKey(e);
    else if (by === 'priority') key = PRIORITY_ORDER.includes(e.priority) ? e.priority : '中';
    else key = e.due_date.slice(0, 7);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(e);
  }
  const order = by === 'industry' ? INDUSTRIES : by === 'priority' ? PRIORITY_ORDER : [...map.keys()].sort();
  return order.filter((k) => map.has(k)).map((key) => {
    let label = key, color = '#868e96';
    if (by === 'industry') color = INDUSTRY_COLORS[INDUSTRIES.indexOf(key)];
    else if (by === 'priority') { label = `志望度 ${key}`; color = PRIORITY_COLORS[key]; }
    else { const [y, m] = key.split('-'); label = `${y}年${Number(m)}月`; color = '#4c6ef5'; }
    return { label, color, items: map.get(key) };
  });
}
function groupHead(g) {
  return `<div class="grp-head" style="display:flex;align-items:center;gap:8px;margin:18px 0 6px;padding-bottom:6px;border-bottom:2px solid ${g.color};font-weight:700">
    <i style="width:12px;height:12px;border-radius:3px;background:${g.color};display:inline-block"></i>${esc(g.label)}
    <span class="muted" style="font-weight:400">${g.items.length}件</span></div>`;
}
async function pageList() {
  const isGroup = listType in GROUP_TABS;
  const all = isGroup
    ? await api('/events?from=1900-01-01&to=2999-12-31')
    : await api(`/events?type=${listType}`);
  const events = (listOnlyOpen ? all.filter((e) => !e.done) : all).sort(sortByDate);
  const today = ymd(new Date());
  const tabs = [
    ...Object.entries(TYPE_LABEL).map(([k, v]) => [k, `${TYPE_ICON[k]} ${v}`]),
    ...Object.entries(GROUP_TABS),
  ];
  let body;
  if (!events.length) body = '<p class="muted">該当する予定はありません。</p>';
  else if (isGroup) body = groupEvents(events, listType).map((g) => groupHead(g) + g.items.map((e) => itemRow(e, today)).join('')).join('');
  else body = events.map((e) => itemRow(e, today)).join('');

  view().innerHTML = `
    <div class="card">
      <h2>項目別リスト</h2>
      <div class="tabs" id="tabs" style="flex-wrap:wrap">${tabs.map(([k, label]) =>
        `<button data-t="${k}" class="${k === listType ? 'on' : ''}">${label}</button>`).join('')}</div>
      <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="only-open" style="width:auto;margin:0" ${listOnlyOpen ? 'checked' : ''}>未完了のみ表示</label>
      ${body}
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
      <h2>Gemini（Google AI）連携</h2>
      <p class="muted">企業研究・ES添削には、あなた自身のGemini APIキーを使います。キーはサーバー側で暗号化して保存され、他のユーザーには使われません。
        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">APIキーの発行はこちら（Google AI Studio）</a></p>
      <p class="muted">※無料枠では、入力内容がGoogleのサービス改善に使われる場合があります。ESに住所・電話番号などの個人情報を書かないようにしてください。</p>
      <p>状態：${user.hasKey ? '<span class="badge">登録済み</span>' : '<span class="badge warn">未登録</span>'}</p>
      <form id="key-form">
        <label>APIキー${user.hasKey ? '（変更する場合のみ入力）' : ''}
          <input id="k-key" type="password" autocomplete="off" placeholder="AIza..."></label>
        <label>モデル名（候補から選ぶか、直接入力）
          <input id="k-model" list="model-list" value="${esc(user.model || 'gemini-3.8-flash')}" autocomplete="off" required>
          <datalist id="model-list">${['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'].map((m) => `<option value="${m}">`).join('')}</datalist>
        </label>
        <div class="row"><button class="btn primary inline" type="submit">保存</button>
          ${user.hasKey ? '<button class="btn danger" type="button" id="k-del">キーを削除</button>' : ''}</div>
      </form>
    </div>`;
  $('#key-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/settings/gemini', 'PUT', { apiKey: $('#k-key').value.trim(), model: $('#k-model').value.trim() });
      toast('保存しました'); pageSettings();
    } catch (err) { toast(err.message); }
  };
  const del = $('#k-del');
  if (del) del.onclick = async () => { await api('/settings/gemini', 'DELETE'); toast('削除しました'); pageSettings(); };
}

// ---------- 起動 ----------
(async () => {
  try {
    const me = await api('/me');
    if (me.user) { state.user = me.user; showApp(); } else showAuth();
  } catch { showAuth(); }
})();
