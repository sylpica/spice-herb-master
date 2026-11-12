// 画面コンポーネント（バンドル分割バッチE1で src/App.tsx から分割。docs/DECISIONS.md #23）
// 修正バッチFIX1（DECISIONS #34）で実働化: 検証済み正式問題から制限時間×2問（上限100問）を
// 決定的に抽出して順に出題し、解答中は正解・解説を表示しない。途中状態は store.examDraft に
// 保存して復元でき、終了時に domain/grading の gradeQuestion を一括適用して結果を表示し、
// 全問分を解答記録（records）に保存する（未回答は不正解）。記述系4形式は自己採点分離の
// 仕様（DECISIONS #6）のため対象外（対象範囲は domain/exam.ts の EXAM_EXCLUDED_FORMATS）。
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { QUESTIONS } from "../data/questions";
import { EXAM_MAX_QUESTIONS, buildExam, examPool, examQuestionCount, gradeExam, type ExamGradeSummary } from "../domain/exam";
import { FORMAT_LABELS, type Question } from "../domain/types";
import type { StoreData } from "../domain/store";
import { initSrs, reviewSrs, qualityFromResult } from "../domain/srs";
import { matchingOptions } from "../domain/grading";
import { moveItem } from "../components/QuestionRunner";

interface ExamDraftState { startedAt: string; mins: number; questionIds: string[]; answers: Record<string, unknown>; }

const questionById = new Map(QUESTIONS.map((q) => [q.id, q]));

function readDraft(store: StoreData): ExamDraftState | null {
  const d = store.examDraft as ExamDraftState | null;
  if (!d || typeof d !== "object" || !Array.isArray(d.questionIds) || d.questionIds.length === 0) return null;
  if (!d.questionIds.every((id) => questionById.has(id))) return null;
  return { startedAt: d.startedAt, mins: d.mins, questionIds: d.questionIds, answers: d.answers ?? {} };
}

