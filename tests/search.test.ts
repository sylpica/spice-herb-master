import { describe, it, expect } from "vitest";
import { ALL_SECTIONS } from "../src/data/structure";
import { TRANSCRIPT_SECTION_TEXT } from "../src/data/transcripts";
import { QUESTIONS } from "../src/data/questions";
import {
  DEFAULT_SEARCH_FILTERS,
  SEARCH_DIFFICULTIES,
  availableSearchFormats,
  availableSearchStatuses,
  availableTranscriptionStatuses,
  filterSearchResults,
  hasActiveSearchFilters,
  keywordExcerpt,
  type SearchFilters,
} from "../src/domain/search";

// 横断検索の複合フィルタ（フェーズ7・バッチS1 = DECISIONS #31、
// バッチS2で章・形式の複数選択と節・状態・転記状態を追加 = DECISIONS #33）。
// 実測の固定値（2026-10-30、サンプル削除で 2026-10-31 更新）: 節81件（序章5・第一章26・第二章39・第三章6・検定情報5）、
// 検索対象の問題は正式1,804問のみ（サンプル問題は全削除済み、DECISIONS #52）。
// 問題には SearchPage と同じく所属節の転記状態を付与して検索プールにする。
const SECTION_BY_ID = new Map(ALL_SECTIONS.map((s) => [s.id, s]));
const POOL = [...QUESTIONS].map((q) => ({
  ...q,
  sectionTranscriptionStatus: SECTION_BY_ID.get(q.sectionId)?.transcriptionStatus,
}));
// 本番（SearchPage）と同じく、節には転記本文を付与してキーワード検索の対象にする（監査C-15）
const SEARCHABLE_SECTIONS = ALL_SECTIONS.map((s) => ({
  ...s,
  bodyText: TRANSCRIPT_SECTION_TEXT.get(s.id) ?? "",
}));
const run = (filters: SearchFilters) => filterSearchResults(SEARCHABLE_SECTIONS, POOL, filters);
const withFilters = (patch: Partial<SearchFilters>): SearchFilters => ({
  ...DEFAULT_SEARCH_FILTERS,
  ...patch,
});

describe("横断検索フィルタ: 既定（後方互換）", () => {
  it("条件なしでは従来どおり全件（節81件・問題1732件・合計1813件）", () => {
    const r = run(DEFAULT_SEARCH_FILTERS);
    expect(r.sections).toHaveLength(81);
    expect(r.questions).toHaveLength(1732);
    expect(r.total).toBe(1813);
    expect(hasActiveSearchFilters(DEFAULT_SEARCH_FILTERS)).toBe(false);
  });

  it("キーワードのマッチ仕様（節はタイトルまたは転記本文・問題は問題文）", () => {
    const r = run(withFilters({ keyword: "歴史" }));
    expect(r.sections).toHaveLength(6); // タイトル一致2件＋本文一致4件（監査C-15で本文を対象化）
    expect(r.questions).toHaveLength(4);
    const narrower = run(withFilters({ keyword: "世界における歴史" }));
    expect(narrower.sections).toHaveLength(2); // タイトル一致1件＋本文で言及する1件
    expect(narrower.questions).toHaveLength(0);
  });

  it("C-15: 本文にだけ現れる語でも節がヒットし、抜粋が作れる", () => {
    // 「ゲオルギー」はパプリカの節の本文（スザント・ゲオルギー博士）にだけ現れ、
    // どの節のタイトル・問題文にも現れない
    const r = run(withFilters({ keyword: "ゲオルギー" }));
    expect(r.sections.map((s) => s.id)).toEqual(["item-paprika"]);
    expect(r.questions).toHaveLength(0);
    const excerpt = keywordExcerpt(r.sections[0]!.bodyText ?? "", "ゲオルギー");
    expect(excerpt).toContain("ゲオルギー");
    expect(keywordExcerpt("本文テキスト", "存在しない語")).toBeNull();
    expect(keywordExcerpt("短い本文", "本文")).toBe("短い本文"); // 切り取りなしなら「…」は付かない
  });

  it("該当しないキーワードでは節・問題とも0件の空状態になる", () => {
    const r = run(withFilters({ keyword: "存在しない語句zzz999" }));
    expect(r.sections).toHaveLength(0);
    expect(r.questions).toHaveLength(0);
    expect(r.total).toBe(0);
  });

  it("形式の選択肢は正式問題に実在する15形式（定義順）", () => {
    expect(availableSearchFormats(QUESTIONS)).toEqual([
      "single-choice",
      "multiple-choice",
      "true-false",
      "fill-blank",
      "term-input",
      "one-answer",
      "short-essay",
      "long-essay",
      "compare-essay",
      "ordering",
      "matching",
      "reverse-lookup",
      "figure",
      "table-fill",
      "composite",
    ]);
    // サンプル削除後はプール（=正式のみ）でも同じ15形式で、サンプル限定の2形式は返らない（#52）
    expect(availableSearchFormats(POOL)).toHaveLength(15);
    expect(availableSearchFormats(POOL)).not.toContain("photo-id");
    expect(availableSearchFormats(POOL)).not.toContain("flashcard");
  });

  it("難易度の選択肢は実分布の1〜4のみで、各値に問題が実在し、5は存在しない", () => {
    expect(SEARCH_DIFFICULTIES).toEqual([1, 2, 3, 4]);
    for (const d of SEARCH_DIFFICULTIES) {
      expect(POOL.some((q) => q.difficulty === d)).toBe(true);
    }
    expect(POOL.some((q) => q.difficulty === 5)).toBe(false);
  });
});

