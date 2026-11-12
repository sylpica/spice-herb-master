import {
  QUESTION_FORMATS,
  type QuestionFormat,
  type QuestionStatus,
} from "./types";

/**
 * 横断検索の複合フィルタ（フェーズ7・バッチS1 = DECISIONS #31、
 * バッチS2で次元内複数選択と節・状態・転記状態を追加 = DECISIONS #33）。
 *
 * キーワードのマッチ仕様（正規化はしない）:
 * - 教材（節）: タイトルまたは転記本文（監査C-15で本文を追加）に
 *   キーワードを含むもの。本文は呼び出し側が bodyText として付与する
 *   （付与がない節はタイトルだけで判定する）
 * - 問題: 問題文にキーワードを含むもの
 * - キーワードが空なら全件が対象になる
 * - 条件なし（DEFAULT_SEARCH_FILTERS）では従来どおり全件になる
 *
 * 組み合わせ仕様:
 * - 次元間は AND: 異なる次元の条件を1つ足すと、結果は単調に絞られるか
 *   不変になる（キーワード・種別・難易度・節・状態・転記状態も同じ）。
 * - 章・問題形式は次元内複数選択（OR）: その次元に値を1つ足すと、結果は
 *   単調に広がるか不変になる。空配列は無条件（「すべて」）。
 * - 問題形式・難易度・問題の状態は問題固有の属性のため、指定した場合は
 *   その属性を持たない教材（節）を対象外にする（AND 条件を満たさないため）。
 * - 節は、節そのもの（1件）とその節に属する問題の双方に適用する。
 * - 転記状態は、節には節自身の transcriptionStatus で、問題には所属する
 *   節の転記状態（呼び出し側が sectionTranscriptionStatus として付与する）
 *   で適用する。付与がない問題は、転記状態を指定した場合は一致しない。
 */

export type SearchTarget = "all" | "sections" | "questions";

export interface SearchFilters {
  keyword: string;
  target: SearchTarget;
  /** 章 ID の複数選択（次元内 OR）。空配列は無条件。 */
  chapterIds: string[];
  /** 問題形式の複数選択（次元内 OR）。空配列は無条件。 */
  formats: QuestionFormat[];
  /** 難易度（実分布 1〜4 のみ、単一選択）。null は無条件。 */
  difficulty: 1 | 2 | 3 | 4 | null;
  /** 節 ID（単一選択）。null は無条件。 */
  sectionId: string | null;
  /** 問題の状態（単一選択、問題固有）。null は無条件。 */
  status: QuestionStatus | null;
  /** 転記状態（単一選択）。null は無条件。 */
  transcriptionStatus: string | null;
}

export const DEFAULT_SEARCH_FILTERS: SearchFilters = {
  keyword: "",
  target: "all",
  chapterIds: [],
  formats: [],
  difficulty: null,
  sectionId: null,
  status: null,
  transcriptionStatus: null,
};

/** 難易度の選択肢。実データの分布は 1〜4 のみ（5 の問題は存在しない）。 */
export const SEARCH_DIFFICULTIES = [1, 2, 3, 4] as const;

/** 問題固有の条件（形式・難易度・状態）が1つでも指定されているか。 */
export function hasQuestionOnlyFilter(filters: SearchFilters): boolean {
  return (
    filters.formats.length > 0 ||
    filters.difficulty !== null ||
    filters.status !== null
  );
}

/** キーワード以外も含め、何らかの条件が有効か。 */
export function hasActiveSearchFilters(filters: SearchFilters): boolean {
  return (
    filters.keyword !== "" ||
    filters.target !== "all" ||
    filters.chapterIds.length > 0 ||
    filters.formats.length > 0 ||
    filters.difficulty !== null ||
    filters.sectionId !== null ||
    filters.status !== null ||
    filters.transcriptionStatus !== null
  );
}

export interface SearchableSection {
  id: string;
  title: string;
  chapterId: string;
  transcriptionStatus: string;
  /** 転記本文の連結テキスト（キーワード検索用、監査C-15）。未転記の節は未付与でよい。 */
  bodyText?: string;
}

