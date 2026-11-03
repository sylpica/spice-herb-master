
import { useRef, useState } from "react";
import type { Question } from "../domain/types";
import { gradeQuestion, matchingOptions, type GradeResult } from "../domain/grading";
import { ALL_SECTIONS } from "../data/structure";
const SECTION_TITLE = new Map(ALL_SECTIONS.map((s) => [s.id, s.title]));
/** 確定済みの回答（「前の問題へ」で戻ったときに、回答と採点結果をそのまま復元するため。UX14・監査AU-02） */
export interface SavedAnswer { answer: unknown; result: GradeResult; selfRatio: number|null }

/**
 * 正誤の直下に出す正答（UX12・R46）。記述系は模範解答、それ以外は形式ごとの正答を返す。
 * 監査AU-03（DECISIONS #54）: 従来は modelAnswer を持つ記述系だけに表示しており、
 * 選択式・入力式・正誤・並べ替え・対応付け・表の穴埋めでは、詳細を開かないと正答が見えなかった。
 */
export function correctAnswerOf(q: Question): { label: string; lines: string[] } | null {
  if (q.modelAnswer) return { label: "模範解答", lines: [q.modelAnswer] };
  if (q.choices && q.correctChoiceIndexes?.length) return { label: "正答", lines: [q.correctChoiceIndexes.map((i) => q.choices![i]).filter((c): c is string => c !== undefined).join("、")] };
  if (q.format === "true-false" && typeof q.correctBoolean === "boolean") return { label: "正答", lines: [q.correctBoolean ? "○ 正しい" : "× 誤り"] };
  if (q.acceptedAnswers?.length) return { label: "正答", lines: [q.acceptedAnswers[0]!] };
  if (q.correctOrder?.length) return { label: "正しい順序", lines: q.correctOrder.map((it, i) => `${i + 1}. ${it}`) };
  if (q.matchingPairs?.length) return { label: "正しい組み合わせ", lines: q.matchingPairs.map((p) => `${p.left} → ${p.right}`) };
  if (q.blankCellAnswers && Object.keys(q.blankCellAnswers).length) return { label: "正答", lines: Object.entries(q.blankCellAnswers).map(([k, v]) => `空欄${k}: ${v}`) };
  return null;
}

