# CI e2e ジョブ失敗への対応提案（2026-10-31 監査）

> **2026-11-03 解決済み（DECISIONS #54、AU-01）**: GitHub MCP の Actions ログ取得で run 41159001533 の失敗テストを特定した。失敗は `e2e/smoke.spec.ts` の暗記モードのテスト1件で、出題順（Date.now() シードのシャッフル）の先頭が「科名」を持たない種類（チャートマサラ等）のときに `科名は` の検証が落ちるフレークだった（環境差ではない）。テストを修正し、30回反復で全件合格を確認した。以下のワークフロー改訂は原因特定に不要となったため、適用しなくてよい。

## 状況

- main の CI は check ジョブ（型・単体・データ検証・ビルド・npm audit）が成功し、e2e ジョブだけが失敗するパターンが 6b976d7c 以降の全コミット（e4dc2b55、748270a3 を含む）で続いている。
- 同一コードの E2E はローカル環境で全件合格する（2026-10-31 の監査でもファイル別に全件合格を確認）。
- GitHub コネクタには Actions のログ取得手段がなく（ツール一覧を列挙して確認済み）、失敗テストの内訳は特定できていない。
- ワークフロー（.github/workflows/ci.yml）と playwright.config.ts の精査では、明白な設定欠陥は見つからなかった。ローカルでは、実行環境の負荷が高いときに 60 秒のテストタイムアウトで同種の失敗が発生することを確認しており、CI ランナー上でも負荷・速度起因のタイムアウトが起きている可能性が考えられるが、ログがないため未確定である。

## 提案: 失敗時の証拠を残す

次回の失敗で内訳を特定できるよう、e2e ジョブに test-results（trace・スクリーンショット）のアップロードを追加する。あわせて、ランナー負荷の影響を切り分けやすくするため、ジョブレベルのタイムアウトを明示する。

```yaml
  e2e:
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: npm }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
      - name: E2E の証拠を保存（失敗時）
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-test-results
          path: test-results/
          if-no-files-found: ignore
          retention-days: 7
```

## 適用方法

.github/workflows/ は GitHub App の権限で書き込めないため、リポジトリの Web UI から ci.yml の e2e ジョブを上記に差し替える必要がある（ユーザーの操作）。差し替え後、次の main への push で e2e が失敗した場合は、Actions の該当 run の Artifacts から playwright-test-results をダウンロードし、trace を `npx playwright show-trace` で開くと失敗箇所が特定できる。

## 適用後の進め方

1. 失敗テスト名と trace を確認する。
2. タイムアウト起因かどうか（ページ表示待ちで落ちているか）を切り分ける。
3. 環境起因であれば、対象テストの待ち条件の見直しや、CI 専用のタイムアウト延長（テストの意味を弱めない範囲）を検討する。
4. 実装起因であれば、通常の不具合として修正する。
