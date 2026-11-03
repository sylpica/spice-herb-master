
import type { Question, Flashcard } from "./types";
import { QUESTION_FORMATS } from "./types";
export interface ValidationIssue { severity: "error"|"warning"; code: string; targetId: string; message: string; }
export function validateQuestion(q: Question, units: readonly { id: string }[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!QUESTION_FORMATS.includes(q.format)) issues.push({severity:"error",code:"bad-format",targetId:q.id,message:"未知の問題形式"});
  if (q.status==="verified") {
    if (!q.sourceRefs.length) issues.push({severity:"error",code:"no-source",targetId:q.id,message:"検証済み問題に出典がない"});
    if (!q.knowledgeUnitIds.length) issues.push({severity:"error",code:"no-unit",targetId:q.id,message:"検証済み問題に知識単位がない"});
    for (const uid of q.knowledgeUnitIds) if (!units.some(u=>u.id===uid)) issues.push({severity:"error",code:"broken-unit-ref",targetId:q.id,message:`知識単位 ${uid} が存在しない`});
    if (!q.explanation.trim()) issues.push({severity:"error",code:"no-explanation",targetId:q.id,message:"解説が空"});
  }
  if ((q.format==="single-choice") && (q.correctChoiceIndexes?.length ?? 0)!==1) issues.push({severity:"error",code:"single-answer-count",targetId:q.id,message:"四択の正解は1つでなければならない"});
  if (q.choices && q.correctChoiceIndexes?.some(i=> i<0 || i>=q.choices!.length)) issues.push({severity:"error",code:"choice-range",targetId:q.id,message:"正解インデックスが選択肢範囲外"});
  return issues;
}
export function validateCard(c: Flashcard): ValidationIssue[] { const i:ValidationIssue[]=[]; if(c.status==="verified" && !c.sourceRefs.length) i.push({severity:"error",code:"no-source",targetId:c.id,message:"検証済みカードに出典がない"}); return i; }
export function findDuplicateCandidates(qs: Question[]): [string,string][] { const out:[string,string][]=[]; for(let a=0;a<qs.length;a++) for(let b=a+1;b<qs.length;b++){ const x=qs[a]!,y=qs[b]!; if(x.format===y.format && x.prompt.trim()===y.prompt.trim()) out.push([x.id,y.id]); } return out; }
export function isPublishable(q: Question): boolean { return q.status==="verified"; }
export function selectForPractice(qs: Question[]): Question[] { return qs.filter(q=> q.status==="verified"); }