describe("横断検索フィルタ: 単独条件", () => {
  it("検索対象の種別: 節のみでは問題0件、問題のみでは節0件", () => {
    const secsOnly = run(withFilters({ target: "sections" }));
    expect(secsOnly.sections).toHaveLength(81);
    expect(secsOnly.questions).toHaveLength(0);
    const qsOnly = run(withFilters({ target: "questions" }));
    expect(qsOnly.sections).toHaveLength(0);
    expect(qsOnly.questions).toHaveLength(1732);
  });

  it("章（単一選択相当）: 節と問題の双方に適用される（序章=節5件・問題169件、第二章=節39件・問題1263件、検定情報=節5件・問題7件）", () => {
    const preface = run(withFilters({ chapterIds: ["preface"] }));
    expect(preface.sections).toHaveLength(5);
    expect(preface.questions).toHaveLength(169);
    expect(preface.sections.every((s) => s.chapterId === "preface")).toBe(true);
    expect(preface.questions.every((q) => q.chapterId === "preface")).toBe(true);

    const ch2 = run(withFilters({ chapterIds: ["ch2"] }));
    expect(ch2.sections).toHaveLength(39);
    expect(ch2.questions).toHaveLength(1263);

    // 検定情報の問題は正式7問のみ（サンプル17問は 2026-10-31 に全削除、#52。q4-e-org は監査BV-13で四択をやめた、#55）
    const appendix = run(withFilters({ chapterIds: ["appendix"] }));
    expect(appendix.sections).toHaveLength(5);
    expect(appendix.questions).toHaveLength(7);
  });

  it("問題形式（単一選択相当）: 指定すると節は対象外になり、問題はその形式だけになる（四択399件）", () => {
    const r = run(withFilters({ formats: ["single-choice"] }));
    expect(r.sections).toHaveLength(0);
    expect(r.questions).toHaveLength(399);
    expect(r.questions.every((q) => q.format === "single-choice")).toBe(true);
    const one = run(withFilters({ formats: ["one-answer"] }));
    expect(one.questions).toHaveLength(465);
  });

  it("難易度: 指定すると節は対象外になり、実分布どおりに絞られる（1=697件・2=456件・3=409件・4=170件）", () => {
    const expected: Array<[1 | 2 | 3 | 4, number]> = [
      [1, 697], // 正式のみ（サンプルは全削除済み、#52）
      [2, 456], // 較正済み469＋据え置き8を含む正式のみ
      [3, 409],
      [4, 170],
    ];
    for (const [d, count] of expected) {
      const r = run(withFilters({ difficulty: d }));
      expect(r.sections).toHaveLength(0);
      expect(r.questions).toHaveLength(count);
      expect(r.questions.every((q) => q.difficulty === d)).toBe(true);
    }
    // 難易度別の合計が全問題数と一致する（取りこぼしがない）
    expect(expected.reduce((a, [, c]) => a + c, 0)).toBe(1732);
  });
});

