
import type { Question, RubricPoint } from "./types";
import { normalizeText } from "./normalize";
export interface GradeResult { correct: boolean|null; scoreRatio: number; autoScoreRatio: number; matchedPointIds: string[]; missedRequiredIds: string[]; note: string; }
export function gradeChoice(q: Question, selected: number[]): GradeResult {
  const correct = [...(q.correctChoiceIndexes ?? [])].sort().join(","); const got=[...selected].sort().join(",");
  const ok = correct.length>0 && correct===got;
  return { correct: ok, scoreRatio: ok?1:0, autoScoreRatio: ok?1:0, matchedPointIds: [], missedRequiredIds: [], note: ok?"正解":"不正解" };
}
export function gradeBoolean(q: Question, value: boolean): GradeResult { const ok = q.correctBoolean===value; return { correct: ok, scoreRatio: ok?1:0, autoScoreRatio: ok?1:0, matchedPointIds:[], missedRequiredIds:[], note: ok?"正解":"不正解" }; }
/** 列挙の区切り（中黒・読点・カンマ・スラッシュ・空白）。normalizeText はこれらを消すため、分割は正規化前に行う。 */
const LIST_SEPARATORS = /[・、，,\/／\s　]+/;
/** 列挙を求める設問（「3つ挙げよ」「2つの〜」など、個数を指定するもの）か。 */
export function asksForEnumeration(prompt: string): boolean {
  return /([0-9０-９]+|[二三四五六七八九])つ/.test(prompt);
}
function listItems(s: string, splitParticles: boolean): string[] {
  const parts = s.split(LIST_SEPARATORS).flatMap((p) => (splitParticles ? p.split(/と|や|および|及び/) : [p]));
  return parts.map(normalizeText).filter(Boolean).sort();
}
/**
 * 監査AU-05（DECISIONS #54）: 個数を指定した列挙の設問では、項目の順序を問わない。
 * 正答の列挙（例「シナモン・カルダモン・クローブ」）と回答の項目が、正規化後に
 * 多重集合として完全一致する場合だけ正解とする（項目の過不足・重複は不一致のまま）。
 * 固有名詞（「バスコ・ダ・ガマ」「テクス・メクス」）は個数指定の設問でないため対象外。
 */
