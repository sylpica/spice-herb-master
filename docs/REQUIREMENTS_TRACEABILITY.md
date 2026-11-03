# 要件追跡表（2026-11-03 Claude Code 独立監査時点）

R01〜R55、UX1〜UX14、DECISIONS #52 の各要件について、実装箇所・検証・判定を示す。
判定は修正後（コミット 8a4f00d 以降）の実測に基づく。前回（2026-10-31、Muse）の版は git 履歴にある。
前回 PASS とされていたもののうち、今回の実測で未実装・不具合が見つかったものは PARTIAL または FAIL に改めた。
判定: PASS（検証して合格）／PARTIAL（一部のみ充足）／FAIL（未充足）／NOT TESTED（未検証）。

## R01〜R55

| 要件 | 実装箇所 | 検証 | 判定 | 修正履歴・未検証理由 |
|---|---|---|---|---|
| R01 教材の完全網羅 | src/data/transcripts、knowledge | 独立再集計（142レコード・140ページ・90,957字・81節）、8ページ目視照合、80プロフィール機械照合 | PARTIAL | 全140ページの原本全数照合は未実施。p.141以降は原本画像が Drive にない（既知） |
| R02 多様な出題形式 | domain/types.ts、QuestionRunner | 15形式の再集計、形式別の採点単体テスト | PARTIAL | 写真識別（photo-id）は未生成（R25） |
| R03 記述式採点 | domain/grading.ts | 記述23問の rubric・modelAnswer、境界ケース単体（羅列で正解と断定しない、改行・全角空白） | PASS | AU-05 で列挙問題の順序違いを修正 |
| R04 知識単位 | src/data/knowledge | 545件・verified 545・全問題の参照が実在 | PASS | AU-11/12 で4単位を上書き（batch 維持） |
| R05 問題数（水増し禁止） | scripts/generate-questions.mjs | 1,795問。四択として成立しない9問を生成しない | PASS | AU-06 |
| R06 演習モード | screens/Practice.tsx、domain/practice.ts | 章・節・形式・難易度・未回答・誤答・苦手・ブックマーク・期限・記述の絞り込み E2E | PASS | — |
| R07 間隔反復 | domain/srs.ts | SRS 単体・E2E（翌日期限、自己評価の保持） | PASS | 解答時間は記録されるが間隔計算には使わない |
| R08 解説 | QuestionRunner の details | 解説・出典・関連節の表示 | PARTIAL | 誤答選択肢ごとの説明はない |
| R09 分析 | screens/Stats.tsx | 章・形式・難易度別、網羅率の E2E | PASS | AU-09 で集計を索引化 |
| R10 端末保存 | domain/store.ts | 再読み込み後の保持 E2E、壊れたデータの単体 | PASS | — |
| R11 出題条件 | Practice・Exam | 絞り込み・問題数・時間の E2E | PASS | — |
| R12 電子書籍 | screens/Reader.tsx | 目次・節・原画・しおり・ページジャンプ・索引 E2E | PARTIAL | ハイライト・メモの E2E はない。書籍内全文検索は節タイトル検索のみ（全文は横断検索側） |
| R13 全文収録 | transcripts | 文字数の独立再集計一致 | PASS | — |
| R14 個人利用 | — | ログイン・アカウントなし | PASS | — |
| R15 原本 | public/pages-b64 | 146件の復号・WebP 検証・寸法・重複0 | PASS | IMG_9647 は欠番（内容未確認） |
| R16 解説表示タイミング | Practice・Exam | 演習は回答直後、模試は終了後の一括採点 E2E | PASS | — |
| R17 中断・再開 | store.examDraft、reader | 模試の途中保存・読書位置の E2E | PASS | 演習セッションの途中状態はリロードで復元しない（記録は保存） |
| R18 問題品質管理 | screens/QaPage.tsx | 検証集計の E2E | PARTIAL | 利用者からの問題報告・除外・修正案の入力はない（AU-17） |
| R19 UI/UX | 全画面 | 390×844・1280×800 の実測、ダークモード E2E | PASS | 文字サイズはリーダーのみ |
| R20 オフライン方針 | vite-plugin-pwa | プリキャッシュ37件（教材画像を含まない）、SW E2E | PASS | — |
| R21 模擬試験 | screens/Exam.tsx、domain/exam.ts | プール1,704・除外91、時間・一括採点・記録 E2E | PARTIAL | 級別の設定はない（AU-17）。公式形式の再現とは表示していない |
| R22 端末容量 | store.ts | 教材の永続保存なし | PASS | 履歴件数は無上限（P3 既知） |
| R23 技術・運用 | GitHub | main・Actions・gh-pages の実測 | PASS | — |
| R24 単語帳 | screens/Cards.tsx | 602枚、表裏・逆引き・種別・章・自己評価・前後 E2E | PARTIAL | カードのお気に入り・タグ・画像はない（AU-17） |
| R25 画像学習 | figure 形式 | 図表問題17問 | PARTIAL | 写真識別は未実装（DECISIONS #53 の再開条件） |
| R26 記述回答 | QuestionRunner | テキスト入力・自己採点 | PARTIAL | 音声入力は OS キーボードの機能に依存（アプリ側の実装なし） |
| R27 高速演習 | Practice | 「とりあえず5問」、自動進行（設定） E2E | PARTIAL | AU-08 で自動進行を追加。スワイプ・キーボード操作・後回しはない |
| R28 高度な検索 | screens/SearchPage.tsx | 章・節・形式・難易度・状態・転記状態の複合 E2E、総数1,876 | PARTIAL | 正答率・解答履歴・習得度・お気に入りでの検索はない（演習の学習フォーカスにはある） |
| R29 継続学習支援 | Home | 1日の目標 | FAIL | 連続学習日数・バッジ・週間/月間レポート・通知設定がない（AU-17） |
| R30 品質保証 | tests、e2e | 単体251・データ13・E2E59・型・ビルド全合格 | PASS | — |
| R31 全機能対象 | — | 本表 | PARTIAL | R18・R21・R24・R27〜R29・R47 に未実装あり |
| R32 CI・公開 | .github/workflows/ci.yml | e2e 失敗の原因を特定・修正（AU-01） | PARTIAL | 修正のリモート CI 結果は PR で確認する。gh-pages への配信は未実施 |
| R33 教材管理 | collation-overrides、import、generate | 再実行で差分0の決定性、照合バッチ記録 | PASS | — |
| R34 PWA | manifest・アイコン・SW | PWA E2E | PASS | 公開版 sw.js の PNG revision 不一致（AU-16、P3） |
| R35 OCR・転記品質 | transcripts | 8ページ目視、80プロフィール機械照合 | PARTIAL | 不一致3件を修正（AU-11）。全数照合は未実施 |
| R36 重複最適化 | — | 364組のツインは保持 | NOT TESTED | 個別の学習価値は未評価 |
| R37 バックアップ不要 | — | クラウド同期なし | PASS | — |
| R38〜R40 教材配信 | gh-pages | 原画146件の配信 | PASS | 許諾範囲の適法性は判断しない |
| R41 ホーム | screens/Home.tsx | E2E | PASS | — |
| R42 弱点克服 | Practice（誤答・苦手） | E2E | PARTIAL | 誤答原因の記録（mistakeCause）の入力 UI はない |
| R43 メモ | Reader | 実装あり | NOT TESTED | E2E なし |
| R44 網羅性 | Stats | 網羅・問題化・学習・習得を区別表示 | PASS | — |
| R45 原文連携 | QuestionRunner→Reader、模試は終了まで参照なし | E2E | PASS | — |
| R46 解答後UI | QuestionRunner | 正誤→正答→詳細の順（全形式）、自動・手動進行 E2E | PASS | AU-03・AU-08 で修正 |
| R47 記述力強化 | grading・QuestionRunner | 要点別・部分点・自己採点 | PARTIAL | 再記述・過去回答との比較はない |
| R48 品質管理 | QaPage、生成後検証 | 未検証・出典不一致・重複の機械検証 | PASS | 認証なしの GitHub 書き込みはない |
| R49 デザイン | styles.css | 実測 | PASS | — |
| R50 通知・演出 | — | 不要な演出なし | PARTIAL | 通知の設定項目がない |
| R51 分析指標 | Stats | 区別表示 | PARTIAL | 記述要点達成率の表示はない |
| R52 性能 | 遅延チャンク・SW | ビルド構成、集計の索引化 | PASS | data-questions 1.90MB（gzip 187KB、P3） |
| R53 データ生成 | scripts | 決定的再生成・生成後検証 | PASS | AU-04/06 のガードを生成後検証に追加 |
| R54 完成基準 | — | 本監査 | PARTIAL | 第38章の品質ゲートは docs/POST_FIX_AUDIT_REPORT.md |
| R55 ドキュメント | docs | 本監査で更新 | PASS | — |