describe("横断検索フィルタ: AND組み合わせと解除", () => {
  it("条件を重ねると結果は単調に絞られ、最終的に1件になる", () => {
    const steps: SearchFilters[] = [
      DEFAULT_SEARCH_FILTERS,
      withFilters({ keyword: "歴史" }),
      withFilters({ keyword: "歴史", chapterIds: ["preface"] }),
      withFilters({ keyword: "歴史", chapterIds: ["preface"], formats: ["one-answer"] }),
      withFilters({
        keyword: "歴史",
        chapterIds: ["preface"],
        formats: ["one-answer"],
        difficulty: 1,
      }),
    ];
    const totals = steps.map((f) => run(f).total);
    // 実測: 全件1813 → キーワード10 → ＋序章4 → ＋一問一答1 → ＋難易度1は不変1
    expect(totals).toEqual([1813, 10, 4, 1, 1]);
    for (let i = 1; i < totals.length; i++) {
      expect(totals[i]!).toBeLessThanOrEqual(totals[i - 1]!);
    }
    const final = run(steps[steps.length - 1]!);
    expect(final.questions.map((q) => q.id)).toEqual(["q1-j-kojiki"]);
    expect(final.sections).toHaveLength(0);
  });

  it("矛盾する条件の組み合わせは0件になる（キーワード「歴史」＋難易度2）", () => {
    // 「歴史」を含む問題4件は全て難易度1のため、難易度2との AND は空になる
    const r = run(withFilters({ keyword: "歴史", difficulty: 2 }));
    expect(r.total).toBe(0);
  });

  it("種別と章の組み合わせ: 問題のみ＋第二章では節0件・問題1263件", () => {
    const r = run(withFilters({ target: "questions", chapterIds: ["ch2"] }));
    expect(r.sections).toHaveLength(0);
    expect(r.questions).toHaveLength(1263);
  });

  it("条件を個別に解除すると、その分だけ結果が戻る", () => {
    const full = withFilters({
      keyword: "歴史",
      chapterIds: ["preface"],
      formats: ["one-answer"],
    });
    expect(run(full).total).toBe(1);
    // 形式だけを解除 → 節2件・問題2件に戻る
    const noFormat = run({ ...full, formats: [] });
    expect(noFormat.sections).toHaveLength(2);
    expect(noFormat.questions).toHaveLength(2);
    // 章だけを解除（形式は維持）→ 問題2件（二つの一問一答）に戻る
    const noChapter = run({ ...full, chapterIds: [] });
    expect(noChapter.sections).toHaveLength(0);
    expect(noChapter.questions).toHaveLength(2);
    // キーワードだけを解除（章・形式は維持）→ 序章の一問一答だけが残る
    const noKeyword = run({ ...full, keyword: "" });
    expect(noKeyword.total).toBeGreaterThan(1);
    expect(
      noKeyword.questions.every(
        (q) => q.chapterId === "preface" && q.format === "one-answer",
      ),
    ).toBe(true);
  });

  it("全解除（既定値に戻す）と結果が全件に復帰する", () => {
    const filtered = run(
      withFilters({
        keyword: "歴史",
        chapterIds: ["ch2"],
        formats: ["single-choice"],
        difficulty: 1,
      }),
    );
    expect(filtered.total).toBe(1);
    const cleared = run(DEFAULT_SEARCH_FILTERS);
    expect(cleared.sections).toHaveLength(81);
    expect(cleared.questions).toHaveLength(1732);
    expect(cleared.total).toBe(1813);
  });
});

