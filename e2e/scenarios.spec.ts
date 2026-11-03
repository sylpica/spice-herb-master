import { expect, test, type Page } from "@playwright/test";

/**
 * シナリオ拡充 E2E（フェーズ7・バッチE3、docs/DECISIONS.md #30）。
 * E2 のスモーク（e2e/smoke.spec.ts / pwa.spec.ts）に追加する形で、
 * 学習状態の保存・復元、SRS・復習フロー、横断検索の絞り込みの段階変化、
 * エラー・空状態を扱う。セレクタ方針（意味的指定・固定 sleep なし）は E2 と同じ。
 *
 * 実測した前提（アプリ側の実装）:
 * - 学習状態は localStorage の単一キー "spice-herb-master:v1" に保存される
 *   （src/domain/store.ts。records / srs / favorites / reader 等を含む JSON）。
 * - SRS は演習の採点時に更新される（src/screens/Practice.tsx が reviewSrs を呼ぶ）。
 *   フラッシュカード画面の自己評価UIはバッチC1（DECISIONS #32）で実装され、
 *   本ファイル末尾の「フラッシュカードの自己評価（C1）」で検証する（E3 時点では未実装だった）。
 * - 横断検索（src/screens/SearchPage.tsx）の絞り込みは、E3 時点ではキーワード
 *   入力のみだったためキーワードの段階的な絞り込みと条件解除だけを固定した。
 *   複合フィルタ（対象・章・形式・難易度）はバッチS1（DECISIONS #31）で実装され、
 *   本ファイルの「横断検索の複合フィルタ（S1）」で検証する。バッチS2
 *   （DECISIONS #33）で章・形式が複数選択（チェックボックス）になり、節・
 *   問題の状態・転記状態の条件が加わったため、S1 の操作はチェックボックスに
 *   置き換え、追加分は「横断検索の拡張フィルタ（S2）」で検証する。
 * - 修正バッチFIX1（DECISIONS #34）で演習の既定モードが検証済みになり、出題順
 *   （シャッフル=既定／登録順）が加わった。決定的な先頭問題を使うテストは
 *   出題順=登録順を選んでから操作する。サンプル問題は 2026-10-31 に全削除済み（#52）。
 *   カード画面も既定が全種別シャッフル開始になったため、登録順の並びに依存する
 *   テストは並び=登録順へ切り替える。模試は実働化され、出題・一括採点・記録
 *   保存は e2e/smoke.spec.ts の模試テストで検証する。
 */

const STORE_KEY = "spice-herb-master:v1";

interface StoredState {
  records: Array<{ questionId: string; correct: boolean | null }>;
  srs: Record<
    string,
    {
      itemId: string;
      repetitions: number;
      intervalDays: number;
      dueAt: string;
      lastReviewedAt: string | null;
    }
  >;
  reader: { sectionId: string; bookmarks: string[] };
}

async function readStore(page: Page): Promise<StoredState | null> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as StoredState) : null;
  }, STORE_KEY);
}

/** 検証済み演習の先頭問題（一問一答）に正解する。E2 スモークと同じ決定的な問題を使う。 */
async function answerFirstVerifiedQuestionCorrectly(page: Page) {
  await page.goto("#/practice");
  await expect(page.getByRole("heading", { name: "演習" })).toBeVisible();
  // FIX1: 既定モードは検証済み。出題順を登録順にして決定的な先頭問題を使う
  await expect(page.getByLabel("モード")).toHaveValue("verified");
  await page.getByLabel("出題順").selectOption("sequence");
  await expect(
    page.getByRole("heading", {
      name: "スパイス&ハーブの定義の一例で、両者は何という植物の一部とされる?",
    }),
  ).toBeVisible();
  await page.getByLabel("回答入力").fill("芳香性植物");
  await page.getByRole("button", { name: "回答を確定する" }).click();
  await expect(page.getByText("正解（スコア 100%）")).toBeVisible();
}

