/**
 * 生成物（薄い集約モジュール） — 手で編集しないこと。再生成: node scripts/generate-questions.mjs
 * 正式問題・正式カードの生成物。生成元は原文照合済み（verified）知識単位のみ:
 * draftQa の直接変換（第一弾）と、プロフィール単位の構造化属性からの生成（拡充Q2、DECISIONS #18）、
 * 散文単位の転記支持文に基づく人手作成一問一答（拡充Q3、DECISIONS #19）、
 * プロフィール属性から機械検証できる追加7形式の生成（拡充F1、DECISIONS #21）、
 * 転記本文の番号付き手順・支持文に基づく人手作成の並べ替え・短文記述（追加形式F2、DECISIONS #26）、
 * 転記本文の複数段落の支持文・明示的な対比に基づく人手作成の長文記述・比較記述（追加形式F3、DECISIONS #27）、
 * プロフィール単位からの用語カードと、名称を含まない検証済み事実からの逆引きカード（修正バッチFIX1、DECISIONS #34）。
 * 難易度は較正D1（DECISIONS #22）で、出題範囲の階層と形式負荷に基づく相対指標として付与する
 * （実際の受験者の正答率ではない。較正できない問題は2に据え置き、メタの d1HeldIds に記録）。
 * データ本体は src/data/questions/ 配下の章別分割JSON（全ファイル128KB未満）。
 */
