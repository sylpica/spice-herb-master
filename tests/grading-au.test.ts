// Claude Code 独立監査（2026-11-03、DECISIONS #54）で追加した採点の境界ケース。
// 採点エンジンの単体テストはテスト内で定義した独立フィクスチャで完結させる
// （本番データにサンプルを再導入しない。DECISIONS #52）。末尾の実データ確認は
// 実在する正式問題で、修正対象の症状（順序違いの列挙が不正解になる）が解消したことを固定する。
import { describe, it, expect } from "vitest";
import { gradeQuestion, gradeTextAnswer, gradeChoice, gradeEssayRubric, gradeMatching, gradeOrdering, asksForEnumeration } from "../src/domain/grading";
import { QUESTIONS } from "../src/data/questions";
import type { Question } from "../src/domain/types";

const base = { version: 1, status: "verified" as const, chapterId: "appendix", sectionId: "exam-about", difficulty: 1 as const, knowledgeUnitIds: [] as string[], sourceRefs: [] as Question["sourceRefs"], explanation: "" };
const enumQ: Question = { ...base, id: "fx-enum", format: "one-answer", prompt: "検証用の列挙を3つ挙げよ。", acceptedAnswers: ["アルファ・ベータ・ガンマ"] };
const properNounQ: Question = { ...base, id: "fx-proper", format: "one-answer", prompt: "検証用の人物は?", acceptedAnswers: ["バスコ・ダ・ガマ"] };
const singleQ: Question = { ...base, id: "fx-sc", format: "single-choice", prompt: "単一", choices: ["a", "b", "c", "d"], correctChoiceIndexes: [2] };

describe("AU-05: 個数を指定した列挙の設問は順序を問わない", () => {
  it("個数指定の判定", () => {
    expect(asksForEnumeration("スパイスを3つ挙げよ。")).toBe(true);
    expect(asksForEnumeration("３つの働きは?")).toBe(true);
    expect(asksForEnumeration("三つの大敵は?")).toBe(true);
    expect(asksForEnumeration("主催する団体は?")).toBe(false);
  });
  it("正規の順序・別の区切り・別の順序はいずれも正解", () => {
    expect(gradeTextAnswer(enumQ, "アルファ・ベータ・ガンマ").correct).toBe(true);
    expect(gradeTextAnswer(enumQ, "アルファ、ベータ、ガンマ").correct).toBe(true);
    expect(gradeTextAnswer(enumQ, "ガンマ、アルファ、ベータ").correct).toBe(true);
    expect(gradeTextAnswer(enumQ, "ベータ ガンマ アルファ").correct).toBe(true);
    expect(gradeTextAnswer(enumQ, "ガンマとアルファとベータ").correct).toBe(true);
    expect(gradeTextAnswer(enumQ, "がんま・あるふぁ・べーた").correct).toBe(true); // ひらがな表記（normalize のかな畳み込み）
    expect(gradeTextAnswer(enumQ, "ガンマ,アルファ,ベータ").correct).toBe(true); // 半角カンマ
    expect(gradeTextAnswer(enumQ, "ガンマ，アルファ，ベータ").note).toBe("正解（列挙の順序は問わない）");
  });
  it("項目の不足・過剰・重複・誤りは不正解", () => {
    expect(gradeTextAnswer(enumQ, "ガンマ、アルファ").correct).toBe(false);
    expect(gradeTextAnswer(enumQ, "ガンマ、アルファ、ベータ、デルタ").correct).toBe(false);
    expect(gradeTextAnswer(enumQ, "ガンマ、ガンマ、アルファ").correct).toBe(false);
    expect(gradeTextAnswer(enumQ, "ガンマ、アルファ、デルタ").correct).toBe(false);
    expect(gradeTextAnswer(enumQ, "アルファベータガンマとデルタ").correct).toBe(false);
  });
  it("個数指定のない設問の固有名詞は並べ替えても正解にならない", () => {
    expect(gradeTextAnswer(properNounQ, "バスコ・ダ・ガマ").correct).toBe(true);
    expect(gradeTextAnswer(properNounQ, "バスコダガマ").correct).toBe(true);
    expect(gradeTextAnswer(properNounQ, "ガマ・ダ・バスコ").correct).toBe(false);
  });
  it("空回答・空白のみは不正解", () => {
    expect(gradeTextAnswer(enumQ, "").note).toBe("空回答");
    expect(gradeTextAnswer(enumQ, "　 \n").note).toBe("空回答");
  });
  it("大量入力・特殊文字でも例外を出さず不正解", () => {
    expect(gradeTextAnswer(enumQ, "ア".repeat(20000)).correct).toBe(false);
    expect(gradeTextAnswer(enumQ, "<script>alert(1)</script>").correct).toBe(false);
  });
  it("実データ: チャイ・3つの働き・保存の大敵は順序違いでも正解（修正前は不正解）", () => {
    const byId = new Map(QUESTIONS.map((q) => [q.id, q]));
    const cases: [string, string][] = [
      ["q1-r-chai", "クローブ、シナモン、カルダモン"],
      ["q1-u-3roles", "色づけ、香りづけ、辛みづけ"],
      ["q1-b-dry-enemy", "湿気・光・熱"],
      ["q1-b-fresh-points", "傷めない、低温、適度な湿気"],
      ["q1-h-ancient-uses", "保存剤、祭事、媚薬"],
      ["q1-u-aroma-whole", "加熱する、挽く"],
    ];
    for (const [id, ans] of cases) {
      const q = byId.get(id);
      expect(q, id).toBeDefined();
      expect(gradeQuestion(q!, ans).correct, id).toBe(true);
      expect(gradeQuestion(q!, ans.split(/[、・]/).slice(1).join("、")).correct, `${id}（不足）`).toBe(false);
    }
  });
});