test.describe("学習状態の保存・復元", () => {
  test("演習の解答記録が再読み込み後も保持され、学習分析に反映される", async ({ page }) => {
    await answerFirstVerifiedQuestionCorrectly(page);

    // 保存先（localStorage）に記録が1件、正解として残っていることを実測で確認する
    await expect
      .poll(async () => (await readStore(page))?.records.length ?? 0)
      .toBe(1);
    const stored = await readStore(page);
    expect(stored?.records[0]?.correct).toBe(true);

    // 再読み込みしても記録は消えない（App の初期化が localStorage から復元する）
    await page.reload();
    await expect(page.getByRole("heading", { name: "演習" })).toBeVisible();
    await page.goto("#/stats");
    await expect(page.getByRole("heading", { name: "学習分析・可視化" })).toBeVisible();
    await expect(page.getByText(/総解答数 1 ／ 正答率 100%/)).toBeVisible();

    // ホームの学習進捗にも復元された記録が反映される
    await page.goto("");
    await expect(page.getByText(/総解答 1 ／ 正答率 100%/)).toBeVisible();
  });

  test("リーダーの読書位置としおりが再読み込み後も保持される", async ({ page }) => {
    await page.goto("#/reader");
    await expect(page.getByRole("heading", { name: "電子書籍リーダー" })).toBeVisible();
    await page.getByRole("button", { name: "日本における歴史（p.10）" }).click();
    await expect(page.getByText(/書籍 p\.10 ／ 転記状態: 転記済み/)).toBeVisible();
    await page.getByRole("button", { name: "しおり", exact: true }).click();

    await expect
      .poll(async () => {
        const s = await readStore(page);
        return s ? `${s.reader.sectionId}|${s.reader.bookmarks.join(",")}` : "";
      })
      .toBe("history-japan|history-japan");

    await page.reload();
    await expect(page.getByRole("heading", { name: "電子書籍リーダー" })).toBeVisible();
    // 読書位置（p.10 の節）が復元され、しおり一覧にも残る
    await expect(page.getByText(/書籍 p\.10 ／ 転記状態: 転記済み/)).toBeVisible();
    await expect(page.getByText(/しおり: history-japan/)).toBeVisible();
  });
});

test.describe("SRS・復習フロー", () => {
  test("演習で正解するとSRS状態が作られ、期限は翌日で直ちに期限到来にはならない", async ({
    page,
  }) => {
    await answerFirstVerifiedQuestionCorrectly(page);

    // SM-2（src/domain/srs.ts）: 初回正解は repetitions=1・intervalDays=1・dueAt は約1日後
    await expect
      .poll(async () => {
        const s = await readStore(page);
        const entries = s ? Object.values(s.srs) : [];
        return entries.length === 1
          ? `${entries[0]!.repetitions}/${entries[0]!.intervalDays}`
          : `entries=${entries.length}`;
      })
      .toBe("1/1");
    const stored = await readStore(page);
    const entry = Object.values(stored!.srs)[0]!;
    expect(entry.lastReviewedAt).not.toBeNull();
    const spanMs = new Date(entry.dueAt).getTime() - new Date(entry.lastReviewedAt!).getTime();
    // setDate(+1日) のため、ほぼ24時間（暦日境界の丸めを許容して 23〜25 時間で判定する）
    expect(spanMs).toBeGreaterThanOrEqual(23 * 3_600_000);
    expect(spanMs).toBeLessThanOrEqual(25 * 3_600_000);

    // 期限は翌日なので、学習分析の「期限到来」は 0 件のまま（再読み込み後も同じ）
    await page.goto("#/stats");
    await expect(page.getByText("0件が期限到来")).toBeVisible();
    await page.reload();
    await expect(page.getByText("0件が期限到来")).toBeVisible();
  });

  test("期限到来のSRSをストレージに用意すると分析とホームで数えられ、未来期限は数えられない", async ({
    page,
  }) => {
    // 日付依存を避けるため、実在する問題IDで「遠い過去が期限」と「遠い未来が期限」の
    // SRS状態を localStorage に直接用意する決定的な方法を採る（時刻モックは使わない）。
    const seed = {
      records: [],
      srs: {
        "q1-b-def": {
          itemId: "q1-b-def",
          easeFactor: 2.5,
          intervalDays: 1,
          repetitions: 1,
          dueAt: "2000-01-01T00:00:00.000Z",
          lastReviewedAt: "1999-12-31T00:00:00.000Z",
        },
        "q4-b-def": {
          itemId: "q4-b-def",
          easeFactor: 2.5,
          intervalDays: 1,
          repetitions: 1,
          dueAt: "2999-01-01T00:00:00.000Z",
          lastReviewedAt: "2000-01-01T00:00:00.000Z",
        },
      },
      favorites: [],
      goalPerDay: 10,
      reader: { sectionId: "", fontSize: 16, dark: false, bookmarks: [], highlights: {}, notes: {} },
      examDraft: null,
    };
    await page.addInitScript(
      ({ key, value }) => {
        localStorage.setItem(key, value);
      },
      { key: STORE_KEY, value: JSON.stringify(seed) },
    );

    await page.goto("#/stats");
    await expect(page.getByRole("heading", { name: "学習分析・可視化" })).toBeVisible();
    // 過去期限の1件だけが期限到来として数えられる
    await expect(page.getByText("1件が期限到来")).toBeVisible();

    await page.goto("");
    await expect(
      page.getByRole("heading", { name: "スパイス＆ハーブ検定1級 学習アプリ" }),
    ).toBeVisible();
    await expect(page.getByText(/復習予定: 1件/)).toBeVisible();
  });
});

