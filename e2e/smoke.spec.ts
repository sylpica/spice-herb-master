import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * 主要フローのスモーク E2E（フェーズ7・バッチE2）。
 *
 * セレクタ方針: 位置指定（nth や CSS クラス依存）は避け、ロール＋アクセシブル名、
 * 表示テキスト等の意味的な指定を優先する（docs/DECISIONS.md #24）。
 * アプリは HashRouter のため、各画面は "#/<route>" で開く（base は config の baseURL）。
 * 遅延チャンク（React.lazy）の読み込みは、対象画面の h1 が見えることを
 * Playwright の自動待機（expect のリトライ）で待つことで検証する。
 */

async function openHome(page: Page) {
  await page.goto("");
  await expect(
    page.getByRole("heading", { name: "スパイス＆ハーブ検定1級 学習アプリ" }),
  ).toBeVisible();
}

function mainNav(page: Page) {
  return page.getByRole("navigation", { name: "メインナビゲーション" });
}

test.describe("ホームとナビゲーション", () => {
  test("ホームが表示され、教材の主要指標が見える", async ({ page }) => {
    await openHome(page);
    // 軽量サマリ経由の件数表示（tests/summary.test.ts が実データ一致を固定）
    await expect(page.getByText("正式問題 1795問").first()).toBeVisible();
    await expect(page.getByText(/取り込み済み知識単位: 545件/)).toBeVisible();
    await expect(page.getByText(/全文転記: 140ページ/)).toBeVisible();
    await expect(page.getByText("教材の状態（正直な表示）")).toBeVisible();
  });

  test("主要ナビゲーションから各画面へ遷移できる（遅延チャンク読み込み）", async ({
    page,
  }) => {
    await openHome(page);
    // 分析・品質管理は UX2 で設定画面へ移したため、ナビの直接リンクには含めない
    const routes: Array<{ link: string; heading: string; hash: string }> = [
      { link: "演習", heading: "演習", hash: "#/practice" },
      { link: "暗記", heading: "暗記モード", hash: "#/memorize" },
      { link: "単語帳", heading: "フラッシュカード・単語帳", hash: "#/cards" },
      { link: "模擬試験", heading: "模擬試験（練習用）", hash: "#/exam" },
      { link: "改訂", heading: "改訂ポイント（4訂版）", hash: "#/revision" },
      { link: "電子書籍", heading: "電子書籍リーダー", hash: "#/reader" },
      { link: "検索", heading: "横断検索", hash: "#/search" },
      { link: "設定", heading: "設定", hash: "#/settings" },
      { link: "ホーム", heading: "スパイス＆ハーブ検定1級 学習アプリ", hash: "#/" },
    ];
    for (const r of routes) {
      await mainNav(page).getByRole("link", { name: r.link, exact: true }).click();
      // 遅延チャンクの取得・描画が終わるまで h1 の出現を待つ
      await expect(page.getByRole("heading", { name: r.heading }).first()).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${r.hash.replace("/", "\\/")}$`));
    }
  });

  test("上部バーのリンクは指定順に並ぶ（UX8: 暗記・改訂を追加）", async ({ page }) => {
    await openHome(page);
    const labels = await mainNav(page).getByRole("link").allTextContents();
    expect(labels.map((t) => t.trim())).toEqual([
      "ホーム",
      "演習",
      "苦手",
      "間違い",
      "ブックマーク",
      "暗記",
      "単語帳",
      "模擬試験",
      "改訂",
      "電子書籍",
      "検索",
      "設定",
    ]);
  });

  test("ホームの「5問始める」は設定なしで5問セッションを開始する", async ({ page }) => {
    await openHome(page);
    await page.getByRole("link", { name: "5問始める" }).click();
    await expect(page).toHaveURL(/#\/practice$/);
    await expect(page.getByText(/セッション 1 \/ 5 問/)).toBeVisible();
    // UX9: クイック開始では絞り込み・学習フォーカス等の設定UIを出さず、問題が初期表示範囲に入る
    await expect(page.getByLabel("学習フォーカス")).toHaveCount(0);
    await expect(page.getByLabel("演習の絞り込み")).toHaveCount(0);
    const sessionLabel = page.getByText(/セッション 1 \/ 5 問/);
    const box = await sessionLabel.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(box!.y).toBeLessThan(viewport!.height);
  });

  test("演習を直接開いた場合は絞り込みと学習フォーカスが表示される", async ({ page }) => {
    await openHome(page);
    await page.getByRole("link", { name: "演習", exact: true }).first().click();
    await expect(page).toHaveURL(/#\/practice$/);
    await expect(page.getByLabel("学習フォーカス")).toBeVisible();
    await expect(page.getByLabel("演習の絞り込み")).toBeVisible();
  });

  test("上部メニューの苦手・間違い・ブックマークは対応する学習フォーカスで演習を開く", async ({
    page,
  }) => {
    const cases: Array<{ link: string; focus: string }> = [
      { link: "苦手", focus: "weak" },
      { link: "間違い", focus: "wrong" },
      { link: "ブックマーク", focus: "favorites" },
    ];
    for (const c of cases) {
      await openHome(page);
      await mainNav(page).getByRole("link", { name: c.link, exact: true }).click();
      await expect(page).toHaveURL(/#\/practice$/);
      await expect(page.getByLabel("学習フォーカス")).toHaveValue(c.focus);
    }
  });
});

test.describe("設定とダークモード（UX2）", () => {
  test("設定画面から学習分析・品質管理へ遷移できる", async ({ page }) => {
    await openHome(page);
    await mainNav(page).getByRole("link", { name: "設定", exact: true }).click();
    await expect(page.getByRole("heading", { name: "設定" })).toBeVisible();
    await page.getByRole("link", { name: "学習分析を開く" }).click();
    await expect(page.getByRole("heading", { name: "学習分析・可視化" })).toBeVisible();
    await page.goto("#/settings");
    await page.getByRole("link", { name: "品質管理を開く" }).click();
    await expect(page.getByRole("heading", { name: "品質管理（管理・監査）" })).toBeVisible();
  });

  test("ダークモードでは本文・カード・バッジの背景が暗色になり文字が読める", async ({ page }) => {
    await openHome(page);
    await mainNav(page).getByRole("link", { name: "設定", exact: true }).click();
    await page.getByRole("button", { name: "ダークモード切替" }).click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.dark))
      .toBe("true");
    // ページ全体の背景（body / html）が暗色になる（UX2 の根本修正: テーマ適用先を <html> へ）
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
      .toBe("rgb(20, 26, 16)");
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor))
      .toBe("rgb(20, 26, 16)");
    // カード背景も暗色で、文字色は明色
    const card = page.locator(".card").first();
    await expect.poll(() => card.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(31, 41, 24)");
    await expect.poll(() => card.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(238, 243, 228)");
    // ホームの通知バッジもダーク用の配色（明るい黄のまま残らない）
    await page.goto("");
    const badge = page.locator("p.badge");
    await expect.poll(() => badge.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(61, 52, 19)");
    await expect.poll(() => badge.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(246, 214, 124)");
    // 切替は保存され、再読み込み後もダークが維持される
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.dark))
      .toBe("true");
  });
});

test.describe("電子書籍リーダー", () => {
  test("目次から節を開くと転記本文が表示される", async ({ page }) => {
    await page.goto("#/reader");
    await expect(page.getByRole("heading", { name: "電子書籍リーダー" })).toBeVisible();
    // 初期表示は先頭の節（世界における歴史、p.6）で転記本文が出ている
    await expect(page.getByText(/書籍 p\.6 ／ 転記状態: 転記済み/)).toBeVisible();
    await expect(
      page.getByText(/古代から、人類はその経験に基づく知恵を生かして/),
    ).toBeVisible();

    // 目次から別の節（日本における歴史、p.10）を開く
    await page.getByRole("button", { name: "日本における歴史（p.10）" }).click();
    await expect(page.getByText(/書籍 p\.10 ／ 転記状態: 転記済み/)).toBeVisible();
    await expect(
      page.getByText(/「薬味」という言葉はあっても、「スパイス」や「香辛料」は最近まで/),
    ).toBeVisible();
    // その節の関連問題数などの付帯情報も描画される
    await expect(page.getByText(/関連問題: \d+問（正式）/)).toBeVisible();
  });

  test("原画（ページ画像）がリーダーで実際に読み込まれて表示される（UX3）", async ({ page }) => {
    await page.goto("#/reader");
    await expect(page.getByRole("heading", { name: "電子書籍リーダー" })).toBeVisible();
    // 初期節の先頭ページの原画は開いた状態で表示され、画像として読み込まれる
    const img = page.locator("#reader-page img").first();
    await expect(img).toBeVisible();
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBe(1000);
    // 2ページ目以降はボタンで開く
    await page.getByRole("button", { name: /原画を表示（本書 p\.7）/ }).click();
    await expect
      .poll(() => page.locator("#reader-page img").nth(1).evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBe(1000);
  });

  test("世界のドリンクは自節の転記本文が表示される（UX4）", async ({ page }) => {
    await page.goto("#/reader");
    await expect(page.getByRole("heading", { name: "電子書籍リーダー" })).toBeVisible();
    await page.getByRole("button", { name: "世界のドリンク（p.29）" }).click();
    await expect(page.locator("#reader-page")).toContainText("スパイスやハーブの香りが決め手の各国のドリンク");
    await expect(page.locator("#reader-page")).not.toContainText("この節の本文はまだ転記されていません");
  });

  test("索引節では本書の索引の転記と生成索引の併記から移動できる（UX4→T18）", async ({ page }) => {
    await page.goto("#/reader");
    await expect(page.getByRole("heading", { name: "電子書籍リーダー" })).toBeVisible();
    await page.getByRole("button", { name: "主なスパイス＆ハーブの索引（p.145）" }).click();
    // 本書の索引そのものの転記（T18）が見える
    await expect(page.locator("#reader-page")).toContainText("麻の実");
    await expect(page.locator("#reader-page")).toContainText("アプリ収録データからの索引（ページへ移動できます）");
    const anise = page.locator("#reader-page li", { hasText: "アニス" }).first();
    await anise.getByRole("button", { name: "p.52" }).click();
    await expect(page.locator("#reader-page h2")).toHaveText("アニス");
  });
});

test.describe("改訂ポイント（UX7）", () => {
  test("ホームから入り、1級対象の変更と出典が見え、該当ページへ移動できる", async ({ page }) => {
    await openHome(page);
    await page.getByRole("link", { name: "改訂ポイントを見る" }).click();
    await expect(page.getByRole("heading", { name: "改訂ポイント（4訂版）" })).toBeVisible();
    await expect(page.getByText(/第18回以降（2027年〜）/)).toBeVisible();
    await expect(page.getByText("ジュニパーベリー", { exact: true }).first()).toBeVisible();
    // パンダンリーフの「4訂版 p.105 を読む」でリーダーの該当節（その他の品目）へ移動する
    const pandan = page.locator("li", { hasText: "パンダンリーフ" }).first();
    await pandan.getByRole("button", { name: "4訂版 p.105 を読む" }).click();
    await expect(page.getByRole("heading", { name: "電子書籍リーダー" })).toBeVisible();
    await expect(page.locator("#reader-page")).toContainText("パンダンリーフ");
  });
});

test.describe("暗記モード（UX5）", () => {
  test("ホームから入り、全80種を答え合わせと自己評価で回せる", async ({ page }) => {
    await openHome(page);
    await page.getByRole("link", { name: "暗記を始める" }).click();
    await expect(page.getByRole("heading", { name: "暗記モード（全80種）" })).toBeVisible();
    await expect(page.getByText("1 / 80種")).toBeVisible();
    // 出題順は毎回シャッフル（Date.now() シード）で、先頭がミックススパイス等の「科名」を
    // 持たない種類になることがある（CI e2e 失敗 run 41159001533 の原因、監査AU-01）。
    // 特定の属性語ではなく「表示中の種類のプロフィール（名称: …）が出ること」を検証する。
    const name = (await page.locator("main h2").textContent())?.trim();
    expect(name).toBeTruthy();
    await page.getByRole("button", { name: "プロフィールを表示（答え合わせ）" }).click();
    await expect(page.locator("main section.card")).toContainText(`${name}: `);
    await expect(page.locator("main section.card")).toContainText("検定");
    await page.getByRole("button", { name: "覚えた", exact: true }).click();
    await expect(page.getByText("2 / 80種")).toBeVisible();
    await expect(page.getByText(/この周の「覚えた」: 1種/)).toBeVisible();
  });

  test("答え合わせしなくても次へ進める（UX10）", async ({ page }) => {
    await openHome(page);
    await page.getByRole("link", { name: "暗記を始める" }).click();
    await expect(page.getByText("1 / 80種")).toBeVisible();
    // 答え合わせも自己評価もしていない状態で「次へ」が使える
    await page.getByRole("button", { name: "次へ", exact: true }).click();
    await expect(page.getByText("2 / 80種")).toBeVisible();
    await expect(page.getByText(/この周の「覚えた」: 0種/)).toBeVisible();
    await expect(page.getByText(/評価済み（累計）: 0 \/ 80種/)).toBeVisible();
  });

  test("逆モード: 説明から名前を当てられる（UX10）", async ({ page }) => {
    await openHome(page);
    await page.getByRole("link", { name: "暗記を始める" }).click();
    await page.getByRole("button", { name: "プロフィール → 名前（逆）" }).click();
    // 表面は説明文で、名前（見出し）はまだ出ていない
    await expect(page.getByText("説明から名前を当てる")).toBeVisible();
    await expect(page.locator("main h2")).toHaveCount(0);
    await page.getByRole("button", { name: "名前を表示（答え合わせ）" }).click();
    await expect(page.locator("main h2")).toHaveCount(1);
    await page.getByRole("button", { name: "まだ", exact: true }).click();
    await expect(page.getByText("2 / 80種")).toBeVisible();
  });
});

test.describe("演習", () => {
  test("通常演習（検証済み）で1問に回答すると採点結果が見える", async ({ page }) => {
    await page.goto("#/practice");
    await expect(page.getByRole("heading", { name: "演習" })).toBeVisible();
    // FIX1（DECISIONS #34）: 既定モードは通常演習（検証済み）。先頭問題を決定的にするため登録順にする
    await expect(page.getByLabel("モード")).toHaveValue("verified");
    await page.getByLabel("出題順").selectOption("sequence");
    // 先頭の正式問題（一問一答）: 問題文が表示されるまで待つ
    await expect(
      page.getByRole("heading", {
        name: "スパイス&ハーブの定義の一例で、両者は何という植物の一部とされる?",
      }),
    ).toBeVisible();
    await page.getByLabel("回答入力").fill("芳香性植物");
    await page.getByRole("button", { name: "回答を確定する" }).click();
    await expect(page.getByText("正解（スコア 100%）")).toBeVisible();
    // UX12: 解説は詳細（details）の中に畳まれている。開いてから見える
    await expect(page.getByText(/解説:/)).toBeHidden();
    await page.getByText("解説・出典などの詳細を見る").click();
    await expect(page.getByText(/解説:/)).toBeVisible();
  });

  test("セッションは問題数で区切られ、確定の二重押しでも記録は1件だけ（監査C-02/C-03回帰）", async ({ page }) => {
    await page.goto("#/practice");
    await expect(page.getByRole("heading", { name: "演習" })).toBeVisible();
    await page.getByLabel("出題順").selectOption("sequence");
    await page.getByLabel("問題数（セッションの長さ）").fill("1");
    await page.getByRole("heading", { name: "演習" }).click(); // blur でセッション組み直し
    await expect(
      page.getByRole("heading", {
        name: "スパイス&ハーブの定義の一例で、両者は何という植物の一部とされる?",
      }),
    ).toBeVisible();
    await page.getByLabel("回答入力").fill("芳香性植物");
    await page.getByRole("button", { name: "回答を確定する" }).click();
    await expect(page.getByText("正解（スコア 100%）")).toBeVisible();
    // 確定後はボタンが無効化され、二重計上されない
    await expect(page.getByRole("button", { name: /確定済み/ })).toBeDisabled();
    await page.getByRole("button", { name: "セッションを終了する" }).click();
    await expect(page.getByText("セッション完了")).toBeVisible();
    await expect(page.getByText(/1 問に回答し、正解 1 問/)).toBeVisible();
    await page.goto("#/stats");
    await expect(page.getByText(/総解答数 1 ／/)).toBeVisible();
  });

  test("演習で次の問題へ進んでから前の問題へ戻れる（#52）", async ({ page }) => {
    await page.goto("#/practice");
    await expect(page.getByRole("heading", { name: "演習" })).toBeVisible();
    // 決定的な先頭問題（正式・一問一答）を使う。サンプルは全削除済み（#52）
    await page.getByLabel("出題順").selectOption("sequence");
    await expect(
      page.getByRole("heading", {
        name: "スパイス&ハーブの定義の一例で、両者は何という植物の一部とされる?",
      }),
    ).toBeVisible();
    await page.getByLabel("回答入力").fill("芳香性植物");
    await page.getByRole("button", { name: "回答を確定する" }).click();
    await expect(page.getByText("正解（スコア 100%）")).toBeVisible();
    // 先頭問題では「前の問題へ」は無効
    await expect(page.getByRole("button", { name: "前の問題へ" })).toBeDisabled();
    await page.getByRole("button", { name: "次の問題へ" }).click();
    await expect(page.getByRole("button", { name: "前の問題へ" })).toBeEnabled();
    await page.getByRole("button", { name: "前の問題へ" }).click();
    await expect(
      page.getByRole("heading", {
        name: "スパイス&ハーブの定義の一例で、両者は何という植物の一部とされる?",
      }),
    ).toBeVisible();
  });

  test("単語帳で次のカードへ進んでから前のカードへ戻れる（#52）", async ({ page }) => {
    await page.goto("#/cards");
    await expect(page.getByRole("heading", { name: "単語帳" })).toBeVisible();
    const card = page.getByLabel("カード反転");
    const firstFront = await card.textContent();
    await page.getByRole("button", { name: "次のカード" }).click();
    await expect(card).not.toHaveText(firstFront ?? "");
    await page.getByRole("button", { name: "前のカード" }).click();
    await expect(card).toHaveText(firstFront ?? "");
  });
});

test.describe("画面遷移とスクロール（UX11）", () => {
  test("電子書籍で下まで読んでも、他タブへ移ると一番上に戻る", async ({ page }) => {
    await page.goto("#/reader");
    await expect(page.getByRole("heading", { name: "電子書籍リーダー" })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 1500));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(400);
    await page.getByRole("link", { name: "演習", exact: true }).click();
    await expect(page.getByRole("heading", { name: "演習" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("黄色い説明ブロックはホームの末尾にある（UX11）", async ({ page }) => {
    await openHome(page);
    const badge = page.locator("main p.badge");
    await expect(badge).toHaveCount(1);
    // バッジは主要機能グリッドより後（=画面の下部）にある
    const gridBox = await page.locator("main section.grid").boundingBox();
    const badgeBox = await badge.boundingBox();
    expect(gridBox).not.toBeNull();
    expect(badgeBox).not.toBeNull();
    expect(badgeBox!.y).toBeGreaterThan(gridBox!.y);
  });
});

test.describe("改訂ポイントのページジャンプ（DECISIONS #51）", () => {
  test("p.106 のボタンを押すと、節の先頭ではなく p.106 に着地する", async ({ page }) => {
    await page.goto("#/revision");
    await expect(page.getByRole("heading", { name: "改訂ポイント（4訂版）" })).toBeVisible();
    await page.getByRole("button", { name: "4訂版 p.106 を読む" }).first().click();
    await expect(page.getByRole("heading", { name: "電子書籍リーダー" })).toBeVisible();
    const anchor = page.locator("#reader-pg-106");
    await expect(anchor).toBeAttached();
    // 着地: p.106 のマーカーがビューポート上部に来ている（節先頭 p.98 ではない）
    await expect
      .poll(async () => {
        const box = await anchor.boundingBox();
        return box ? Math.round(box.y) : 99999;
      })
      .toBeLessThan(500);
    const box = await anchor.boundingBox();
    expect(box!.y).toBeGreaterThan(-50);
  });

  test("p.71（タイム）のボタンは p.71 に着地する", async ({ page }) => {
    await page.goto("#/revision");
    await page.getByRole("button", { name: "4訂版 p.71 を読む" }).first().click();
    await expect(page.getByRole("heading", { name: "電子書籍リーダー" })).toBeVisible();
    const anchor = page.locator("#reader-pg-71");
    await expect(anchor).toBeAttached();
    await expect
      .poll(async () => {
        const box = await anchor.boundingBox();
        return box ? Math.round(box.y) : 99999;
      })
      .toBeLessThan(500);
  });
});

test.describe("プルダウンと絞り込みの配置（UX13）", () => {
  const docTop = async (loc: Locator) =>
    loc.evaluate((e) => (e as HTMLElement).getBoundingClientRect().top + window.scrollY);

  test("単語帳: プルダウンはカードの下にある", async ({ page }) => {
    await page.goto("#/cards");
    await expect(page.getByRole("heading", { name: "フラッシュカード・単語帳" })).toBeVisible();
    const cardTop = await docTop(page.getByRole("button", { name: "カード反転" }));
    const selTop = await docTop(page.getByLabel("種別"));
    expect(selTop).toBeGreaterThan(cardTop);
  });

  test("演習: 設定と絞り込みは問題の下にある", async ({ page }) => {
    await page.goto("#/practice");
    await expect(page.getByRole("heading", { name: "演習" })).toBeVisible();
    const qTop = await docTop(page.locator('[aria-label="問題"]'));
    const modeTop = await docTop(page.getByLabel("モード"));
    expect(modeTop).toBeGreaterThan(qTop);
  });

  test("検索: 絞り込み条件は検索結果の下にある", async ({ page }) => {
    await page.goto("#/search");
    await expect(page.getByRole("heading", { name: "絞り込み条件" })).toBeAttached();
    const resultTop = await docTop(page.getByRole("heading", { name: /問題 \d+件/ }));
    const filterTop = await docTop(page.getByRole("heading", { name: "絞り込み条件" }));
    expect(filterTop).toBeGreaterThan(resultTop);
  });
});

test.describe("フラッシュカード", () => {
  test("カードが表示され、クリックでめくれて、次のカードへ進める", async ({ page }) => {
    await page.goto("#/cards");
    await expect(
      page.getByRole("heading", { name: "フラッシュカード・単語帳" }),
    ).toBeVisible();
    // FIX1（DECISIONS #34）: 既定は全種別シャッフル開始のため、先頭カードは決定的でない。
    // 表→裏→次へ、の遷移そのものを固定する（カード同定には依存しない）。
    await expect(page.getByText(/対象カード 602 件（全 602 件）/)).toBeVisible();
    const card = page.getByRole("button", { name: "カード反転" });
    const front = (await card.textContent())?.trim();
    expect(front).toBeTruthy();
    await card.click();
    const back = (await card.textContent())?.trim();
    expect(back).toBeTruthy();
    expect(back).not.toBe(front);
    // 監査D-02是正: キーボード（Enter）でも反転できる（フォーカス可能＋キー操作）
    await card.focus();
    await page.keyboard.press("Enter");
    await expect(card).toHaveText(front!);
    await page.keyboard.press("Enter");
    await expect(card).toHaveText(back!);
    await page.getByRole("button", { name: "次のカード" }).click();
    const next = (await card.textContent())?.trim();
    expect(next).toBeTruthy();
    expect(next).not.toBe(back);
  });

  test("操作ボタンはカードの真下にある（UX10）", async ({ page }) => {
    await page.goto("#/cards");
    await expect(
      page.getByRole("heading", { name: "フラッシュカード・単語帳" }),
    ).toBeVisible();
    const card = page.getByRole("button", { name: "カード反転" });
    const cardBox = await card.boundingBox();
    const nextBox = await page.getByRole("button", { name: "次のカード" }).boundingBox();
    expect(cardBox).not.toBeNull();
    expect(nextBox).not.toBeNull();
    // 「次のカード」はカードの下端より下、かつ 160px 以内（=真下）
    expect(nextBox!.y).toBeGreaterThanOrEqual(cardBox!.y + cardBox!.height - 1);
    expect(nextBox!.y - (cardBox!.y + cardBox!.height)).toBeLessThan(160);
    // 裏面を表示すると自己評価ボタンも同じ真下の段に出る
    await page.getByRole("button", { name: "裏面を表示" }).click();
    const evalBox = await page.getByRole("button", { name: "分かった" }).boundingBox();
    expect(evalBox).not.toBeNull();
    const cardBox2 = await card.boundingBox();
    expect(evalBox!.y).toBeGreaterThanOrEqual(cardBox2!.y + cardBox2!.height - 1);
    expect(evalBox!.y - (cardBox2!.y + cardBox2!.height)).toBeLessThan(160);
  });

  test("種別フィルタで用語カードだけに絞り込める（FIX1）", async ({ page }) => {
    await page.goto("#/cards");
    await expect(
      page.getByRole("heading", { name: "フラッシュカード・単語帳" }),
    ).toBeVisible();
    await page.getByLabel("種別").selectOption("term");
    await expect(page.getByText(/対象カード 80 件/)).toBeVisible();
    await expect(page.getByText(/種別: 用語/)).toBeVisible();
    await page.getByLabel("種別").selectOption("reverse");
    await expect(page.getByText(/対象カード 63 件/)).toBeVisible();
    await expect(page.getByText(/種別: 逆引き/)).toBeVisible();
  });
});

test.describe("模擬試験", () => {
  test("設定画面から模試を開始し、未回答のまま終了すると一括採点され記録が保存される（FIX1）", async ({ page }) => {
    await page.goto("#/exam");
    await expect(page.getByRole("heading", { name: "模擬試験（練習用）" })).toBeVisible();
    await expect(page.getByText("出題候補（検証済み）: 1795問")).toBeVisible();
    await page.getByLabel("制限時間（分）").fill("1");
    await page.getByRole("button", { name: "開始（途中状態を保存）" }).click();
    // 出題中: 進捗と残り時間が見え、正解・解説は表示されない（制限時間1分=2問）
    await expect(page.getByText(/問題 1 \/ 2/)).toBeVisible();
    await expect(page.getByText(/残り時間/)).toBeVisible();
    await expect(page.getByText(/解説:/)).toHaveCount(0);
    await page.getByRole("button", { name: "終了して一括採点する" }).click();
    await expect(page.getByRole("heading", { name: "結果" })).toBeVisible();
    await expect(page.getByText(/正答率 0%（0 \/ 2 問正解/)).toBeVisible();
    // 全問分（2件）の解答記録が保存され、途中状態は消えている
    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem("spice-herb-master:v1");
      return raw ? (JSON.parse(raw) as { records: unknown[]; examDraft: unknown }) : null;
    });
    expect(stored?.records.length).toBe(2);
    expect(stored?.examDraft).toBeNull();
  });
});

test.describe("分析・検索・品質管理", () => {
  test("学習分析: 主要指標と網羅率が見える", async ({ page }) => {
    await page.goto("#/stats");
    await expect(page.getByRole("heading", { name: "学習分析・可視化" })).toBeVisible();
    // 新規プロファイル（履歴なし）では総解答 0 件・正答率は未測定が正しい表示
    await expect(page.getByText(/総解答数 0 ／ 正答率 未測定（算出不能）/)).toBeVisible();
    await expect(page.getByText("網羅率（5指標を分離表示）")).toBeVisible();
    await expect(page.getByText("1. 教科書の取り込み率")).toBeVisible();
    await expect(page.getByText(/139\/140画像/)).toBeVisible();
    await expect(
      page.getByText(/545件（原文照合済み 545件・未検証 0件・一問一答ドラフト付き 379件）/),
    ).toBeVisible();
  });

  test("横断検索: 件数が見え、キーワードで絞り込める", async ({ page }) => {
    await page.goto("#/search");
    await expect(page.getByRole("heading", { name: "横断検索" })).toBeVisible();
    // 初期状態は全件: 節 81 件・問題 1795 件（正式のみ。サンプルは全削除済み、#52）
    await expect(page.getByRole("heading", { name: "教材（節） 81件" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "問題 1795件" })).toBeVisible();
    await page.getByLabel("キーワード").fill("歴史");
    await expect(page.getByRole("heading", { name: "教材（節） 6件" })).toBeVisible();
    await expect(page.getByText("世界における歴史（p.6・転記済み）")).toBeVisible();
  });

  test("品質管理: 検証集計の主要指標が見える", async ({ page }) => {
    await page.goto("#/qa");
    await expect(
      page.getByRole("heading", { name: "品質管理（管理・監査）" }),
    ).toBeVisible();
    await expect(page.getByText(/重複候補: \d+組/)).toBeVisible();
    await expect(
      page.getByText(/取り込み済み知識単位: 545件（原文照合済み 545件・未検証 0件/),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "修正案JSONを出力" }),
    ).toBeVisible();
  });
});
