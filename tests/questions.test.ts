import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { QUESTIONS, CARDS } from "../src/data/questions";
import { QUESTION_GENERATION_META as META } from "../src/data/formal-questions";
import { IMPORTED_KNOWLEDGE_UNITS as U } from "../src/data/knowledge";
import manifest from "../src/data/source-manifest.json";
import { validateQuestion, validateCard, findDuplicateCandidates, selectForPractice } from "../src/domain/validate";
import { gradeQuestion } from "../src/domain/grading";
import { normalizeText } from "../src/domain/normalize";
import { TRANSCRIPT_PAGES } from "../src/data/transcripts";
import { ALL_SECTIONS } from "../src/data/structure";
import { computeStats } from "../src/domain/stats";

const byId = new Map(U.map((u) => [u.id, u]));

// 監査B-07是正（AD-6）の照合用ヘルパー: 生成器（scripts/generate-questions.mjs）の
// nameVariants / aliasAnswersFor / profileByNameNorm と同じ規則で、照合済み
// プロフィールの名称バリアントと別名を引く。生成器側の検証と独立に再計算する。
const stripParenSuffix = (s: string) => s.replace(/[（(][^）)]*[）)]\s*$/, "").trim();
const nameVariantsOf = (name: string): string[] => {
  const noParen = stripParenSuffix(name);
  const parts = name.split(/[・/]/).map((p) => p.trim()).filter(Boolean);
  return [...new Set([name, noParen, ...parts, ...parts.map(stripParenSuffix)])].filter(Boolean);
};
const profileByVariant = new Map<string, (typeof U)[number]>();
const profileAmbiguous = new Set<string>();
for (const p of U) {
  if (p.kind !== "spice-profile" || p.status !== "verified") continue;
  const pname = p.content.match(/^(.+?):\s/)?.[1];
  if (!pname) continue;
  for (const v of nameVariantsOf(pname)) {
    const k = normalizeText(v);
    const prev = profileByVariant.get(k);
    if (prev && prev.id !== p.id) profileAmbiguous.add(k);
    else profileByVariant.set(k, p);
  }
}
const aliasExtrasFor = (a: string, alt: string[]): string[] => {
  for (const cand of [a, ...alt]) {
    const k = normalizeText(cand);
    const prof = profileAmbiguous.has(k) ? undefined : profileByVariant.get(k);
    if (!prof) continue;
    const pname = prof.content.match(/^(.+?):\s/)![1]!;
    const aliasesRaw = prof.content.match(/別名は(.+?)。/)?.[1] ?? "";
    const aliases = aliasesRaw.split(/[、・，,]/).map((s) => s.trim()).filter(Boolean)
      .flatMap((al) => { const b = stripParenSuffix(al); return b && b !== al ? [al, b] : [al]; });
    return [...new Set([...nameVariantsOf(pname), ...aliases])];
  }
  return [];
};
const questionsDir = new URL("../src/data/questions/", import.meta.url);