describe("選択式・対応付け・並べ替えの境界", () => {
  it("単一選択: 不正なインデックス・重複・未選択は不正解", () => {
    expect(gradeChoice(singleQ, [2]).correct).toBe(true);
    expect(gradeChoice(singleQ, [9]).correct).toBe(false);
    expect(gradeChoice(singleQ, [2, 2]).correct).toBe(false);
    expect(gradeChoice(singleQ, []).correct).toBe(false);
    expect(gradeChoice(singleQ, [-1]).correct).toBe(false);
  });
  it("2桁インデックスでも辞書順ソートの影響を受けない", () => {
    const q: Question = { ...base, id: "fx-mc", format: "multiple-choice", prompt: "多択", choices: Array.from({ length: 12 }, (_, i) => `c${i}`), correctChoiceIndexes: [2, 10] };
    expect(gradeChoice(q, [10, 2]).correct).toBe(true);
    expect(gradeChoice(q, [2]).correct).toBe(false);
  });
  it("対応付けは部分点、並べ替えは完全一致のみ", () => {
    const m: Question = { ...base, id: "fx-match", format: "matching", prompt: "対応", matchingPairs: [{ left: "A", right: "1" }, { left: "B", right: "2" }] };
    expect(gradeMatching(m, { A: "1", B: "1" }).scoreRatio).toBe(0.5);
    expect(gradeMatching(m, {}).correct).toBe(false);
    const o: Question = { ...base, id: "fx-ord", format: "ordering", prompt: "並べ替え", orderingItems: ["x", "y", "z"], correctOrder: ["x", "y", "z"] };
    expect(gradeOrdering(o, ["x", "y", "z"]).correct).toBe(true);
    expect(gradeOrdering(o, ["y", "x", "z"]).correct).toBe(false);
  });
  it("正誤: 未選択（null）は不正解", () => {
    const tf: Question = { ...base, id: "fx-tf", format: "true-false", prompt: "正誤", correctBoolean: false };
    expect(gradeQuestion(tf, null).correct).toBe(false);
    expect(gradeQuestion(tf, false).correct).toBe(true);
  });
});

describe("記述式: キーワードの羅列で正解と断定しない", () => {
  const rubric = [
    { id: "a", label: "香りづけ", keywords: ["香りづけ"], required: true, points: 1 },
    { id: "b", label: "辛みづけ", keywords: ["辛みづけ"], required: true, points: 1 },
  ];
  it("キーワードだけの羅列は満点でも correct=null（自己採点で確定）", () => {
    const r = gradeEssayRubric(rubric, "香りづけ 辛みづけ");
    expect(r.scoreRatio).toBe(1);
    expect(r.correct).toBeNull();
  });
  it("無関係な長文は不正解、改行・全角空白を含んでも判定できる", () => {
    expect(gradeEssayRubric(rubric, "今日は晴れでした。".repeat(200)).correct).toBe(false);
    expect(gradeEssayRubric(rubric, "香り\nづけ").matchedPointIds).toContain("a");
    expect(gradeEssayRubric(rubric, "辛み　づけ").matchedPointIds).toContain("b");
  });
});
