// 画面コンポーネント（バンドル分割バッチE1で src/App.tsx から分割。docs/DECISIONS.md #23）
// バッチC1で自己評価UIを追加（docs/DECISIONS.md #32）: 裏面表示後に3段階の自己評価を記録し、
// 演習と共通の SRS（store.srs、キーはカードID）に反映する。解答記録（records）には追加しない。
// 修正バッチFIX1（DECISIONS #34）: 種別フィルタ・章フィルタ・シャッフル有無を追加し、
// 既定では全種別をシャッフルして開始する（毎回同じ先頭カードから始まらない）。
// 自己評価→SRS の仕様は全種別で従来どおり維持する。
// UX10（DECISIONS #46）: 自己評価と「次のカード」のボタンをカードの真下へ移し、
// スクロールなしで操作できるようにした（状態表示はボタンの下へ）。
import { useMemo, useState } from "react";
import { CARDS } from "../data/questions";
import { CHAPTERS } from "../data/structure";
import type { StoreData } from "../domain/store";
import { applyCardReview, isDue, type CardSelfEval } from "../domain/srs";
import { CARD_KIND_LABELS, cardKindOf, countCardsByKind, filterCards } from "../domain/cards";
import { seededShuffle } from "../domain/shuffle";
import type { FlashcardKind } from "../domain/types";

const EVAL_OPTIONS: { key: CardSelfEval; label: string }[] = [
 { key: "known", label: "分かった" },
 { key: "unsure", label: "あいまい" },
 { key: "unknown", label: "分からない" },
];
const CHAPTER_LABEL = new Map(CHAPTERS.map((ch) => [ch.id, ch.label]));
const KIND_ORDER: FlashcardKind[] = ["qa", "profile", "term", "reverse"];

export default function Cards({store, update}:{store:StoreData; update:any}){
 const all=useMemo(()=>[...CARDS], []);
 const [kind,setKind]=useState<FlashcardKind|null>(null);
 const [chapterId,setChapterId]=useState<string|null>(null);
 const [shuffleOn,setShuffleOn]=useState(true);
 // お気に入りのカードだけに絞る（R24、DECISIONS #55）
 const [favOnly,setFavOnly]=useState(false);
 const [seed,setSeed]=useState(()=>String(Date.now()));
 const [i,setI]=useState(0); const [flip,setFlip]=useState(false);
 const filtered=useMemo(()=>filterCards(all, { kind, chapterId }).filter(x=>!favOnly || store.cardFavorites.includes(x.id)), [all, kind, chapterId, favOnly, store.cardFavorites]);
 const ordered=useMemo(()=> shuffleOn? seededShuffle(filtered, `cards|${kind ?? "all"}|${chapterId ?? "all"}|${seed}`) : filtered, [filtered, shuffleOn, kind, chapterId, seed]);
 const kindCounts=useMemo(()=>countCardsByKind(all), [all]);
 const resetPosition=()=>{ setI(0); setFlip(false); };
 const c=ordered[i % Math.max(1,ordered.length)];
 // 前のカードへ（ユーザー指示 2026-10-31）: 表示中インデックス基準で循環する
 const prevCard=()=>{ if(ordered.length===0) return; const cur=((i % ordered.length)+ordered.length)%ordered.length; setFlip(false); setI((cur-1+ordered.length)%ordered.length); };
 const st=c? store.srs[c.id] : undefined;
 const isFav=c? store.cardFavorites.includes(c.id) : false;
 const evaluated=all.filter(x=>store.srs[x.id]).length;
 const evaluate=(ev:CardSelfEval)=>{ if(!c) return; update((d:StoreData)=>{ d.srs[c.id]=applyCardReview(d.srs[c.id], c.id, ev); return d; }); setFlip(false); setI(i+1); };
 return <main><h1>フラッシュカード・単語帳</h1>
 {!c ? <p className="card">対象カードがありません。種別・章・お気に入りの条件を変えてください。</p> :
 <><div className="card flash" role="button" aria-label="カード反転" tabIndex={0} onClick={()=>setFlip(!flip)} onKeyDown={e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); setFlip(!flip); } }}>{flip? c.back : c.front}</div>
 {/* UX10: 操作ボタンはカードの真下に置く（スクロールなしで届くように） */}
 {flip
  ? <p className="actions" role="group" aria-label="自己評価">{EVAL_OPTIONS.map(o=><button key={o.key} onClick={()=>evaluate(o.key)}>{o.label}</button>)}</p>
  : <p className="actions"><button type="button" onClick={()=>setFlip(true)}>裏面を表示</button></p>}
 <p className="actions"><button type="button" className="ghost" onClick={prevCard}>前のカード</button><button type="button" className="ghost" onClick={()=>{setFlip(false); setI(i+1);}}>次のカード</button><button type="button" className="ghost" aria-pressed={isFav} onClick={()=>update((d:StoreData)=>({...d, cardFavorites: isFav? d.cardFavorites.filter(x=>x!==c.id) : [...d.cardFavorites, c.id]}))}>{isFav? "★ お気に入り" : "☆ お気に入り"}</button></p>
 <p className="muted" style={{margin:".2rem 0"}}>{(i % ordered.length)+1} / {ordered.length} 枚 ・ {CARD_KIND_LABELS[cardKindOf(c)]} ・ {CHAPTER_LABEL.get(c.chapterId) ?? c.chapterId}{st? ` ・ 復習 ${st.repetitions} 回・次回 ${st.dueAt.slice(0,10)}${isDue(st)?"（期限到来）":""}` : " ・ 未評価"}</p></>}
 <p><label>種別<select aria-label="種別" value={kind ?? ""} onChange={e=>{ setKind(e.target.value===""? null : e.target.value as FlashcardKind); resetPosition(); }}><option value="">すべて（{all.length}件）</option>{KIND_ORDER.map(k=><option key={k} value={k}>{CARD_KIND_LABELS[k]}（{kindCounts[k]}件）</option>)}</select></label>{" "}
 <label>章<select aria-label="章" value={chapterId ?? ""} onChange={e=>{ setChapterId(e.target.value===""? null : e.target.value); resetPosition(); }}><option value="">すべて</option>{CHAPTERS.map(ch=><option key={ch.id} value={ch.id}>{ch.label}</option>)}</select></label>{" "}
 <label>並び<select aria-label="並び" value={shuffleOn? "shuffle" : "sequence"} onChange={e=>{ setShuffleOn(e.target.value==="shuffle"); resetPosition(); }}><option value="shuffle">シャッフル</option><option value="sequence">登録順</option></select></label>{" "}
 <label className="chip" style={{marginTop:".4rem"}}><input type="checkbox" checked={favOnly} onChange={e=>{ setFavOnly(e.target.checked); resetPosition(); }}/>お気に入りのみ（{store.cardFavorites.length}枚）</label>{" "}
 {shuffleOn && <button className="ghost" onClick={()=>{ setSeed(String(Date.now())); resetPosition(); }}>シャッフルし直す</button>}</p>
 <p className="foot-note">評価済み {evaluated} / 全 {all.length} 枚。裏面を表示すると自己評価を記録できます。自己評価は復習間隔（SRS）に反映されます（解答記録には追加されません）。</p></main>;
}
