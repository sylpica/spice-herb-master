// 画面コンポーネント（バンドル分割バッチE1で src/App.tsx から分割。docs/DECISIONS.md #23）
import { QUESTIONS } from "../data/questions";
import { IMPORTED_KNOWLEDGE_UNITS } from "../data/knowledge";
import { ALL_SECTIONS, CHAPTERS } from "../data/structure";
import { FORMAT_LABELS, type QuestionFormat } from "../domain/types";
import { PAGE_IMAGES } from "../data/pageImages";
import { APP_DATA_SUMMARY } from "../data/summary";
import { studyStreak, periodReport } from "../domain/streak";
import { ESSAY_FORMATS } from "../domain/practice";
import type { StoreData } from "../domain/store";
import { computeStats, computeCoverage } from "../domain/stats";
import { isDue } from "../domain/srs";
import { dateKeyOfIso } from "../domain/dates";

export default function Stats({store}:{store:StoreData}){
 const all=[...QUESTIONS]; const st=computeStats(store.records, all);
 const qById=new Map(all.map(q=>[q.id,q]));
 const dueQ=Object.values(store.srs).filter(s=>!s.itemId.startsWith("card-") && isDue(s)).length; const dueC=Object.values(store.srs).filter(s=>s.itemId.startsWith("card-") && isDue(s)).length;
 const cov=computeCoverage({presentImages:PAGE_IMAGES.length, expectedImages:PAGE_IMAGES.length+APP_DATA_SUMMARY.missingImages, units:IMPORTED_KNOWLEDGE_UNITS, totalSections:ALL_SECTIONS.length, questions:QUESTIONS, records:store.records});
 const pct=(v:number|null)=> v==null? "未測定（算出不能）" : Math.round(v*100)+"%";
 const chapterLabel=(id:string)=>{ const c=CHAPTERS.find(x=>x.id===id); return c? `${c.label} ${c.title}` : id; };
 const rows=(m:Map<string,{total:number;correct:number}>, label:(k:string)=>string=(k)=>k)=>[...m.entries()].map(([k,v])=><tr key={k}><th scope="row">{label(k)}</th><td>{v.total}</td><td>{v.total?Math.round(v.correct/v.total*100):0}%</td></tr>);
 const streak=studyStreak(store.records); const week=periodReport(store.records,7); const month=periodReport(store.records,30);
 const essayRecs=store.records.filter(r=>{ const q=qById.get(r.questionId); return !!q && ESSAY_FORMATS.includes(q.format); });
 const essayPoint=essayRecs.length? essayRecs.reduce((a,r)=>a+(r.autoScoreRatio??0),0)/essayRecs.length : null;
 const badges=[
  {label:"はじめの一歩", ok: st.total>=1},{label:"100問", ok: st.total>=100},{label:"1000問", ok: st.total>=1000},
  {label:"3日連続", ok: streak>=3},{label:"7日連続", ok: streak>=7},{label:"30日連続", ok: streak>=30},
  {label:"全問題に挑戦", ok: cov.studiedRatio===1},
 ];
 const rep=(r:{answered:number;accuracy:number|null;activeDays:number;days:number})=>`${r.answered}問 ・ 正答率 ${r.accuracy==null?"—":Math.round(r.accuracy*100)+"%"} ・ 学習 ${r.activeDays}/${r.days}日`;
 const table=(title:string, body:React.ReactNode[])=> body.length===0 ? null : <><h2>{title}</h2><table><thead><tr><th scope="col">区分</th><th scope="col">解答</th><th scope="col">正答率</th></tr></thead><tbody>{body}</tbody></table></>;
 const weakChapters=[...st.byChapter.entries()].filter(([,v])=>v.total>=5 && v.correct/v.total<0.6).map(([k])=>chapterLabel(k));
 return <main><h1>学習分析・可視化</h1>
 <section className="card"><dl className="kv">
  <dt>総解答</dt><dd>{st.total}問 ・ 正答率 {st.accuracy==null?"—":Math.round(st.accuracy*100)+"%"}</dd>
  <dt>連続学習</dt><dd>{streak}日（学習日数 {new Set(store.records.map(r=>dateKeyOfIso(r.answeredAt))).size}日）</dd>
  <dt>直近7日</dt><dd>{rep(week)}</dd>
  <dt>直近30日</dt><dd>{rep(month)}</dd>
  <dt>復習期限</dt><dd>問題 {dueQ}件 ・ カード {dueC}件</dd>
  <dt>苦手分野</dt><dd>{weakChapters.join("、")||"—"}</dd>
 </dl>
 <p aria-label="バッジ" className="chips">{badges.map(b=><span key={b.label} className="badge" style={b.ok?undefined:{opacity:.45}}>{b.ok?"★":"☆"} {b.label}</span>)}</p></section>
 <section className="card"><h2>網羅率</h2><dl className="kv">
  <dt>原本の収録</dt><dd>{pct(cov.importedRatio)}（{PAGE_IMAGES.length}/{PAGE_IMAGES.length+APP_DATA_SUMMARY.missingImages}画像）</dd>
  <dt>問題化</dt><dd>{pct(cov.questionizedRatio)}（知識単位 {IMPORTED_KNOWLEDGE_UNITS.length}件）</dd>
  <dt>学習済み</dt><dd>{pct(cov.studiedRatio)}（1回以上解いた問題）</dd>
  <dt>習得推定</dt><dd>{pct(cov.masteredRatio)}（直近2回連続正解）</dd>
  <dt>記述の要点達成</dt><dd>{essayPoint==null?"—":Math.round(essayPoint*100)+"%"}（記述式 {essayRecs.length}回の自動判定の平均）</dd>
 </dl></section>
 {st.total>0 && <section className="card">{table("章別", rows(st.byChapter, chapterLabel))}{table("形式別", rows(st.byFormat, (k)=>FORMAT_LABELS[k as QuestionFormat] ?? k))}{table("難易度別", rows(st.byDifficulty, (k)=>`難易度 ${k}`))}</section>}
 <p className="foot-note">5つの網羅率は別々の指標です。原本の収録は教材画像の収録割合、問題化は知識単位のうち問題になった割合、学習済み・習得推定は端末の解答記録から求めた値で、実際の理解度の実測ではありません。合格可能性などの根拠のない予測は表示しません。</p></main>;
}