/** 結果画面の「正解」表示用に、正答を短い文字列へ要約する（採点には使わない）。 */
function answerSummary(q: Question): string {
  if (q.choices && q.correctChoiceIndexes) return q.correctChoiceIndexes.map((i) => q.choices?.[i] ?? "").join(" / ");
  if (q.format === "true-false") return q.correctBoolean ? "○ 正しい" : "× 誤り";
  if (q.acceptedAnswers?.length) return q.acceptedAnswers[0] ?? "";
  if (q.correctOrder?.length) return q.correctOrder.join(" → ");
  if (q.matchingPairs?.length) return q.matchingPairs.map((p) => `${p.left}→${p.right}`).join("、");
  if (q.blankCellAnswers) return Object.entries(q.blankCellAnswers).map(([k, v]) => `${k}: ${v}`).join("、");
  return q.modelAnswer ?? "";
}

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function Exam({store,update}:{store:StoreData;update:any}){
 const navigate = useNavigate();
 const draft = readDraft(store);
 const [mins,setMins]=useState(10);
 const [idx,setIdx]=useState(0);
 const [result,setResult]=useState<ExamGradeSummary|null>(null);
 const [remaining,setRemaining]=useState<number|null>(null);
 const questions = useMemo(()=> draft? draft.questionIds.map((id)=>questionById.get(id)!).filter(Boolean) : [], [draft?.questionIds.join(",")]);
 const answers = draft?.answers ?? {};
 const current = questions[Math.min(idx, Math.max(0, questions.length - 1))];

 // 監査C-17是正: 終了処理の二重実行（終了ボタンの連打・タイマーとの競合）を防ぐ。
 const finishedRef = useRef(false);
 // 監査C-04是正: 問題ごとの表示滞留時間を実測し、解答時間として記録する。
 const dwellRef = useRef<Record<string, number>>({});
 const viewRef = useRef<{ id: string; at: number } | null>(null);
 const closeView = () => { const v = viewRef.current; if (v) { dwellRef.current[v.id] = (dwellRef.current[v.id] ?? 0) + (Date.now() - v.at); viewRef.current = null; } };
 useEffect(()=>{
   if (!draft || result) return;
   const id = current?.id;
   if (!id) return;
   if (viewRef.current?.id !== id) { closeView(); viewRef.current = { id, at: Date.now() }; }
 }, [current?.id, draft, result]);

 const finish = () => {
   if (!draft || finishedRef.current) return;
   finishedRef.current = true;
   closeView();
   // 並べ替えは表示中の並び自体が回答状態のため、未操作なら表示順を回答として採点する
   const effective: Record<string, unknown> = { ...answers };
   for (const q of questions) if (q.format === "ordering" && effective[q.id] === undefined) effective[q.id] = q.orderingItems ?? [];
   const summary = gradeExam(questions, effective);
   const answeredAt = new Date().toISOString();
   const dwell = dwellRef.current;
   // 監査C-06是正（AUDIT_DECISIONS AD-4）: 模試の結果も演習と同様に SRS へ反映する。
   update((d:StoreData)=>{ for (const item of summary.items) { d.records.push({ questionId: item.question.id, answeredAt, correct: item.result.correct, scoreRatio: item.result.scoreRatio, autoScoreRatio: item.result.autoScoreRatio, selfScoreRatio: null, responseMs: item.answered ? (dwell[item.question.id] ?? null) : null }); const cur = d.srs[item.question.id] ?? initSrs(item.question.id); d.srs[item.question.id] = reviewSrs(cur, qualityFromResult(item.result.correct, item.result.scoreRatio)); } d.examDraft = null; return d; });
   setResult(summary);
 };
 const finishRef = useRef(finish);
 finishRef.current = finish;

 // 残り時間の数え直し（開始時刻から実経過を差し引く。0で自動終了）
 useEffect(()=>{
   if (!draft || result) { setRemaining(null); return; }
   const tick = () => {
     const elapsed = Math.floor((Date.now() - Date.parse(draft.startedAt)) / 1000);
     const left = draft.mins * 60 - elapsed;
     setRemaining(left);
     if (left <= 0) finishRef.current();
   };
   tick();
   const timer = setInterval(tick, 1000);
   return ()=>clearInterval(timer);
 }, [draft?.startedAt, draft?.mins, result]);

 const start = () => {
   // 利用者が除外した問題（R18）は模試にも出さない。
   const picked = buildExam(QUESTIONS.filter((x)=>!store.excluded.includes(x.id)), mins, new Date().toISOString());
   setResult(null); setIdx(0); finishedRef.current = false; dwellRef.current = {}; viewRef.current = null;
   update((d:StoreData)=>({ ...d, examDraft: { startedAt: new Date().toISOString(), mins, questionIds: picked.map((q)=>q.id), answers: {} } }));
 };
 const abort = () => { setResult(null); setIdx(0); finishedRef.current = false; dwellRef.current = {}; viewRef.current = null; update((d:StoreData)=>({ ...d, examDraft: null })); };
 const setAnswer = (questionId: string, value: unknown) => {
   update((d:StoreData)=>{ const cur = d.examDraft as ExamDraftState | null; if (!cur) return d; d.examDraft = { ...cur, answers: { ...cur.answers, [questionId]: value } }; return d; });
 };

 if (result) {
   return <main><h1>模擬試験（練習用）</h1><div className="card"><h2>結果</h2>
   <p>正答率 {Math.round(result.accuracy * 100)}%（{result.correctCount} / {result.total} 問正解 ・ 平均スコア {Math.round(result.averageScoreRatio * 100)}% ・ 回答済み {result.answeredCount} 問）</p>
   <p className="muted">解答はすべて演習記録に保存しました。誤答は演習画面の学習フォーカス「誤答の復習」で復習できます。</p>
   {result.wrongItems.length === 0 ? <p>誤答はありません。</p> :
   <><h3>誤答一覧（{result.wrongItems.length}件）</h3>{result.wrongItems.map((item)=> <div key={item.question.id} className="card"><p><span className="badge">{FORMAT_LABELS[item.question.format]}</span> {item.result.note}</p><p>{item.question.prompt}</p><p><strong>正解:</strong> {answerSummary(item.question)}</p><p><strong>解説:</strong> {item.question.explanation}</p><p><button type="button" className="ghost" onClick={()=>{ update((d:StoreData)=>{ d.reader.sectionId = item.question.sectionId; return d; }); navigate("/reader"); }}>教科書の該当箇所を開く</button></p></div>)}</>}
   <p><button onClick={()=>setResult(null)}>設定に戻る</button> <Link className="btn" to="/practice" state={{ focus: "wrong" }}>誤答を復習する</Link></p></div></main>;
 }

 if (!draft || !current) {
   const pool = examPool(QUESTIONS.filter((x)=>!store.excluded.includes(x.id)));
   return <main><h1>模擬試験（練習用）</h1>
   <div className="card"><label>制限時間（分）<input type="number" min={1} max={120} inputMode="numeric" value={mins} onChange={e=>setMins(Math.max(1, Math.min(120, Math.floor(Number(e.target.value)) || 10)))}/></label><p>{examQuestionCount(mins, pool.length)}問を出題（対象 {pool.length}問）</p><p className="actions"><button onClick={start}>開始</button></p></div>
   <p className="foot-note">実際の試験制度の公式形式を再現したものではなく、独自の練習用試験です。制限時間×2問（上限{EXAM_MAX_QUESTIONS}問）を抽出します。記述系4形式（短文・長文・比較・複合）は自己採点と分離する仕様のため含めません。途中状態は保存され、解答確定まで教科書本文・正解は表示されません。</p></main>;
 }

 const q = current;
 const selected = (answers[q.id] as number[] | undefined) ?? [];
 const boolVal = (answers[q.id] as boolean | null | undefined) ?? null;
 const textVal = typeof answers[q.id] === "string" ? (answers[q.id] as string) : "";
 const orderVal = (answers[q.id] as string[] | undefined) ?? q.orderingItems ?? [];
 const pairsVal = (answers[q.id] as Record<string, string> | undefined) ?? {};
 const cellsVal = (answers[q.id] as Record<string, string> | undefined) ?? {};
 const answeredCount = questions.filter((x)=> answers[x.id] !== undefined).length;
 return <main><h1>模擬試験（練習用）</h1>
 <p className="muted" style={{ margin: "0 0 .3rem" }}>問題 {Math.min(idx + 1, questions.length)} / {questions.length} ・ 残り時間 {remaining === null ? "--:--" : formatClock(remaining)} ・ 回答済み {answeredCount} 問</p>
 <div className="card" aria-label="問題">
 <p><span className="badge">{FORMAT_LABELS[q.format]}</span> <span className="muted">難易度 {q.difficulty}</span></p>
 <h2 style={{fontSize:"1.1rem"}}>{q.prompt}</h2>
 {q.table && <table><thead><tr>{q.table.headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{q.table.rows.map((r,i)=><tr key={i}>{r.map((c,j)=><td key={j}>{c}</td>)}</tr>)}</tbody></table>}
 {q.choices && <div role="group" aria-label="選択肢">{q.choices.map((c,i)=>{ const multi = q.format==="multiple-choice"; return <label key={i} className="choice"><input type={multi?"checkbox":"radio"} name={q.id} checked={selected.includes(i)} onChange={()=> setAnswer(q.id, multi? (selected.includes(i)? selected.filter(x=>x!==i): [...selected,i]) : [i])}/><span>{c}</span></label>;})}</div>}
 {q.format==="true-false" && <div><button type="button" className={boolVal===true?"":"ghost"} onClick={()=>setAnswer(q.id, true)}>○ 正しい</button> <button type="button" className={boolVal===false?"":"ghost"} onClick={()=>setAnswer(q.id, false)}>× 誤り</button></div>}
 {(q.format==="fill-blank"||q.format==="term-input"||q.format==="one-answer") && <input aria-label="回答入力" value={textVal} onChange={e=>setAnswer(q.id, e.target.value)} />}
 {q.format==="ordering" && <div><p className="muted">上下ボタンで並べ替え</p>{orderVal.map((it,i)=><p key={it} className="inline-field"><span style={{flex:1}}>{i+1}. {it}</span> <button type="button" className="ghost" disabled={i===0} onClick={()=>setAnswer(q.id, moveItem(orderVal, i, -1))}>↑</button> <button type="button" className="ghost" disabled={i===orderVal.length-1} onClick={()=>setAnswer(q.id, moveItem(orderVal, i, 1))}>↓</button></p>)}</div>}
 {q.format==="matching" && <div>{(q.matchingPairs??[]).map(p=><label key={p.left}>{p.left}<select aria-label={p.left} value={pairsVal[p.left]??""} onChange={e=>setAnswer(q.id, {...pairsVal,[p.left]:e.target.value})}><option value="">選択</option>{matchingOptions(q).map(x=><option key={x} value={x}>{x}</option>)}</select></label>)}</div>}
 {q.format==="table-fill" && <div>{Object.keys(q.blankCellAnswers??{}).map(k=><label key={k}>空欄{k}<input aria-label={"空欄"+k} value={cellsVal[k]??""} onChange={e=>setAnswer(q.id, {...cellsVal,[k]:e.target.value})}/></label>)}</div>}
 </div>
 <p className="actions"><button className="ghost" disabled={idx<=0} onClick={()=>setIdx(idx-1)}>前の問題へ</button><button className="ghost" disabled={idx>=questions.length-1} onClick={()=>setIdx(idx+1)}>次の問題へ</button></p>
 <p className="actions"><button onClick={finish}>終了して一括採点する</button><button className="ghost" onClick={abort}>模試を中止する（記録しません）</button></p>
 <p className="foot-note">途中状態は保存されています。解答中は正解・解説を表示しません。</p>
 </main>;
}
