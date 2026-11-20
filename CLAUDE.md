# yadokari

Chromeにコマンドバーとタブの自動クローズを足す個人用の拡張機能。Manifest V3。実行時の依存ライブラリなし、ビルド工程なし。リポジトリをそのままChromeに読み込んで動く状態を常に保つ。

## 検証

| コマンド | 内容 | 所要 |
|---|---|---|
| `npm test` | 単体テストとガードレール。依存の導入は不要 | 数秒 |
| `npm run test:e2e` | 実機テスト。Chrome for Testing を起動し、本物のキー入力で操作する。Linux専用 | 数十秒 |
| `npm run check` | 上の2つを続けて実行 | |
| `npm run setup` | 実機テストに必要なものを導入する。クラウドのセッションでは開始時に自動で走る | |

- 変更したら `npm run check` を通す。通っていない状態で「完了」と報告しない。
- macOSでは実機テストを実行できない。`npm test` まで通し、実機テストはPRのCIで確認する。
- テストが落ちたら原因を直す。テストを消す・弱める・スキップするのは、テスト側が誤っていると説明できるときだけにする。

## 完了の定義

- 挙動を足した・変えたら、その挙動を確かめるテストを同じPRに入れる。
  - ロジック(`src/lib/`)は単体テスト `test/<名前>.test.js`
  - ブラウザ上の挙動は実機テスト `test/e2e/<名前>.e2e.mjs`
- 画面を変えたら、`test/e2e/artifacts/` に出るスクリーンショットを自分で開いて確認する。バーの見た目が変わったら `npm run screenshots` でREADMEの画像も撮り直す。
- 自動テストで確かめられないこと(macOS固有の挙動、日本語入力など)は、#8 のチェックリストに追記し、PR本文で1行触れる。確かめていないことを確かめたように書かない。

## 守ること

`test/guardrails.test.js` が機械的に検査している。緩める必要が出たら、理由を書いた単独のPRにする。機能のPRに混ぜない。

- **依存を足さない。** `dependencies` は空のまま。`devDependencies` の追加もガードレールの許可リスト変更を伴う。
- **ビルド工程を足さない。** トランスパイラ、バンドラ、TypeScriptへの移行はしない。型はJSDocで書く。
- **権限を足さない。** 使ってよい権限は `test/guardrails.test.js` の許可リストにあるものだけ。`host_permissions`、`<all_urls>`、`content_scripts` は使わない。ページへの挿入は、ショートカットを押したタブに `activeTab` で行う。
- **外部と通信しない。** `fetch`、XHR、WebSocket、リモートのスクリプト・フォント・画像を使わない。
- **外部由来の文字列をHTMLとして扱わない。** ページタイトルやURLは `textContent` とテキストノードだけで描画する。`innerHTML` 系は使わない。
- **ページのDOMにバーを直接描かない。** バーは拡張機能のページを `iframe` で重ねる。ページ側のスクリプトから入力内容と検索結果を読めないようにするため。
- **`src/lib/` は純粋関数だけ。** `chrome.*`、`document`、`window` に触れない。触れるコードは `src/` 直下に置く。

## 進め方

- 1 issue = 1 ブランチ = 1 PR。`main` に直接pushしない。
- 着手前にissueの「要件」「完了条件」を読む。issueにない作業が必要になったら、PRを広げずに新しいissueを立てる。
- 複数のissueを並行して進めるときは、`github-issue-orchestrator` スキルで親issueとsub-issueに分けて指揮する。
- ブランチ名は `feat/<issue番号>-<短い英語>`、`fix/…`、`chore/…`。
- コミットメッセージは英語の命令形。issue・PR・画面の文言は日本語。READMEは英語の `README.md` を正とし、同じ内容の日本語版を `README.ja.md` に置く。片方を変えたらもう片方も直す。コード内のコメントは英語。
- PR本文は最大5行程度。背景とやったことを書き、`Closes #n` を付ける。コードを読めば分かること(ファイルの一覧、実装の説明、テストの件数)は書かない。
- コメントには「なぜそうしているか」だけを書く。コードを読めば分かることは書かない。

## リリース

GitHubの Actions → `release` → Run workflow で、上げる桁(patch / minor / major)を選んで実行するだけ。`main` でテストを通したうえで、最新のタグから次のバージョンを決め、タグとGitHub Releaseを作ってzipを添付する。

リリース済みのバージョンはタグだけが持つ。`manifest.json` の `version` は `0.0.0` のまま変えない(zipを作るときにCIが書き換える)。バージョンを上げるコミットは作らない。

## つまずきやすい点

- **⌘T / Ctrl+T は拡張機能に割り当てられない。** Chromeが予約している。既定のショートカットは macOS が ⌃T、それ以外が Ctrl+Shift+K。
- **拡張機能のショートカットはブラウザが処理する。** Puppeteerのキーボード操作はページにしか届かず、ショートカットは発火しない(`smoke.e2e.mjs` で確認している)。`activeTab` もユーザーがショートカットを押したときにしか付かない。実機テストでは `pressGlobal()` でXサーバーから本物のキー入力を送る。
- **挿入できないページがある。** `chrome://`、Chromeウェブストア、新規タブページ、PDFビューア。必ず代替の経路を用意する。
- **日本語入力中の Enter・矢印キーはIMEのもの。** `keydown` では `event.isComposing` と `keyCode === 229` を見て無視する。
- **`iframe` の `color-scheme` が埋め込み先と食い違うと、背景が不透明になる。**
- **通常版のGoogle Chromeは `--load-extension` を受け付けない。** 実機テストには Chrome for Testing を使う(`CHROME_PATH` で指定)。

## 構成

```
manifest.json
src/                 chrome.* や DOM に触れるコード
src/lib/             純粋関数。単体テストの対象
test/*.test.js       単体テストとガードレール(node --test)
test/e2e/harness.mjs 実機テストの共通部品(Chrome起動、本物のキー入力、スクリーンショット)
test/e2e/*.e2e.mjs   実機テスト。1ファイルが1回のChrome起動
scripts/setup.sh     実機テストの準備
scripts/package.mjs  配布するファイルを dist/yadokari/ に集める。リリース時にCIがzipにする
scripts/next-version.sh  最新のタグから次のバージョンを決める
scripts/screenshots.mjs  READMEに載せる画像 docs/bar.png を撮り直す(`npm run screenshots`、Linux専用)
.claude/settings.json  検証コマンドの許可と、セッション開始時の準備
.claude/skills/        このリポジトリ用のスキル(並列実装の指揮)
```