import type { Question, Flashcard } from "../domain/types";
import formalPreface1 from "./questions/formal-preface-1.json";
import formalPreface2 from "./questions/formal-preface-2.json";
import formalCh11 from "./questions/formal-ch1-1.json";
import formalCh12 from "./questions/formal-ch1-2.json";
import formalCh21 from "./questions/formal-ch2-1.json";
import formalCh22 from "./questions/formal-ch2-2.json";
import formalCh23 from "./questions/formal-ch2-3.json";
import formalCh24 from "./questions/formal-ch2-4.json";
import formalCh25 from "./questions/formal-ch2-5.json";
import formalCh26 from "./questions/formal-ch2-6.json";
import formalCh27 from "./questions/formal-ch2-7.json";
import formalCh28 from "./questions/formal-ch2-8.json";
import formalCh29 from "./questions/formal-ch2-9.json";
import formalCh210 from "./questions/formal-ch2-10.json";
import formalCh211 from "./questions/formal-ch2-11.json";
import formalCh212 from "./questions/formal-ch2-12.json";
import formalCh213 from "./questions/formal-ch2-13.json";
import formalCh214 from "./questions/formal-ch2-14.json";
import formalCh215 from "./questions/formal-ch2-15.json";
import formalCh31 from "./questions/formal-ch3-1.json";
import formalCh32 from "./questions/formal-ch3-2.json";
import formalAppendix from "./questions/formal-appendix.json";
import cardsPreface from "./questions/cards-preface.json";
import cardsCh1 from "./questions/cards-ch1.json";
import cardsCh21 from "./questions/cards-ch2-1.json";
import cardsCh22 from "./questions/cards-ch2-2.json";
import cardsCh3 from "./questions/cards-ch3.json";
import cardsAppendix from "./questions/cards-appendix.json";
export const QUESTION_GENERATION_META = {
  "generatedBy": "scripts/generate-questions.mjs",
  "sourceUnitsTotal": 545,
  "eligibleUnits": 379,
  "profileEligibleUnits": 80,
  "q3Units": 86,
  "q3Questions": 86,
  "f1ByKind": {
    "tf-family-true": 68,
    "tf-family-false": 68,
    "tf-part-true": 68,
    "tf-part-false": 68,
    "mc-family": 14,
    "mc-part": 11,
    "mc-origin": 7,
    "match-family": 17,
    "match-part": 17,
    "match-origin": 9,
    "reverse-alias": 60,
    "table-profile": 68,
    "composite-profile": 68,
    "figure-table": 17
  },
  "f1Questions": 560,
  "f1SkippedItems": 71,
  "f2ByKind": {
    "ordering": 17,
    "short-essay": 12
  },
  "f2Questions": 29,
  "f2SkippedItems": 11,
  "f3ByKind": {
    "long-essay": 4,
    "compare-essay": 7
  },
  "f3Questions": 11,
  "f3SkippedItems": 11,
  "q2ByKind": {
    "family-fill": 68,
    "level-fill": 80,
    "part-choice": 68,
    "origin-choice": 39,
    "alias-term": 60,
    "reverse-term": 60,
    "profile-card": 80
  },
  "q2Questions": 375,
  "formalQuestions": 1795,
  "byFormat": {
    "one-answer": 465,
    "single-choice": 462,
    "fill-blank": 148,
    "term-input": 120,
    "true-false": 272,
    "table-fill": 68,
    "composite": 68,
    "reverse-lookup": 60,
    "multiple-choice": 32,
    "matching": 43,
    "figure": 17,
    "ordering": 17,
    "short-essay": 12,
    "long-essay": 4,
    "compare-essay": 7
  },
  "d1ByDifficulty": {
    "1": 737,
    "2": 474,
    "3": 414,
    "4": 170
  },
  "d1CalibratedByDifficulty": {
    "1": 737,
    "2": 466,
    "3": 414,
    "4": 170
  },
  "d1CalibratedQuestions": 1787,
  "d1HeldQuestions": 8,
  "d1HeldIds": [
    "q1-e-org",
    "q4-e-org",
    "q1-e-start",
    "q4-e-start",
    "q1-e-scope",
    "q4-e-scope",
    "q1q3-e-level1",
    "q1q3-e-scope1"
  ],
  "formalCards": 602,
  "aliasExpandedQuestions": 128,
  "fix1ByKind": {
    "term-card": 80,
    "reverse-card": 63
  },
  "fix1Cards": 143,
  "fix1SkippedItems": 17,
  "excludedItems": 129,
  "excludedUnits": 0,
  "files": [
    "formal-preface-1.json",
    "formal-preface-2.json",
    "formal-ch1-1.json",
    "formal-ch1-2.json",
    "formal-ch2-1.json",
    "formal-ch2-2.json",
    "formal-ch2-3.json",
    "formal-ch2-4.json",
    "formal-ch2-5.json",
    "formal-ch2-6.json",
    "formal-ch2-7.json",
    "formal-ch2-8.json",
    "formal-ch2-9.json",
    "formal-ch2-10.json",
    "formal-ch2-11.json",
    "formal-ch2-12.json",
    "formal-ch2-13.json",
    "formal-ch2-14.json",
    "formal-ch2-15.json",
    "formal-ch3-1.json",
    "formal-ch3-2.json",
    "formal-appendix.json",
    "cards-preface.json",
    "cards-ch1.json",
    "cards-ch2-1.json",
    "cards-ch2-2.json",
    "cards-ch3.json",
    "cards-appendix.json"
  ]
} as const;
export const FORMAL_QUESTIONS: Question[] = [
  ...(formalPreface1 as unknown as Question[]),
  ...(formalPreface2 as unknown as Question[]),
  ...(formalCh11 as unknown as Question[]),
  ...(formalCh12 as unknown as Question[]),
  ...(formalCh21 as unknown as Question[]),
  ...(formalCh22 as unknown as Question[]),
  ...(formalCh23 as unknown as Question[]),
  ...(formalCh24 as unknown as Question[]),
  ...(formalCh25 as unknown as Question[]),
  ...(formalCh26 as unknown as Question[]),
  ...(formalCh27 as unknown as Question[]),
  ...(formalCh28 as unknown as Question[]),
  ...(formalCh29 as unknown as Question[]),
  ...(formalCh210 as unknown as Question[]),
  ...(formalCh211 as unknown as Question[]),
  ...(formalCh212 as unknown as Question[]),
  ...(formalCh213 as unknown as Question[]),
  ...(formalCh214 as unknown as Question[]),
  ...(formalCh215 as unknown as Question[]),
  ...(formalCh31 as unknown as Question[]),
  ...(formalCh32 as unknown as Question[]),
  ...(formalAppendix as unknown as Question[]),
];
export const FORMAL_CARDS: Flashcard[] = [
  ...(cardsPreface as unknown as Flashcard[]),
  ...(cardsCh1 as unknown as Flashcard[]),
  ...(cardsCh21 as unknown as Flashcard[]),
  ...(cardsCh22 as unknown as Flashcard[]),
  ...(cardsCh3 as unknown as Flashcard[]),
  ...(cardsAppendix as unknown as Flashcard[]),
];