test.describe("横断検索の絞り込み", () => {
  test("キーワードを段階的に具体化すると節・問題とも絞られ、条件解除で全件に戻る", async ({
    page,
  }) => {
    await page.goto("#/search");
    await expect(page.getByRole("heading", { name: "横断検索" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "教材（節） 81件" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "問題 1795件" })).toBeVisible();

    // 単独キーワード: 節と問題の両方が同時に絞られる（横断検索の実態）
    await page.getByLabel("キーワード").fill("歴史");
    await expect(page.getByRole("heading", { name: "教材（節） 6件" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "問題 4件" })).toBeVisible();

    // キーワードを具体化すると、単独条件よりさらに絞られる
    await page.getByLabel("キーワード").fill("世界における歴史");
    await expect(page.getByRole("heading", { name: "教材（節） 2件" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "問題 0件" })).toBeVisible();
    await expect(page.getByText("世界における歴史（p.6・転記済み）")).toBeVisible();

    // 条件を解除すると全件表示に戻る
    await page.getByLabel("キーワード").fill("");
    await expect(page.getByRole("heading", { name: "教材（節） 81件" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "問題 1795件" })).toBeVisible();
  });

  test("該当しないキーワードでは節・問題とも0件の空状態になる", async ({ page }) => {
    await page.goto("#/search");
    await expect(page.getByRole("heading", { name: "横断検索" })).toBeVisible();
    await page.getByLabel("キーワード").fill("存在しない語句zzz999");
    await expect(page.getByRole("heading", { name: "教材（節） 0件" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "問題 0件" })).toBeVisible();
  });
});

