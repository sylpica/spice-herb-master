import { expect, test } from "@playwright/test";

/**
 * モバイル viewport の E2E（フェーズ7・バッチE3、docs/DECISIONS.md #30）。
 * スマートフォン幅（390×844）でホーム・リーダー・演習が表示でき、
 * 主要操作（画面遷移・節を開く・回答）ができることを確認する。
 * 実機確認ではなくブラウザの viewport エミュレーションである
 * （実機との区別は docs/TEST_PLAN.md / QUALITY_REPORT.md の従来どおり）。
 * プロジェクトはデスクトップ Chromium のまま、viewport だけを差し替える。
 */

test.describe("モバイル viewport（390×844）", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("ホームから演習へ遷移し、選択式問題に回答できる", async ({ page }) => {
    await page.goto("");
    await expect(
      page.getByRole("heading", { name: "スパイス＆ハーブ検定1級 学習アプリ" }),
    ).toBeVisible();
    // 横方向にページ全体がはみ出していない（横スクロールで操作不能にならない）
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);

    await page
      .getByRole("navigation", { name: "メインナビゲーション" })
      .getByRole("link", { name: "演習", exact: true })
      .click();
    await expect(page.getByRole("heading", { name: "演習" })).toBeVisible();
    // 正式問題の先頭（一問一答）で回答する。出題順を登録順にして決定的にする（サンプルは全削除済み、#52）
    await page.getByLabel("出題順").selectOption("sequence");
    await expect(
      page.getByRole("heading", {
        name: "スパイス&ハーブの定義の一例で、両者は何という植物の一部とされる?",
      }),
    ).toBeVisible();
    await page.getByLabel("回答入力").fill("芳香性植物");
    await page.getByRole("button", { name: "回答を確定する" }).click();
    await expect(page.getByText("正解（スコア 100%）")).toBeVisible();
  });

  test("リーダーが縦積みで表示され、目次から節を開ける", async ({ page }) => {
    await page.goto("#/reader");
    await expect(page.getByRole("heading", { name: "電子書籍リーダー" })).toBeVisible();
    await expect(page.getByText(/書籍 p\.6 ／ 転記状態: 転記済み/)).toBeVisible();
    // スマホ幅では目次（81節）を畳み、本文を先に見せる（全アプリ共通UIルール1、DECISIONS #55）
    await expect(page.getByRole("button", { name: "日本における歴史（p.10）" })).toBeHidden();
    await page.locator("summary", { hasText: "目次" }).click();
    await page.getByRole("button", { name: "日本における歴史（p.10）" }).click();
    await expect(page.getByText(/書籍 p\.10 ／ 転記状態: 転記済み/)).toBeVisible();
    // 節を選んだら目次は畳まれ、スクロール操作なしで本文の見出しが画面内に入る（DECISIONS #35）
    await expect(
      page.locator("#reader-page").getByRole("heading", { name: "日本における歴史", level: 2 }),
    ).toBeInViewport();
    await expect(
      page.getByText(/「薬味」という言葉はあっても、「スパイス」や「香辛料」は最近まで/),
    ).toBeVisible();
  });

  test("ホームの「電子書籍を開く」は目次を飛ばして本文ページへ直接着地する", async ({ page }) => {
    await page.goto("");
    await page.locator("main").getByRole("link", { name: "前回の続き" }).click();
    await expect(page).toHaveURL(/#\/reader$/);
    // 初期節（世界における歴史、p.6）の本文見出しが、スクロールなしで画面内にある
    // （転記本文側にも同名の h3 があるため、節タイトルは h2 に限定する）
    await expect(
      page.locator("#reader-page").getByRole("heading", { name: "世界における歴史", level: 2 }),
    ).toBeInViewport();
  });
});
