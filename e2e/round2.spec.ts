import { test, expect, type Page } from "@playwright/test";

/**
 * 第2ラウンド監査（2026-11-11、DECISIONS #55）の E2E。
 * 全アプリ共通UIルール（スクロール最小化・文字切れ禁止・説明は下・上部バーは現行寸法）と、
 * R28（学習状況での検索）・R27（後回し・キーボード）・R18（問題報告・除外）・R24（カードのお気に入り）を
 * 実ブラウザの 375px 幅で検証する。
 */
const STORE_KEY = "spice-herb-master:v1";
const ROUTES = ["", "#/practice", "#/memorize", "#/cards", "#/exam", "#/revision", "#/reader", "#/search", "#/settings", "#/stats", "#/qa"];
const FIRST_PROMPT = "スパイス&ハーブの定義の一例で、両者は何という植物の一部とされる?";

async function readStore(page: Page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), STORE_KEY);
}

test.describe("全アプリ共通UIルール（375×667）", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("全11画面で横スクロールがなく、文字が切れず、操作部品は44px以上", async ({ page }) => {
    for (const route of ROUTES) {
      await page.goto(route);
      await expect(page.locator("main h1")).toBeVisible();
      await page.waitForTimeout(300);
      const m = await page.evaluate(() => {
        const de = document.documentElement;
        const clipped: string[] = [];
        const small: string[] = [];
        for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const cs = getComputedStyle(el);
          const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? "").trim());
          const label = `${el.tagName}:${(el.textContent ?? "").trim().slice(0, 20)}`;
          if (hasText || ["BUTTON", "A", "SELECT", "INPUT"].includes(el.tagName)) {
            if (r.right > window.innerWidth + 1 || r.left < -1) clipped.push(`${label} はみ出し`);
            if (el.scrollWidth > el.clientWidth + 1 && ["hidden", "clip"].includes(cs.overflowX)) clipped.push(`${label} 横切れ`);
            if (el.scrollHeight > el.clientHeight + 2 && ["hidden", "clip"].includes(cs.overflowY)) clipped.push(`${label} 縦切れ`);
            if (cs.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1) clipped.push(`${label} 省略`);
          }
          // 上部バーは確定仕様（寸法を変更しない）のため対象外。チェックボックス・ラジオは行（label）で判定する。
          if (el.closest("nav.main")) continue;
          const isControl = ["BUTTON", "SELECT", "TEXTAREA", "SUMMARY"].includes(el.tagName) || (el.tagName === "A" && !!el.closest("main")) || (el.tagName === "INPUT" && !["checkbox", "radio"].includes((el as HTMLInputElement).type));
          const isChoiceRow = el.tagName === "LABEL" && !!el.querySelector('input[type="checkbox"],input[type="radio"]');
          if ((isControl || isChoiceRow) && r.height < 43.5) small.push(`${label} h=${Math.round(r.height)}`);
        }
        return { docW: de.scrollWidth, winW: window.innerWidth, clipped, small };
      });
      expect(m.docW, `${route}: 横スクロール`).toBeLessThanOrEqual(m.winW);
      expect(m.clipped, `${route}: 文字切れ`).toEqual([]);
      expect(m.small, `${route}: 44px未満の操作部品`).toEqual([]);
    }
  });

  test("上部バーの寸法は変更しない（375pxで3行・111px、リンクの高さ32px）", async ({ page }) => {
    await page.goto("");
    const header = await page.locator("header.top").boundingBox();
    expect(Math.round(header!.height)).toBe(111);
    const link = await page.locator("nav.main a").first().boundingBox();
    expect(Math.round(link!.height)).toBe(32);
    await expect(page.locator("nav.main a")).toHaveCount(12);
  });

  test("ホーム: 主要機能のタイル10個と今日の目標が、スクロールなしで一画面に収まる", async ({ page }) => {
    await page.goto("");
    const tiles = page.locator("main section.tiles a.tile");
    await expect(tiles).toHaveCount(10);
    for (let i = 0; i < 10; i++) await expect(tiles.nth(i)).toBeInViewport({ ratio: 1 });
    await expect(page.getByLabel("今日の目標の達成度")).toBeInViewport({ ratio: 1 });
    // 説明・注記はタイルより下
    const lastTile = await tiles.nth(9).boundingBox();
    const note = await page.getByText("教材の収録状況").boundingBox();
    expect(note!.y).toBeGreaterThan(lastTile!.y + lastTile!.height - 1);
  });

  test("ページ全体の高さ: ホーム・模試・暗記は縦長にしない", async ({ page }) => {
    const height = async (route: string) => { await page.goto(route); await expect(page.locator("main h1")).toBeVisible(); return page.evaluate(() => document.documentElement.scrollHeight); };
    expect(await height("")).toBeLessThanOrEqual(900); // 修正前 3,019px
    expect(await height("#/exam")).toBeLessThanOrEqual(700); // 修正前 768px
    expect(await height("#/memorize")).toBeLessThanOrEqual(900);
    expect(await height("#/search")).toBeLessThanOrEqual(5000); // 修正前 129,135px（全1,876件を一度に描画）
    expect(await height("#/revision")).toBeLessThanOrEqual(3000); // 修正前 8,176px
  });

  test("模試・暗記・単語帳: 説明文は主要操作より下にある", async ({ page }) => {
    const y = async (loc: ReturnType<Page["locator"]>) => (await loc.boundingBox())!.y;
    await page.goto("#/exam");
    expect(await y(page.getByText(/独自の練習用試験です/))).toBeGreaterThan(await y(page.getByRole("button", { name: "開始", exact: true })));
    await page.goto("#/memorize");
    expect(await y(page.getByText(/思い出してから答え合わせ/))).toBeGreaterThan(await y(page.getByRole("button", { name: "次へ", exact: true })));
    await expect(page.getByRole("button", { name: "次へ", exact: true })).toBeInViewport({ ratio: 1 });
    await page.goto("#/cards");
    expect(await y(page.getByText(/自己評価は復習間隔/))).toBeGreaterThan(await y(page.getByLabel("種別")));
    for (const name of ["裏面を表示", "前のカード", "次のカード"]) await expect(page.getByRole("button", { name })).toBeInViewport({ ratio: 1 });
  });

  test("演習の絞り込み: チェックボックスとラベルが同じ行に並ぶ", async ({ page }) => {
    await page.goto("#/practice");
    const chip = page.locator("label.chip", { hasText: "第一章" });
    const box = await chip.boundingBox();
    const input = await chip.locator("input").boundingBox();
    expect(box!.height).toBeLessThan(60); // 修正前はチェックボックスがラベルの上の行に離れていた
    expect(input!.y).toBeGreaterThanOrEqual(box!.y);
    expect(input!.y + input!.height).toBeLessThanOrEqual(box!.y + box!.height + 1);
  });
});

