const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const path = require('path');
const { pool, initDb } = require('./db');
const { encrypt, decrypt } = require('./crypto-util');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

if (!process.env.SESSION_SECRET) {
  console.warn('[warn] SESSION_SECRET が未設定です。本番では必ず設定してください。');
}

app.set('trust proxy', 1); // Renderはリバースプロキシ配下
app.use(express.json({ limit: '1mb' }));

app.use(
  session({
    store: new PgSession({ pool, tableName: 'session' }),
    secret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30日
    },
  })
);

app.use(express.static(path.join(__dirname, 'public')));

// ---------- ヘルパー ----------
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'ログインが必要です' });
  next();
}

const EVENT_TYPES = ['es', 'interview', 'test'];
const PRIORITIES = ['高', '中', '低'];
const STATUSES = [
  '未応募', 'ES提出済み', '適性検査', '一次面接', '二次面接',
  '三次面接', '最終面接', '内定', '内定承諾', 'お見送り', '辞退',
];
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

// 簡易レート制限（ログイン試行）
const attempts = new Map();
function tooManyAttempts(key) {
  const now = Date.now();
  const rec = (attempts.get(key) || []).filter((t) => now - t < 10 * 60 * 1000);
  attempts.set(key, rec);
  return rec.length >= 10;
}
function recordAttempt(key) {
  attempts.set(key, [...(attempts.get(key) || []), Date.now()]);
}

// ---------- 認証 ----------
app.post('/api/register', wrap(async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!/^[A-Za-z0-9_\-]{3,30}$/.test(username))
    return res.status(400).json({ error: 'ユーザー名は半角英数字・_・-の3〜30文字にしてください' });
  if (password.length < 8)
    return res.status(400).json({ error: 'パスワードは8文字以上にしてください' });

  const hash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await pool.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username',
      [username, hash]
    );
    req.session.userId = rows[0].id;
    res.json({ username: rows[0].username });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'このユーザー名は既に使われています' });
    throw e;
  }
}));

app.post('/api/login', wrap(async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const key = `${req.ip}:${username}`;
  if (tooManyAttempts(key))
    return res.status(429).json({ error: '試行回数が多すぎます。しばらくしてからお試しください' });

  const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  const ok = rows[0] && (await bcrypt.compare(password, rows[0].password_hash));
  if (!ok) {
    recordAttempt(key);
    return res.status(401).json({ error: 'ユーザー名またはパスワードが違います' });
  }
  req.session.userId = rows[0].id;
  res.json({ username: rows[0].username });
}));

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', wrap(async (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const { rows } = await pool.query(
    'SELECT username, openai_key_enc IS NOT NULL AS has_key, openai_model FROM users WHERE id = $1',
    [req.session.userId]
  );
  if (!rows[0]) return res.json({ user: null });
  res.json({ user: { username: rows[0].username, hasKey: rows[0].has_key, model: rows[0].openai_model } });
}));

// ---------- 設定（OpenAI APIキー：ユーザーごと） ----------
// ---------- 設定（APIキー：ユーザーごと） ----------
app.put('/api/settings/openai', requireAuth, wrap(async (req, res) => {
  const apiKey = String(req.body.apiKey || '').trim();
  const model = String(req.body.model || 'gemini-2.5-flash').trim().slice(0, 50);
  if (apiKey) {
    if (apiKey.length < 20)
      return res.status(400).json({ error: 'APIキーの形式が正しくありません' });
    await pool.query('UPDATE users SET openai_key_enc = $1, openai_model = $2 WHERE id = $3',
      [encrypt(apiKey), model, req.session.userId]);
  } else {
    await pool.query('UPDATE users SET openai_model = $1 WHERE id = $2', [model, req.session.userId]);
  }
  res.json({ ok: true });
}));

app.delete('/api/settings/openai', requireAuth, wrap(async (req, res) => {
  await pool.query('UPDATE users SET openai_key_enc = NULL WHERE id = $1', [req.session.userId]);
  res.json({ ok: true });
}));

