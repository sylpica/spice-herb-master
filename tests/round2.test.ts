// 第2ラウンド監査（2026-11-11、DECISIONS #55）の回帰テスト。
// 期待値は実装の出力を写さず、仕様（指令書・確定指示）から手で決めている。
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { moveItem } from "../src/components/QuestionRunner";
import { studyStreak, periodReport } from "../src/domain/streak";
import { buildLearningIndex, matchesLearningState, sortSearchQuestions } from "../src/domain/search";
import { sanitizeStore, defaultStore, type StoreData } from "../src/domain/store";
import { buildPracticePool, DEFAULT_PRACTICE_FILTERS } from "../src/domain/practice";
import { QUESTIONS } from "../src/data/questions";
import type { AnswerRecord } from "../src/domain/types";
import Home from "../src/screens/Home";
import SearchPage from "../src/screens/SearchPage";
import Exam from "../src/screens/Exam";
import Memorize from "../src/screens/Memorize";
import Stats from "../src/screens/Stats";

const rec = (questionId: string, correct: boolean | null, at: string): AnswerRecord => ({ questionId, answeredAt: at, correct, scoreRatio: correct ? 1 : 0, autoScoreRatio: correct ? 1 : 0, selfScoreRatio: null, responseMs: 1000 });
const local = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();
const render = (el: React.ReactElement) => renderToString(createElement(MemoryRouter, null, el));

