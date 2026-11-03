
import type { AnswerRecord, Question, KnowledgeUnit } from "./types";
export interface Coverage { importedRatio: number|null; unitExtractionRatio: number|null; questionizedRatio: number|null; studiedRatio: number|null; masteredRatio: number|null; }
export function computeStats(records: AnswerRecord[], questions: Question[]) {
  const total = records.length; const correct = records.filter(r=>r.correct===true).length;
  // 監査AU-09（DECISIONS #54）: 学習履歴は件数上限がないため、記録ごとの線形探索（記録数×問題数）を避けて ID 索引で引く。
  const qById = new Map(questions.map((q) => [q.id, q]));
  const by = (key: (q:Question)=>string) => { const m = new Map<string,{total:number;correct:number}>(); for(const r of records){ const q=qById.get(r.questionId); if(!q) continue; const k=key(q); const e=m.get(k)??{total:0,correct:0}; e.total++; if(r.correct===true) e.correct++; m.set(k,e);} return m; };
  return { total, correct, accuracy: total? correct/total : null, byChapter: by(q=>q.chapterId), byFormat: by(q=>q.format), byDifficulty: by(q=>String(q.difficulty)) };
}
export function computeCoverage(args: {presentImages:number; expectedImages:number; units: readonly { id: string }[]; totalSections:number; questions:Question[]; records:AnswerRecord[]}): Coverage {
  const {presentImages, expectedImages, units, questions, records} = args;
  const verifiedUnits = units; const questionized = new Set(questions.filter(q=>q.status==="verified").flatMap(q=>q.knowledgeUnitIds));
  const studiedQ = new Set(records.map(r=>r.questionId));
  const verifiedQ = questions.filter(q=>q.status==="verified");
  const studiedVerified = verifiedQ.filter(q=>studiedQ.has(q.id)).length;
  // 問題ごとの直近2件の正誤（記録は時系列順に追記される）。記録数×問題数の走査を避ける（AU-09）。
  const lastTwo = new Map<string, (boolean|null)[]>();
  for (const r of records) { const a = lastTwo.get(r.questionId) ?? []; a.push(r.correct); if (a.length > 2) a.shift(); lastTwo.set(r.questionId, a); }
  const mastered = verifiedQ.filter(q=>{ const rs=lastTwo.get(q.id); return !!rs && rs.length>=2 && rs.every(c=>c===true); }).length;
  return {
    importedRatio: expectedImages? presentImages/expectedImages : null,
    unitExtractionRatio: null, // 教材総量（全文転記後の知識単位総数）が未確定のため算出不能。null=未測定として表示する
    questionizedRatio: verifiedUnits.length? questionized.size/verifiedUnits.length : null,
    studiedRatio: verifiedQ.length? studiedVerified/verifiedQ.length : null,
    masteredRatio: verifiedQ.length? mastered/verifiedQ.length : null,
  };
}