// ---------- 企業 ----------
function cleanCompany(b) {
  return {
    name: String(b.name || '').trim().slice(0, 200),
    industry: String(b.industry || '未設定').trim().slice(0, 50),
    priority: PRIORITIES.includes(b.priority) ? b.priority : '中',
    status: STATUSES.includes(b.status) ? b.status : '未応募',
    url: String(b.url || '').trim().slice(0, 500),
    memo: String(b.memo || '').slice(0, 5000),
  };
}

app.get('/api/meta', (req, res) => res.json({ STATUSES, PRIORITIES, EVENT_TYPES }));

app.get('/api/companies', requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, industry, priority, status FROM companies WHERE user_id = $1 ORDER BY name',
    [req.session.userId]
  );
  res.json(rows);
}));

app.post('/api/companies', requireAuth, wrap(async (req, res) => {
  const c = cleanCompany(req.body);
  if (!c.name) return res.status(400).json({ error: '企業名を入力してください' });
  const { rows } = await pool.query(
    `INSERT INTO companies (user_id, name, industry, priority, status, url, memo)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.session.userId, c.name, c.industry, c.priority, c.status, c.url, c.memo]
  );
  res.json(rows[0]);
}));

app.get('/api/companies/:id', requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM companies WHERE id = $1 AND user_id = $2', [req.params.id, req.session.userId]);
  if (!rows[0]) return res.status(404).json({ error: '企業が見つかりません' });
  const events = await pool.query(
    `SELECT id, type, title, to_char(due_date,'YYYY-MM-DD') AS due_date, due_time, done, note
     FROM events WHERE company_id = $1 AND user_id = $2 ORDER BY due_date, due_time`,
    [req.params.id, req.session.userId]);
  const ai = await pool.query(
    `SELECT DISTINCT ON (kind) kind, result, created_at FROM ai_results
     WHERE company_id = $1 AND user_id = $2 ORDER BY kind, created_at DESC`,
    [req.params.id, req.session.userId]);
  res.json({ company: rows[0], events: events.rows, ai: ai.rows });
}));

app.put('/api/companies/:id', requireAuth, wrap(async (req, res) => {
  const c = cleanCompany(req.body);
  if (!c.name) return res.status(400).json({ error: '企業名を入力してください' });
  const esDraft = typeof req.body.es_draft === 'string' ? req.body.es_draft.slice(0, 20000) : null;
  const { rowCount } = await pool.query(
    `UPDATE companies SET name=$1, industry=$2, priority=$3, status=$4, url=$5, memo=$6,
       es_draft = COALESCE($7, es_draft)
     WHERE id=$8 AND user_id=$9`,
    [c.name, c.industry, c.priority, c.status, c.url, c.memo, esDraft, req.params.id, req.session.userId]);
  if (!rowCount) return res.status(404).json({ error: '企業が見つかりません' });
  res.json({ ok: true });
}));

app.delete('/api/companies/:id', requireAuth, wrap(async (req, res) => {
  await pool.query('DELETE FROM companies WHERE id=$1 AND user_id=$2', [req.params.id, req.session.userId]);
  res.json({ ok: true });
}));

// ---------- イベント（ES締切・面接・適性検査） ----------
app.get('/api/events', requireAuth, wrap(async (req, res) => {
  const params = [req.session.userId];
  let where = 'e.user_id = $1';
  if (isDate(req.query.from)) { params.push(req.query.from); where += ` AND e.due_date >= $${params.length}`; }
  if (isDate(req.query.to)) { params.push(req.query.to); where += ` AND e.due_date <= $${params.length}`; }
  if (EVENT_TYPES.includes(req.query.type)) { params.push(req.query.type); where += ` AND e.type = $${params.length}`; }
  const { rows } = await pool.query(
    `SELECT e.id, e.company_id, e.type, e.title, to_char(e.due_date,'YYYY-MM-DD') AS due_date,
            e.due_time, e.done, e.note, c.name AS company_name, c.industry, c.priority, c.status
     FROM events e JOIN companies c ON c.id = e.company_id
     WHERE ${where} ORDER BY e.due_date, e.due_time`, params);
  res.json(rows);
}));

app.post('/api/events', requireAuth, wrap(async (req, res) => {
  const b = req.body;
  if (!EVENT_TYPES.includes(b.type)) return res.status(400).json({ error: '種類が不正です' });
  if (!isDate(b.due_date)) return res.status(400).json({ error: '日付を入力してください' });
  const own = await pool.query('SELECT 1 FROM companies WHERE id=$1 AND user_id=$2', [b.company_id, req.session.userId]);
  if (!own.rowCount) return res.status(404).json({ error: '企業が見つかりません' });
  const time = /^\d{2}:\d{2}$/.test(b.due_time || '') ? b.due_time : '';
  const { rows } = await pool.query(
    `INSERT INTO events (user_id, company_id, type, title, due_date, due_time, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [req.session.userId, b.company_id, b.type, String(b.title || '').slice(0, 200), b.due_date, time, String(b.note || '').slice(0, 2000)]);
  res.json(rows[0]);
}));

app.put('/api/events/:id', requireAuth, wrap(async (req, res) => {
  const b = req.body;
  if (b.due_date !== undefined && !isDate(b.due_date)) return res.status(400).json({ error: '日付が不正です' });
  const { rowCount } = await pool.query(
    `UPDATE events SET
       title = COALESCE($1, title),
       due_date = COALESCE($2, due_date),
       due_time = COALESCE($3, due_time),
       done = COALESCE($4, done),
       note = COALESCE($5, note)
     WHERE id=$6 AND user_id=$7`,
    [
      typeof b.title === 'string' ? b.title.slice(0, 200) : null,
      b.due_date ?? null,
      typeof b.due_time === 'string' ? b.due_time.slice(0, 5) : null,
      typeof b.done === 'boolean' ? b.done : null,
      typeof b.note === 'string' ? b.note.slice(0, 2000) : null,
      req.params.id, req.session.userId,
    ]);
  if (!rowCount) return res.status(404).json({ error: '予定が見つかりません' });
  res.json({ ok: true });
}));

app.delete('/api/events/:id', requireAuth, wrap(async (req, res) => {
  await pool.query('DELETE FROM events WHERE id=$1 AND user_id=$2', [req.params.id, req.session.userId]);
  res.json({ ok: true });
}));

// ---------- 「その日までにやること」：期日が近い順 ----------
app.get('/api/todo', requireAuth, wrap(async (req, res) => {
  if (!isDate(req.query.until)) return res.status(400).json({ error: '日付を指定してください' });
  const { rows } = await pool.query(
    `SELECT e.id, e.company_id, e.type, e.title, to_char(e.due_date,'YYYY-MM-DD') AS due_date,
            e.due_time, e.done, c.name AS company_name, c.industry, c.priority
     FROM events e JOIN companies c ON c.id = e.company_id
     WHERE e.user_id = $1 AND e.done = FALSE AND e.due_date <= $2
     ORDER BY e.due_date ASC, e.due_time ASC, c.name ASC`,
    [req.session.userId, req.query.until]);
  res.json(rows);
}));


// ---------- Gemini連携（OpenAI互換エンドポイント経由） ----------



async function callOpenAI(userId, messages) {
  const { rows } = await pool.query('SELECT openai_key_enc, openai_model FROM users WHERE id=$1', [userId]);
  if (!rows[0] || !rows[0].openai_key_enc) {
    const err = new Error('OpenAI APIキーが未登録です。設定画面から登録してください。');
    err.status = 400;
    throw err;
  }
  const apiKey = decrypt(rows[0].openai_key_enc);
  const model = rows[0].openai_model || 'gpt-4o-mini';
  const payload = { model, messages };
  // gpt-5系・oシリーズなどの推論モデルは temperature の指定を受け付けないため、gpt-4系のみ指定する
  if (/^gpt-4/.test(model)) payload.temperature = 0.6;
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(`OpenAI APIエラー: ${data.error?.message || r.status}`);
    err.status = r.status === 401 ? 400 : 502;
    throw err;
  }
  return data.choices?.[0]?.message?.content || '';
}



