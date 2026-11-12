// 画面コンポーネント（バンドル分割バッチE1で src/App.tsx から分割。docs/DECISIONS.md #23）
import { QUESTIONS, KNOWLEDGE_UNITS } from "../data/questions";
import { IMPORTED_KNOWLEDGE_UNITS } from "../data/knowledge";
import { PAGE_IMAGES } from "../data/pageImages";
import { APP_DATA_SUMMARY } from "../data/summary";
import type { StoreData } from "../domain/store";
import { validateQuestion, findDuplicateCandidates } from "../domain/validate";

export default function QaPage({ store, update }: { store?: StoreData; update?: (fn: (d: StoreData) => StoreData) => void }){
 const all=[...QUESTIONS];
 const issues=all.flatMap(q=>validateQuestion(q, [...KNOWLEDGE_UNITS, ...IMPORTED_KNOWLEDGE_UNITS]));
 const dup=findDuplicateCandidates(all);
 const reports=store?.reports ?? []; const excluded=store?.excluded ?? [];
 const qById=new Map(all.map(q=>[q.id,q]));
 const unasked=IMPORTED_KNOWLEDGE_UNITS.filter(u=>!QUESTIONS.some(q=>q.knowledgeUnitIds.includes(u.id))).length;
 const exportJson=()=>{ const blob=new Blob([JSON.stringify({reports,excluded,issues,dup},null,2)],{type:"application/json"}); const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="qa-proposals.json"; a.click(); };
 return <main><h1>品質管理（管理・監査）</h1><section className="card">
 <dl className="kv">
  <dt>正式問題</dt><dd>{all.length}問（未検証 {all.filter(q=>q.status!=="verified").length}件）</dd>
  <dt>出典不明</dt><dd>{issues.filter(i=>i.code==="no-source").length}件</dd>
  <dt>検証エラー</dt><dd>{issues.length}件</dd>
  <dt>同一文の重複</dt><dd>{dup.length}組</dd>
  <dt>知識単位</dt><dd>{IMPORTED_KNOWLEDGE_UNITS.length}件（原文照合済み {IMPORTED_KNOWLEDGE_UNITS.filter(u=>u.status==="verified").length}件・未出題 {unasked}件）</dd>
  <dt>原本画像</dt><dd>{PAGE_IMAGES.length}件（欠落 {APP_DATA_SUMMARY.missingImages}件）</dd>
  <dt>問題報告</dt><dd>{reports.length}件 ・ 出題から除外 {excluded.length}問</dd>
 </dl>
 {issues.length>0 && <ul>{issues.map((i,idx)=><li key={idx}>[{i.severity}/{i.code}] {i.targetId}: {i.message}</li>)}</ul>}
 <p className="actions"><button onClick={exportJson}>報告・検証結果を書き出す（JSON）</button></p></section>
 {reports.length>0 && <section className="card"><h2>問題報告</h2><ul className="rows">{reports.map((r,i)=><li key={i} style={{padding:".4rem 0"}}><strong>{qById.get(r.questionId)?.prompt ?? r.questionId}</strong><br/>{r.note}<br/><span className="muted">{r.at.slice(0,10)}</span> <button type="button" className="ghost" onClick={()=>update?.((d)=>{ d.reports=d.reports.filter((_,j)=>j!==i); return d; })}>削除</button></li>)}</ul></section>}
 {excluded.length>0 && <section className="card"><h2>出題から除外した問題</h2><ul className="rows">{excluded.map(id=><li key={id} style={{padding:".4rem 0"}}>{qById.get(id)?.prompt ?? id} <button type="button" className="ghost" onClick={()=>update?.((d)=>({ ...d, excluded: d.excluded.filter(x=>x!==id) }))}>出題に戻す</button></li>)}</ul></section>}
 <p className="foot-note">問題報告は演習の解説欄から保存でき、この端末内にだけ保存されます。GitHubへ直接書き込む機構は実装していません。書き出したJSONを開発側でリポジトリの生成元データに反映します。正式問題・カードは scripts/generate-questions.mjs が原文照合済みの知識単位から生成・検証します。</p></main>;
}