/**
 * キーワードが本文のどこに現れるかを示す抜粋（監査C-15）。
 * 最初の出現位置の前後 radius 文字を返し、切り取った側に「…」を付ける。
 * 見つからなければ null。
 */
export function keywordExcerpt(text: string, keyword: string, radius = 30): string | null {
  if (!keyword) return null;
  const idx = text.indexOf(keyword);
  if (idx < 0) return null;
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + keyword.length + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

export interface SearchableQuestion {
  id: string;
  prompt: string;
  chapterId: string;
  sectionId: string;
  format: QuestionFormat;
  difficulty: number;
  status: QuestionStatus;
  /** 所属する節の転記状態（呼び出し側が節データから付与する）。 */
  sectionTranscriptionStatus?: string;
}

export function filterSearchSections<T extends SearchableSection>(
  sections: readonly T[],
  filters: SearchFilters,
): T[] {
  if (filters.target === "questions") return [];
  // 形式・難易度・状態は節に存在しない属性のため、指定時は AND を満たさず対象外
  if (hasQuestionOnlyFilter(filters)) return [];
  return sections.filter(
    (s) =>
      (!filters.keyword ||
        s.title.includes(filters.keyword) ||
        (s.bodyText?.includes(filters.keyword) ?? false)) &&
      (filters.chapterIds.length === 0 ||
        filters.chapterIds.includes(s.chapterId)) &&
      (!filters.sectionId || s.id === filters.sectionId) &&
      (!filters.transcriptionStatus ||
        s.transcriptionStatus === filters.transcriptionStatus),
  );
}

export function filterSearchQuestions<T extends SearchableQuestion>(
  questions: readonly T[],
  filters: SearchFilters,
): T[] {
  if (filters.target === "sections") return [];
  return questions.filter(
    (x) =>
      (!filters.keyword || x.prompt.includes(filters.keyword)) &&
      (filters.chapterIds.length === 0 ||
        filters.chapterIds.includes(x.chapterId)) &&
      (filters.formats.length === 0 || filters.formats.includes(x.format)) &&
      (filters.difficulty === null || x.difficulty === filters.difficulty) &&
      (!filters.sectionId || x.sectionId === filters.sectionId) &&
      (!filters.status || x.status === filters.status) &&
      (!filters.transcriptionStatus ||
        x.sectionTranscriptionStatus === filters.transcriptionStatus),
  );
}

export function filterSearchResults<
  S extends SearchableSection,
  Q extends SearchableQuestion,
>(
  sections: readonly S[],
  questions: readonly Q[],
  filters: SearchFilters,
): { sections: S[]; questions: Q[]; total: number } {
  const secs = filterSearchSections(sections, filters);
  const qs = filterSearchQuestions(questions, filters);
  return { sections: secs, questions: qs, total: secs.length + qs.length };
}

/**
 * 形式フィルタの選択肢: 渡された問題群に実在する形式を、
 * QUESTION_FORMATS の定義順で返す。正式問題だけを渡せば正式15形式に、
 * （サンプル問題は全削除済み。DECISIONS #52）
 */
export function availableSearchFormats(
  questions: readonly SearchableQuestion[],
): QuestionFormat[] {
  const present = new Set(questions.map((q) => q.format));
  return QUESTION_FORMATS.filter((f) => present.has(f));
}

/** 状態フィルタの選択肢の並び（QuestionStatus の定義順）。 */
const SEARCH_STATUS_ORDER: readonly QuestionStatus[] = [
  "verified",
  "unverified",
  "excluded",
];

/**
 * 状態フィルタの選択肢: 渡された問題群に実在する状態だけを定義順で返す。
 * 実在しない状態（現行プールでは unverified / excluded）は選択肢に出ない。
 */
export function availableSearchStatuses(
  questions: readonly SearchableQuestion[],
): QuestionStatus[] {
  const present = new Set(questions.map((q) => q.status));
  return SEARCH_STATUS_ORDER.filter((s) => present.has(s));
}

/**
 * 転記状態フィルタの選択肢: 渡された節群に実在する転記状態だけを、
 * 節の登録順（初出順）で返す。実在しない状態は選択肢に出ない。
 */
export function availableTranscriptionStatuses(
  sections: readonly SearchableSection[],
): string[] {
  const seen: string[] = [];
  for (const s of sections) {
    if (!seen.includes(s.transcriptionStatus)) seen.push(s.transcriptionStatus);
  }
  return seen;
}

/**
 * 学習状況による問題の絞り込みと並べ替え（R28、DECISIONS #55）。
 * 検索の複合フィルタ（教材データだけで決まる）とは別に、端末の学習履歴から決まる条件を扱う。
 * - unanswered: 一度も解いていない
 * - wrong: 直近の回答が不正解
 * - weak: 2回以上解いて正答率50%未満（演習の「苦手」と同じ定義）
 * - mastered: 直近2回が連続正解（学習分析の「習得済みと推定」と同じ定義）
 * - favorites: ブックマーク済み
 */
export type LearningState = "all" | "unanswered" | "wrong" | "weak" | "mastered" | "favorites";
export const LEARNING_STATE_LABELS: Record<LearningState, string> = {
  all: "すべて",
  unanswered: "未回答",
  wrong: "直近が不正解",
  weak: "苦手（正答率50%未満）",
  mastered: "習得済み（2回連続正解）",
  favorites: "ブックマーク",
};
export type SearchSort = "default" | "difficulty-asc" | "difficulty-desc" | "accuracy-asc";
export const SEARCH_SORT_LABELS: Record<SearchSort, string> = {
  default: "収録順",
  "difficulty-asc": "難易度が低い順",
  "difficulty-desc": "難易度が高い順",
  "accuracy-asc": "正答率が低い順",
};

export interface LearningIndex {
  attempts: Map<string, { total: number; correct: number; lastTwo: (boolean | null)[] }>;
  favorites: Set<string>;
}

export function buildLearningIndex(
  records: readonly { questionId: string; correct: boolean | null }[],
  favorites: readonly string[],
): LearningIndex {
  const attempts: LearningIndex["attempts"] = new Map();
  for (const r of records) {
    const e = attempts.get(r.questionId) ?? { total: 0, correct: 0, lastTwo: [] };
    e.total++;
    if (r.correct === true) e.correct++;
    e.lastTwo.push(r.correct);
    if (e.lastTwo.length > 2) e.lastTwo.shift();
    attempts.set(r.questionId, e);
  }
  return { attempts, favorites: new Set(favorites) };
}

export function matchesLearningState(state: LearningState, questionId: string, index: LearningIndex): boolean {
  const a = index.attempts.get(questionId);
  switch (state) {
    case "unanswered": return !a;
    case "wrong": return !!a && a.lastTwo[a.lastTwo.length - 1] === false;
    case "weak": return !!a && a.total >= 2 && a.correct / a.total < 0.5;
    case "mastered": return !!a && a.lastTwo.length >= 2 && a.lastTwo.every((c) => c === true);
    case "favorites": return index.favorites.has(questionId);
    default: return true;
  }
}

/** 並べ替え（安定ソート）。正答率順は未回答の問題を末尾に置く。 */
export function sortSearchQuestions<T extends { id: string; difficulty: number }>(
  questions: readonly T[],
  sort: SearchSort,
  index: LearningIndex,
): T[] {
  if (sort === "default") return [...questions];
  const acc = (q: T) => { const a = index.attempts.get(q.id); return a ? a.correct / a.total : Number.POSITIVE_INFINITY; };
  const key = sort === "difficulty-asc" ? (q: T) => q.difficulty : sort === "difficulty-desc" ? (q: T) => -q.difficulty : acc;
  return questions.map((q, i) => ({ q, i })).sort((x, y) => key(x.q) - key(y.q) || x.i - y.i).map((x) => x.q);
}