test.describe("横断検索の複合フィルタ（S1）", () => {
  test("キーワード＋章＋形式・難易度で絞られ、個別解除で戻り、全解除で全件に復帰する", async ({
    page,
  }) => {
    await page.goto("#/search");
    await expect(page.getByRole("heading", { name: "横断検索" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "教材（節） 81件" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "問題 1795件" })).toBeVisible();
    await expect(page.getByText(/検索結果 合計 1876件/)).toBeVisible();

    // キーワード単独: 節6件（タイトル2＋本文4）・問題4件
    await page.getByLabel("キーワード").fill("歴史");
    await expect(page.getByRole("heading", { name: "教材（節） 6件" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "問題 4件" })).toBeVisible();
    await expect(page.getByText(/検索結果 合計 10件/)).toBeVisible();

    // ＋章（序章）: 節は序章の2件のまま、問題は序章の2件に絞られる
    await page.getByLabel("序章", { exact: true }).check();
    await expect(page.getByRole("heading", { name: "教材（節） 2件" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "問題 2件" })).toBeVisible();
    await expect(page.getByText(/検索結果 合計 4件/)).toBeVisible();

    // ＋問題形式（一問一答）: 形式は問題固有の条件のため節は対象外になり、問題1件に絞られる
    await page.getByLabel("一問一答", { exact: true }).check();
    await expect(page.getByRole("heading", { name: "教材（節） 0件" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "問題 1件" })).toBeVisible();
    await expect(page.getByText(/検索結果 合計 1件/)).toBeVisible();
    await expect(
      page.getByText(/712年に編纂され、「はじかみ」やにんにくが登場する歴史書は\?/),
    ).toBeVisible();

    // 形式だけを個別解除すると、キーワード＋章の結果（節2件・問題2件）に戻る
    await page.getByRole("button", { name: "形式: 一問一答 ×" }).click();
    await expect(page.getByRole("heading", { name: "教材（節） 2件" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "問題 2件" })).toBeVisible();

    // 形式を戻して難易度2を重ねると、該当問題（難易度1のみ）が消えて0件の空状態になる
    await page.getByLabel("一問一答", { exact: true }).check();
    await page.getByLabel("難易度").selectOption("2");
    await expect(page.getByRole("heading", { name: "教材（節） 0件" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "問題 0件" })).toBeVisible();
    await expect(page.getByText("該当する教材（節）はありません。")).toBeVisible();
    await expect(page.getByText("該当する問題はありません。")).toBeVisible();

    // 難易度だけを個別解除すると問題1件に戻る
    await page.getByRole("button", { name: "難易度: 2 ×" }).click();
    await expect(page.getByRole("heading", { name: "問題 1件" })).toBeVisible();

    // すべての条件を解除すると全件表示に復帰し、入力値も初期状態に戻る
    await page.getByRole("button", { name: "すべての条件を解除" }).click();
    await expect(page.getByRole("heading", { name: "教材（節） 81件" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "問題 1795件" })).toBeVisible();
    await expect(page.getByText(/検索結果 合計 1876件/)).toBeVisible();
    await expect(page.getByLabel("キーワード")).toHaveValue("");
    await expect(page.getByLabel("序章", { exact: true })).not.toBeChecked();
    await expect(page.getByLabel("一問一答", { exact: true })).not.toBeChecked();
  });

  test("検索対象の種別で節のみ・問題のみに切り替えられる", async ({ page }) => {
    await page.goto("#/search");
    await expect(page.getByRole("heading", { name: "横断検索" })).toBeVisible();
    await page.getByLabel("検索対象").selectOption("sections");
    await expect(page.getByRole("heading", { name: "教材（節） 81件" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "問題 0件" })).toBeVisible();
    await page.getByLabel("検索対象").selectOption("questions");
    await expect(page.getByRole("heading", { name: "教材（節） 0件" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "問題 1795件" })).toBeVisible();
    await page.getByRole("button", { name: "対象: 問題のみ ×" }).click();
    await expect(page.getByRole("heading", { name: "教材（節） 81件" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "問題 1795件" })).toBeVisible();
  });
});

