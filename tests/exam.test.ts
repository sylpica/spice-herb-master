import { describe, it, expect } from "vitest";
import { QUESTIONS } from "../src/data/questions";
import { EXAM_EXCLUDED_FORMATS, EXAM_MAX_QUESTIONS, buildExam, examPool, examQuestionCount, gradeExam } from "../src/domain/exam";
import { gradeQuestion } from "../src/domain/grading";
import type { Question } from "../src/domain/types";

// 修正バッチFIX1（DECISIONS #34）: 模擬試験の純粋ロジック。
// 対象は verified 正式問題から記述系4形式を除いたプールで、問題数は制限時間×2問（上限100）。
describe("模擬試験（FIX1、DECISIONS #34）: domain/exam", () => {
  it("対象プールは verified のみで、記述系4形式を含まない（実測1,704問）", () => {
    const pool = examPool(QUESTIONS);
    expect(pool.length).toBe(1704);
    for (const q of pool) {
      expect(q.status, q.id).toBe("verified");
      expect(EXAM_EXCLUDED_FORMATS, q.id).not.toContain(q.format);
    }
    const excluded = QUESTIONS.filter((q) => q.status === "verified" && EXAM_EXCLUDED_FORMATS.includes(q.format));
    expect(excluded.length).toBe(91); // short-essay 12 + long-essay 4 + compare-essay 7 + composite 68
  });

  it("問題数は制限時間×2問・上限100問・プール件数で決まる", () => {
    expect(examQuestionCount(1, 1728)).toBe(2);
    expect(examQuestionCount(10, 1728)).toBe(20);
    expect(examQuestionCount(50, 1728)).toBe(100);
    expect(examQuestionCount(60, 1728)).toBe(EXAM_MAX_QUESTIONS);
    expect(examQuestionCount(60, 30)).toBe(30);
    expect(examQuestionCount(10, 0)).toBe(0);
  });

  it("buildExam は決定的で、対象プールからのみ抽出する", () => {
    const a = buildExam(QUESTIONS, 10, "seed-1");
    const b = buildExam(QUESTIONS, 10, "seed-1");
    expect(a.map((q) => q.id)).toEqual(b.map((q) => q.id));
    expect(a.length).toBe(20);
    const poolIds = new Set(examPool(QUESTIONS).map((q) => q.id));
    for (const q of a) expect(poolIds.has(q.id), q.id).toBe(true);
    expect(new Set(a.map((q) => q.id)).size).toBe(a.length); // 重複なし
    const c = buildExam(QUESTIONS, 10, "seed-2");
    expect(c.map((q) => q.id)).not.toEqual(a.map((q) => q.id)); // シードが違えば並びも変わる
    expect(buildExam(QUESTIONS, 1, "seed-1").length).toBe(2);
  });

  it("gradeExam は gradeQuestion を一括適用し、未回答を不正解（未回答）として集計する", () => {
    const qs = buildExam(QUESTIONS, 5, "grade-seed"); // 10問
    expect(qs.length).toBe(10);
    // 全問未回答
    const none = gradeExam(qs, {});
    expect(none.total).toBe(10);
    expect(none.answeredCount).toBe(0);
    expect(none.correctCount).toBe(0);
    expect(none.accuracy).toBe(0);
    expect(none.wrongItems.length).toBe(10);
    for (const item of none.items) {
      expect(item.answered).toBe(false);
      expect(item.result.correct).toBe(false);
      expect(item.result.scoreRatio).toBe(0);
      expect(item.result.note).toBe("未回答");
    }
    // 先頭1問だけ正解の回答を作る（形式ごとの正答エンコーディングは gradeQuestion の仕様に従う）
    const first = qs[0]!;
    const correctAnswer = (q: Question): unknown => {
      if (q.choices) return q.correctChoiceIndexes;
      if (q.format === "true-false") return q.correctBoolean;
      if (q.acceptedAnswers?.length) return q.acceptedAnswers[0];
      if (q.format === "ordering") return q.correctOrder;
      if (q.format === "matching") return Object.fromEntries((q.matchingPairs ?? []).map((p) => [p.left, p.right]));
      if (q.format === "table-fill") return { ...(q.blankCellAnswers ?? {}) };
      return "";
    };
    const ans = correctAnswer(first);
    expect(gradeQuestion(first, ans).correct).toBe(true); // 前提: 作った回答が本当に正解であること
    const one = gradeExam(qs, { [first.id]: ans });
    expect(one.answeredCount).toBe(1);
    expect(one.correctCount).toBe(1);
    expect(one.accuracy).toBeCloseTo(0.1);
    expect(one.wrongItems.length).toBe(9);
    expect(one.items[0]!.result.correct).toBe(true);
  });
});