describe("横断検索フィルタ: 複数選択（次元内 OR、S2）", () => {
  it("章の複数選択は OR で合算され、単一選択の結果を含む（序章＋第二章=節44件・問題1432件）", () => {
    const single = run(withFilters({ chapterIds: ["preface"] }));
    const both = run(withFilters({ chapterIds: ["preface", "ch2"] }));
    expect(both.sections).toHaveLength(44);
    expect(both.questions).toHaveLength(1432);
    // 単一選択の結果は複数選択の結果に含まれる（次元内では単調に広がる）
    const bothSectionIds = new Set(both.sections.map((s) => s.id));
    const bothQuestionIds = new Set(both.questions.map((q) => q.id));
    expect(single.sections.every((s) => bothSectionIds.has(s.id))).toBe(true);
    expect(single.questions.every((q) => bothQuestionIds.has(q.id))).toBe(true);
    expect(
      both.questions.every((q) => q.chapterId === "preface" || q.chapterId === "ch2"),
    ).toBe(true);
  });

  it("章を全て選択すると条件なしと一致する（節81件・問題1732件）", () => {
    const all = run(
      withFilters({ chapterIds: ["preface", "ch1", "ch2", "ch3", "appendix"] }),
    );
    expect(all.sections).toHaveLength(81);
    expect(all.questions).toHaveLength(1732);
    expect(all.total).toBe(1813);
  });

  it("形式の複数選択は OR で合算される（一問一答465＋四択399=864件）", () => {
    const one = run(withFilters({ formats: ["one-answer"] }));
    const both = run(withFilters({ formats: ["one-answer", "single-choice"] }));
    expect(both.sections).toHaveLength(0);
    expect(both.questions).toHaveLength(864);
    const bothIds = new Set(both.questions.map((q) => q.id));
    expect(one.questions.every((q) => bothIds.has(q.id))).toBe(true);
    expect(
      both.questions.every(
        (q) => q.format === "one-answer" || q.format === "single-choice",
      ),
    ).toBe(true);
  });

  it("正式15形式を全て選択すると全問題が対象になる（1732件、サンプル限定形式は存在しない）", () => {
    const all15 = run(
      withFilters({
        formats: [
          "single-choice",
          "multiple-choice",
          "true-false",
          "fill-blank",
          "term-input",
          "one-answer",
          "short-essay",
          "long-essay",
          "compare-essay",
          "ordering",
          "matching",
          "reverse-lookup",
          "figure",
          "table-fill",
          "composite",
        ],
      }),
    );
    expect(all15.questions).toHaveLength(1732);
    expect(all15.questions.some((q) => q.format === "photo-id")).toBe(false);
    expect(all15.questions.some((q) => q.format === "flashcard")).toBe(false);
  });

  it("次元内 OR の拡大と次元間 AND の縮小が同時に成り立つ（91件→308件→595件、難易度を足すと縮小）", () => {
    const base = run(withFilters({ chapterIds: ["preface"], formats: ["one-answer"] }));
    expect(base.questions).toHaveLength(91);
    // 章を1つ足す（次元内 OR）→ 広がる
    const widerChapter = run(
      withFilters({ chapterIds: ["preface", "ch2"], formats: ["one-answer"] }),
    );
    expect(widerChapter.questions).toHaveLength(308);
    // 形式を1つ足す（次元内 OR）→ さらに広がる
    const widerFormat = run(
      withFilters({
        chapterIds: ["preface", "ch2"],
        formats: ["one-answer", "single-choice"],
      }),
    );
    expect(widerFormat.questions).toHaveLength(595);
    const baseIds = new Set(base.questions.map((q) => q.id));
    const widerChapterIds = new Set(widerChapter.questions.map((q) => q.id));
    const widerFormatIds = new Set(widerFormat.questions.map((q) => q.id));
    expect([...baseIds].every((id) => widerChapterIds.has(id))).toBe(true);
    expect([...widerChapterIds].every((id) => widerFormatIds.has(id))).toBe(true);
    // 別の次元の条件（難易度）を足す（次元間 AND）→ 縮小するか不変
    const narrower = run(
      withFilters({
        chapterIds: ["preface", "ch2"],
        formats: ["one-answer", "single-choice"],
        difficulty: 1,
      }),
    );
    expect(narrower.questions.length).toBeLessThanOrEqual(widerFormat.questions.length);
    expect(narrower.questions.every((q) => widerFormatIds.has(q.id))).toBe(true);
    expect(narrower.questions.every((q) => q.difficulty === 1)).toBe(true);
  });

  it("複数選択の値を1つだけ外す（個別解除）と、その値の分だけ結果が戻る", () => {
    const both = withFilters({ chapterIds: ["preface", "ch2"] });
    const oneRemoved = run({ ...both, chapterIds: ["preface"] });
    expect(oneRemoved.sections).toHaveLength(5);
    expect(oneRemoved.questions).toHaveLength(169);
    const formats = withFilters({ formats: ["one-answer", "single-choice"] });
    const formatRemoved = run({ ...formats, formats: ["one-answer"] });
    expect(formatRemoved.questions).toHaveLength(465);
    // 空配列に戻せば無条件（全件）と一致する
    expect(run({ ...both, chapterIds: [] }).total).toBe(1813);
    expect(run({ ...formats, formats: [] }).total).toBe(1813);
  });
});

