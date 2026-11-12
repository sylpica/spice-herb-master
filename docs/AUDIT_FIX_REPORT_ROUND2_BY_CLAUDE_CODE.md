# 修正結果報告書・第2ラウンド — Claude Code（2026-11-12）

修正前の監査は docs/AUDIT_REPORT_ROUND2_BY_CLAUDE_CODE.md、決定記録は docs/DECISIONS.md #55。
第1ラウンドの修正結果は docs/AUDIT_FIX_REPORT_BY_CLAUDE_CODE.md（変更していない）。
生成済み問題データの手編集はしていない。四択の変更は `scripts/generate-questions.mjs` を直して再生成した。
知識単位・カード・転記は変更していない。

| ID | 重大度 | 修正前の現象 | 根本原因 | 変更内容 | 変更ファイル | 修正後の検証 |
|---|---|---|---|---|---|---|
| BV-01 | P1 | ホーム・検索・改訂・リーダーが極端に縦長 | 説明文つきカードの縦積み、検索結果の全件描画、一覧の常時展開 | ホームを2列タイル（PC幅は5列）にし、説明を末尾の折りたたみへ。検索は問題20件・節5件ずつ表示。改訂の変更箇所は領域ごとに畳む。リーダーの目次はスマホ幅で畳み、節を選ぶと閉じる。前の節・次の節ボタンを追加 | Home・SearchPage・Revision・Reader・styles.css | E2E（375×667 でタイル10個が一画面内、ページ高さの上限、目次の開閉） |
| BV-02 | P1 | 模試の並べ替えで「↓」を押すと項目が消える | 入れ替えの式の添字誤り | 演習と模試で共通の `moveItem` に統一 | QuestionRunner・Exam | 単体（端・途中・連続操作で項目が増減しない） |
| BV-03 | P2 | 説明文が主要操作より上 | レイアウト | 暗記・模試・単語帳・リーダー・設定・学習分析・品質管理の説明を末尾（`.foot-note`）へ | 各画面 | 単体（文言の出現順）・E2E（座標） |
| BV-04 | P2 | チェックボックスの行ずれ、44px未満の操作部品 | `input{width:100%}` がチェックボックスにも適用。高さ指定なし | チェックボックス・ラジオの寸法を固定し、選択肢をチップ／行にする。入力・プルダウンは `min-height:44px`。検索結果とリーダーのしおりは行全体をタップ領域に | styles.css・Practice・SearchPage・QuestionRunner・Exam | E2E（全11画面で44px未満0件、チップ内に収まる） |
| BV-05 | P2 | 原本画像139件などの古い数値 | 初回取り込み時の manifest を表示 | 収録済み目録（page-images.json）の件数146と、連番の欠番数1を表示。意味を失った「教材未読取」「検証済み知識単位 0件」の表示を削除 | summary・Home・Stats・QaPage | 単体（サマリと目録の一致）・E2E |
| BV-06 | P2 | R28 未実装 | — | 学習状況（未回答・直近が不正解・苦手・習得済み・ブックマーク）と並び順（難易度・正答率）を検索に追加。純粋関数は domain/search.ts | search.ts・SearchPage | 単体（境界: 1回だけ・ちょうど50%・過去に誤答→最後に正解）・E2E |
| BV-07 | P2 | R27 未実装 | — | 「後回し」（未回答の問題を末尾へ）、数字キーで選択・Enter で確定・←→で前後、左右スワイプで前後 | Practice・QuestionRunner | E2E（後回しの順序、キー操作、確定済みは後回し不可） |
| BV-08 | P2 | R18 未実装 | — | 解説欄から問題を報告（端末内に保存）・出題から除外。品質管理で一覧・削除・復帰・JSON 書き出し。除外は演習と模試に反映 | store・QuestionRunner・Practice・Exam・QaPage | E2E（報告→一覧→除外でプール1件減→復帰） |
| BV-09 | P2 | R24 お気に入りなし | — | カードのお気に入りと「お気に入りのみ」絞り込み。内部IDの表示をやめ、位置・種別・章名を1行に | store・Cards | E2E |
| BV-10 | P2 | R29 未実装 | — | 連続学習日数（ホーム・学習分析）、直近7日・30日の解答数と正答率、バッジ7種。1日の目標の入力は設定へ移動 | streak.ts・Home・Stats・Settings | 単体（途切れ・今日未回答・同日複数）・E2E |
| BV-11 | P3 | R47 未実装 | — | 記述式の「書き直す」と、過去の回答（日付・得点つき、直近5件）の表示。記述の回答本文を記録に保存 | types・QuestionRunner・Practice | 型・単体（既存の採点テスト合格） |
| BV-12 | P3 | 確定後も回答を変更できる | 入力の無効化なし | 確定後は選択肢・正誤・入力・並べ替えを固定し、正答の選択肢に「（正答）」と枠色を付ける（色以外でも判別できる） | QuestionRunner | E2E |
| BV-13 | P2 | 四択の誤答が種類違い | 次元不明の設問に同一章の回答を無差別に使用 | 設問文から型（意味・成分・言語・人物・書名・場所・時代・調味料・料理・別名・用語・食材・品目名）を付け、同じ型の設問の正答だけを誤答にする。暦年と期間を分ける。型が付かない設問は、文と語を混ぜず長さを揃え、同じ節かページの回答が2つ以上ある場合だけ四択にする。生成後検証の誤検出（同じ答えの単位が複数ある場合）を修正 | generate-questions.mjs、生成データ | 単体（人物・成分・意味・調味料・暦年の四択は誤答も同じ型、名詞の四択に理由文が混ざらない）。削除66・新規3・誤答が入れ替わった四択163問、四択以外は不変 |
| BV-14 | P3 | しおりが内部ID表示 | — | 節名の一覧にし、押すと移動、ボタンで付け外し | Reader | E2E |
| BV-15 | P3 | 検索結果に内部状態名 | — | 問題文と形式名だけを表示 | SearchPage | 単体 |
| BV-16 | P3 | 復習予定の件数と中身の不一致 | カードの期限も合算 | ホームは問題の期限だけ、学習分析は問題・カード別に表示 | Home・Stats | E2E |
| BV-17 | P3 | 模試の制限時間に下限なし | — | 1〜120分に制限し、出題数を開始前に表示 | Exam | E2E |
| BV-18 | P3 | 並び順だけ変更時に全解除が出ない | 表示条件の漏れ | 条件に並び順を追加 | SearchPage | E2E |