test.describe("横断検索の拡張フィルタ（S2）", () => {
  test("章・形式の複数選択（OR）で結果が広がり、チップの個別解除でその値だけ戻る", async ({
    page,
  }) => {
    await page.goto("#/search");
    await expect(page.getByRole("heading", { name: "横断検索" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "教材（節） 81件" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "問題 1795件" })).toBeVisible();

    // 章を1つ選択: 序章だけに絞られる
    await page.getByLabel("序章", { exact: true }).check();
    await expect(page.getByRole("heading", { name: "教材（節） 5件" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "問題 181件" })).toBeVisible();
    await expect(page.getByText(/検索結果 合計 186件/)).toBeVisible();

    // 章をもう1つ足す（次元内 OR）: 第二章との合算に単調に広がる
    await page.getByLabel("第二章", { exact: true }).check();
    await expect(page.getByRole("heading", { name: "教材（節） 44件" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "問題 1469件" })).toBeVisible();
    await expect(page.getByText(/検索結果 合計 1513件/)).toBeVisible();

    // 形式（一問一答）を重ねる（次元間 AND）: 2章の一問一答308件に絞られ、節は対象外になる
    await page.getByLabel("一問一答", { exact: true }).check();
    await expect(page.getByRole("heading", { name: "教材（節） 0件" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "問題 308件" })).toBeVisible();

    // 第二章のチップだけを個別解除すると、序章の一問一答91件に戻る
    await page.getByRole("button", { name: "章: 第二章 ×" }).click();
    await expect(page.getByRole("heading", { name: "問題 91件" })).toBeVisible();
    await expect(page.getByText(/検索結果 合計 91件/)).toBeVisible();

    // 形式のチップを個別解除すると、序章のみの結果（節5件・問題181件）に戻る
    await page.getByRole("button", { name: "形式: 一問一答 ×" }).click();
    await expect(page.getByRole("heading", { name: "教材（節） 5件" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "問題 181件" })).toBeVisible();

    // 序章のチェックを外すと全件に復帰する
    await page.getByLabel("序章", { exact: true }).uncheck();
    await expect(page.getByRole("heading", { name: "教材（節） 81件" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "問題 1795件" })).toBeVisible();
    await expect(page.getByText(/検索結果 合計 1876件/)).toBeVisible();
  });

  test("節・問題の状態・転記状態で絞り込め、解除で全件に戻る", async ({ page }) => {
    await page.goto("#/search");
    await expect(page.getByRole("heading", { name: "横断検索" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "教材（節） 81件" })).toBeVisible();

    // 節（世界における歴史）: その節自身と所属する問題67件だけになる
    await page.getByLabel("節").selectOption("history-world");
    await expect(page.getByRole("heading", { name: "教材（節） 1件" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "問題 67件" })).toBeVisible();
    await expect(page.getByText(/検索結果 合計 68件/)).toBeVisible();
    await expect(page.getByText("世界における歴史（p.6・転記済み）")).toBeVisible();

    // 節のチップで個別解除すると全件に戻る
    await page.getByRole("button", { name: "節: 世界における歴史 ×" }).click();
    await expect(page.getByRole("heading", { name: "教材（節） 81件" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "問題 1795件" })).toBeVisible();

    // 問題の状態（正式）: サンプル削除後は正式のみが選択肢にあり、問題固有の条件のため節は対象外になる
    await page.getByLabel("問題の状態").selectOption("verified");
    await expect(page.getByRole("heading", { name: "教材（節） 0件" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "問題 1795件" })).toBeVisible();

    // 状態のチップで個別解除すると全件に戻る
    await page.getByRole("button", { name: "状態: 正式 ×" }).click();
    await expect(page.getByRole("heading", { name: "教材（節） 81件" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "問題 1795件" })).toBeVisible();

    // 転記状態（転記済み）: T18 で全81節が転記済みになったため、選択肢は「転記済み」のみで
    // 絞り込んでも全件のまま（未処理の節は存在しない）
    await page.getByLabel("転記状態").selectOption("転記済み");
    await expect(page.getByRole("heading", { name: "教材（節） 81件" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "問題 1795件" })).toBeVisible();
    await expect(page.getByText(/検索結果 合計 1876件/)).toBeVisible();

    // すべての条件を解除すると全件表示と入力初期値に復帰する
    await page.getByRole("button", { name: "すべての条件を解除" }).click();
    await expect(page.getByRole("heading", { name: "教材（節） 81件" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "問題 1795件" })).toBeVisible();
    await expect(page.getByText(/検索結果 合計 1876件/)).toBeVisible();
    await expect(page.getByLabel("転記状態")).toHaveValue("");
  });
});

test.describe("エラー・空状態（実装の実態どおり）", () => {
  test("一問一答を空回答で確定すると「空回答」として不正解になる", async ({ page }) => {
    await page.goto("#/practice");
    await expect(page.getByRole("heading", { name: "演習" })).toBeVisible();
    await page.getByLabel("出題順").selectOption("sequence");
    await expect(
      page.getByRole("heading", {
        name: "スパイス&ハーブの定義の一例で、両者は何という植物の一部とされる?",
      }),
    ).toBeVisible();
    // 入力せずに確定する。ガードでブロックはされず、採点エンジンが「空回答」を返す
    await page.getByRole("button", { name: "回答を確定する" }).click();
    await expect(page.getByText("不正解（スコア 0%）")).toBeVisible();
    await expect(page.getByText("空回答", { exact: true })).toBeVisible();
  });

  test("選択式を未選択で確定すると不正解（スコア0%）として採点される", async ({ page }) => {
    await page.goto("#/practice");
    await expect(page.getByRole("heading", { name: "演習" })).toBeVisible();
    // 正式問題の四択だけに絞る（サンプルは全削除済み、#52）。未選択のまま確定してもブロックされず 0% で採点される実態を固定する
    await page.getByRole("checkbox", { name: "四択" }).check();
    await page.getByLabel("出題順").selectOption("sequence");
    await expect(page.getByRole("group", { name: "選択肢" })).toBeVisible();
    await page.getByRole("button", { name: "回答を確定する" }).click();
    await expect(page.getByText("不正解（スコア 0%）")).toBeVisible();
    // UX12: 解説は詳細（details）の中。開いてから見える
    await page.getByText("解説・出典などの詳細を見る").click();
    await expect(page.getByText(/解説:/)).toBeVisible();
  });
});