test.describe("R28: 学習状況での検索", () => {
  test("直近が不正解・習得済み・ブックマーク・未回答で絞り込め、正答率順に並べ替えられる", async ({ page }) => {
    const at = (d: number) => new Date(2026, 9, d, 12).toISOString();
    const r = (questionId: string, correct: boolean, d: number) => ({ questionId, answeredAt: at(d), correct, scoreRatio: correct ? 1 : 0, autoScoreRatio: correct ? 1 : 0, selfScoreRatio: null, responseMs: 1000 });
    const seed = {
      records: [r("q1-b-def", false, 1), r("q1-b-def-split", true, 1), r("q1-b-def-split", true, 2), r("q1-b-fresh", true, 1)],
      srs: {}, favorites: ["q1-b-dry"], goalPerDay: 10,
      reader: { sectionId: "", fontSize: 16, dark: false, bookmarks: [], highlights: {}, notes: {} }, examDraft: null,
    };
    await page.addInitScript(({ key, value }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, value); }, { key: STORE_KEY, value: JSON.stringify(seed) });
    await page.goto("#/search");
    await expect(page.getByRole("heading", { name: "問題 1732件" })).toBeVisible();
    // 全件を一度に描画しない（20件ずつ）
    await expect(page.locator("main ul.rows a.row")).toHaveCount(20);
    await page.getByRole("button", { name: "さらに表示（残り 1712件）", exact: true }).click();
    await expect(page.locator("main ul.rows a.row")).toHaveCount(60);

    await page.getByLabel("学習状況").selectOption("wrong");
    await expect(page.getByRole("heading", { name: "問題 1件" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "教材（節） 0件" })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(FIRST_PROMPT.replace(/[?&]/g, "\\$&")) })).toBeVisible();

    await page.getByLabel("学習状況").selectOption("mastered");
    await expect(page.getByRole("heading", { name: "問題 1件" })).toBeVisible();
    await page.getByLabel("学習状況").selectOption("favorites");
    await expect(page.getByRole("heading", { name: "問題 1件" })).toBeVisible();
    await page.getByLabel("学習状況").selectOption("unanswered");
    await expect(page.getByRole("heading", { name: "問題 1729件" })).toBeVisible(); // 1732 − 解答済み3問

    await page.getByLabel("学習状況").selectOption("all");
    await page.getByLabel("並び順").selectOption("accuracy-asc");
    // 正答率0%の問題が先頭に来る
    await expect(page.locator("main ul.rows a.row").first()).toContainText(FIRST_PROMPT);
    await page.getByRole("button", { name: "すべての条件を解除" }).click();
    await expect(page.getByLabel("並び順")).toHaveValue("default");
    await expect(page.getByRole("heading", { name: "教材（節） 81件" })).toBeVisible();
  });
});

