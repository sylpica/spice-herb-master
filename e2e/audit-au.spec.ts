import { expect, test, type Page } from "@playwright/test";

/**
 * Claude Code 独立監査（2026-11-03、docs/DECISIONS.md #54）で修正した不具合の回帰 E2E。
 * 実機相当の操作で、修正前に再現した症状が起きないことを固定する。
 * - AU-02: 「前の問題へ」で戻ると回答・採点状態が消え、再確定で記録が二重計上された
 * - AU-03: 選択式・入力式などで、正誤の直下に正答が出なかった（UX12・R46）
 * - AU-07: 対応付けの候補が正解ペアの順に並んでいた
 * - AU-08: 正解時の自動進行（R27/R46）が未実装だった
 * - UX14: 単語帳・暗記の前へ移動で自己評価・復習記録が変化しない
 */
const KEY = "spice-herb-master:v1";
const FIRST_PROMPT = "スパイス&ハーブの定義の一例で、両者は何という植物の一部とされる?";

async function store(page: Page) {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null"), KEY);
}
async function openSequencePractice(page: Page) {
  await page.goto("#/practice");
  await expect(page.getByRole("heading", { name: "演習" })).toBeVisible();
  await page.getByLabel("出題順").selectOption("sequence");
  await expect(page.getByRole("heading", { name: FIRST_PROMPT })).toBeVisible();
}

test.describe("演習の回答後表示と前後移動（AU-02・AU-03）", () => {
  test("誤答すると正誤の直下に正答が出て、詳細は畳まれている", async ({ page }) => {
    await openSequencePractice(page);
    await page.getByLabel("回答入力").fill("まちがい");
    await page.getByRole("button", { name: "回答を確定する" }).click();
    const result = page.locator('[aria-live="polite"]');
    await expect(result.getByText(/^不正解/)).toBeVisible();
    const answer = result.locator(".model-answer");
    await expect(answer).toHaveText("正答: 芳香性植物");
    const verdictBox = await result.getByText(/^不正解/).boundingBox();
    const answerBox = await answer.boundingBox();
    const detailsBox = await result.locator("details.result-details").boundingBox();
    expect(answerBox!.y).toBeGreaterThan(verdictBox!.y);
    expect(detailsBox!.y).toBeGreaterThan(answerBox!.y);
    await expect(result.locator("details.result-details")).not.toHaveAttribute("open", /.*/);
  });

  test("前の問題へ戻ると回答と採点が残り、再確定できず、記録は1件のまま", async ({ page }) => {
    await openSequencePractice(page);
    await page.getByLabel("回答入力").fill("まちがい");
    await page.getByRole("button", { name: "回答を確定する" }).click();
    await expect(page.getByText(/^不正解（スコア 0%）/)).toBeVisible();
    expect((await store(page)).records).toHaveLength(1);
    await page.getByRole("button", { name: "次の問題へ" }).click();
    // 次の（未回答の）問題には前問の正答が漏れない
    await expect(page.locator(".model-answer")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "回答を確定する" })).toBeEnabled();
    await page.getByRole("button", { name: "前の問題へ" }).click();
    await expect(page.getByRole("heading", { name: FIRST_PROMPT })).toBeVisible();
    await expect(page.getByLabel("回答入力")).toHaveValue("まちがい");
    await expect(page.getByText(/^不正解（スコア 0%）/)).toBeVisible();
    await expect(page.locator(".model-answer")).toHaveText("正答: 芳香性植物");
    await expect(page.getByRole("button", { name: /確定済み/ })).toBeDisabled();
    const s = await store(page);
    expect(s.records).toHaveLength(1);
    expect(Object.keys(s.srs)).toHaveLength(1);
  });
});