## テストの変更

- 追加: tests/round2.test.ts（25件）、e2e/round2.spec.ts（12件）、scripts/independent-recount-2.mjs
- 件数の基準値（1,795→1,732 など）は、独立再集計の値で更新した
- 画面の文言・配置を固定していた E2E は、共通UIルールに沿った新しい配置に合わせて書き換えた（検証の対象は減らしていない。例: ホームの件数表示は折りたたみを開いて確認、p.71 ジャンプは領域を開いてから押す）
- 「人物の四択は成立しない」ことを固定していた単体テストは、型付けで人物の回答が11件に増えて四択が成立するようになったため、「誤答も全員人物である」ことを検証する内容に改めた

## 検証結果（ローカル、2026-11-12）

| 項目 | 結果 |
|---|---|
| typecheck | 成功 |
| 単体（vitest） | 23ファイル・277件合格、失敗0・スキップ0 |
| validate:data | 13件合格 |
| build | 成功。data-questions 1,856.91 kB（gzip 185.20 kB）、プリキャッシュ38件・444.15 KiB（教材画像は対象外） |
| E2E | 71件合格、失敗0 |
| npm audit --audit-level=high | 成功（low 2・moderate 4、開発依存のみ） |

## 未解決

AU-15、AU-18、BV-19、R21（級別模試: 問題に級の属性がなく、原本の級区分を問題単位へ付ける照合が必要）、
R25（写真識別: 写真の切り出しと正解の照合記録が必要、DECISIONS #53）、R08（誤答選択肢ごとの説明: 原本に根拠のある説明文が必要）、
R29 の通知、BV-13 の残り（型が付かない設問の四択は、誤答のもっともらしさを話題の近さだけが支える）。

## 統合時の注意

- 削除した正式問題ID（四択66問）: q4-e-org・q4-r-paella・q4-r-cumin-potato・q4-r-chai・q4-c-bottle・q4-c-paste-basil・q4-u-3roles・q4-u-aroma-main・q4-u-aroma-herb・q4-u-aroma-powder・q4-u-heat・q4-u-timing-prep・q4-u-timing-finish-herb・q4-u-knife・q4-w-asia・q4-d-moroccan-tea・q4-cardamom-5・q4-gardenia-3・q4-coriander-2・q4-saffron-3・q4-ginger-1・q4-ginger-4・q4-thyme-2・q4-tarragon-1・q4-chives-1・q4-chives-3・q4-chili-6・q4-chili-7・q4-nutmeg-1・q4-basil-4・q4-parsley-1・q4-paprika-2・q4-fennel-4・q4-mustard-1・q4-mint-1・q4-rucola-2・q4-rosemary-4・q4-gokoufun-2・q4-shichimi-1・q4-saf-1・q4-cel-1・q4-tad-1・q4-m-greek・q4-m-commissione・q4-m-3func・q4-m-hokenkinou・q4-t-lid・q4-t-raspberry・q4-t-coffee・q4-l-hungarian・q4-l-spray・q4-l-tussie・q4-m-ayur-3・q4-b-def・q4-b-def-split・q4-b-powder・q4-b-taxonomy・q4-b-family-meaning・q4-b-fresh-points・q4-b-fresh-stand・q4-h-ancient-uses・q4-j-yakumi・q4-j-fish・q4-j-hajikami・q4-j-shosoin-doc・q4-j-shichimi-origin
- 新規の正式問題ID（四択3問）: q4-d-mojito・q4-shichimi-2・q4-h-hippocrates
- 端末の学習履歴に残る削除済みIDは各集計で読み飛ばされる。保存データに cardFavorites・reports・excluded・（記述式の記録に）answerText を追加したが、旧データはそのまま読める