test.describe("演習の操作（R27・R18）と AU-02/03/07/08 の回帰", () => {
  test("後回しで末尾へ回り、←→キーで前後に移動でき、確定済みの回答は戻っても保持される", async ({ page }) => {
    await page.goto("#/practice");
    await page.getByLabel("出題順").selectOption("sequence");
    await expect(page.getByRole("heading", { name: FIRST_PROMPT })).toBeVisible();
    await expect(page.getByText(/セッション 1 \/ 10 問/)).toBeVisible();
    // 後回し: 1問目が末尾へ回り、2問目が先頭に来る（位置は1のまま）
    await page.getByRole("button", { name: "後回し" }).click();
    await expect(page.getByRole("heading", { name: FIRST_PROMPT })).toHaveCount(0);
    await expect(page.getByText(/セッション 1 \/ 10 問/)).toBeVisible();
    // さらに2問を後回しにすると、登録順4問目の四択が先頭に来る
    await page.getByRole("button", { name: "後回し" }).click();
    await page.getByRole("button", { name: "後回し" }).click();
    await expect(page.getByRole("radio")).toHaveCount(4);
    // 数字キーで選択肢を選び、Enter で確定（四択）。ボタンにフォーカスが残っていると Enter は
    // そのボタンを押す操作になるため、問題文をクリックしてフォーカスを外してから操作する。
    await page.locator('[aria-label="問題"] h2').click();
    await page.locator("body").press("1");
    await expect(page.getByRole("radio").first()).toBeChecked();
    await page.locator("body").press("Enter");
    await expect(page.getByRole("button", { name: "確定済み" })).toBeDisabled();
    // AU-03: 正誤の直下に正答が出る
    await expect(page.locator(".model-answer")).toContainText("正答:");
    await expect.poll(async () => (await readStore(page))?.records.length).toBe(1);
    // →で次へ、←で戻ると確定済みのまま（AU-02: 再確定できず記録は増えない）
    await page.locator("body").press("ArrowRight");
    await expect(page.getByText(/セッション 2 \/ 10 問/)).toBeVisible();
    await page.locator("body").press("ArrowLeft");
    await expect(page.getByText(/セッション 1 \/ 10 問/)).toBeVisible();
    await expect(page.getByRole("button", { name: "確定済み" })).toBeDisabled();
    await expect(page.locator(".model-answer")).toBeVisible();
    expect((await readStore(page)).records.length).toBe(1);
    // 確定済みの問題は後回しにできない
    await expect(page.getByRole("button", { name: "後回し" })).toBeDisabled();
    // 後回しした3問は末尾（8〜10問目）に、後回しした順で並ぶ
    for (let i = 0; i < 7; i++) await page.getByRole("button", { name: "次の問題へ" }).click();
    await expect(page.getByText(/セッション 8 \/ 10 問/)).toBeVisible();
    await expect(page.getByRole("heading", { name: FIRST_PROMPT })).toBeVisible();
  });

  test("問題を報告して除外すると、品質管理に載り、演習の対象から外れる", async ({ page }) => {
    await page.goto("#/practice");
    await page.getByLabel("出題順").selectOption("sequence");
    await page.getByLabel("回答入力").fill("まちがい");
    await page.getByRole("button", { name: "回答を確定する" }).click();
    await page.getByText("解説・出典などの詳細を見る").click();
    await page.getByText("この問題を報告・除外").click();
    await page.getByLabel("報告内容").fill("表記を確認したい");
    await page.getByRole("button", { name: "報告を保存" }).click();
    await page.getByRole("button", { name: "出題から除外" }).click();
    const s = await readStore(page);
    expect(s.reports).toHaveLength(1);
    expect(s.reports[0].note).toBe("表記を確認したい");
    expect(s.excluded).toEqual(["q1-b-def"]);
    await page.goto("#/qa");
    await expect(page.getByText("表記を確認したい")).toBeVisible();
    await expect(page.getByText(/1件 ・ 出題から除外 1問/)).toBeVisible();
    // 演習を開き直すと、除外した問題は出ない（登録順の先頭が次の問題になる）
    await page.goto("#/practice");
    await page.getByLabel("出題順").selectOption("sequence");
    await expect(page.getByText(/対象プール 1731 問/)).toBeVisible();
    await expect(page.getByRole("heading", { name: FIRST_PROMPT })).toHaveCount(0);
    // 品質管理から出題に戻せる
    await page.goto("#/qa");
    await page.getByRole("button", { name: "出題に戻す" }).click();
    expect((await readStore(page)).excluded).toEqual([]);
  });

  test("AU-08: 自動進行をオンにすると、正解後に次の問題へ進む", async ({ page }) => {
    await page.goto("#/settings");
    await page.getByLabel("正解したら自動で次の問題へ進む").check();
    await page.goto("#/practice");
    await page.getByLabel("出題順").selectOption("sequence");
    await page.getByLabel("回答入力").fill("芳香性植物");
    await page.getByRole("button", { name: "回答を確定する" }).click();
    await expect(page.getByText(/セッション 2 \/ 10 問/)).toBeVisible({ timeout: 5000 });
  });
});

