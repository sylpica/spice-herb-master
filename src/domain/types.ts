
export const QUESTION_FORMATS = ["single-choice","multiple-choice","true-false","fill-blank","term-input","one-answer","short-essay","long-essay","compare-essay","ordering","matching","reverse-lookup","photo-id","figure","table-fill","composite","flashcard"] as const;
export type QuestionFormat = typeof QUESTION_FORMATS[number];
export const FORMAT_LABELS: Record<QuestionFormat,string> = {"single-choice":"四択","multiple-choice":"多択","true-false":"正誤判定","fill-blank":"穴埋め","term-input":"用語入力","one-answer":"一問一答","short-essay":"短文記述","long-essay":"長文記述","compare-essay":"比較記述","ordering":"順序並べ替え","matching":"組み合わせ","reverse-lookup":"逆引き","photo-id":"写真を用いた識別","figure":"図表を用いた問題","table-fill":"表の穴埋め","composite":"複数知識の組み合わせ","flashcard":"フラッシュカード"};
export type VerificationStatus = "unprocessed"|"extracted"|"needs-check"|"collated"|"unclear"|"missing";
/** 問題・カードの状態。エンジン検証用サンプルの状態 "sample" は、サンプルの全削除（DECISIONS #52）に伴い型からも削除した（監査AU-10、#54）。 */
export type QuestionStatus = "verified"|"unverified"|"excluded";
export interface SourceRef { manifestImageId: string; bookPage: number|null; locationNote: string; }
export interface KnowledgeUnit { id: string; materialId: string; materialVersion: string; chapterId: string; sectionId: string; bookPage: number|null; sourceRefs: SourceRef[]; content: string; category: string; relatedTerms: string[]; relatedUnitIds: string[]; verificationStatus: VerificationStatus; questionIds: string[]; cardIds: string[]; }
export interface RubricPoint {
  id: string; label: string; keywords: string[]; required: boolean; points: number;
  /** G1（DECISIONS #29）: 近接AND結合キーワード群。各群は断片の配列で、全断片が順序どおり・近接（gradeEssayRubric の PROXIMITY_MAX_GAP 以内の間隔）して現れた場合に一致する。群同士は OR、keywords とも OR。助詞挿入で落ちる「材料名＋分量」「対象名＋値」の連結要点用。 */
  keywordGroups?: string[][];
  /** G1（DECISIONS #29）: 比較記述の対象名（主語）。同一ルーブリック内の subject の出現で回答を区間分割し、この要点は自対象の区間内でのみキーワード一致を判定する（回答に対象名が現れない場合は従来どおり全文判定へフォールバックする）。 */
  subject?: string;
}
export interface Question {
  id: string; version: number; format: QuestionFormat; status: QuestionStatus;
  chapterId: string; sectionId: string; difficulty: 1|2|3|4|5;
  prompt: string; choices?: string[]; correctChoiceIndexes?: number[]; correctBoolean?: boolean;
  acceptedAnswers?: string[]; modelAnswer?: string; rubric?: RubricPoint[];
  orderingItems?: string[]; correctOrder?: string[]; matchingPairs?: {left:string;right:string}[];
  table?: { headers: string[]; rows: string[][] }; blankCellAnswers?: Record<string,string>;
  imageAlt?: string; imageRef?: string|null;
  explanation: string; knowledgeUnitIds: string[]; sourceRefs: SourceRef[];
}
/** カードの種別（FIX1で導入）。未設定のカードは ID 接頭辞から判定する（後方互換、domain/cards.ts の cardKindOf）。 */
export type FlashcardKind = "qa" | "profile" | "term" | "reverse";
export interface Flashcard { id: string; kind?: FlashcardKind; front: string; back: string; reverseOf?: string|null; chapterId: string; sectionId: string; status: QuestionStatus; knowledgeUnitIds: string[]; sourceRefs: SourceRef[]; }
/** Claude版ブランチから取り込んだ知識単位（フェーズ2統合）。原則 unverified: 原本画像との人手照合を終えた単位だけが、scripts/collation-overrides.json 経由で verified になる。 */
export interface KnowledgeSource { page: number; sourceUnitId: string; origin: "claude/build-learning-app"; }
/** 原文照合の記録（照合済み単位にのみ付く）。batch は scripts/collation-overrides.json のバッチID。 */
export interface CollationRecord { batch: string|null; reason: string; needsReview: boolean; }
export interface ImportedKnowledgeUnit {
  id: string; kind: "unit"|"spice-fact"|"spice-profile"; status: "unverified"|"verified";
  chapterId: string; sectionTitle: string; category: string; content: string;
  source: KnowledgeSource;
  draftQa: { q: string; a: string; alt: string[] } | null;
  spice: { id: string; name: string; en: string|null } | null;
  collation: CollationRecord | null;
}
export interface AnswerRecord { questionId: string; answeredAt: string; correct: boolean|null; scoreRatio: number|null; autoScoreRatio: number|null; selfScoreRatio: number|null; responseMs: number|null; selfEval?: "known"|"unsure"|"unknown"|null; mistakeCause?: string|null; }
export interface SrsState { itemId: string; easeFactor: number; intervalDays: number; repetitions: number; dueAt: string; lastReviewedAt: string|null; }
export interface ReaderState { sectionId: string; fontSize: number; dark: boolean; bookmarks: string[]; highlights: Record<string,string>; notes: Record<string,string>; }