function enumerationMatches(accepted: string, answer: string): boolean {
  const want = listItems(accepted, false);
  if (want.length < 2) return false;
  const got = listItems(answer, true);
  return got.length === want.length && got.every((v, i) => v === want[i]);
}
export function gradeTextAnswer(q: Question, answer: string): GradeResult {
  const a = normalizeText(answer); if (!a) return { correct:false, scoreRatio:0, autoScoreRatio:0, matchedPointIds:[], missedRequiredIds:[], note:"空回答" };
  const accepted = q.acceptedAnswers ?? [];
  if (accepted.some(x=> normalizeText(x)===a)) return { correct: true, scoreRatio: 1, autoScoreRatio: 1, matchedPointIds:[], missedRequiredIds:[], note: "正解（表記揺れ正規化後）" };
  const unordered = asksForEnumeration(q.prompt) && accepted.some((x) => enumerationMatches(x, answer));
  return { correct: unordered, scoreRatio: unordered?1:0, autoScoreRatio: unordered?1:0, matchedPointIds:[], missedRequiredIds:[], note: unordered?"正解（列挙の順序は問わない）":"不一致" };
}
export function gradeOrdering(q: Question, order: string[]): GradeResult { const ok = JSON.stringify(order)===JSON.stringify(q.correctOrder ?? []); return { correct: ok, scoreRatio: ok?1:0, autoScoreRatio: ok?1:0, matchedPointIds:[], missedRequiredIds:[], note: ok?"正解":"順序が異なる" }; }
export function gradeMatching(q: Question, pairs: Record<string,string>): GradeResult {
  const all = q.matchingPairs ?? []; if (!all.length) return {correct:null,scoreRatio:0,autoScoreRatio:0,matchedPointIds:[],missedRequiredIds:[],note:"採点基準なし"};
  const hit = all.filter(p=> pairs[p.left]===p.right).length; const ratio = hit/all.length;
  return { correct: ratio===1, scoreRatio: ratio, autoScoreRatio: ratio, matchedPointIds:[], missedRequiredIds:[], note: `${hit}/${all.length} 一致` };
}
export function gradeTableFill(q: Question, cells: Record<string,string>): GradeResult {
  const exp = q.blankCellAnswers ?? {}; const keys = Object.keys(exp); if (!keys.length) return {correct:null,scoreRatio:0,autoScoreRatio:0,matchedPointIds:[],missedRequiredIds:[],note:"採点基準なし"};
  const hit = keys.filter(k=> normalizeText(cells[k] ?? "")===normalizeText(exp[k]!)).length; const ratio=hit/keys.length;
  return { correct: ratio===1, scoreRatio: ratio, autoScoreRatio: ratio, matchedPointIds:[], missedRequiredIds:[], note: `${hit}/${keys.length} セル正解` };
}
/* ---- G1: 記述式採点エンジン拡張（DECISIONS #29） ----
 * すべて後方互換の追加仕様であり、拡張フィールドを持たない要点・括弧も単漢字も含まない
 * キーワードについては従来の includesNormalized と完全に同じ判定になる。
 * (1) 括弧注記の任意化: キーワード中の括弧注記（別名・注釈）を取り除いた形でも一致を認める。
 *     ただし注記を除いた残り（正規化後）が PAREN_KEYWORD_MIN_REMAINDER 字未満のキーワードには
 *     適用しない（「（エビデンス）に基づいて」のような汎用句への退化を防ぐ）。
 * (2) 単漢字キーワードの境界判定: 正規化後1字のキーワードは、区切りを残したテキスト上で
 *     前後に漢字（CJK）が隣接しない出現がある場合にのみ一致する（「加熱」「日光」の中の
 *     「熱」「光」には当たらない。「「光」、「熱」」「光と熱」のような列挙には当たる）。
 * (3) 近接AND結合（keywordGroups）: 全断片が順序どおり、連続する断片間の間隔が
 *     PROXIMITY_MAX_GAP 字以内で現れた場合に一致する。数字・英字で始まる断片は、
 *     直前が数字・英字・小数点の出現（例: 「45mℓ」の中の「5mℓ」）を数えない。
 * (4) 主語区間判定（subject）: ルーブリック内の subject（対象名）の「見出し出現」で回答を
 *     区間分割し、subject を持つ要点は自対象の区間内でのみ判定する。見出し出現とは、
 *     直前が「と」「や」でなく、直後が助詞・読点相当（/・は・が・の・に・も・へ・を）か文末で、
 *     他の subject と重ならない出現をいう（「立性とほふく性の間」のような言及は見出しでない）。
 *     自対象の見出し出現が回答にない要点は従来どおり全文で判定する（対象名を書かず
 *     順序で示す模範解答型の回答を落とさないためのフォールバック）。 */
export const PROXIMITY_MAX_GAP = 3;
export const PAREN_KEYWORD_MIN_REMAINDER = 6;
const CJK_CHAR = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF々]/;
const SUBJECT_FOLLOW_CHARS = new Set(["/", "は", "が", "の", "に", "も", "へ", "を"]);