test.describe("単語帳のお気に入り（R24）と設定の目標", () => {
  test("カードをお気に入りにして、お気に入りのみで絞り込める", async ({ page }) => {
    await page.goto("#/cards");
    await page.getByLabel("並び").selectOption("sequence");
    await page.getByRole("button", { name: "☆ お気に入り" }).click();
    await expect(page.getByRole("button", { name: "★ お気に入り" })).toBeVisible();
    expect((await readStore(page)).cardFavorites).toHaveLength(1);
    await page.getByLabel(/お気に入りのみ/).check();
    await expect(page.getByText(/^1 \/ 1 枚/)).toBeVisible();
    // 前後移動では学習履歴（SRS）が変わらない（UX14）
    await page.getByRole("button", { name: "次のカード" }).click();
    await page.getByRole("button", { name: "前のカード" }).click();
    expect(Object.keys((await readStore(page)).srs)).toHaveLength(0);
  });

  test("1日の目標は設定画面で変更でき、ホームの進捗に反映される", async ({ page }) => {
    await page.goto("#/settings");
    await page.getByLabel("1日の目標（問）").fill("25");
    await page.goto("");
    await expect(page.getByText("今日 0/25問")).toBeVisible();
    await expect(page.getByText("連続 0日")).toBeVisible();
  });
});