describe("正式問題の生成（フェーズ4: scripts/generate-questions.mjs）", () => {
  it("生成メタと実データの件数が一致する", () => {
    expect(META.formalQuestions).toBe(QUESTIONS.length);
    expect(META.formalCards).toBe(CARDS.length);
    expect(META.eligibleUnits).toBe(379); // verified かつ draftQa 付き（全545件中）
    expect(META.profileEligibleUnits).toBe(80); // Q2対象: verified かつ draftQa なしのプロフィール単位
    expect(META.q2Questions).toBe(375);
    expect(META.q3Units).toBe(86); // Q3対象: verified かつ draftQa なしの散文単位（事実79+unit7）
    expect(META.q3Questions).toBe(86);
    expect(META.q2ByKind).toEqual({ "family-fill": 68, "level-fill": 80, "part-choice": 68, "origin-choice": 39, "alias-term": 60, "reverse-term": 60, "profile-card": 80 });
    expect(META.f1ByKind).toEqual({ "tf-family-true": 68, "tf-family-false": 68, "tf-part-true": 68, "tf-part-false": 68, "mc-family": 14, "mc-part": 11, "mc-origin": 7, "match-family": 17, "match-part": 17, "match-origin": 9, "reverse-alias": 60, "table-profile": 68, "composite-profile": 68, "figure-table": 17 });
    expect(META.f1Questions).toBe(560);
    expect(META.f1SkippedItems).toBe(71); // 科名・利用部位なし12単位×4種・一意な別名なし20・原産地グループ余り3
    expect(META.f2ByKind).toEqual({ "ordering": 17, "short-essay": 12 });
    expect(META.f2Questions).toBe(29);
    expect(META.f2SkippedItems).toBe(11); // 2手順のみ6件（7手順）・対応単位なし1件・番号なし手順1件・年代並べ替え1件・短文記述の対象外1件・監査A3で並べ替えとして不成立と判定した水やりの基本1件（scripts/f2-manual-questions.json の skipped）
    expect(META.f3ByKind).toEqual({ "long-essay": 4, "compare-essay": 7 });
    expect(META.f3Questions).toBe(11);
    expect(META.fix1ByKind).toEqual({ "term-card": 80, "reverse-card": 63 }); // FIX1（DECISIONS #34）: 用語カード80・逆引きカード63
    expect(META.fix1Cards).toBe(143);
    expect(META.fix1SkippedItems).toBe(17); // 名称・別名を含まない検証済み事実がない17種は逆引きを作らない
    expect(META.f3SkippedItems).toBe(11); // 長文の見送り5件・比較の見送り5件・写真識別1件（scripts/f3-manual-questions.json の skipped）
    const byFormat: Record<string, number> = {};
    for (const q of QUESTIONS) byFormat[q.format] = (byFormat[q.format] ?? 0) + 1;
    expect(byFormat).toEqual({ ...META.byFormat });
    expect(byFormat).toEqual({ "one-answer": 465, "single-choice": 462, "fill-blank": 148, "term-input": 120, "true-false": 272, "multiple-choice": 32, "matching": 43, "reverse-lookup": 60, "table-fill": 68, "composite": 68, "figure": 17, "ordering": 17, "short-essay": 12, "long-essay": 4, "compare-essay": 7 });
    // 機械検証できる変換のみ（第一弾: draftQa直接変換、Q2: プロフィール構造化属性、Q3: 転記支持文つき人手作成の一問一答、F1: プロフィール構造化属性から検証できる追加7形式。DECISIONS #21。F2: 転記の番号付き手順・支持文に基づく人手作成の並べ替え・短文記述。DECISIONS #26。F3: 転記の複数段落の支持文・明示的な対比に基づく人手作成の長文記述・比較記述。DECISIONS #27）
    expect(Object.keys(byFormat).sort()).toEqual(["compare-essay", "composite", "figure", "fill-blank", "long-essay", "matching", "multiple-choice", "one-answer", "ordering", "reverse-lookup", "short-essay", "single-choice", "table-fill", "term-input", "true-false"]);
  });
  it("全件 verified で、validate.ts の検証エラーがない（取り込み単位を参照先として）", () => {
    for (const q of QUESTIONS) {
      expect(q.status, q.id).toBe("verified");
      const errors = validateQuestion(q, U).filter((i) => i.severity === "error");
      expect(errors, q.id).toEqual([]);
    }
    for (const c of CARDS) {
      expect(c.status, c.id).toBe("verified");
      expect(validateCard(c).filter((i) => i.severity === "error"), c.id).toEqual([]);
    }
  });
  it("正答が生成元単位の draftQa と一致する（根拠の機械チェック）", () => {
    for (const q of QUESTIONS) {
      const unit = byId.get(q.knowledgeUnitIds[0]!)!;
      expect(unit, q.id).toBeTruthy();
      expect(unit.status, q.id).toBe("verified");
      if (q.id.startsWith("qord-") || q.id.startsWith("qse-")) continue; // F2（並べ替え・短文記述）は別ブロックで検証
      if (q.id.startsWith("qle-") || q.id.startsWith("qce-")) continue; // F3（長文記述・比較記述）は別ブロックで検証
      if (!unit.draftQa) continue; // Q2（プロフィール属性由来）は別テストで検証
      expect(q.prompt, q.id).toBe(unit.draftQa!.q);
      expect(q.explanation, q.id).toBe(unit.content);
      if (q.format === "one-answer") {
        expect(q.acceptedAnswers?.[0], q.id).toBe(unit.draftQa!.a);
        // 監査B-07是正（AD-6）: 正答が指す照合済みプロフィールの名称バリアント・
        // 別名も許容される（推測の別名は加えない）。それ以外は draftQa の a+alt のみ。
        const expected = [unit.draftQa!.a, ...unit.draftQa!.alt, ...aliasExtrasFor(unit.draftQa!.a, unit.draftQa!.alt)];
        for (const a of q.acceptedAnswers ?? []) expect(expected, q.id).toContain(a);
      }
      if (q.format === "single-choice") {
        expect(q.choices?.length, q.id).toBe(4);
        expect(q.correctChoiceIndexes, q.id).toHaveLength(1);
        expect(q.choices?.[q.correctChoiceIndexes![0]!], q.id).toBe(unit.draftQa!.a);
      }
    }
  });
  it("四択の誤答は照合済み回答（同一章優先・同次元は他章可）か同次元のプロフィール属性値からのみ作られ、本文に現れる紛らわしい候補は除外される", () => {
    // 監査B-08是正（AD-5）後の規則: 誤答は (a) 同一章の照合済み回答、(b) 設問と
    // 同じ次元（科名・温度・分量など）の他章の照合済み回答、(c) 科名・原産地・
    // 利用部位については照合済みプロフィールの同属性値、のいずれか。
    // 次元の一致そのものは生成器の生成後検証（validateGenerated）が生成時に
    // 強制し、違反があればデータ自体が書き出されない。ここでは観測可能な
    // 帰属（a∪b∪c の範囲内にあること）と曖昧さガードを固定する。
    const allAnswers = new Set<string>();
    const profileAttrValues = new Set<string>();
    for (const u of U) {
      if (u.status !== "verified") continue;
      if (u.draftQa) allAnswers.add(u.draftQa.a);
      if (u.kind === "spice-profile") {
        const g = (re: RegExp) => u.content.match(re)?.[1] ?? null;
        for (const v of [g(/科名は(.+?)。/), g(/原産地は(.+?)。/), g(/利用部位は(.+?)。/)]) if (v) profileAttrValues.add(v);
      }
    }
    for (const q of QUESTIONS.filter((x) => x.id.startsWith("q4-"))) {
      const unit = byId.get(q.knowledgeUnitIds[0]!)!;
      const norms = (q.choices ?? []).map(normalizeText);
      expect(new Set(norms).size, q.id).toBe(4); // 正規化後の重複なし
      for (const c of q.choices ?? []) {
        if (c === unit.draftQa!.a) continue;
        expect(allAnswers.has(c) || profileAttrValues.has(c), `${q.id}: 誤答「${c}」`).toBe(true);
        // 曖昧さガード: 誤答が生成元単位の本文に現れる場合は正答でもありうるため含めない
        expect(normalizeText(unit.content).includes(normalizeText(c)), `${q.id}: 誤答「${c}」`).toBe(false);
      }
    }
  });
  it("出典（manifest画像）が実在し、ページが生成元単位と一致する", () => {
    const entries = new Map(manifest.entries.map((e) => [e.imageId, e]));
    for (const item of [...QUESTIONS, ...CARDS]) {
      const unit = byId.get(item.knowledgeUnitIds[0]!)!;
      expect(item.sourceRefs.length, item.id).toBeGreaterThan(0);
      const ref = item.sourceRefs[0]!;
      expect(ref.bookPage, item.id).toBe(unit.source.page);
      const entry = entries.get(ref.manifestImageId);
      expect(entry, item.id).toBeTruthy();
      expect(entry!.driveFileId, item.id).not.toBeNull();
      expect(entry!.extractionStatus, item.id).not.toBe("欠落");
    }
  });
  it("正式カードの表裏が draftQa と一致する", () => {
    for (const c of CARDS) {
      const unit = byId.get(c.knowledgeUnitIds[0]!)!;
      if (c.id.startsWith("card-profile-")) continue; // Q2カードは別テストで検証
      if (c.id.startsWith("card-term-") || c.id.startsWith("card-rev-")) continue; // FIX1カードは別ブロックで検証
      expect(c.front, c.id).toBe(unit.draftQa!.q);
      expect(c.back, c.id).toBe(unit.draftQa!.a);
    }
  });
  it("Q2: 正答・許容回答が生成元プロフィールの構造化属性と一致する（根拠の機械チェック）", () => {
    const parse = (c: string) => {
      const g = (re: RegExp) => c.match(re)?.[1] ?? null;
      return { name: g(/^(.+?):\s/), family: g(/科名は(.+?)。/), origin: g(/原産地は(.+?)。/), part: g(/利用部位は(.+?)。/), aliasesRaw: g(/別名は(.+?)。/), levels: g(/検定(.+?)級の対象。/) };
    };
    const profiles = U.filter((u) => u.kind === "spice-profile" && !u.draftQa);
    const q2 = QUESTIONS.filter((q) => /^(qfb|qsc|qti)-/.test(q.id));
    expect(q2.length).toBe(375);
    for (const q of q2) {
      const unit = byId.get(q.knowledgeUnitIds[0]!)!;
      expect(unit.kind, q.id).toBe("spice-profile");
      expect(unit.draftQa, q.id).toBeNull();
      expect(q.explanation, q.id).toBe(unit.content);
      expect([1, 2, 3, 4, 5], q.id).toContain(q.difficulty); // 難易度は較正D1（DECISIONS #22）で別ブロックで全件検証
      const p = parse(unit.content);
      if (q.id.startsWith("qfb-family-")) expect(q.acceptedAnswers, q.id).toEqual([p.family]);
      if (q.id.startsWith("qfb-level-")) expect(q.acceptedAnswers, q.id).toEqual([p.levels]);
      if (q.id.startsWith("qsc-part-") || q.id.startsWith("qsc-origin-")) {
        const key = q.id.startsWith("qsc-part-") ? "part" : "origin";
        expect(q.choices?.length, q.id).toBe(4);
        expect(q.correctChoiceIndexes, q.id).toHaveLength(1);
        const answer = q.choices![q.correctChoiceIndexes![0]!]!;
        expect(answer, q.id).toBe(p[key]);
        const pool = new Set(profiles.filter((o) => o.id !== unit.id).map((o) => parse(o.content)[key]).filter(Boolean));
        const norms = q.choices!.map(normalizeText);
        expect(new Set(norms).size, q.id).toBe(4);
        for (const c of q.choices!) {
          if (c === answer) continue;
          expect(pool.has(c), `${q.id}: 誤答「${c}」`).toBe(true); // 誤答は他の照合済みプロフィールの同属性値のみ
          const n = normalizeText(c), na = normalizeText(answer);
          expect(n.includes(na) || na.includes(n), `${q.id}: 誤答「${c}」`).toBe(false); // 曖昧さガード
        }
      }
      if (q.id.startsWith("qti-alias-")) {
        const toks = (p.aliasesRaw ?? "").split("、").map((s) => s.trim()).filter(Boolean);
        const expected = new Set<string>();
        for (const t of toks) { expected.add(t); expected.add(t.replace(/[(（].*$/, "").trim()); }
        expect(new Set(q.acceptedAnswers), q.id).toEqual(expected);
      }
      if (q.id.startsWith("qti-rev-")) {
        const base = q.prompt.match(/別名「(.+)」/)![1]!;
        const holders = profiles.filter((o) => (parse(o.content).aliasesRaw ?? "").split("、").some((t) => t.replace(/[(（].*$/, "").trim() === base));
        expect(holders.map((h) => h.id), q.id).toEqual([unit.id]); // 別名基部が一意な場合のみ生成
        expect(q.acceptedAnswers, q.id).toContain(p.name);
      }
    }
    const q2cards = CARDS.filter((c) => c.id.startsWith("card-profile-"));
    expect(q2cards.length).toBe(80);
    for (const c of q2cards) {
      const unit = byId.get(c.knowledgeUnitIds[0]!)!;
      expect(c.back, c.id).toBe(unit.content); // 裏はプロフィール単位の content そのもの
    }
  });
  it("サンプルは存在しない（2026-10-31 全削除、DECISIONS #52）", () => {
    for (const item of [...QUESTIONS, ...CARDS]) expect(item.status, item.id).toBe("verified");
    for (const q of QUESTIONS) expect(q.prompt, q.id).not.toContain("[サンプル]");
    for (const c of CARDS) expect(c.front, c.id).not.toContain("[サンプル");
    expect(findDuplicateCandidates(QUESTIONS)).toEqual([]);
    expect(new Set([...QUESTIONS, ...CARDS].map((x) => x.id)).size).toBe(QUESTIONS.length + CARDS.length);
    expect(selectForPractice(QUESTIONS).length).toBe(QUESTIONS.length);
  });
  it("生成データは章別分割JSON（全ファイル128KB未満）で、メタのファイル一覧と一致する", () => {
    expect(META.files.length).toBeGreaterThan(0);
    let totalBytes = 0;
    for (const rel of META.files) {
      const url = new URL(rel, questionsDir);
      expect(statSync(url).size, rel).toBeLessThan(128 * 1024);
      const arr = JSON.parse(readFileSync(url, "utf8")) as unknown[];
      expect(Array.isArray(arr), rel).toBe(true);
      expect(arr.length, rel).toBeGreaterThan(0);
      totalBytes += arr.length;
    }
    expect(totalBytes).toBe(QUESTIONS.length + CARDS.length);
  });
  it("全545単位が問題化され、未問題化の単位は残らない（Q3完了時点）", () => {
    const usedUnitIds = new Set([...QUESTIONS, ...CARDS].map((x) => x.knowledgeUnitIds[0]!));
    expect(usedUnitIds.size).toBe(545); // draftQa 379 + プロフィール 80 + 散文 86
    for (const u of U) expect(usedUnitIds.has(u.id), u.id).toBe(true);
    expect(META.excludedUnits).toBe(0);
    // 項目レベルの除外はプロフィールに属性の記載がない項目（科名12・利用部位12・原産地41・別名20・逆引き20）
    // ＋監査B-08是正で同次元の誤答を3つ用意できず四択として成立しなくなった15項目＋監査AU-06で二者択一・可否の設問の四択をやめた9項目（DECISIONS #54）
    expect(META.excludedItems).toBe(129);
  });
  it("Q3: 散文単位の一問一答は手書きデータと一致し、正答が転記支持文に字句として含まれる（根拠の機械チェック）", () => {
    const manual = JSON.parse(readFileSync(new URL("../scripts/q3-manual-questions.json", import.meta.url), "utf8")) as {
      questions: { unitId: string; prompt: string; answer: string; altAnswers: string[]; supportPage: number; supportText: string }[];
      skipped: unknown[];
    };
    expect(manual.skipped).toEqual([]);
    const q3 = QUESTIONS.filter((q) => q.id.startsWith("q1q3-"));
    expect(q3.length).toBe(86);
    expect(manual.questions.length).toBe(86);
    // 転記ページのテキスト断片（ブロック本文・コラム題・表セル）をページごとに用意する
    const fragmentsByPage = new Map<number, string[]>();
    for (const pg of TRANSCRIPT_PAGES) {
      const frags: string[] = [];
      for (const b of pg.blocks) {
        if (b.text) frags.push(b.text);
        if (b.title) frags.push(b.title);
        if (b.rows) for (const row of b.rows) for (const cell of row) frags.push(cell);
      }
      fragmentsByPage.set(pg.bookPage, frags);
    }
    const manualById = new Map(manual.questions.map((m) => [m.unitId, m]));
    for (const q of q3) {
      const unit = byId.get(q.knowledgeUnitIds[0]!)!;
      expect(unit.draftQa, q.id).toBeNull();
      expect(unit.kind, q.id).not.toBe("spice-profile");
      expect(q.format, q.id).toBe("one-answer");
      expect([1, 2, 3, 4, 5], q.id).toContain(q.difficulty); // 難易度は較正D1（DECISIONS #22）で別ブロックで全件検証
      expect(q.explanation, q.id).toBe(unit.content);
      const m = manualById.get(unit.id)!;
      expect(m, q.id).toBeTruthy();
      expect(q.prompt, q.id).toBe(m.prompt);
      expect(q.acceptedAnswers?.[0], q.id).toBe(m.answer);
      for (const a of q.acceptedAnswers ?? []) expect([m.answer, ...m.altAnswers], q.id).toContain(a);
      // 支持文が根拠ページの転記本文に原文のまま含まれ、正答・許容回答が支持文に含まれること
      const frags = fragmentsByPage.get(m.supportPage) ?? [];
      expect(frags.some((f) => f.includes(m.supportText)), `${q.id}: 支持文が転記 p.${m.supportPage} にない`).toBe(true);
      for (const a of q.acceptedAnswers ?? []) expect(m.supportText.includes(a), `${q.id}: 正答「${a}」が支持文にない`).toBe(true);
      // 出典注記に支持文が記録されていること
      expect(q.sourceRefs[0]!.locationNote, q.id).toContain(m.supportText);
    }
    // 散文単位は全件ちょうど1問ずつ
    const prose = U.filter((u) => !u.draftQa && u.kind !== "spice-profile");
    expect(prose.length).toBe(86);
    for (const u of prose) expect(q3.filter((q) => q.knowledgeUnitIds[0] === u.id).length, u.id).toBe(1);
  });
  it("A1: 四択486問の誤答意味的監査が完了し、真の問題2件は除外リストで修正されている（監査レポートの実測固定）", () => {
    const report = JSON.parse(readFileSync(new URL("../scripts/distractor-audit-a1-report.json", import.meta.url), "utf8")) as {
      meta: {
        targets: { total: number; fromDraftQa: number; fromProfile: number };
        screening: { flaggedQuestions: number; byCategory: Record<string, { instances: number; questions: number }> };
        sampling: { sampledQuestions: number };
        verdicts: { flagged: Record<string, number>; sampled: Record<string, number>; trueProblems: string[] };
        fixes: { questionId: string; excludedValues: string[] }[];
      };
      flagged: { questionId: string; verdict: string; basis: string }[];
      sampled: { questionId: string; verdict: string; basis: string }[];
    };
    // 監査対象は四択全486問（q4 379 + qsc 107）、検出136問を全件精査し、未検出から章別10%の38問をサンプル精査
    expect(report.meta.targets).toEqual({ total: 486, fromDraftQa: 379, fromProfile: 107, byChapter: { appendix: 3, ch1: 81, ch2: 245, ch3: 66, preface: 91 } });
    expect(report.meta.screening.flaggedQuestions).toBe(136);
    expect(report.meta.sampling.sampledQuestions).toBe(38);
    // 既存ガードの再検証観点（B: 誤答が単位本文に出現 / D1: 誤答が正答と同一品目の別名と一致）は検出0件
    expect(report.meta.screening.byCategory.B ?? { instances: 0, questions: 0 }).toEqual({ instances: 0, questions: 0 });
    expect(report.meta.screening.byCategory.D1 ?? { instances: 0, questions: 0 }).toEqual({ instances: 0, questions: 0 });
    expect(report.meta.verdicts.flagged).toEqual({ "真の問題": 2, "問題なし": 134, "要確認": 0 });
    expect(report.meta.verdicts.sampled).toEqual({ "真の問題": 0, "問題なし": 38, "要確認": 0 });
    expect(report.meta.verdicts.trueProblems).toEqual(["q4-pepper-6", "qsc-part-dokudami-profile"]);
    // 精査した全件に判定と根拠が記録されている
    expect(report.flagged.length).toBe(136);
    expect(report.sampled.length).toBe(38);
    for (const item of [...report.flagged, ...report.sampled]) {
      expect(["真の問題", "問題なし", "要確認"], item.questionId).toContain(item.verdict);
      expect(item.basis.trim().length, item.questionId).toBeGreaterThan(0);
    }
    // 真の問題2件は生成パイプラインの除外リストで修正され、現行データに除外値が残っていない
    const exclusions = JSON.parse(readFileSync(new URL("../scripts/distractor-audit-exclusions.json", import.meta.url), "utf8")) as {
      exclusions: { kind: string; unitId: string; values: string[] }[];
    };
    expect(report.meta.fixes.map((f) => f.questionId).sort()).toEqual(["q4-pepper-6", "qsc-part-dokudami-profile"]);
    const pepper6 = QUESTIONS.find((q) => q.id === "q4-pepper-6")!;
    for (const v of ["ブラックペッパー", "ホワイトペッパー", "グリーンペッパー"]) expect(pepper6.choices, v).not.toContain(v);
    expect(pepper6.choices?.[pepper6.correctChoiceIndexes![0]!]).toBe("こしょう"); // 正答は不変
    const dokudami = QUESTIONS.find((q) => q.id === "qsc-part-dokudami-profile")!;
    expect(dokudami.choices).not.toContain("地上部");
    expect(dokudami.choices?.[dokudami.correctChoiceIndexes![0]!]).toBe("葉"); // 正答は不変
    // 除外リストの登録内容（生成器が実際に読むファイル）
    const exMap = new Map(exclusions.exclusions.map((e) => [`${e.kind}:${e.unitId}`, e.values]));
    expect(exMap.get("draft-choice:pepper-6")).toEqual(["ブラックペッパー", "ホワイトペッパー", "グリーンペッパー"]);
    expect(exMap.get("profile-part:dokudami-profile")).toEqual(["地上部"]);
  });
});

describe("正式問題の生成（フェーズ6・拡充F1: 残り形式のうち機械検証できる7形式。DECISIONS #21）", () => {
  const parse = (c: string) => {
    const g = (re: RegExp) => c.match(re)?.[1] ?? null;
    return { name: g(/^(.+?):\s/), family: g(/科名は(.+?)。/), origin: g(/原産地は(.+?)。/), part: g(/利用部位は(.+?)。/), aliasesRaw: g(/別名は(.+?)。/), levels: g(/検定(.+?)級の対象。/) };
  };
  const profiles = U.filter((u) => u.kind === "spice-profile" && !u.draftQa);
  const profByName = new Map(profiles.map((u) => [parse(u.content).name, u]));
  const f1 = QUESTIONS.filter((q) => /^(qtf|qmc|qmatch|qrev|qtable|qcomp|qfig)-/.test(q.id));
  const tokens = (v: string) => v.split(/[、,・]/).flatMap((s) => s.split("および")).map((s) => s.replace(/[(（].*$/, "").trim()).filter(Boolean);
  const unrelated = (a: string, b: string) => {
    const na = normalizeText(a), nb = normalizeText(b);
    if (!na || !nb || na === nb || na.includes(nb) || nb.includes(na)) return false;
    const tb = new Set(tokens(b).map(normalizeText));
    return tokens(a).every((t) => !tb.has(normalizeText(t)));
  };

  it("F1は560問で、全件プロフィール単位由来・解説と出典が生成元単位と一致する", () => {
    expect(f1.length).toBe(560);
    for (const q of f1) {
      expect([1, 2, 3, 4, 5], q.id).toContain(q.difficulty); // 難易度は較正D1（DECISIONS #22）で別ブロックで全件検証
      const us = q.knowledgeUnitIds.map((id) => byId.get(id)!);
      for (const u of us) { expect(u.kind, q.id).toBe("spice-profile"); expect(u.draftQa, q.id).toBeNull(); }
      expect(q.explanation, q.id).toBe(us.map((u) => u.content).join("\n"));
      expect(q.sourceRefs.length, q.id).toBe(us.length);
      us.forEach((u, i) => expect(q.sourceRefs[i]!.bookPage, q.id).toBe(u.source.page));
    }
    // 不採用形式（DECISIONS #21）は正式問題に含まれない（short-essay と ordering は F2 で、
    // long-essay と compare-essay は F3 で、それぞれ人手作成＋検証方式により追加されたため除く。
    // DECISIONS #26・#27）
    for (const f of ["photo-id", "flashcard"]) {
      expect(QUESTIONS.filter((q) => q.format === f), f).toEqual([]);
    }
  });

  it("○×: 真文は属性値そのまま、偽文は無関係な他プロフィールの同属性値で、A1除外リストと矛盾しない", () => {
    const tf = QUESTIONS.filter((q) => q.format === "true-false");
    expect(tf.length).toBe(272);
    const exclusions = JSON.parse(readFileSync(new URL("../scripts/distractor-audit-exclusions.json", import.meta.url), "utf8")) as { exclusions: { kind: string; unitId: string; values: string[] }[] };
    for (const q of tf) {
      const unit = byId.get(q.knowledgeUnitIds[0]!)!;
      const p = parse(unit.content);
      const key = q.id.startsWith("qtf-family-") ? "family" : "part";
      const label = key === "family" ? "科名" : "利用部位";
      const value = q.prompt.match(new RegExp(`の${label}は(.+)である。$`))![1]!;
      if (q.correctBoolean) expect(value, q.id).toBe(p[key]);
      else {
        expect(profiles.some((o) => o.id !== unit.id && parse(o.content)[key] === value), q.id).toBe(true); // 偽文の値は実在する同属性値
        expect(unrelated(p[key]!, value), `${q.id}: 偽文の値「${value}」`).toBe(true); // 正答と一致・包含・トークン共有なし
        const ex = exclusions.exclusions.filter((e) => e.unitId === unit.id && e.kind === `profile-${key}`).flatMap((e) => e.values);
        expect(ex, q.id).not.toContain(value); // 監査A1（DECISIONS #20）の除外値を偽文に使わない
      }
    }
    // A1の実例: どくだみの利用部位の偽文に「地上部」は使われていない
    const dokudamiFalse = QUESTIONS.find((q) => q.id === "qtf-part-false-dokudami-profile")!;
    expect(dokudamiFalse.prompt).not.toContain("地上部");
    expect(dokudamiFalse.correctBoolean).toBe(false);
  });

  it("多択: 正解集合は属性値の完全一致と一致し、非該当候補は対象値と無関係である", () => {
    const mc = QUESTIONS.filter((q) => q.format === "multiple-choice");
    expect(mc.length).toBe(32);
    for (const q of mc) {
      const key = q.id.split("-")[1] as "family" | "part" | "origin";
      const value = q.prompt.match(/が「(.+)」であるものをすべて選べ。$/)![1]!;
      expect(q.choices, q.id).toHaveLength(4);
      expect(q.correctChoiceIndexes, q.id).toHaveLength(2);
      for (const [i, c] of (q.choices ?? []).entries()) {
        const u = profByName.get(c)!;
        expect(u, `${q.id}: 選択肢「${c}」`).toBeTruthy();
        const isMember = parse(u.content)[key] === value;
        expect(q.correctChoiceIndexes!.includes(i), `${q.id}: 選択肢「${c}」`).toBe(isMember);
        if (!isMember) expect(unrelated(value, parse(u.content)[key]!), `${q.id}: 選択肢「${c}」`).toBe(true);
      }
    }
  });

  it("組み合わせ・図表: 対応と表の内容がプロフィール属性と一致し、対象属性は表内で一意である", () => {
    const match = QUESTIONS.filter((q) => q.format === "matching");
    expect(match.length).toBe(43);
    for (const q of match) {
      const key = q.id.split("-")[1] as "family" | "part" | "origin";
      expect(q.matchingPairs, q.id).toHaveLength(4);
      expect(new Set(q.matchingPairs!.map((x) => x.right)).size, q.id).toBe(4);
      for (const pr of q.matchingPairs!) expect(parse(profByName.get(pr.left)!.content)[key], q.id).toBe(pr.right);
    }
    const fig = QUESTIONS.filter((q) => q.format === "figure");
    expect(fig.length).toBe(17);
    for (const q of fig) {
      const part = q.prompt.match(/利用部位が「(.+)」である品目/)![1]!;
      const holders = (q.table!.rows).filter((r) => r[2] === part);
      expect(holders.length, q.id).toBe(1);
      expect(q.choices![q.correctChoiceIndexes![0]!], q.id).toBe(holders[0]![0]);
      for (const r of q.table!.rows) { const p = parse(profByName.get(r[0]!)!.content); expect([p.name, p.family, p.part], q.id).toEqual(r); }
    }
  });

  it("監査A2（DECISIONS #25）: 図表の対象は意味的にも一意で、組み合わせの同種グループ除外ペアは同居しない", () => {
    // 利用部位の構成要素（語彙）抽出。生成器・監査スクリプトと同じ規則
    const PART_LEX = ["仮種皮", "雌しべ", "地上部", "根茎", "鱗茎", "果皮", "果実", "種子", "樹皮", "花弁", "花穂", "走根", "葉", "茎", "根", "花", "蕾", "仁"];
    const partLexemes = (v: string) => {
      const out = new Set<string>();
      for (const rawTok of v.split(/[、,]/).flatMap((s) => s.split("および"))) {
        const tok = rawTok.trim();
        if (!tok) continue;
        const paren = tok.match(/[(（]([^)）]+)[)）]/)?.[1] ?? "";
        const t = tok.replace(/[(（].*[)）]/, "").replace(/^未熟な/, "");
        if (t.includes("雌しべ")) out.add("雌しべ");
        else if (t.includes("仮種皮")) out.add("仮種皮");
        else if (t.includes("の仁")) out.add("仁");
        else if (t.includes("の")) out.add(t.split("の").pop()!);
        else out.add(t);
        for (const lx of PART_LEX) if (paren.includes(lx)) out.add(lx);
        if (tok.includes("葉") && paren.includes("芽")) out.add("葉(芽)");
      }
      return out;
    };
    const subset = (a: Set<string>, b: Set<string>) => [...a].every((x) => b.has(x));
    for (const q of QUESTIONS.filter((x) => x.format === "figure")) {
      const part = q.prompt.match(/利用部位が「(.+)」である品目/)![1]!;
      const lt = partLexemes(part);
      const semanticHolders = (q.table!.rows).filter((r) => subset(lt, partLexemes(r[2]!)));
      expect(semanticHolders.map((r) => r[0]), q.id).toEqual([q.choices![q.correctChoiceIndexes![0]!]]);
    }
    // A2の実例: 図表の対象付け替え（果実→バジルの複合値）と、同種グループ除外（オールスパイス×マンゴーパウダー）
    const figAjwain = QUESTIONS.find((q) => q.id === "qfig-ajwain-profile")!;
    expect(figAjwain.choices![figAjwain.correctChoiceIndexes![0]!]).toBe("バジル");
    for (const q of QUESTIONS.filter((x) => x.format === "matching" && x.id.startsWith("qmatch-part-"))) {
      const lefts = q.matchingPairs!.map((p) => p.left);
      expect(lefts.includes("オールスパイス") && lefts.includes("マンゴーパウダー"), q.id).toBe(false);
    }
    expect(QUESTIONS.some((q) => q.id === "qmatch-part-amchur-profile")).toBe(true);
  });

  it("逆引き・表穴埋め・複合: 正答と採点基準がプロフィール属性・別名の一意性と一致する", () => {
    const rev = QUESTIONS.filter((q) => q.format === "reverse-lookup");
    expect(rev.length).toBe(60);
    for (const q of rev) {
      const unit = byId.get(q.knowledgeUnitIds[0]!)!;
      const base = q.prompt.match(/別名「(.+)」/)![1]!;
      const holders = profiles.filter((o) => (parse(o.content).aliasesRaw ?? "").split("、").some((t) => t.replace(/[(（].*$/, "").trim() === base));
      expect(holders.map((h) => h.id), q.id).toEqual([unit.id]); // 別名基部が一意な場合のみ生成
      expect(q.choices![q.correctChoiceIndexes![0]!], q.id).toBe(parse(unit.content).name);
    }
    for (const q of QUESTIONS.filter((x) => x.format === "table-fill")) {
      const p = parse(byId.get(q.knowledgeUnitIds[0]!)!.content);
      expect(q.blankCellAnswers, q.id).toEqual({ A: p.family, B: p.part });
    }
    for (const q of QUESTIONS.filter((x) => x.format === "composite")) {
      const p = parse(byId.get(q.knowledgeUnitIds[0]!)!.content);
      expect(q.modelAnswer, q.id).toBe(`科名は${p.family}。利用部位は${p.part}。`);
      expect(q.rubric!.map((r) => r.keywords), q.id).toEqual([[p.family], [p.part]]);
    }
  });

  it("F1全形式が採点エンジンで正答を正解と判定する（出題・模試・分析が使う gradeQuestion への接続）", () => {
    const seen = new Set<string>();
    for (const q of f1) {
      let answer: unknown;
      switch (q.format) {
        case "true-false": answer = q.correctBoolean; break;
        case "multiple-choice": case "reverse-lookup": case "figure": answer = q.correctChoiceIndexes; break;
        case "matching": answer = Object.fromEntries(q.matchingPairs!.map((p) => [p.left, p.right])); break;
        case "table-fill": answer = q.blankCellAnswers; break;
        case "composite": answer = q.modelAnswer; break;
        default: throw new Error(`想定外のF1形式: ${q.format}`);
      }
      const r = gradeQuestion(q, answer);
      // 監査AD-1: ルーブリック採点の複合問題は、模範解答でも要点充足率1.0に
      // なるだけで correct は断定されない（null。自己採点で確定する）。
      if (q.format === "composite") expect(r.correct, q.id).toBeNull();
      else expect(r.correct, q.id).toBe(true);
      expect(r.scoreRatio, q.id).toBe(1);
      seen.add(q.format);
    }
    expect([...seen].sort()).toEqual(["composite", "figure", "matching", "multiple-choice", "reverse-lookup", "table-fill", "true-false"]);
    // 誤答が不正解になることも確認（○×の反転、多択の部分選択）
    const tf = QUESTIONS.find((q) => q.format === "true-false")!;
    expect(gradeQuestion(tf, !tf.correctBoolean).correct).toBe(false);
    const mc = QUESTIONS.find((q) => q.format === "multiple-choice")!;
    expect(gradeQuestion(mc, [mc.correctChoiceIndexes![0]!]).correct).toBe(false);
  });
});

describe("難易度較正D1（フェーズ6、DECISIONS #22）", () => {
  // 生成器とは独立に、転記 p.137（試験概要）の階層と構造データから期待値を再計算する
  const sectionsByPage = [...ALL_SECTIONS].sort((a, b) => a.bookPage - b.bookPage);
  const sectionForPage = (page: number) => { let found: (typeof ALL_SECTIONS)[number] | null = null; for (const s of sectionsByPage) { if (s.bookPage <= page) found = s; else break; } return found; };
  const profileGrade = (content: string): number | null => {
    const m = content.match(/検定(.+?)級の対象。/);
    if (!m) return null;
    const grades = m[1]!.split("・").map(Number).filter((n) => [1, 2, 3].includes(n));
    return grades.length ? Math.max(...grades) : null;
  };
  const SECTION_GRADE: Record<string, number> = {
    "history-world": 3, "history-japan": 3, "definition": 3, "classification": 3, "preservation": 3,
    "basic-aroma": 3, "basic-timing": 3, "basic-compat": 3,
    "world-africa": 3, "world-europe": 3, "world-asia": 3, "world-america": 3, "world-drink": 3,
    "dish-curry": 3, "dish-genovese": 3, "dish-paella": 3, "dish-chili": 3, "dish-kakuni": 3, "dish-ceviche": 3, "dish-hummus": 3, "dish-lamb": 3, "dish-currywurst": 3, "dish-cumin-potato": 3, "dish-chai": 3, "dish-apple": 3,
    "season-oil": 1, "season-vinegar": 1, "season-soy": 1, "season-paste": 1, "season-dressing": 1, "season-plus": 1,
    "life-tea": 2, "life-grow": 2, "life-health": 2, "life-beauty": 3, "life-house": 3, "life-handmade": 3,
  };
  const profBySpice = new Map<string, (typeof U)[number]>();
  const profsBySection = new Map<string, (typeof U)[number][]>();
  for (const u of U) {
    if (u.kind !== "spice-profile") continue;
    if (u.spice?.id) profBySpice.set(u.spice.id, u);
    const sec = sectionForPage(u.source.page);
    if (sec) { if (!profsBySection.has(sec.id)) profsBySection.set(sec.id, []); profsBySection.get(sec.id)!.push(u); }
  }
  const unitGrade = (u: (typeof U)[number]): number | null => {
    if (u.kind === "spice-profile") return profileGrade(u.content);
    if (u.kind === "spice-fact") {
      const prof = u.spice?.id ? profBySpice.get(u.spice.id) : undefined;
      if (prof) return profileGrade(prof.content);
      const sec = sectionForPage(u.source.page);
      const grades = new Set((sec ? profsBySection.get(sec.id) ?? [] : []).map((p) => profileGrade(p.content)));
      return grades.size === 1 ? [...grades][0]! : null;
    }
    const sec = sectionForPage(u.source.page);
    return (sec && SECTION_GRADE[sec.id]) || null;
  };
  // 形式負荷の対象は生成器の D1_LOAD_FORMATS と同一（F2 で ordering / short-essay、F3 で long-essay / compare-essay を追加。DECISIONS #26・#27）
  const LOAD = new Set(["multiple-choice", "matching", "reverse-lookup", "table-fill", "composite", "figure", "ordering", "short-essay", "long-essay", "compare-essay"]);
  const expected = (q: (typeof QUESTIONS)[number]): number | null => {
    const grades = q.knowledgeUnitIds.map((id) => unitGrade(byId.get(id)!));
    if (grades.some((g) => g === null)) return null;
    const base = ({ 3: 1, 2: 2, 1: 3 } as Record<number, number>)[Math.min(...(grades as number[]))]!;
    return Math.max(1, Math.min(5, base + (LOAD.has(q.format) || q.id.startsWith("qti-rev-") ? 1 : 0)));
  };
  const HELD = ["q1-e-org", "q4-e-org", "q1-e-start", "q4-e-start", "q1-e-scope", "q4-e-scope", "q1q3-e-level1", "q1q3-e-scope1"];

  it("プロフィールの対象級の種数が転記 p.137 の単品知識の階層（25/20/35種）と一致する", () => {
    const counts = { 3: 0, 2: 0, 1: 0 } as Record<number, number>;
    for (const u of U) if (u.kind === "spice-profile") counts[profileGrade(u.content)!]!++;
    expect(counts).toEqual({ 1: 35, 2: 20, 3: 25 }); // 最下級1=1級のみ35種、最下級2=2級追加20種、最下級3=3級25種
  });

  it("全問題の難易度が較正規則の再計算と一致し、較正不能な検定情報の8問だけが2に据え置かれる", () => {
    const held: string[] = [];
    for (const q of QUESTIONS) {
      const e = expected(q);
      if (e === null) { held.push(q.id); expect(q.difficulty, q.id).toBe(2); } // 据え置きは仮置きの2
      else expect(q.difficulty, q.id).toBe(e);
    }
    expect(held.sort()).toEqual([...HELD].sort());
    expect(META.d1HeldIds).toEqual(HELD); // 生成順のまま固定
    expect(META.d1HeldQuestions).toBe(8);
    expect(META.d1CalibratedQuestions).toBe(1787); // F2の29問・F3の11問も全件較正済み（DECISIONS #26・#27。監査B-08是正の再生成で四択15問が減り較正済みも15問減）
  });

  it("難易度分布の実測が固定値と一致する（較正前は全件2）", () => {
    const dist: Record<string, number> = {};
    for (const q of QUESTIONS) dist[q.difficulty] = (dist[q.difficulty] ?? 0) + 1;
    expect(dist).toEqual({ 1: 737, 2: 474, 3: 414, 4: 170 });
    expect(META.d1ByDifficulty).toEqual({ 1: 737, 2: 474, 3: 414, 4: 170 });
    // 較正済みのみの分布（2の474問のうち466問は較正済み、残り8問は据え置き）
    expect(META.d1CalibratedByDifficulty).toEqual({ 1: 737, 2: 466, 3: 414, 4: 170 });
  });
});

describe("追加形式F2（フェーズ6、DECISIONS #26）: 転記の番号付き手順による並べ替えと、支持文による短文記述", () => {
  const manual = JSON.parse(readFileSync(new URL("../scripts/f2-manual-questions.json", import.meta.url), "utf8")) as {
    ordering: { slug: string; title: string; unitIds: string[]; page: number; mode: string; items: string[]; mergeGroups?: number[][]; prompt: string; supportText?: string }[];
    shortEssay: { slug: string; unitId: string; prompt: string; supportPage: number; supportText: string; rubric: { id: string; label: string; keywords: string[]; required: boolean; points: number }[] }[];
    skipped: { target: string; reason: string }[];
  };
  const fragmentsByPage = new Map<number, string[]>();
  for (const pg of TRANSCRIPT_PAGES) {
    const frags: string[] = [];
    for (const b of pg.blocks) {
      if (b.text) frags.push(b.text);
      if (b.title) frags.push(b.title);
      if (b.rows) for (const row of b.rows) for (const cell of row) frags.push(cell);
    }
    fragmentsByPage.set(pg.bookPage, frags);
  }
  const ordering = QUESTIONS.filter((q) => q.format === "ordering");
  const essays = QUESTIONS.filter((q) => q.format === "short-essay");
  // 監査A3の mergeGroups から表示項目を再構成する（生成器 scripts/generate-questions.mjs と同じ規則）
  const displayItemsOf = (e: { items: string[]; mergeGroups?: number[][] }): string[] => {
    if (!e.mergeGroups) return [...e.items];
    expect(e.mergeGroups.flat(), "mergeGroups は原文手順の添字の分割").toEqual(e.items.map((_, i) => i));
    return e.mergeGroups.map((g) => g.map((i) => e.items[i]!).join(""));
  };

  it("F2は並べ替え17問・短文記述12問で、手書きデータと生成済み問題が一致する", () => {
    expect(ordering.length).toBe(17);
    expect(essays.length).toBe(12);
    expect(manual.ordering.length).toBe(17);
    expect(manual.shortEssay.length).toBe(12);
    expect(manual.skipped.length).toBe(11); // 見送った対象と理由の記録（監査A3で水やりの基本を並べ替えから外した分を含む）
    for (const s of manual.skipped) { expect(s.target.length).toBeGreaterThan(0); expect(s.reason.length).toBeGreaterThan(0); }
    for (const e of manual.ordering) {
      const q = ordering.find((x) => x.id === `qord-${e.slug}`)!;
      expect(q, e.slug).toBeTruthy();
      expect(q.prompt, q.id).toBe(e.prompt);
      expect(q.knowledgeUnitIds, q.id).toEqual(e.unitIds);
      // 監査A3（DECISIONS #28）: mergeGroups がある場合は独立工程を統合した表示項目が正解順序になる
      expect(q.correctOrder, q.id).toEqual(displayItemsOf(e));
    }
    for (const e of manual.shortEssay) {
      const q = essays.find((x) => x.id === `qse-${e.slug}`)!;
      expect(q, e.slug).toBeTruthy();
      expect(q.prompt, q.id).toBe(e.prompt);
      expect(q.knowledgeUnitIds, q.id).toEqual([e.unitId]);
      expect(q.modelAnswer, q.id).toBe(e.supportText);
      expect(q.rubric, q.id).toEqual(e.rubric);
      expect(q.explanation, q.id).toBe(byId.get(e.unitId)!.content);
    }
    // 独立検証パス（scripts/verify-f2-questions.mjs）の結果も固定する
    const report = JSON.parse(readFileSync(new URL("../scripts/f2-verification-report.json", import.meta.url), "utf8")) as {
      meta: { orderingEntries: number; orderingOk: number; shortEssayEntries: number; shortEssayOk: number; failures: number };
    };
    expect(report.meta).toMatchObject({ orderingEntries: 17, orderingOk: 17, shortEssayEntries: 12, shortEssayOk: 12, failures: 0 });
  });

  it("並べ替え: 項目文と正解順序が転記本文の番号付き手順と原文どおり一致する（根拠の機械チェック）", () => {
    for (const e of manual.ordering) {
      const frags = fragmentsByPage.get(e.page) ?? [];
      expect(e.items.length, e.slug).toBeGreaterThanOrEqual(3); // 3手順未満は自明なため作らない
      expect(new Set(e.items).size, e.slug).toBe(e.items.length);
      if (e.mode === "embedded") {
        const joined = e.items.map((t, i) => `${i + 1} ${t}`).join("。") + "。";
        expect(joined, e.slug).toBe(e.supportText);
        expect(frags.some((f) => f.includes(e.supportText!)), `${e.slug}: 支持文が転記 p.${e.page} にない`).toBe(true);
      } else {
        // blocks / headings: 「番号 + 半角空白 + 項目文」が転記フラグメントと完全一致する
        e.items.forEach((t, i) => expect(frags, `${e.slug}: 手順${i + 1}`).toContain(`${i + 1} ${t}`));
      }
      const q = ordering.find((x) => x.id === `qord-${e.slug}`)!;
      // 初期表示順は正解順序（mergeGroups 適用後の表示項目）の並べ替えで、正解順そのものではない
      const disp = displayItemsOf(e);
      expect(disp.length, e.slug).toBeGreaterThanOrEqual(3);
      expect([...(q.orderingItems ?? [])].sort(), q.id).toEqual([...disp].sort());
      expect(q.orderingItems, q.id).not.toEqual(q.correctOrder);
      for (const uid of e.unitIds) expect(byId.get(uid)!.status, q.id).toBe("verified");
    }
  });

  it("短文記述: 模範解答が転記に原文のまま存在し、要点キーワードがすべて支持文に字句として含まれる（根拠の機械チェック）", () => {
    for (const e of manual.shortEssay) {
      const frags = fragmentsByPage.get(e.supportPage) ?? [];
      expect(frags.some((f) => f.includes(e.supportText)), `${e.slug}: 支持文が転記 p.${e.supportPage} にない`).toBe(true);
      expect(e.rubric.length, e.slug).toBeGreaterThanOrEqual(2); // 要点2点以上の単位・節に限る
      for (const r of e.rubric) {
        expect(r.required, `${e.slug}/${r.id}`).toBe(true);
        for (const k of r.keywords) expect(e.supportText.includes(k), `${e.slug}/${r.id}: キーワード「${k}」`).toBe(true);
      }
      expect(byId.get(e.unitId)!.status, e.slug).toBe("verified");
    }
  });

  it("F2全形式が採点エンジンで正答を満点と判定する（出題・模試・分析が使う gradeQuestion への接続）", () => {
    for (const q of ordering) {
      const r = gradeQuestion(q, q.correctOrder);
      expect(r.correct, q.id).toBe(true);
      expect(r.scoreRatio, q.id).toBe(1);
      // 逆順は不正解（項目が3つ以上あるため正解順と必ず異なる）
      expect(gradeQuestion(q, [...(q.correctOrder ?? [])].reverse()).correct, q.id).toBe(false);
    }
    for (const q of essays) {
      const r = gradeQuestion(q, q.modelAnswer);
      // 監査AD-1: 記述式は模範解答でも correct を断定しない（要点充足率1.0のみ）
      expect(r.correct, q.id).toBeNull();
      expect(r.scoreRatio, q.id).toBe(1);
      expect(gradeQuestion(q, "").correct, q.id).toBe(false);
    }
  });
});

describe("追加形式F3（フェーズ6、DECISIONS #27）: 転記の複数段落の支持文による長文記述と、明示的な対比による比較記述", () => {
  const manual = JSON.parse(readFileSync(new URL("../scripts/f3-manual-questions.json", import.meta.url), "utf8")) as {
    longEssay: { slug: string; unitIds: string[]; prompt: string; supports: { page: number; text: string }[]; rubric: { id: string; label: string; keywords: string[]; required: boolean; points: number }[] }[];
    compareEssay: { slug: string; unitIds: string[]; prompt: string; supports: { page: number; text: string }[]; rubric: { id: string; label: string; keywords: string[]; required: boolean; points: number }[] }[];
    skipped: { target: string; reason: string }[];
  };
  const fragmentsByPage = new Map<number, string[]>();
  for (const pg of TRANSCRIPT_PAGES) {
    const frags: string[] = [];
    for (const b of pg.blocks) {
      if (b.text) frags.push(b.text);
      if (b.title) frags.push(b.title);
      if (b.rows) for (const row of b.rows) for (const cell of row) frags.push(cell);
    }
    fragmentsByPage.set(pg.bookPage, frags);
  }
  const longs = QUESTIONS.filter((q) => q.format === "long-essay");
  const compares = QUESTIONS.filter((q) => q.format === "compare-essay");
  const all = [
    ...manual.longEssay.map((e) => ({ e, q: longs.find((x) => x.id === `qle-${e.slug}`)! })),
    ...manual.compareEssay.map((e) => ({ e, q: compares.find((x) => x.id === `qce-${e.slug}`)! })),
  ];

  it("F3は長文記述4問・比較記述7問で、手書きデータと生成済み問題が一致する", () => {
    expect(longs.length).toBe(4);
    expect(compares.length).toBe(7);
    expect(manual.longEssay.length).toBe(4);
    expect(manual.compareEssay.length).toBe(7);
    expect(manual.skipped.length).toBe(11); // 見送った対象と理由の記録（長文5・比較5・写真識別1）
    for (const s of manual.skipped) { expect(s.target.length).toBeGreaterThan(0); expect(s.reason.length).toBeGreaterThan(0); }
    for (const { e, q } of all) {
      expect(q, e.slug).toBeTruthy();
      expect(q.prompt, q.id).toBe(e.prompt);
      expect(q.knowledgeUnitIds, q.id).toEqual(e.unitIds);
      expect(q.modelAnswer, q.id).toBe(e.supports.map((s) => s.text).join("\n"));
      expect(q.rubric, q.id).toEqual(e.rubric);
      expect(q.explanation, q.id).toBe(e.unitIds.map((id) => byId.get(id)!.content).join("\n"));
      for (const uid of e.unitIds) expect(byId.get(uid)!.status, q.id).toBe("verified");
    }
    // 独立検証パス（scripts/verify-f3-questions.mjs）の結果も固定する
    const report = JSON.parse(readFileSync(new URL("../scripts/f3-verification-report.json", import.meta.url), "utf8")) as {
      meta: { longEssayEntries: number; longEssayOk: number; compareEssayEntries: number; compareEssayOk: number; failures: number };
    };
    expect(report.meta).toMatchObject({ longEssayEntries: 4, longEssayOk: 4, compareEssayEntries: 7, compareEssayOk: 7, failures: 0 });
  });

  it("支持文が転記に原文のまま存在し、要点キーワードがすべて支持範囲に字句として含まれる（根拠の機械チェック）", () => {
    for (const { e } of all) {
      const union = e.supports.map((s) => s.text).join("\n");
      for (const s of e.supports) {
        const frags = fragmentsByPage.get(s.page) ?? [];
        expect(frags.some((f) => f.includes(s.text)), `${e.slug}: 支持文が転記 p.${s.page} にない`).toBe(true);
      }
      expect(e.rubric.length, e.slug).toBeGreaterThanOrEqual(4); // 長文・比較とも要点4点以上
      for (const r of e.rubric) {
        expect(r.required, `${e.slug}/${r.id}`).toBe(true);
        for (const k of r.keywords) expect(union.includes(k), `${e.slug}/${r.id}: キーワード「${k}」`).toBe(true);
      }
    }
  });

  it("長文記述は短文記述との区別基準（DECISIONS #27）を満たす: 支持範囲2ブロック以上・模範解答300字以上・5文以上", () => {
    for (const e of manual.longEssay) {
      const union = e.supports.map((s) => s.text).join("\n");
      expect(e.supports.length, e.slug).toBeGreaterThanOrEqual(2);
      expect(union.length, e.slug).toBeGreaterThanOrEqual(300);
      expect((union.match(/。/g) ?? []).length, e.slug).toBeGreaterThanOrEqual(5);
    }
    // 参考: F2の短文記述は支持文が単一ブロックで最大201字（基準未満）であること
    const f2 = JSON.parse(readFileSync(new URL("../scripts/f2-manual-questions.json", import.meta.url), "utf8")) as { shortEssay: { supportText: string }[] };
    for (const e of f2.shortEssay) expect(e.supportText.length).toBeLessThan(300);
  });

  it("F3全形式が採点エンジンで模範解答を満点と判定する（出題・模試・分析が使う gradeQuestion への接続）", () => {
    for (const q of [...longs, ...compares]) {
      const r = gradeQuestion(q, q.modelAnswer);
      // 監査AD-1: 記述式は模範解答でも correct を断定しない（要点充足率1.0のみ）
      expect(r.correct, q.id).toBeNull();
      expect(r.scoreRatio, q.id).toBe(1);
      expect(gradeQuestion(q, "").correct, q.id).toBe(false);
    }
  });
});

describe("F2/F3形式の意味的監査バッチA3（フェーズ6、DECISIONS #28）", () => {
  const verdicts = JSON.parse(readFileSync(new URL("../scripts/f2f3-audit-a3-verdicts.json", import.meta.url), "utf8")) as {
    verdicts: { questionId: string; format: string; verdict: string; basis: string; fix?: string }[];
  };
  const report = JSON.parse(readFileSync(new URL("../scripts/f2f3-audit-a3-report.json", import.meta.url), "utf8")) as {
    meta: { targets: number; verdicts: Record<string, number> };
  };
  const q = (id: string) => QUESTIONS.find((x) => x.id === id)!;

  it("対象41問（監査時点）の全件に判定と根拠があり、集約が一致する", () => {
    expect(report.meta.targets).toBe(41);
    expect(verdicts.verdicts.length).toBe(41);
    expect(report.meta.verdicts).toEqual({ "真の問題": 15, "問題なし": 22, "要確認": 4 });
    const byFormat: Record<string, number> = {};
    for (const v of verdicts.verdicts) {
      byFormat[v.format] = (byFormat[v.format] ?? 0) + 1;
      expect(v.basis.length, v.questionId).toBeGreaterThan(0);
      if (v.verdict === "真の問題") expect(v.fix, v.questionId).toBeTruthy();
    }
    expect(byFormat).toEqual({ ordering: 18, "short-essay": 12, "long-essay": 4, "compare-essay": 7 });
  });

  it("並べ替え: 統合された5問は表示項目が依存鎖になり、水やりの基本は取り下げられた", () => {
    const merged: Record<string, number> = { "qord-curry": 5, "qord-genovese": 3, "qord-paella": 5, "qord-lamb": 3, "qord-currywurst": 3 };
    for (const [id, n] of Object.entries(merged)) expect(q(id).correctOrder!.length, id).toBe(n);
    expect(QUESTIONS.some((x) => x.id === "qord-watering")).toBe(false);
    const f2 = JSON.parse(readFileSync(new URL("../scripts/f2-manual-questions.json", import.meta.url), "utf8")) as { skipped: { target: string; reason: string }[] };
    expect(f2.skipped.some((s) => s.target.includes("水やりの基本") && s.reason.includes("監査A3"))).toBe(true);
  });

  it("記述式: 設問カバレッジの要点追加により、列挙のみ・誤帰属の回答は満点にならない", () => {
    // food-functions: 3機能の列挙のみ／優れている機能の誤帰属は満点でない
    expect(gradeQuestion(q("qse-food-functions"), "食品の3つの機能は栄養機能、嗜好機能、生体調節機能である。").correct).not.toBe(true);
    expect(gradeQuestion(q("qse-food-functions"), "食品の3つの機能は栄養機能、嗜好機能、生体調節機能であり、とりわけ栄養機能に優れている。").correct).not.toBe(true);
    // herb-bath: ドライの作り方を誤ると満点でない
    expect(gradeQuestion(q("qse-herb-bath"), "ドライハーブは約20g、フレッシュハーブはひとつかみ程度。フレッシュはだし袋に入れて湯船に入れる。ドライはそのまま湯船に入れる。").correct).not.toBe(true);
    // salt-reduction: 日本食の課題を欠くと満点でない
    expect(gradeQuestion(q("qle-salt-reduction"), "塩分の摂りすぎは高血圧や心血管疾患などのリスクを高める。男性7.5g未満、女性6.5g未満が目安。「適塩」という考え方が広まり、スパイスやハーブの香りや辛みが薄味の物足りなさを補ってくれる。").correct).not.toBe(true);
  });

  it("記述式: 語幹化・代替キーワードにより、常体や括弧注記を省略した原文どおりの回答が満点（要点充足率1.0）になる", () => {
    // 監査AD-1: 満点は要点充足率1.0を指し、correct は自動では断定されない（null）
    const tm = gradeQuestion(q("qle-traditional-medicine"), "多くの伝統医学はホリスティックな視点に基づき、体と心の両面に働きかけ自然治癒力を引き出す。インドのアーユルヴェーダは「ヴァータ」「ピッタ」「カパ」の3要素でとらえる。中国医学は陰陽五行説に基づいて体系化された。ギリシア発祥の伝統医学は現在の西洋ハーブ医学（メディカルハーブ）にも通じている。コミッションEのモノグラフは正確な情報として評価されている。");
    expect(tm.scoreRatio).toBe(1);
    expect(tm.correct).toBeNull();
    const fs = gradeQuestion(q("qle-food-safety"), "安全性は科学的な根拠に基づいて論じることが基本で、「食経験」が、安全性の裏づけになっている。保健機能食品は「特定保健用食品」「栄養機能食品」「機能性表示食品」で、それ以外は機能（効果）に関する表示をして販売することもできません。食べ物や栄養の影響を過大に信じる傾向はフードファディズムと呼ばれる。情報の出どころや科学的根拠の有無を確認することが大切だ。");
    expect(fs.scoreRatio).toBe(1);
    expect(fs.correct).toBeNull();
  });

  it("比較記述: 属性を全面入れ替えした回答は満点にならない（主語結合キーワード）", () => {
    const cinnamonSwap = "カシアは主にスリランカで採れる種類で、樹皮が薄いのが特徴。シナモンは主にベトナム、中国で生産される種類で、樹皮は厚いのが特徴。カシアは柑橘系の爽やかで上品な香り、シナモンは甘く濃厚な香りに特徴がある。";
    const r = gradeQuestion(q("qce-cinnamon-cassia"), cinnamonSwap);
    expect(r.correct).not.toBe(true);
    expect(r.scoreRatio).toBeLessThan(1);
    const potsSwap = "プラスチック製は通気性（水はけ）はよいが、夏は乾燥しやすい。素焼き製は軽いという長所があるが、通気性が悪くて蒸れやすい。重さは素焼き製よりプラスチック製が重い。";
    expect(gradeQuestion(q("qce-pots"), potsSwap).correct).not.toBe(true);
  });
});

describe("難易度較正D1（フェーズ6、DECISIONS #22）: 学習分析への接続", () => {
  it("学習分析の難易度別集計が新分布で破綻しない（stats.ts の byDifficulty）", () => {
    const picks = [1, 2, 3, 4].map((d) => QUESTIONS.find((q) => q.difficulty === d)!);
    for (const p of picks) expect(p, `難易度${p?.difficulty}`).toBeTruthy();
    const records = picks.map((q, i) => ({ questionId: q.id, answeredAt: "2026-10-30T00:00:00Z", correct: i % 2 === 0, scoreRatio: null, autoScoreRatio: null, selfScoreRatio: null, responseMs: null }));
    const st = computeStats(records, QUESTIONS);
    expect([...st.byDifficulty.keys()].sort()).toEqual(["1", "2", "3", "4"]);
    for (const [, v] of st.byDifficulty) expect(v.total).toBe(1);
    expect(st.total).toBe(4);
    // 回答記録がなくても集計は空で返る（表示側は0件を扱える）
    expect(computeStats([], QUESTIONS).byDifficulty.size).toBe(0);
  });
});

describe("修正バッチFIX1（DECISIONS #34）: 用語カード・逆引きカード", () => {
  const parse = (c: string) => {
    const g = (re: RegExp) => c.match(re)?.[1] ?? null;
    return { name: g(/^(.+?):\s/)!, aliasesRaw: g(/別名は(.+?)。/) };
  };
  const aliasBase = (t: string) => t.replace(/[(（].*$/, "").trim();
  const profiles = U.filter((u) => u.kind === "spice-profile" && u.status === "verified");
  const cardById = new Map(CARDS.map((c) => [c.id, c]));

  it("種別（kind）が全カードに付き、種別別件数が実測と一致する", () => {
    const counts: Record<string, number> = {};
    for (const c of CARDS) {
      const expected = c.id.startsWith("card-term-") ? "term" : c.id.startsWith("card-rev-") ? "reverse" : c.id.startsWith("card-profile-") ? "profile" : "qa";
      expect(c.kind, c.id).toBe(expected);
      counts[expected] = (counts[expected] ?? 0) + 1;
    }
    expect(counts).toEqual({ qa: 379, profile: 80, term: 80, reverse: 63 });
    expect(profiles.length).toBe(80); // 図鑑エントリ82種のうち続きページ2件は独立プロフィール単位を持たない
  });

  it("用語カード: 表=名称、裏=プロフィール content から接頭辞を除いた要点で、全プロフィール分ある", () => {
    for (const u of profiles) {
      const card = cardById.get(`card-term-${u.id}`);
      expect(card, u.id).toBeTruthy();
      const p = parse(u.content);
      expect(card!.front, card!.id).toBe(p.name);
      expect(card!.back, card!.id).toBe(u.content.replace(/^.+?:\s/, ""));
      expect(card!.knowledgeUnitIds, card!.id).toEqual([u.id]);
      expect(card!.status, card!.id).toBe("verified");
    }
  });

  it("逆引きカード: 表は名称・別名を含まない検証済み事実で、用語カードと reverseOf で相互リンクする", () => {
    const revCards = CARDS.filter((c) => c.id.startsWith("card-rev-"));
    expect(revCards.length).toBe(63);
    for (const c of revCards) {
      const profileUnit = byId.get(c.knowledgeUnitIds[0]!)!;
      const factUnit = byId.get(c.knowledgeUnitIds[1]!)!;
      expect(profileUnit.kind, c.id).toBe("spice-profile");
      expect(factUnit.kind, c.id).toBe("spice-fact");
      expect(factUnit.status, c.id).toBe("verified");
      expect(factUnit.spice?.id, c.id).toBe(profileUnit.spice?.id);
      const p = parse(profileUnit.content);
      expect(c.front, c.id).toBe(factUnit.content);
      expect(c.back, c.id).toBe(p.name);
      const forbidden = [p.name, ...p.name.split("/").map((s) => s.trim()), ...((p.aliasesRaw ?? "").split("、").map(aliasBase))].filter(Boolean);
      for (const v of forbidden) expect(c.front.includes(v), `${c.id}: 表に「${v}」が含まれる`).toBe(false);
      expect(c.reverseOf, c.id).toBe(`card-term-${profileUnit.id}`);
      expect(cardById.get(c.reverseOf!)!.reverseOf, c.id).toBe(c.id);
      expect(c.sourceRefs.length, c.id).toBe(2);
      expect(c.sourceRefs[1]!.bookPage, c.id).toBe(factUnit.source.page);
    }
    // 逆引きのないプロフィールは実測17種（名称を含む事実しかない種）
    const withoutReverse = profiles.filter((u) => !cardById.has(`card-rev-${u.id}`));
    expect(withoutReverse.length).toBe(17);
  });
});

// 監査B-07/B-08是正の回帰固定（docs/AUDIT_DECISIONS.md AD-5/AD-6、2026-10-30再生成）。
describe("監査是正: 別名許容（B-07）と四択の同次元化（B-08）", () => {
  const byId = new Map(QUESTIONS.map((q) => [q.id, q]));
  it("B-07: 逆引き問題はプロフィールの別名を許容する（コリアンダー=パクチー等）", () => {
    const coriander = byId.get("qti-rev-coriander-profile");
    expect(coriander?.acceptedAnswers).toContain("パクチー");
    const garlic = byId.get("qti-rev-garlic-profile");
    expect(garlic?.prompt).toBe("別名「にんにく」と呼ばれるスパイス＆ハーブの名称を答えよ。");
    expect(garlic?.acceptedAnswers).toContain("大蒜");
    // AU-04（DECISIONS #54）: 問題文に示した別名そのもの（にんにく）は、写せば正解になるため許容しない
    expect(garlic?.acceptedAnswers).not.toContain("にんにく");
  });
  it("AU-04: 入力式の許容回答は、問題文の「」内の語（括弧注記を除いた基部を含む）の写しを含まない", () => {
    const strip = (s: string) => s.replace(/[（(][^）)]*[）)]/g, "");
    const offenders: string[] = [];
    let checked = 0;
    for (const q of QUESTIONS) {
      if (!["one-answer", "fill-blank", "term-input"].includes(q.format)) continue;
      const quoted = new Set([...q.prompt.matchAll(/「([^」]+)」/g)].map((m) => normalizeText(m[1]!)));
      if (quoted.size) checked++;
      for (const a of q.acceptedAnswers ?? []) if (quoted.has(normalizeText(a)) || quoted.has(normalizeText(strip(a)))) offenders.push(`${q.id}:${a}`);
      expect((q.acceptedAnswers ?? []).length, q.id).toBeGreaterThan(0);
    }
    expect(checked).toBeGreaterThan(60); // 空集合で成功しないこと（引用語を持つ入力式問題が実在する）
    expect(offenders).toEqual([]);
    expect(byId.get("q1-cumin-4")?.acceptedAnswers).toEqual(["ニゲラ", "カロンジ"]);
    expect(byId.get("q1-b-part-leaf")?.prompt).toBe("タイム、ローレル、セージ、バジルが分類される利用部位は?");
  });
  it("AU-06: 二者択一・可否の設問は四択にしない（一問一答としては残る）", () => {
    for (const id of ["u-wash", "u-pairing", "cinnamon-1", "turmeric-3", "chp-2", "gal-1", "g-timing", "g-harvest-api", "b-cooking-care"]) {
      expect(byId.has(`q4-${id}`), id).toBe(false);
      expect(byId.has(`q1-${id}`), id).toBe(true);
    }
    for (const q of QUESTIONS) if (q.id.startsWith("q4-")) expect(/どちら/.test(q.prompt), q.id).toBe(false);
  });
  it("B-07: 一問一答の正答がスパイス名なら別名も許容する（ターメリック=うこん）", () => {
    const curry = byId.get("q1-r-curry");
    expect(curry?.acceptedAnswers).toContain("ターメリック");
    expect(curry?.acceptedAnswers).toContain("うこん");
  });
  it("B-08: 温度の四択は誤答も全て温度（単位クラスが混在しない）", () => {
    const t = byId.get("q4-b-basil-temp");
    expect(t).toBeDefined();
    for (const c of t?.choices ?? []) expect(c).toMatch(/度$/);
  });
  it("B-08: 科名の四択は誤答も全て科名", () => {
    const f = byId.get("q4-lemongrass-1");
    expect(f).toBeDefined();
    for (const c of f?.choices ?? []) expect(c).toMatch(/科$/);
  });
  it("B-08: 同次元の誤答を3つ用意できない四択は生成しない（プール不足の脱落を固定）", () => {
    // 人物名の照合済み回答は全書で3件しかなく、人物の四択は成立しない。
    // 知識自体は一問一答（q1）側で引き続き出題される。
    for (const id of ["q4-h-hippocrates", "q4-shichimi-2", "q4-d-mojito", "q4-t-cup", "q4-j-todaiji"]) {
      expect(byId.has(id), id).toBe(false);
    }
    expect(byId.has("q1-h-hippocrates")).toBe(true);
  });
  it("B-07: 別名展開の対象問題数は生成メタに記録される（128問）", () => {
    expect(META.aliasExpandedQuestions).toBe(128);
  });
});