describe("BV-02: 並べ替えの行の入れ替え（模試で「↓」を押すと項目が消える不具合の回帰）", () => {
  it("下へ動かすと隣と入れ替わり、項目は増減しない", () => {
    expect(moveItem(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
  });
  it("上へ動かすと隣と入れ替わる", () => {
    expect(moveItem(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
  });
  it("端を越える移動は何も変えず、元の配列も書き換えない", () => {
    const src = ["a", "b", "c"];
    expect(moveItem(src, 0, -1)).toEqual(["a", "b", "c"]);
    expect(moveItem(src, 2, 1)).toEqual(["a", "b", "c"]);
    expect(src).toEqual(["a", "b", "c"]);
  });
  it("何度動かしても元の項目の並べ替えになっている", () => {
    let cur = ["1", "2", "3", "4", "5"];
    for (const [i, d] of [[0, 1], [1, 1], [4, -1], [2, -1], [3, 1]] as [number, -1 | 1][]) cur = moveItem(cur, i, d);
    expect([...cur].sort()).toEqual(["1", "2", "3", "4", "5"]);
  });
});

describe("R29: 連続学習日数と期間レポート", () => {
  const now = new Date(2026, 10, 11, 20); // 2026-11-11 20:00（端末ローカル）
  it("記録がなければ0日", () => { expect(studyStreak([], now)).toBe(0); });
  it("今日・昨日・一昨日に解いていれば3日", () => {
    expect(studyStreak([rec("a", true, local(2026, 11, 9)), rec("a", true, local(2026, 11, 10)), rec("a", false, local(2026, 11, 11))], now)).toBe(3);
  });
  it("今日まだ解いていなくても、昨日までの連続は途切れない", () => {
    expect(studyStreak([rec("a", true, local(2026, 11, 9)), rec("a", true, local(2026, 11, 10))], now)).toBe(2);
  });
  it("1日空くと、そこで途切れる", () => {
    expect(studyStreak([rec("a", true, local(2026, 11, 8)), rec("a", true, local(2026, 11, 10)), rec("a", true, local(2026, 11, 11))], now)).toBe(2);
    expect(studyStreak([rec("a", true, local(2026, 11, 8))], now)).toBe(0);
  });
  it("同じ日に何問解いても1日として数える", () => {
    expect(studyStreak([rec("a", true, local(2026, 11, 11, 8)), rec("b", true, local(2026, 11, 11, 9))], now)).toBe(1);
  });
  it("直近7日のレポートは今日を含む7日間だけを数える", () => {
    const rs = [rec("a", true, local(2026, 11, 4)), rec("a", true, local(2026, 11, 5)), rec("b", false, local(2026, 11, 11)), rec("c", true, local(2026, 11, 11))];
    const r = periodReport(rs, 7, now);
    expect(r.answered).toBe(3); // 11/5・11/11×2（11/4 は8日前で対象外）
    expect(r.correct).toBe(2);
    expect(r.accuracy).toBeCloseTo(2 / 3);
    expect(r.activeDays).toBe(2);
    expect(periodReport([], 7, now).accuracy).toBeNull();
  });
});

describe("R28: 学習状況での検索の絞り込みと並べ替え", () => {
  const records = [
    rec("q-wrong", true, local(2026, 11, 1)), rec("q-wrong", false, local(2026, 11, 2)),
    rec("q-weak", false, local(2026, 11, 1)), rec("q-weak", false, local(2026, 11, 2)), rec("q-weak", true, local(2026, 11, 3)),
    rec("q-master", false, local(2026, 11, 1)), rec("q-master", true, local(2026, 11, 2)), rec("q-master", true, local(2026, 11, 3)),
    rec("q-once", true, local(2026, 11, 1)),
  ];
  const index = buildLearningIndex(records, ["q-fav", "q-once"]);
  const ids = ["q-wrong", "q-weak", "q-master", "q-once", "q-fav", "q-new"];
  const pick = (state: Parameters<typeof matchesLearningState>[0]) => ids.filter((id) => matchesLearningState(state, id, index));
  it("未回答: 一度も解いていない問題だけ", () => { expect(pick("unanswered")).toEqual(["q-fav", "q-new"]); });
  it("直近が不正解: 最後の回答が不正解の問題だけ（過去に間違えて最後は正解した問題は含めない）", () => { expect(pick("wrong")).toEqual(["q-wrong"]); });
  it("苦手: 2回以上解いて正答率50%未満（1回だけの問題・ちょうど50%は含めない）", () => { expect(pick("weak")).toEqual(["q-weak"]); });
  it("習得済み: 直近2回が連続正解（1回正解しただけでは含めない）", () => { expect(pick("mastered")).toEqual(["q-master"]); });
  it("ブックマーク: ブックマーク済みの問題だけ", () => { expect(pick("favorites")).toEqual(["q-once", "q-fav"]); });
  it("すべて: 絞り込まない", () => { expect(pick("all")).toEqual(ids); });
  it("正答率が低い順: 未回答は末尾、同率は元の順を保つ", () => {
    const qs = ids.map((id, i) => ({ id, difficulty: (i % 4) + 1 }));
    // 正答率: q-weak 1/3、q-wrong 1/2、q-master 2/3、q-once 1/1、未回答は末尾
    expect(sortSearchQuestions(qs, "accuracy-asc", index).map((q) => q.id)).toEqual(["q-weak", "q-wrong", "q-master", "q-once", "q-fav", "q-new"]);
    expect(sortSearchQuestions(qs, "difficulty-desc", index).map((q) => q.difficulty)).toEqual([4, 3, 2, 2, 1, 1]);
    expect(sortSearchQuestions(qs, "default", index).map((q) => q.id)).toEqual(ids);
  });
  it("検索画面に学習状況と並び順の条件があり、問題は一度に20件だけ描画される", () => {
    const html = render(createElement(SearchPage, { store: structuredClone(defaultStore) }));
    expect(html).toContain('aria-label="学習状況"');
    expect(html).toContain("習得済み（2回連続正解）");
    expect(html).toContain('aria-label="並び順"');
    expect(html).toContain("正答率が低い順");
    expect((html.match(/演習で開く/g) ?? []).length).toBe(20);
    expect(html).toContain("さらに表示");
    // 内部の状態名は画面に出さない
    expect(html).not.toContain("/verified]");
  });
});

describe("保存データ: 追加した項目は旧データでも既定値で読める", () => {
  it("旧形式（追加項目なし）を読むと空の既定値になり、既存の記録は保たれる", () => {
    const old = { records: [rec("a", true, local(2026, 11, 1))], srs: {}, favorites: ["a"], goalPerDay: 20, reader: { sectionId: "x", fontSize: 18, dark: true, bookmarks: [], highlights: {}, notes: {} }, examDraft: null };
    const d = sanitizeStore(old);
    expect(d.records).toHaveLength(1);
    expect(d.favorites).toEqual(["a"]);
    expect(d.goalPerDay).toBe(20);
    expect(d.cardFavorites).toEqual([]);
    expect(d.reports).toEqual([]);
    expect(d.excluded).toEqual([]);
  });
  it("壊れた値は捨て、正しい値だけを残す", () => {
    const d = sanitizeStore({ cardFavorites: ["card-a", 3], excluded: "x", reports: [{ questionId: "q", note: "誤字", at: "2026-11-11T00:00:00.000Z" }, { questionId: 1 }] });
    expect(d.cardFavorites).toEqual(["card-a"]);
    expect(d.excluded).toEqual([]);
    expect(d.reports).toEqual([{ questionId: "q", note: "誤字", at: "2026-11-11T00:00:00.000Z" }]);
  });
});

describe("全アプリ共通UIルール（2026-11-03 追記）: 説明・注記は主要操作より後ろ", () => {
  const store: StoreData = structuredClone(defaultStore);
  const update = () => {};
  const before = (html: string, a: string, b: string) => { const i = html.indexOf(a), j = html.indexOf(b); expect(i, a).toBeGreaterThanOrEqual(0); expect(j, b).toBeGreaterThanOrEqual(0); expect(i, `${a} は ${b} より前`).toBeLessThan(j); };
  it("ホーム: 主要機能のタイルが先、収録状況の説明は末尾。説明文つきのカードは置かない", () => {
    const html = render(createElement(Home, { store, update }));
    before(html, "とりあえず5問", "教材の収録状況");
    before(html, "学習進捗", "教材の収録状況");
    expect(html).not.toContain("設定なしで、正式問題からランダムに5問だけ出題します");
    expect(html).toContain("146"); // 原本画像は実際の収録数（旧表示は139）
    expect(html).not.toContain("139");
  });
  it("模試: 開始ボタンが先、注意書きは後ろ", () => {
    const html = render(createElement(Exam, { store, update }));
    before(html, "開始</button>", "独自の練習用試験です");
  });
  it("暗記: カードと前へ・次へが先、使い方の説明は後ろ", () => {
    const html = render(createElement(Memorize, { store, update }));
    before(html, "次へ</button>", "思い出してから答え合わせ");
    before(html, "プロフィール → 名前（逆）", "思い出してから答え合わせ");
  });
  it("学習分析: 記録がないときは空の表見出しを出さず、収録数は実数を表示する", () => {
    const html = render(createElement(Stats, { store }));
    expect(html).not.toContain("章別");
    expect(html).toContain("連続学習");
    expect(html).toContain("記述の要点達成");
    expect(html).not.toContain("139/140");
  });
});

describe("R18: 利用者が除外した問題は演習の出題対象から外れる", () => {
  it("除外IDを取り除いたプールには、その問題が含まれない", () => {
    const excluded = [QUESTIONS[0]!.id, QUESTIONS[5]!.id];
    const pool = buildPracticePool(QUESTIONS.filter((q) => !excluded.includes(q.id)), DEFAULT_PRACTICE_FILTERS, { records: [], srs: {}, favorites: [] });
    expect(pool).toHaveLength(QUESTIONS.length - 2);
    for (const id of excluded) expect(pool.some((q) => q.id === id)).toBe(false);
  });
});