describe("横断検索フィルタ: 節・状態・転記状態（S2）", () => {
  it("節: その節自身と、その節に属する問題だけになる（世界における歴史=節1件・問題67件）", () => {
    const r = run(withFilters({ sectionId: "history-world" }));
    expect(r.sections.map((s) => s.id)).toEqual(["history-world"]);
    expect(r.questions).toHaveLength(67);
    expect(r.questions.every((q) => q.sectionId === "history-world")).toBe(true);
    // 問題が0件の節では、節だけが残る
    const empty = run(withFilters({ sectionId: "season-soy" }));
    expect(empty.sections).toHaveLength(1);
    expect(empty.questions).toHaveLength(0);
  });

  it("節とキーワードの AND: 節タイトルが一致しても、その節の問題文に語がなければ問題は0件", () => {
    // 実測: 「歴史」を問題文に含む4問は history-world 節には属さない
    const r = run(withFilters({ sectionId: "history-world", keyword: "歴史" }));
    expect(r.sections).toHaveLength(1);
    expect(r.questions).toHaveLength(0);
  });

  it("節と章の矛盾（序章の節＋第二章だけ選択）は0件になる", () => {
    const r = run(withFilters({ sectionId: "history-world", chapterIds: ["ch2"] }));
    expect(r.sections).toHaveLength(0);
    expect(r.questions).toHaveLength(0);
    expect(r.total).toBe(0);
  });

  it("状態の選択肢はプールに実在する正式のみで、実在しない状態は出ない", () => {
    expect(availableSearchStatuses(POOL)).toEqual(["verified"]);
  });

  it("状態: 指定すると節は対象外になり、問題はその状態だけになる（正式1732件・サンプルは0件）", () => {
    const verified = run(withFilters({ status: "verified" }));
    expect(verified.sections).toHaveLength(0);
    expect(verified.questions).toHaveLength(1732);
    expect(verified.questions.every((q) => q.status === "verified")).toBe(true);
    // サンプル問題は全削除済みで、状態の選択肢にも「サンプル」は存在しない（#52、AU-10）
    expect(availableSearchStatuses(POOL)).toEqual(["verified"]);
    const unverified = run(withFilters({ status: "unverified" }));
    expect(unverified.questions).toHaveLength(0);
    // 状態と難易度の AND: 正式の難易度1は697件
    const v1 = run(withFilters({ status: "verified", difficulty: 1 }));
    expect(v1.questions).toHaveLength(697);
  });

  it("転記状態の選択肢は節データに実在する転記済み・未処理のみ", () => {
    expect(availableTranscriptionStatuses(ALL_SECTIONS)).toEqual(["転記済み"]);
  });

  it("転記状態: 節には直接、問題には所属節の転記状態で適用される（転記済み=節81件・問題1732件、未処理=節0件・問題0件）", () => {
    // UX4（DECISIONS #39）で world-drink・season-soy が転記済みになり、さらに T18 で
    // index が転記済みになったため、全81節が転記済みで未処理は0件になった。
    const done = run(withFilters({ transcriptionStatus: "転記済み" }));
    expect(done.sections).toHaveLength(81);
    expect(done.sections.every((s) => s.transcriptionStatus === "転記済み")).toBe(true);
    expect(done.questions).toHaveLength(1732);
    expect(
      done.questions.every((q) => q.sectionTranscriptionStatus === "転記済み"),
    ).toBe(true);
    const pending = run(withFilters({ transcriptionStatus: "未処理" }));
    expect(pending.sections).toHaveLength(0);
    expect(pending.questions).toHaveLength(0);
    // 節との AND: 転記済み＋index はその節だけ（索引節には問題がないため問題は0件）、
    // 未処理＋index は0件（T18で index も転記済みになったため）
    const withSection = run(
      withFilters({ transcriptionStatus: "転記済み", sectionId: "index" }),
    );
    expect(withSection.sections).toHaveLength(1);
    expect(withSection.questions).toHaveLength(0);
    expect(
      run(withFilters({ transcriptionStatus: "未処理", sectionId: "index" }))
        .total,
    ).toBe(0);
    expect(
      run(withFilters({ transcriptionStatus: "未処理", sectionId: "world-drink" }))
        .total,
    ).toBe(0);
    expect(
      run(withFilters({ transcriptionStatus: "未処理", sectionId: "item-pepper" }))
        .total,
    ).toBe(0);
  });

  it("転記状態と問題固有条件の組み合わせ: 形式を指定すると節は対象外のまま、問題は所属節の転記状態で絞られる", () => {
    // 未処理＋一問一答: 未処理の節が存在しないため0件になる
    const r = run(
      withFilters({ transcriptionStatus: "未処理", formats: ["one-answer"] }),
    );
    expect(r.sections).toHaveLength(0);
    expect(r.questions).toHaveLength(0);
    // 対照: 転記済み＋一問一答では、転記済み節の一問一答だけが残る
    const done = run(
      withFilters({ transcriptionStatus: "転記済み", formats: ["one-answer"] }),
    );
    expect(done.questions.length).toBeGreaterThan(0);
    expect(
      done.questions.every((q) => q.sectionTranscriptionStatus === "転記済み"),
    ).toBe(true);
  });

  it("S2の各条件も有効な条件として数えられる（hasActiveSearchFilters）", () => {
    expect(hasActiveSearchFilters(withFilters({ chapterIds: ["ch1"] }))).toBe(true);
    expect(hasActiveSearchFilters(withFilters({ chapterIds: [] }))).toBe(false);
    expect(hasActiveSearchFilters(withFilters({ formats: ["one-answer"] }))).toBe(true);
    expect(hasActiveSearchFilters(withFilters({ formats: [] }))).toBe(false);
    expect(hasActiveSearchFilters(withFilters({ sectionId: "history-world" }))).toBe(
      true,
    );
    expect(hasActiveSearchFilters(withFilters({ status: "excluded" }))).toBe(true);
    expect(hasActiveSearchFilters(withFilters({ transcriptionStatus: "未処理" }))).toBe(
      true,
    );
  });
});
