const KEY = "spice-herb-master:v1";
export interface StoreData { records: import("./types").AnswerRecord[]; srs: Record<string, import("./types").SrsState>; favorites: string[]; goalPerDay: number; reader: import("./types").ReaderState; examDraft: unknown|null;
  /** 演習で正解したとき自動で次の問題へ進む（既定はオフ＝手動進行。R27/R46、DECISIONS #54） */
  autoAdvance: boolean;
  /** 単語帳のお気に入りカード（R24、DECISIONS #55） */
  cardFavorites: string[];
  /** 利用者による問題報告（R18）。端末内に保存し、品質管理画面から書き出す。 */
  reports: QuestionReport[];
  /** 利用者が出題から除外した問題ID（R18）。演習・模試の出題対象から外す。 */
  excluded: string[]; }
export interface QuestionReport { questionId: string; note: string; at: string }
export const defaultStore: StoreData = { records: [], srs: {}, favorites: [], goalPerDay: 10, reader: { sectionId: "", fontSize: 16, dark: false, bookmarks: [], highlights: {}, notes: {} }, examDraft: null, autoAdvance: false, cardFavorites: [], reports: [], excluded: [] };

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * 保存データの型検証（監査C-12是正）。JSONとして読めても型が壊れているデータ
 * （例: records がオブジェクト）でアプリ全体が落ちて復旧不能になる事態を防ぐため、
 * フィールド単位で検証し、不正なフィールドだけを既定値へ落とす。
 */
export function sanitizeStore(parsed: unknown): StoreData {
  const d = structuredClone(defaultStore);
  if (!isPlainObject(parsed)) return d;
  if (Array.isArray(parsed.records)) {
    d.records = parsed.records.filter((r) => isPlainObject(r) && typeof r.questionId === "string" && typeof r.answeredAt === "string") as StoreData["records"];
  }
  if (isPlainObject(parsed.srs)) {
    const srs: StoreData["srs"] = {};
    for (const [k, v] of Object.entries(parsed.srs)) if (isPlainObject(v)) srs[k] = v as unknown as StoreData["srs"][string];
    d.srs = srs;
  }
  if (Array.isArray(parsed.favorites)) d.favorites = parsed.favorites.filter((x): x is string => typeof x === "string");
  if (typeof parsed.goalPerDay === "number" && Number.isFinite(parsed.goalPerDay) && parsed.goalPerDay > 0) d.goalPerDay = parsed.goalPerDay;
  if (isPlainObject(parsed.reader)) {
    const r = parsed.reader;
    if (typeof r.sectionId === "string") d.reader.sectionId = r.sectionId;
    if (typeof r.fontSize === "number" && Number.isFinite(r.fontSize) && r.fontSize > 0) d.reader.fontSize = r.fontSize;
    if (typeof r.dark === "boolean") d.reader.dark = r.dark;
    if (Array.isArray(r.bookmarks)) d.reader.bookmarks = r.bookmarks.filter((x): x is string => typeof x === "string");
    if (isPlainObject(r.highlights)) d.reader.highlights = r.highlights as StoreData["reader"]["highlights"];
    if (isPlainObject(r.notes)) d.reader.notes = r.notes as StoreData["reader"]["notes"];
  }
  d.examDraft = parsed.examDraft ?? null;
  if (typeof parsed.autoAdvance === "boolean") d.autoAdvance = parsed.autoAdvance;
  if (Array.isArray(parsed.cardFavorites)) d.cardFavorites = parsed.cardFavorites.filter((x): x is string => typeof x === "string");
  if (Array.isArray(parsed.excluded)) d.excluded = parsed.excluded.filter((x): x is string => typeof x === "string");
  if (Array.isArray(parsed.reports)) d.reports = parsed.reports.filter((r) => isPlainObject(r) && typeof r.questionId === "string" && typeof r.note === "string" && typeof r.at === "string") as unknown as QuestionReport[];
  return d;
}

export function loadStore(): StoreData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(defaultStore);
    return sanitizeStore(JSON.parse(raw));
  } catch { return structuredClone(defaultStore); }
}

/** 保存に成功したら true、容量超過等で失敗したら false を返す（監査E-11: 失敗を呼び出し側UIで案内する）。 */
export function saveStore(d: StoreData): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(d)); return true; }
  catch { console.warn("localStorage save failed"); return false; }
}

/** 復旧用: 保存データを消去する（ErrorBoundary のリセット導線から使う）。 */
export function resetStoreData(): void { try { localStorage.removeItem(KEY); } catch { /* noop */ } }

export function exportStore(d: StoreData): string { return JSON.stringify(d, null, 2); }