async function loadCompany(req) {
  const { rows } = await pool.query('SELECT * FROM companies WHERE id=$1 AND user_id=$2',
    [req.params.id, req.session.userId]);
  return rows[0];
}

app.post('/api/companies/:id/ai/research', requireAuth, wrap(async (req, res) => {
  const c = await loadCompany(req);
  if (!c) return res.status(404).json({ error: '企業が見つかりません' });
  const userInfo = String(req.body.info || c.memo || '').slice(0, 6000);

  const text = await callOpenAI(req.session.userId, [
    { role: 'system', content: 'あなたは日本の新卒就職活動に詳しいキャリアアドバイザーです。事実が不確かな点は断定せず「要確認」と明記し、推測と事実を区別してください。' },
    { role: 'user', content:
`以下の企業について、就活生向けの企業研究を日本語でまとめてください。

企業名: ${c.name}
業界: ${c.industry}
URL: ${c.url || '(なし)'}
就活生が集めた情報・メモ:
${userInfo || '(なし)'}

出力形式:
## 事業内容と強み
## 求める人物像（推測を含む場合は明記）
## 業界内での立ち位置・今後の課題
## 志望動機に使える切り口（3つ）
## 面接で聞かれそうな質問と準備ポイント
## 逆質問の例
## 要確認事項（自分で調べるべき点）` },
  ]);
  await pool.query('INSERT INTO ai_results (user_id, company_id, kind, result) VALUES ($1,$2,$3,$4)',
    [req.session.userId, c.id, 'research', text]);
  res.json({ result: text });
}));

