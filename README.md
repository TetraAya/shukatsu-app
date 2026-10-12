# 就活スケジュール

ES締切・面接・適性検査をカレンダーで管理し、ChatGPTで企業研究とES添削ができる就活生向けWebアプリです。

## 機能

- **アカウント**: ユーザー名 + パスワード（bcryptでハッシュ化）。データはすべてPostgreSQLに保存
- **カレンダー**: 日付をタップして予定追加、企業名をタップでその企業のマイページへ。選考状況を表示。業界別／志望度別に色分け切り替え
- **項目別リスト**: ES締切・面接・適性検査をタブで切り替え
- **やること**: 日付を入力すると、今日〜その日までの未完了の予定を期日が近い順に表示（期限超過も表示）
- **ChatGPT連携**: ユーザーごとのOpenAI APIキー（AES-256-GCMで暗号化して保存）で、企業研究とES添削（その企業向けのアピールポイント提示）

## Renderへのデプロイ

1. このフォルダをGitHubのリポジトリにpushする
2. Renderのダッシュボードで **New → Blueprint** を選び、リポジトリを接続する
3. `render.yaml` に従って、Webサービスと PostgreSQL が自動で作成される
   - `SESSION_SECRET` と `ENCRYPTION_KEY` は自動生成されます
4. デプロイ完了後、発行されたURLにアクセスしてアカウントを作成する
5. 「設定」画面で自分のOpenAI APIキーを登録する

### 注意

- **`ENCRYPTION_KEY` は変更・削除しないでください。** 変更すると、登録済みのAPIキーが復号できなくなります（再登録すれば復旧します）。
- Renderの無料PostgreSQLは期限（作成から一定期間）があります。本番運用ではStarter以上のプランを推奨します。
- 無料Webサービスは一定時間アクセスがないとスリープし、再開時に数十秒かかります。

## ローカルで動かす

```bash
npm install
export DATABASE_URL=postgres://user:pass@localhost:5432/shukatsu
export SESSION_SECRET=適当な長い文字列
export ENCRYPTION_KEY=適当な長い文字列
npm start
# http://localhost:3000
```

## 構成

```
server.js        Expressサーバー・API・OpenAI連携
db.js            PostgreSQL接続とテーブル作成（起動時に自動）
crypto-util.js   APIキーの暗号化/復号
public/          フロントエンド（HTML/CSS/JS）
render.yaml      Render用Blueprint
```
