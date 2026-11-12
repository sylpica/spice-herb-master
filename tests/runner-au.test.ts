// @vitest-environment jsdom
// Claude Code 独立監査（2026-11-03、DECISIONS #54）の回帰固定:
// AU-02 確定済み回答の復元、AU-03 正誤直下の正答表示、AU-07 対応付けの候補順、
// AU-08 自動進行設定の保存、AU-09 集計の索引化（旧実装と同じ結果）。
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import QuestionRunner, { correctAnswerOf } from "../src/components/QuestionRunner";
import { gradeQuestion, matchingOptions } from "../src/domain/grading";
import { sanitizeStore, defaultStore } from "../src/domain/store";
import { computeCoverage, computeStats } from "../src/domain/stats";
import { QUESTIONS } from "../src/data/questions";
import type { AnswerRecord, Question } from "../src/domain/types";

const byId = new Map(QUESTIONS.map((q) => [q.id, q]));
const firstOf = (format: Question["format"]) => QUESTIONS.find((q) => q.format === format)!;

describe("AU-03: 全形式で正答（記述系は模範解答）を返す", () => {
  it("正式15形式すべてで正答が得られ、選択式は正解の選択肢そのもの", () => {
    const formats = [...new Set(QUESTIONS.map((q) => q.format))];
    expect(formats).toHaveLength(15);
    for (const f of formats) {
      const q = firstOf(f);
      const ca = correctAnswerOf(q);
      expect(ca, f).not.toBeNull();
      expect(ca!.lines.join("").length, f).toBeGreaterThan(0);
    }
    const sc = firstOf("single-choice");
    expect(correctAnswerOf(sc)!.lines[0]).toBe(sc.choices![sc.correctChoiceIndexes![0]!]);
    expect(correctAnswerOf(firstOf("short-essay"))!.label).toBe("模範解答");
    const tf = firstOf("true-false");
    expect(correctAnswerOf(tf)!.lines[0]).toBe(tf.correctBoolean ? "○ 正しい" : "× 誤り");
  });
  it("誤答して確定した表示では、正誤のすぐ後に正答が出て、詳細（解説・出典）は畳まれている", () => {
    const q = firstOf("single-choice");
    const wrong = [(q.correctChoiceIndexes![0]! + 1) % 4];
    const html = renderToString(createElement(QuestionRunner, { q, saved: { answer: wrong, result: gradeQuestion(q, wrong), selfRatio: null } }));
    const iVerdict = html.indexOf("不正解");
    const iAnswer = html.indexOf('class="model-answer"');
    const iDetails = html.indexOf("<details");
    expect(iVerdict).toBeGreaterThan(0);
    expect(iAnswer).toBeGreaterThan(iVerdict);
    expect(iDetails).toBeGreaterThan(iAnswer);
    expect(html).toContain(q.choices![q.correctChoiceIndexes![0]!]!);
    expect(html).not.toContain("模範解答（サンプル）");
  });
  it("未回答の問題には正答も模範解答も出ない（漏れ防止）", () => {
    for (const f of ["single-choice", "one-answer", "short-essay", "matching"] as const) {
      const q = firstOf(f);
      const html = renderToString(createElement(QuestionRunner, { q }));
      expect(html, f).not.toContain("model-answer");
      expect(html, f).not.toContain("模範解答");
      expect(html, f).not.toContain("<details");
    }
  });
});

describe("AU-02: 確定済み回答の復元", () => {
  it("復元した問題は確定済み（再確定不可）で、入力値と採点結果がそのまま表示される", () => {
    const q = firstOf("one-answer");
    const ans = q.acceptedAnswers![0]!;
    const html = renderToString(createElement(QuestionRunner, { q, saved: { answer: ans, result: gradeQuestion(q, ans), selfRatio: null } }));
    expect(html).toContain("確定済み");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>確定済み/);
    expect(html).toContain(`value="${ans}"`);
    expect(html).toContain("正解");
  });
});

describe("AU-07: 対応付けの候補は正解ペアの順に並ばない", () => {
  it("全対応付け問題で候補は照合順で、正解ペア順と一致する問題が「上から順に選ぶだけで全問正解」にならない", () => {
    const ms = QUESTIONS.filter((q) => q.format === "matching");
    expect(ms.length).toBeGreaterThan(40);
    let diagonalSolvable = 0;
    for (const q of ms) {
      const opts = matchingOptions(q);
      expect([...opts].sort((a, b) => a.localeCompare(b, "ja"))).toEqual(opts);
      expect(new Set(opts)).toEqual(new Set(q.matchingPairs!.map((p) => p.right)));
      const diagonal = Object.fromEntries(q.matchingPairs!.map((p, i) => [p.left, opts[i]!]));
      if (gradeQuestion(q, diagonal).correct) diagonalSolvable++;
    }
    // 照合順がたまたま正解順と一致する問題は残りうるが、全問がそうなることはない（修正前は全問）
    expect(diagonalSolvable).toBeLessThan(ms.length / 2);
  });
});

describe("AU-08: 自動進行の設定", () => {
  it("既定はオフ（手動進行）で、真偽値だけを保存データから復元する", () => {
    expect(defaultStore.autoAdvance).toBe(false);
    expect(sanitizeStore({ autoAdvance: true }).autoAdvance).toBe(true);
    expect(sanitizeStore({ autoAdvance: "yes" }).autoAdvance).toBe(false);
    expect(sanitizeStore({}).autoAdvance).toBe(false);
  });
});

describe("AU-09: 集計の索引化は旧実装（線形探索）と同じ結果", () => {
  it("ランダムな学習履歴で、章・形式・難易度別集計と習得率が一致する", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const records: AnswerRecord[] = Array.from({ length: 3000 }, (_, i) => ({
      questionId: rnd() < 0.05 ? `gone-${i}` : QUESTIONS[Math.floor(rnd() * 200)]!.id,
      answeredAt: new Date(2026, 0, 1, 0, i).toISOString(),
      correct: rnd() < 0.7, scoreRatio: null, autoScoreRatio: null, selfScoreRatio: null, responseMs: null,
    }));
    const naiveBy = (key: (q: Question) => string) => {
      const m = new Map<string, { total: number; correct: number }>();
      for (const r of records) { const q = QUESTIONS.find((x) => x.id === r.questionId); if (!q) continue; const k = key(q); const e = m.get(k) ?? { total: 0, correct: 0 }; e.total++; if (r.correct === true) e.correct++; m.set(k, e); }
      return m;
    };
    const st = computeStats(records, QUESTIONS);
    expect(st.byChapter).toEqual(naiveBy((q) => q.chapterId));
    expect(st.byFormat).toEqual(naiveBy((q) => q.format));
    expect(st.byDifficulty).toEqual(naiveBy((q) => String(q.difficulty)));
    const naiveMastered = QUESTIONS.filter((q) => { const rs = records.filter((r) => r.questionId === q.id); return rs.length >= 2 && rs.slice(-2).every((r) => r.correct === true); }).length;
    const cov = computeCoverage({ presentImages: 146, expectedImages: 147, units: [], totalSections: 81, questions: QUESTIONS, records });
    expect(cov.masteredRatio).toBeCloseTo(naiveMastered / QUESTIONS.length, 12);
    expect(byId.size).toBe(QUESTIONS.length);
  });
});