test.describe("フラッシュカードの自己評価（C1）", () => {
  test("裏面表示後に自己評価でき、『分かった』でカードのSRSが作られ次のカードへ進む", async ({
    page,
  }) => {
    await page.goto("#/cards");
    await expect(
      page.getByRole("heading", { name: "フラッシュカード・単語帳" }),
    ).toBeVisible();
    // FIX1: 既定はシャッフル開始のため先頭カードは決定的でない。遷移とSRSの効果だけを固定する
    const card = page.getByRole("button", { name: "カード反転" });
    const front = (await card.textContent())?.trim();
    expect(front).toBeTruthy();
    // 評価ボタンは裏面を表示するまで出ない（DECISIONS #32: 反転後にのみ自己評価できる）
    await expect(page.getByRole("button", { name: "分かった" })).toBeHidden();
    await expect(page.getByText("このカードの状態: 未評価")).toBeVisible();

    await card.click();
    const back = (await card.textContent())?.trim();
    expect(back).toBeTruthy();
    expect(back).not.toBe(front);
    await expect(page.getByRole("button", { name: "分かった" })).toBeVisible();
    await page.getByRole("button", { name: "分かった" }).click();

    // 評価すると自動で次のカードへ進み、表面に戻る
    await expect.poll(async () => (await card.textContent())?.trim()).not.toBe(back);

    // SRS はカードID（card- 接頭辞）をキーに1件だけ作られ、解答記録は増えない
    await expect
      .poll(async () => {
        const s = await readStore(page);
        if (!s) return "no-store";
        const keys = Object.keys(s.srs);
        if (keys.length !== 1) return `entries=${keys.length}`;
        const e = s.srs[keys[0]!]!;
        return `${keys[0]!.startsWith("card-")}/${e.repetitions}/${e.intervalDays}/records=${s.records.length}`;
      })
      .toBe("true/1/1/records=0");
    const stored = await readStore(page);
    const entry = Object.values(stored!.srs)[0]!;
    expect(entry.lastReviewedAt).not.toBeNull();
    const spanMs = new Date(entry.dueAt).getTime() - new Date(entry.lastReviewedAt!).getTime();
    expect(spanMs).toBeGreaterThanOrEqual(23 * 3_600_000);
    expect(spanMs).toBeLessThanOrEqual(25 * 3_600_000);
  });

  test("評価は再読み込み後も保持されて状態表示に出て、『分からない』は repetitions=0 になる", async ({
    page,
  }) => {
    await page.goto("#/cards");
    await expect(
      page.getByRole("heading", { name: "フラッシュカード・単語帳" }),
    ).toBeVisible();
    // FIX1: 並びを登録順にして、評価対象のカードを決定的にする
    await page.getByLabel("並び").selectOption("sequence");
    const card = page.getByRole("button", { name: "カード反転" });
    // 1枚目を「分からない」、2枚目を「分かった」で評価する
    await card.click();
    await page.getByRole("button", { name: "分からない" }).click();
    await card.click();
    await page.getByRole("button", { name: "分かった" }).click();

    await expect
      .poll(async () => {
        const s = await readStore(page);
        if (!s) return "no-store";
        const reps = Object.values(s.srs)
          .map((e) => e.repetitions)
          .sort()
          .join(",");
        return `${Object.keys(s.srs).length}/${reps}`;
      })
      .toBe("2/0,1");
    await expect(page.getByText(/評価済み 2 \/ 全 602 件/)).toBeVisible();

    // 再読み込み後、登録順の1枚目に戻ると保持された評価が状態表示に出る（1枚目は repetitions=0）
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "フラッシュカード・単語帳" }),
    ).toBeVisible();
    await page.getByLabel("並び").selectOption("sequence");
    await expect(page.getByText(/このカードの状態: 評価済み（復習 0 回/)).toBeVisible();

    // 期限は翌日のため、学習分析の「期限到来」は 0 件のまま（カードのSRSも同じ集計に載る）
    await page.goto("#/stats");
    await expect(page.getByText("0件が期限到来")).toBeVisible();
  });
});
