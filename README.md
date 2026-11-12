# スパイス＆ハーブ検定1級 学習アプリ（spice-herb-master）

公式テキスト『4訂版 スパイス&ハーブの使いこなし事典』（主婦の友社）に基づく、個人用レスポンシブWebアプリ／PWA。開発主体は Muse（開発指令は元々Claude向けに書かれたものをユーザーがMuseへ再割当）。

**公開サイト: https://sylpica.github.io/spice-herb-master/**（リポジトリは public。2026-10-30 に GitHub アカウント名が minkohno-hub から sylpica へ変更され、公開URLも移行した。旧URLは転送されない）

## 現在の状態（2026-10-30、独立品質監査の修正反映後）
- **正式問題 1,732問（15形式）・正式カード 602件**（2026-11-12 の第2ラウンド監査で、誤答を揃えられない四択を除いた。DECISIONS #55）。全て原文照合済み（verified）の知識単位545件から決定的パイプライン（`scripts/generate-questions.mjs`）で生成し、出典・正答の検証を通ったものだけを登録している。エンジン検証用サンプルは全削除済み（DECISIONS #52）。
- **本文転記 133ページ・85,586文字**（序章・第一章・第二章・第三章の全範囲＋検定情報の Drive 実在範囲 p.136〜140＋章扉3葉）。収録範囲は本文テキストと表データで、写真そのものは収録していない（写真はキャプション文のみ）。p.141以降は原本画像が Drive に存在しないため未転記。IMG_9647 は番号なし扉ページと強く推察（内容は未確認）。詳細は `docs/SOURCE_COVERAGE.md` と `docs/TRANSCRIPTION.md`。
- **機能**: 演習（学習モード絞り込み・問題数設定・学習記録と間隔反復）、電子書籍リーダー（転記本文・問題との双方向リンク）、フラッシュカード（4種別・自己評価→間隔反復）、模擬試験（制限時間・一括採点・結果の間隔反復反映）、学習分析、横断検索（転記本文も検索対象）、品質管理画面。
- **品質**: Vitest 約200件＋Playwright E2E 約30件が全件合格する状態を維持する。2026-10-30 に独立品質監査（領域A〜E）を実施し、検出事項は監査ブランチで修正・再検証した（`docs/MUSE_AUDIT_REPORT.md`、`docs/AUDIT_DECISIONS.md`）。

## 開発
```sh
npm install
npm run dev        # 開発サーバー
npm run check      # 型チェック＋テスト＋ビルド
npm run test:e2e   # Playwright E2E（本番ビルド＋preview で実行）
npm run validate:data  # データ検証テストのみ
```
技術: React 19 + TypeScript + Vite + vite-plugin-pwa + react-router（HashRouter、GitHub Pagesのベースパス `/spice-herb-master/`）。学習履歴は localStorage のみに保存（同期・バックアップなし＝要件）。ブラウザデータ削除・機種変更で履歴が消える可能性があります。

## ドキュメント
`docs/` 配下: REQUIREMENTS / ARCHITECTURE / DECISIONS / AUDIT_DECISIONS / MUSE_AUDIT_REPORT / DATA_PIPELINE / SOURCE_COVERAGE / TRANSCRIPTION / QUESTION_QUALITY / UI_UX_GUIDELINES / TEST_PLAN / QUALITY_REPORT / TRACEABILITY / BLOCKERS / RELEASE_REPORT / DEVELOPMENT_STATE