export default function QuestionRunner({ q, saved, onGraded, onSelfScore, onOpenSection }: { q: Question; saved?: SavedAnswer; onGraded?: (r: GradeResult, selfRatio: number|null, responseMs: number, answer: unknown)=>void; onSelfScore?: (selfRatio: number|null)=>void; onOpenSection?: (sectionId: string)=>void }) {
  const sa = saved?.answer;
  const [selected, setSelected] = useState<number[]>(() => (q.choices && Array.isArray(sa) ? (sa as number[]) : []));
  const [boolVal, setBoolVal] = useState<boolean|null>(() => (typeof sa === "boolean" ? sa : null));
  const [text, setText] = useState(() => (typeof sa === "string" ? sa : ""));
  const [order, setOrder] = useState<string[]>(() => (q.format === "ordering" && Array.isArray(sa) ? (sa as string[]) : (q.orderingItems ?? [])));
  const [pairs, setPairs] = useState<Record<string,string>>(() => (q.format === "matching" && sa && typeof sa === "object" ? (sa as Record<string,string>) : {}));
  const [cells, setCells] = useState<Record<string,string>>(() => (q.format === "table-fill" && sa && typeof sa === "object" ? (sa as Record<string,string>) : {}));
  const [result, setResult] = useState<GradeResult|null>(saved?.result ?? null);
  const [selfRatio, setSelfRatio] = useState<number|null>(saved?.selfRatio ?? null);
  const [flipped, setFlipped] = useState(false);
  // 監査C-03是正: 確定の二重実行で記録・SRSが二重計上されないよう、確定は1回だけ。
  // 確定済みの問題へ戻った場合も確定済みのまま復元する（再確定による二重計上を防ぐ。監査AU-02）。
  const [submitted, setSubmitted] = useState(Boolean(saved));
  // 監査C-04是正: 解答時間（表示開始→確定）の実測。
  const startedAt = useRef(Date.now());
  const essay = ["short-essay","long-essay","compare-essay","composite"].includes(q.format);
  const submit = () => {
    if (submitted) return;
    let ans: unknown = text;
    if (q.choices) ans = selected; else if (q.format==="true-false") ans = boolVal;
    else if (q.format==="ordering") ans = order; else if (q.format==="matching") ans = pairs; else if (q.format==="table-fill") ans = cells;
    const r = gradeQuestion(q, ans); setResult(r); setSubmitted(true); onGraded?.(r, selfRatio, Date.now() - startedAt.current, ans);
  };
  const changeSelfRatio = (v: number|null) => { setSelfRatio(v); if (submitted) onSelfScore?.(v); };
  return <div className="card" aria-label="問題">
    <p className="muted">難易度 {q.difficulty}</p>
    <h2 style={{fontSize:"1.1rem"}}>{q.prompt}</h2>
    {q.imageAlt && <p className="muted" role="img" aria-label={q.imageAlt}>🖼 {q.imageRef? q.imageRef : "画像は未設定です（教科書画像は未取り込み）"}</p>}
    {q.table && <table><thead><tr>{q.table.headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{q.table.rows.map((r,i)=><tr key={i}>{r.map((c,j)=><td key={j}>{c}</td>)}</tr>)}</tbody></table>}
    {q.choices && <div role="group" aria-label="選択肢">{q.choices.map((c,i)=>{ const multi = q.format==="multiple-choice"; return <label key={i} style={{display:"block",padding:".45rem .5rem",minHeight:44}}><input style={{width:"auto"}} type={multi?"checkbox":"radio"} name={q.id} checked={selected.includes(i)} onChange={()=> setSelected(multi? (selected.includes(i)? selected.filter(x=>x!==i): [...selected,i]) : [i])}/> {c}</label>;})}</div>}
    {q.format==="true-false" && <div><button type="button" aria-pressed={boolVal===true} className={boolVal===true?"":"ghost"} onClick={()=>setBoolVal(true)}>○ 正しい</button> <button type="button" aria-pressed={boolVal===false} className={boolVal===false?"":"ghost"} onClick={()=>setBoolVal(false)}>× 誤り</button></div>}
    {(q.format==="fill-blank"||q.format==="term-input"||q.format==="one-answer") && <input aria-label="回答入力" value={text} onChange={e=>setText(e.target.value)} />}
    {essay && <><textarea aria-label="記述回答" rows={q.format==="long-essay"?8:4} value={text} onChange={e=>setText(e.target.value)} placeholder="ここに記述（音声入力はブラウザ対応時のみキーボードの音声入力を利用可）"/>
      <label>自己採点（自動判定と分離保存）<select aria-label="自己採点" value={selfRatio??""} onChange={e=>changeSelfRatio(e.target.value===""?null:Number(e.target.value))}><option value="">未選択</option><option value="1">満点だと思う</option><option value="0.5">半分程度</option><option value="0">できなかった</option></select></label></>}
    {q.format==="ordering" && <div><p className="muted">上下ボタンで並べ替え</p>{order.map((it,i)=><p key={it}>{it} <button type="button" className="ghost" disabled={i===0} onClick={()=>{const n=[...order]; [n[i-1],n[i]]=[n[i]!,n[i-1]!]; setOrder(n);}}>↑</button> <button type="button" className="ghost" disabled={i===order.length-1} onClick={()=>{const n=[...order]; [n[i+1],n[i]]=[n[i]!,n[i+1]!]; setOrder(n);}}>↓</button></p>)}</div>}
    {q.format==="matching" && <div>{(q.matchingPairs??[]).map(p=><label key={p.left}>{p.left}<select aria-label={p.left} value={pairs[p.left]??""} onChange={e=>setPairs({...pairs,[p.left]:e.target.value})}><option value="">選択</option>{matchingOptions(q).map(x=><option key={x} value={x}>{x}</option>)}</select></label>)}</div>}
    {q.format==="table-fill" && <div>{Object.keys(q.blankCellAnswers??{}).map(k=><label key={k}>空欄{k}<input aria-label={"空欄"+k} value={cells[k]??""} onChange={e=>setCells({...cells,[k]:e.target.value})}/></label>)}</div>}
    {q.format==="flashcard" && <div className="card flash" onClick={()=>setFlipped(!flipped)} role="button" aria-label="カード反転">{flipped? q.explanation : "タップしてヒント/解説を表示"}</div>}
    <p><button type="button" onClick={submit} disabled={submitted}>{submitted ? "確定済み（記録は1回だけ保存されます）" : "回答を確定する"}</button></p>
    {result && <div aria-live="polite"><p className={result.correct===true?"ok":result.correct===false?"bad":""}>{result.correct===true?"正解":result.correct===false?"不正解":"部分点・要自己確認"}（スコア {Math.round(result.scoreRatio*100)}%）</p>{!["正解","不正解","不一致"].includes(result.note) && <p>{result.note}</p>}
      {/* UX12: 模範解答は正誤のすぐ下に出す（ユーザー指示）。それ以外の詳細
          （採点内訳・解説・出典）は下に畳み、「次の問題へ」までの距離を短く保つ。
          開くと下へ伸び、スクロールで読み進める形になる。 */}
      {(() => { const ca = correctAnswerOf(q); return ca ? <div className="model-answer"><strong>{ca.label}:</strong> {ca.lines.length === 1 ? ca.lines[0] : <ol style={{ listStyle: "none", paddingLeft: 0, margin: ".2rem 0" }}>{ca.lines.map((l) => <li key={l}>{l}</li>)}</ol>}</div> : null; })()}
      <details className="result-details"><summary>解説・出典などの詳細を見る</summary>
      {q.rubric && <ul>{q.rubric.map(r=><li key={r.id}>{result.matchedPointIds.includes(r.id)?"✓":"−"} {r.label}{r.required?"（必須）":""}</li>)}</ul>}
      <p><strong>解説:</strong> {q.explanation}</p>
      <p className="muted">出典: {q.sourceRefs.length? q.sourceRefs.map(s=>`${s.manifestImageId} p.${s.bookPage??"未確定"}`).join(", ") : "なし"} ／ 関連節: {SECTION_TITLE.get(q.sectionId) ?? q.sectionId}</p>
      {onOpenSection && <p><button type="button" className="ghost" onClick={()=>onOpenSection(q.sectionId)}>教科書の該当箇所を開く</button></p>}
      </details></div>}
  </div>;
}