function parenStrippedVariant(keyword: string): string | null {
  if (!/[（(][^（）()]*[）)]/.test(keyword)) return null;
  const stripped = keyword.replace(/[（(][^（）()]*[）)]/g, "");
  return normalizeText(stripped).length >= PAREN_KEYWORD_MIN_REMAINDER ? stripped : null;
}
function singleCharBoundaryHit(boundaryText: string, ch: string): boolean {
  let i = -1;
  while ((i = boundaryText.indexOf(ch, i + 1)) !== -1) {
    const prev = i > 0 ? boundaryText[i - 1]! : "";
    const next = i + ch.length < boundaryText.length ? boundaryText[i + ch.length]! : "";
    if (!CJK_CHAR.test(prev) && !CJK_CHAR.test(next)) return true;
  }
  return false;
}
/** 長いキーワードの派生断片（監査B-06是正）: 読点・中点・括弧で分割した断片群。 */
function derivedFragments(keyword: string): string[] {
  return keyword
    .split(/[、,・]/)
    .flatMap((s) => s.split(/[(（]/))
    .map((s) => s.replace(/[)）]/g, "").trim())
    .filter((s) => normalizeText(s).length >= 2);
}
/** キーワード1件の一致判定。normAnswer は正規化済み回答、boundaryText は区切りを残した回答（単漢字判定用）。 */
function keywordHit(normAnswer: string, boundaryText: string, keyword: string, useBoundary: boolean): boolean {
  const variants = [keyword];
  const stripped = parenStrippedVariant(keyword);
  if (stripped) variants.push(stripped);
  for (const v of variants) {
    const n = normalizeText(v);
    if (!n) continue;
    if (n.length === 1) {
      if (useBoundary ? singleCharBoundaryHit(boundaryText, n) : normAnswer.includes(n)) return true;
    } else if (normAnswer.includes(n)) return true;
  }
  // 監査B-06是正: 正規化後12字以上の単一キーワードは、言い回しの少しの違いで
  // 連続部分文字列にならず正しい回答を落とす。断片（2字以上）が順序どおり
  // 近接して現れる場合も一致とみなす（全断片が必要なため、羅列の緩和にはならない）。
  if (normalizeText(keyword).length >= 12) {
    const frags = derivedFragments(keyword);
    if (frags.length >= 2 && proximityGroupHit(normAnswer, frags)) return true;
  }
  return false;
}
function proximityGroupHit(normAnswer: string, group: string[]): boolean {
  let searchFrom = 0; let prevEnd = -1;
  for (const raw of group) {
    const frag = normalizeText(raw);
    if (!frag) return false;
    let found = -1; let i = normAnswer.indexOf(frag, searchFrom);
    while (i !== -1) {
      const startsAlnum = /^[0-9a-z]/.test(frag);
      const prevCh = i > 0 ? normAnswer[i - 1]! : "";
      const insideNumber = startsAlnum && /[0-9a-z.]/.test(prevCh);
      const gapOk = prevEnd < 0 || i - prevEnd <= PROXIMITY_MAX_GAP;
      if (!insideNumber && gapOk) { found = i; break; }
      i = normAnswer.indexOf(frag, i + 1);
    }
    if (found === -1) return false;
    searchFrom = found + frag.length; prevEnd = searchFrom;
  }
  return true;
}
/** subject の見出し出現で分割した区間（正規化済み subject → その subject の区間テキスト群）。 */
function subjectSegments(normAnswer: string, subjects: string[]): Map<string, string[]> {
  type Occ = { s: string; start: number; end: number };
  const occ: Occ[] = [];
  for (const s of subjects) {
    let i = -1;
    while ((i = normAnswer.indexOf(s, i + 1)) !== -1) occ.push({ s, start: i, end: i + s.length });
  }
  // 長い subject を優先して重なりを除く（「半立性」の中の「立性」を独立の出現と数えない）
  occ.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const kept: Occ[] = [];
  for (const o of occ) if (!kept.some((k) => o.start < k.end && k.start < o.end)) kept.push(o);
  const bounds = kept.filter((o) => {
    const next = o.end < normAnswer.length ? normAnswer[o.end]! : "";
    const prev = o.start > 0 ? normAnswer[o.start - 1]! : "";
    return (next === "" || SUBJECT_FOLLOW_CHARS.has(next)) && prev !== "と" && prev !== "や";
  }).sort((a, b) => a.start - b.start);
  const map = new Map<string, string[]>();
  bounds.forEach((b, idx) => {
    const segEnd = idx + 1 < bounds.length ? bounds[idx + 1]!.start : normAnswer.length;
    const arr = map.get(b.s) ?? []; arr.push(normAnswer.slice(b.start, segEnd)); map.set(b.s, arr);
  });
  return map;
}
/** 要点チェック式ルールベース採点。意味の完全理解はできないため、結果は「自動判定」として自己採点と分離する。 */
export function gradeEssayRubric(rubric: RubricPoint[], answer: string): GradeResult {
  if (!rubric.length) return { correct:null, scoreRatio:0, autoScoreRatio:0, matchedPointIds:[], missedRequiredIds:[], note:"採点基準（要点）が未設定のため自動判定しない" };
  if (!answer.trim()) return { correct:false, scoreRatio:0, autoScoreRatio:0, matchedPointIds:[], missedRequiredIds: rubric.filter(r=>r.required).map(r=>r.id), note:"空回答" };
  const normAnswer = normalizeText(answer);
  const boundaryText = answer.normalize("NFKC").toLowerCase().replace(/[\s　]+/g, "");
  const subjects = [...new Set(rubric.map(p=>p.subject).filter((s): s is string => Boolean(s)).map(s=>normalizeText(s)))].filter(Boolean);
  const segments = subjects.length ? subjectSegments(normAnswer, subjects) : new Map<string, string[]>();
  let total=0, got=0; const matched:string[]=[]; const missed:string[]=[];
  for (const p of rubric) {
    total+=p.points;
    const ownSegs = p.subject ? segments.get(normalizeText(p.subject)) : undefined;
    const inSegment = Boolean(ownSegs && ownSegs.length);
    const targets = inSegment ? ownSegs! : [normAnswer];
    const hit = targets.some(t =>
      p.keywords.some(k=> keywordHit(t, inSegment ? t : boundaryText, k, !inSegment)) ||
      (p.keywordGroups ?? []).some(g=> proximityGroupHit(t, g)));
    if (hit){got+=p.points; matched.push(p.id);} else if (p.required) missed.push(p.id);
  }
  const ratio = total? got/total:0;
  // 監査B-05是正（AUDIT_DECISIONS AD-1）: キーワード一致だけでは文としての正しさ
  // （意味・矛盾の有無）を判定できないため、要点が全て揃っても自動判定では
  // 「正解」と断定しない（correct は null＝要自己確認）。要点が皆無の場合の
  // 不正解（false）だけは断定できるため維持する。
  return { correct: ratio===0 ? false : null, scoreRatio: ratio, autoScoreRatio: ratio, matchedPointIds: matched, missedRequiredIds: missed, note: ratio===1 ? "全ての要点キーワードが含まれています。ただし文としての正しさは自動判定できないため、正解とは断定しません。最終判定は自己採点で確定してください。" : "ルールベース自動判定（要点キーワード一致）。最終判定は自己採点と分離して保存される。" };
}
export function gradeQuestion(q: Question, answer: unknown): GradeResult {
  switch(q.format){
    case "single-choice": case "multiple-choice": case "reverse-lookup": case "photo-id": case "figure": case "flashcard": return gradeChoice(q, (answer as number[]) ?? []);
    case "true-false": return gradeBoolean(q, answer as boolean);
    case "fill-blank": case "term-input": case "one-answer": return gradeTextAnswer(q, String(answer ?? ""));
    case "ordering": return gradeOrdering(q, (answer as string[]) ?? []);
    case "matching": return gradeMatching(q, (answer as Record<string,string>) ?? {});
    case "table-fill": return gradeTableFill(q, (answer as Record<string,string>) ?? {});
    default: return gradeEssayRubric(q.rubric ?? [], String(answer ?? ""));
  }
}

/**
 * 監査AU-07（DECISIONS #54）: 対応付け問題のプルダウンに並べる候補。正解ペアの順のまま並べると
 * 「上から1番目・2番目…」を選ぶだけで全問正解できるため、正解ペアの順序と無関係な
 * 決定的な順（日本語の照合順）に並べ替える。
 */
export function matchingOptions(q: Question): string[] {
  return [...new Set((q.matchingPairs ?? []).map((p) => p.right))].sort((a, b) => a.localeCompare(b, "ja"));
}