## UX1〜UX14

| 要件 | 検証 | 判定 |
|---|---|---|
| UX1 ホームの即時演習 | 「5問始める」で5問セッションが設定なしで始まる（E2E・390×844 実測） | PASS |
| UX2〜UX7 | 既存 E2E（ダークモード、原画、索引、改訂、暗記）全件合格 | PASS |
| UX8 ナビ12項目の順序 | 実測で指定順 | PASS（タップ高さ32pxは AU-15、寸法不変の指示を優先） |
| UX9 即時演習の設定非表示 | 絞り込み・学習フォーカスが0件 | PASS |
| UX10 暗記・単語帳 | 「次へ」表記、逆モード（下部）、単語帳のボタンがカード直下で画面内（下端400px/844px） | PASS |
| UX11 説明ブロック末尾・タブ移動で最上部 | E2E | PASS |
| UX12 余白・回答後の表示順 | 全形式で正誤→正答（模範解答）→展開式詳細。上部バー寸法は不変 | PASS（AU-03 で修正） |
| UX13 設定の配置 | 単語帳・演習・検索の E2E、390×844 実測 | PASS |
| UX14 前へナビゲーション | 単語帳: 先頭→末尾の循環、表裏どちらでも、戻ると表面、SRS 不変。暗記: 先頭で無効、逆モードと整合、SRS 不変。演習: 先頭で無効、回答と採点を保持、未回答に正答が漏れない、自動進行と矛盾しない | PASS（AU-02 で修正） |

## DECISIONS #52

| 項目 | 検証 | 判定 |
|---|---|---|
| 前へナビゲーション | UX14 | PASS |
| サンプル全削除 | 0件・型からも削除・回帰ガード | PASS |
| 改訂内容の全体適用 | 36件の旧表記が学習データに残っていない。注記の未反映2件（唐辛子・しそ）を修正 | PASS |
| ロングペッパー「ピバーチ」・batch10 | 原本 p.107 と一致、batch10 維持 | PASS |
| カリカット「コーリコード」 | 原本 p.8 と一致 | PASS |