app.post('/api/companies/:id/ai/es-review', requireAuth, wrap(async (req, res) => {
  const c = await loadCompany(req);
  if (!c) return res.status(404).json({ error: '企業が見つかりません' });
  const es = String(req.body.es || '').trim().slice(0, 10000);
  const question = String(req.body.question || '').trim().slice(0, 500);
  if (!es) return res.status(400).json({ error: 'ESの文章を入力してください' });

  await pool.query('UPDATE companies SET es_draft=$1 WHERE id=$2 AND user_id=$3', [es, c.id, req.session.userId]);
  const prev = await pool.query(
    `SELECT result FROM ai_results WHERE company_id=$1 AND user_id=$2 AND kind='research'
     ORDER BY created_at DESC LIMIT 1`, [c.id, req.session.userId]);
  const research = prev.rows[0]?.result?.slice(0, 4000) || '(企業研究は未実施)';

  const text = await callOpenAI(req.session.userId, [
    { role: 'system', content: 'あなたは新卒採用の選考経験が豊富な人事担当者兼ESの添削者です。具体的で実行しやすい指摘をしてください。事実を捏造しないこと。' },
    { role: 'user', content:
`次のESを、志望企業に合わせて添削してください。

企業名: ${c.name} / 業界: ${c.industry}
設問: ${question || '(指定なし)'}
企業研究の結果:
${research}

【ES本文】
${es}

出力形式:
## 総評（良い点・改善点）
## この企業に刺さるアピールポイント（3つ、ES本文の経験に基づくもの）
## 具体的な修正案（箇所ごとに「原文 → 修正案」）
## 企業に合わせた書き直し例（元の事実を変えない範囲で）
## 面接で深掘りされそうな点` },
  ]);
  await pool.query('INSERT INTO ai_results (user_id, company_id, kind, result) VALUES ($1,$2,$3,$4)',
    [req.session.userId, c.id, 'es_review', text]);
  res.json({ result: text });
}));

// ---------- エラー処理 ----------
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'サーバーエラーが発生しました' });
});

initDb()
  .then(() => app.listen(PORT, () => console.log(`Listening on ${PORT}`)))
  .catch((e) => { console.error('DB初期化に失敗しました', e); process.exit(1); });
