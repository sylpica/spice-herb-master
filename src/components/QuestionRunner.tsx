
import { useEffect, useRef, useState } from "react";
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

/** 過去の記述回答（R47: 書き直しと過去回答との比較用） */
export interface PastAnswer { at: string; text: string; scoreRatio: number|null }
/** 選択肢・正誤・並べ替えなど、行の入れ替え（i と i+delta）。範囲外は元の配列をそのまま返す。演習と模試で共用する。 */
export function moveItem<T>(items: readonly T[], i: number, delta: -1|1): T[] {
  const j = i + delta; const n = [...items];
  if (i < 0 || j < 0 || i >= n.length || j >= n.length) return n;
  [n[i], n[j]] = [n[j]!, n[i]!];
  return n;
}

export default function QuestionRunner({ q, saved, onGraded, onSelfScore, onOpenSection, pastAnswers, onReport, reported, excluded, onToggleExcluded }: { q: Question; saved?: SavedAnswer; onGraded?: (r: GradeResult, selfRatio: number|null, responseMs: number, answer: unknown)=>void; onSelfScore?: (selfRatio: number|null)=>void; onOpenSection?: (sectionId: string)=>void; pastAnswers?: PastAnswer[]; onReport?: (note: string)=>void; reported?: boolean; excluded?: boolean; onToggleExcluded?: ()=>void }) {
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
  // R47: 記述式は書き直して採点し直せる（新しい回答として記録される。過去の回答は詳細で見比べられる）。
  const rewrite = () => { setSubmitted(false); setResult(null); startedAt.current = Date.now(); };
  const [reportNote, setReportNote] = useState("");
  // R27: キーボード操作。1〜9 で選択肢、Enter で確定（複数行の記述欄では改行を優先する）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName ?? "";
      const typing = tag === "TEXTAREA" || tag === "SELECT" || (tag === "INPUT" && !["radio", "checkbox"].includes((t as HTMLInputElement).type));
      if (e.key === "Enter" && tag !== "TEXTAREA" && tag !== "BUTTON" && tag !== "SUMMARY" && tag !== "A" && !submitted) { e.preventDefault(); submit(); return; }
      if (typing || submitted) return;
      if (q.choices && /^[1-9]$/.test(e.key)) {
        const i = Number(e.key) - 1;
        if (i < q.choices.length) { e.preventDefault(); setSelected((cur) => (q.format === "multiple-choice" ? (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]) : [i])); }
      } else if (q.format === "true-false" && (e.key === "o" || e.key === "1")) setBoolVal(true);
      else if (q.format === "true-false" && (e.key === "x" || e.key === "2")) setBoolVal(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return <div className="card" aria-label="問題">
    <p className="muted">難易度 {q.difficulty}</p>
    <h2 style={{fontSize:"1.1rem"}}>{q.prompt}</h2>
    {q.imageAlt && <p className="muted" role="img" aria-label={q.imageAlt}>🖼 {q.imageRef? q.imageRef : "画像は未設定です（教科書画像は未取り込み）"}</p>}
    {q.table && <table><thead><tr>{q.table.headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{q.table.rows.map((r,i)=><tr key={i}>{r.map((c,j)=><td key={j}>{c}</td>)}</tr>)}</tbody></table>}
    {q.choices && <div role="group" aria-label="選択肢">{q.choices.map((c,i)=>{ const multi = q.format==="multiple-choice"; const isAns = q.correctChoiceIndexes?.includes(i) ?? false; const mark = submitted ? (isAns ? " is-correct" : selected.includes(i) ? " is-wrong" : "") : ""; return <label key={i} className={"choice"+mark}><input type={multi?"checkbox":"radio"} name={q.id} disabled={submitted} checked={selected.includes(i)} onChange={()=> setSelected(multi? (selected.includes(i)? selected.filter(x=>x!==i): [...selected,i]) : [i])}/><span>{c}{submitted && isAns ? "（正答）" : ""}</span></label>;})}</div>}
    {q.format==="true-false" && <div><button type="button" disabled={submitted} aria-pressed={boolVal===true} className={boolVal===true?"":"ghost"} onClick={()=>setBoolVal(true)}>○ 正しい</button> <button type="button" disabled={submitted} aria-pressed={boolVal===false} className={boolVal===false?"":"ghost"} onClick={()=>setBoolVal(false)}>× 誤り</button></div>}
    {(q.format==="fill-blank"||q.format==="term-input"||q.format==="one-answer") && <input aria-label="回答入力" value={text} readOnly={submitted} onChange={e=>setText(e.target.value)} />}
    {essay && <><textarea aria-label="記述回答" rows={q.format==="long-essay"?8:4} value={text} onChange={e=>setText(e.target.value)} placeholder="ここに記述"/>
      <label>自己採点<select aria-label="自己採点" value={selfRatio??""} onChange={e=>changeSelfRatio(e.target.value===""?null:Number(e.target.value))}><option value="">未選択</option><option value="1">満点だと思う</option><option value="0.5">半分程度</option><option value="0">できなかった</option></select></label></>}
    {q.format==="ordering" && <div><p className="muted">上下ボタンで並べ替え</p>{order.map((it,i)=><p key={it} className="inline-field"><span style={{flex:1}}>{i+1}. {it}</span> <button type="button" className="ghost" disabled={submitted||i===0} onClick={()=>setOrder(moveItem(order, i, -1))}>↑</button> <button type="button" className="ghost" disabled={submitted||i===order.length-1} onClick={()=>setOrder(moveItem(order, i, 1))}>↓</button></p>)}</div>}
    {q.format==="matching" && <div>{(q.matchingPairs??[]).map(p=><label key={p.left}>{p.left}<select aria-label={p.left} value={pairs[p.left]??""} onChange={e=>setPairs({...pairs,[p.left]:e.target.value})}><option value="">選択</option>{matchingOptions(q).map(x=><option key={x} value={x}>{x}</option>)}</select></label>)}</div>}
    {q.format==="table-fill" && <div>{Object.keys(q.blankCellAnswers??{}).map(k=><label key={k}>空欄{k}<input aria-label={"空欄"+k} value={cells[k]??""} onChange={e=>setCells({...cells,[k]:e.target.value})}/></label>)}</div>}
    {q.format==="flashcard" && <div className="card flash" onClick={()=>setFlipped(!flipped)} role="button" aria-label="カード反転">{flipped? q.explanation : "タップしてヒント/解説を表示"}</div>}
    <p className="actions"><button type="button" onClick={submit} disabled={submitted}>{submitted ? "確定済み" : "回答を確定する"}</button>{essay && submitted && <button type="button" className="ghost" onClick={rewrite}>書き直す</button>}</p>
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
      {essay && pastAnswers && pastAnswers.length > 0 && <div aria-label="過去の回答"><p><strong>過去の回答（{pastAnswers.length}件）</strong></p><ul>{pastAnswers.slice(-5).reverse().map((a,i)=><li key={i}><span className="muted">{a.at.slice(0,10)}{a.scoreRatio!=null?` ・ ${Math.round(a.scoreRatio*100)}%`:""}</span><br/>{a.text}</li>)}</ul></div>}
      {(onReport || onToggleExcluded) && <details className="fold"><summary>この問題を報告・除外</summary>
        {onReport && <><textarea aria-label="報告内容" rows={2} value={reportNote} onChange={e=>setReportNote(e.target.value)} placeholder="誤り・気になった点"/><p className="actions"><button type="button" className="ghost" disabled={!reportNote.trim()} onClick={()=>{ onReport(reportNote.trim()); setReportNote(""); }}>報告を保存</button>{onToggleExcluded && <button type="button" className="ghost" aria-pressed={!!excluded} onClick={onToggleExcluded}>{excluded ? "出題に戻す" : "出題から除外"}</button>}</p>{reported && <p className="muted">報告を保存済みです（設定 → 品質管理で一覧・書き出しができます）。</p>}</>}
      </details>}
      </details></div>}
  </div>;
}