test.describe("自動進行（AU-08）", () => {
  test("既定は手動進行で、設定でオンにすると正解後に次の問題へ自動で進む", async ({ page }) => {
    await openSequencePractice(page);
    await page.getByLabel("回答入力").fill("芳香性植物");
    await page.getByRole("button", { name: "回答を確定する" }).click();
    await expect(page.getByText("正解（スコア 100%）")).toBeVisible();
    await page.waitForTimeout(2200);
    await expect(page.getByRole("heading", { name: FIRST_PROMPT })).toBeVisible(); // 既定はオフ

    await page.goto("#/settings");
    await page.getByLabel("正解したら自動で次の問題へ進む").check();
    expect((await store(page)).autoAdvance).toBe(true);
    await openSequencePractice(page);
    await page.getByLabel("回答入力").fill("芳香性植物");
    await page.getByRole("button", { name: "回答を確定する" }).click();
    await expect(page.getByText("セッション 2 / 10 問")).toBeVisible({ timeout: 5000 });
    // 戻っても（確定済みの復元では）自動進行は再発しない
    await page.getByRole("button", { name: "前の問題へ" }).click();
    await expect(page.getByText("セッション 1 / 10 問")).toBeVisible();
    await page.waitForTimeout(2200);
    await expect(page.getByText("セッション 1 / 10 問")).toBeVisible();
  });

  test("不正解のときは自動進行しない", async ({ page }) => {
    await page.goto("#/settings");
    await page.getByLabel("正解したら自動で次の問題へ進む").check();
    await openSequencePractice(page);
    await page.getByLabel("回答入力").fill("まちがい");
    await page.getByRole("button", { name: "回答を確定する" }).click();
    await page.waitForTimeout(2200);
    await expect(page.getByText("セッション 1 / 10 問")).toBeVisible();
  });
});

test.describe("前へ移動は学習記録を変えない（UX14）", () => {
  test("単語帳: 先頭で前のカードは末尾へ循環し、表面で戻り、自己評価は増えない", async ({ page }) => {
    await page.goto("#/cards");
    await page.getByLabel("並び").selectOption("sequence");
    const card = page.getByLabel("カード反転");
    const first = (await card.textContent()) ?? "";
    await page.getByRole("button", { name: "前のカード" }).click();
    const last = (await card.textContent()) ?? "";
    expect(last).not.toBe(first);
    await page.getByRole("button", { name: "次のカード" }).click();
    await expect(card).toHaveText(first); // 末尾の次は先頭
    // 裏面からでも前へ戻れて、戻った先は表面
    await page.getByRole("button", { name: "次のカード" }).click();
    await page.getByRole("button", { name: "裏面を表示" }).click();
    await page.getByRole("button", { name: "前のカード" }).click();
    await expect(card).toHaveText(first);
    await expect(page.getByRole("button", { name: "裏面を表示" })).toBeVisible();
    expect(Object.keys((await store(page))?.srs ?? {})).toHaveLength(0);
  });

  test("暗記: 先頭では前へが無効、次へ→前へで同じ種類に戻り、復習記録は増えない", async ({ page }) => {
    await page.goto("#/memorize");
    const prev = page.getByRole("button", { name: "前へ", exact: true });
    await expect(prev).toBeDisabled();
    const name = (await page.locator("main h2").textContent())?.trim();
    await page.getByRole("button", { name: "次へ", exact: true }).click();
    await expect(page.getByText("2 / 80種")).toBeVisible();
    await prev.click();
    await expect(page.getByText("1 / 80種")).toBeVisible();
    await expect(page.locator("main h2")).toHaveText(name!);
    // 逆モードでも同じ位置のカードを表示し、名前は伏せられる
    await page.getByRole("button", { name: "プロフィール → 名前（逆）" }).click();
    await expect(page.locator("main h2")).toHaveCount(0);
    await page.getByRole("button", { name: "名前を表示（答え合わせ）" }).click();
    await expect(page.locator("main h2")).toHaveText(name!);
    expect(Object.keys((await store(page))?.srs ?? {})).toHaveLength(0);
  });
});

test.describe("対応付けの候補順（AU-07）", () => {
  test("各プルダウンの候補は正解ペアの順ではなく、全行で同じ照合順に並ぶ", async ({ page }) => {
    await page.goto("#/practice");
    const formats = page.locator("text=問題形式（複数選択可）").locator("..");
    await formats.getByLabel("組み合わせ", { exact: true }).check();
    const selects = page.locator('[aria-label="問題"] select');
    await expect(selects.first()).toBeVisible();
    const n = await selects.count();
    expect(n).toBeGreaterThanOrEqual(2);
    const opts = await selects.first().locator("option").allTextContents();
    const values = opts.slice(1);
    expect([...values].sort((a, b) => a.localeCompare(b, "ja"))).toEqual(values);
    for (let i = 1; i < n; i++) expect(await selects.nth(i).locator("option").allTextContents()).toEqual(opts);
  });
});
