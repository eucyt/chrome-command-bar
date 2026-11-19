# 親 issue と sub-issue

## 親 issue に書くこと(設計)

親 issue は、sub-issue を読む人とワーカーが共有する全体像。元からある「目的」「要件」「完了条件」の下に、次を足す。

```
> いま: <何をしているか 1 行>(<日付>)

## 設計
モジュールと責務の境界(どのファイルが何を持つか)
データと契約(関数の入出力、メッセージの形、保存する値)
受け入れ基準のうち、テストで担保するもの

## やらないこと

## 前提・未決

## 分割
| 順 | issue | 依存 | 状態 |
|---|---|---|---|
| 1 | #21 検索の順位付け | なし | 未着手 |
| 2 | #22 バーの描画 | #21 | 未着手 |

並行できる本数: 最初 1 本、#21 のマージ後に +2 本
```

状態は「未着手」「実装中」「PR #n」「マージ済み」「人のマージ待ち」のどれか。

issue に書かれていない判断(方式の選択、既存のものを流用するか)は、**書く前にユーザーに聞く**。聞かずに進めてよいのは、issue か `CLAUDE.md` に答えが書いてあるものだけ。並行する sub-issue が同じ判断を別々にすると、後で衝突として跳ね返る。

## sub-issue の分け方

- **1 sub-issue = 1 ブランチ = 1 PR。** 人が 1 回で読み切れる大きさにする(目安は差分 600 行以下)
- **下の層から積む。** `src/lib/` の純粋関数 → それを使う `src/` のコード → 画面。下が上に依存しないので、待ちが少ない
- **依存の無い sub-issue を増やす。** 並行の効き目は同時に着手できる本数で決まる。共通の土台(関数の入出力、メッセージの形)を最初の 1 本に切り出し、残りをそこにぶら下げる形が多い
- **同じファイルを 2 つの sub-issue に触らせない。** 避けられないときは依存を付けて順に入れる
- 人が番号や順序を振るもの(`manifest.json` の項目の並び、テストの番号付きスクリーンショット名など)を複数の sub-issue が触るなら、先に入る順を指揮側が決めて全員に伝える

## sub-issue に書くこと

ワーカーはこの本文と `CLAUDE.md` だけを頼りに実装する。曖昧な指示は、ワーカーごとに別の解釈をされて衝突になる。

```
## 目的
なぜ要るか。親 issue #n の設計のどこに当たるか(2〜4 行)

## 要件
- 実装する内容を箇条書きで網羅する。触るファイル、流用する既存の関数を名指しする
- 他の sub-issue との取り合い(「この関数は #m が作る。同じものを作らず、それを使う」)

## 完了条件
- テストで確認できる形で書く(「〜できる。実機テストで確認する」)
- `npm run check` が通る

## 備考
依存: #m(なければ「なし」)
```

「要件」を書く前に、実際にコードを読んで変更の範囲を把握する。読まずに書いた sub-issue は、ワーカーが同じ調査をやり直すか、既にある仕組みを二重に作る。

## GitHub API の呼び方

`gh issue` や `gh pr` が使えない環境がある(GraphQL を通さない環境)。どこでも動く `gh api` の REST を使う。`OWNER/REPO` は `git remote get-url origin` から読む。

```sh
# issue を作る。番号と id が返る(sub-issue の紐付けには番号ではなく id を使う)
gh api repos/OWNER/REPO/issues -f title='<タイトル>' -F body=@body.md --jq '{number, id}'

# 親 issue #PARENT に sub-issue として紐付ける。id は整数で渡す(-f だと文字列になり 422 で弾かれる)
gh api repos/OWNER/REPO/issues/PARENT/sub_issues -F sub_issue_id=<id>

# sub-issue の一覧と状態
gh api repos/OWNER/REPO/issues/PARENT/sub_issues --jq '.[] | [.number, .state, .title] | @tsv'

# 親 issue の本文を書き換える(分割表の更新)
gh api -X PATCH repos/OWNER/REPO/issues/PARENT -F body=@parent.md

# sub-issue に対応する PR を探す
gh api 'repos/OWNER/REPO/pulls?state=all' --jq '.[] | [.number, .state, .head.ref, .title] | @tsv'

# PR の CI
gh api repos/OWNER/REPO/commits/<head の SHA>/check-runs --jq '.check_runs[] | [.name, .status, .conclusion] | @tsv'

# 親 issue を閉じる
gh api -X PATCH repos/OWNER/REPO/issues/PARENT -f state=closed
```

- 親 issue の本文を書き換えるときは、直前に取得した本文を元にする。人が編集しているかもしれない
- sub-issue は、PR 本文に `Closes #<番号>` があれば main へのマージで自動で閉じる。親 issue は自動では閉じない

## 承認の取り方

分割ができたら、次を示して止まる。

```
親 issue: <URL>
sub-issue: <n> 本(依存なし <m> 本から着手)
順 | issue | 依存
...
並行できる本数: 最初 <m> 本、<先行>のマージ後に +<k> 本
```

承認の質問に、分け方の可否以外を混ぜない。ほかに聞くことがあるなら先に片付ける。
