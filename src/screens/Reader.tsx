// 画面コンポーネント（バンドル分割バッチE1で src/App.tsx から分割。docs/DECISIONS.md #23）
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { CHAPTERS, ALL_SECTIONS } from "../data/structure";
import { QUESTIONS } from "../data/questions";
import { IMPORTED_KNOWLEDGE_UNITS } from "../data/knowledge";
import { transcriptPagesForSection, type TranscriptBlock } from "../data/transcripts";
import { FRONT_MATTER_IMAGES, imageForBookPage, pageImageUrl, type PageImageEntry } from "../data/pageImages";
import type { StoreData } from "../domain/store";

function TranscriptBlockView({b}:{b:TranscriptBlock}){
 if(b.type==="heading") return b.level && b.level>=3 ? <h4>{b.text}</h4> : <h3>{b.text}</h3>;
 if(b.type==="caption") return <p className="muted">［写真］{b.text}</p>;
 if(b.type==="note") return <p className="muted">{b.text}</p>;
 if(b.type==="column") return <aside className="card">{b.title?<h4>{b.title}</h4>:null}<p>{b.text}</p></aside>;
 if(b.type==="table") return <figure>{b.caption?<figcaption>{b.caption}</figcaption>:null}<table><tbody>{(b.rows??[]).map((r,i)=><tr key={i}>{r.map((c,j)=><td key={j}>{c}</td>)}</tr>)}</tbody></table></figure>;
 return <p>{b.text}</p>;
}
// ページ原画の表示（UX3、docs/DECISIONS.md #38）。原画は Base64 テキスト
// （public/pages-b64/）として配信し、開いたページだけ fetch して Blob URL 化する。
// 一度読み込んだ原画はモジュール内のキャッシュで使い回す。
const blobUrlCache = new Map<string, string>();

function PageImage({ imageId, label, defaultOpen = false }: { imageId: string; label: string; defaultOpen?: boolean }) {
 const [open, setOpen] = useState(defaultOpen);
 const [url, setUrl] = useState<string | null>(() => blobUrlCache.get(imageId) ?? null);
 const [failed, setFailed] = useState(false);
 useEffect(() => {
  if (!open || url) return;
  let cancelled = false;
  fetch(pageImageUrl(imageId))
   .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.text(); })
   .then((text) => {
    const bin = atob(text);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const u = URL.createObjectURL(new Blob([bytes], { type: "image/webp" }));
    blobUrlCache.set(imageId, u);
    if (!cancelled) setUrl(u);
   })
   .catch(() => { if (!cancelled) setFailed(true); });
  return () => { cancelled = true; };
 }, [open, url, imageId]);
 return <div>
  <p><button type="button" className="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? `原画を隠す（${label}）` : `原画を表示（${label}）`}</button></p>
  {open && (failed
   ? <p className="muted">原画を読み込めませんでした。</p>
   : url
    ? <img src={url} alt={`${label}の原画`} style={{ width: "100%", height: "auto" }} loading="lazy" />
    : <p className="muted">原画を読み込み中…</p>)}
 </div>;
}

// 索引節の代替表示（UX4、docs/DECISIONS.md #39）。本書の索引（p.145〜147）は
// アプリに収録したスパイス＆ハーブの知識データ（原文照合済み）から生成した
// 索引。本書の索引の転記（T18で収録済み）と併記し、ページ番号から該当する
// 節へ移動するナビゲーションとして使う（DECISIONS #41）。
function buildIndexEntries(): { name: string; pages: number[] }[] {
 const map = new Map<string, Set<number>>();
 for (const u of IMPORTED_KNOWLEDGE_UNITS) {
  if (!u.spice) continue;
  const name = u.spice.name.replace(/（続き）|\(続き\)/g, "").trim();
  if (!name) continue;
  const set = map.get(name) ?? new Set<number>();
  set.add(u.source.page);
  map.set(name, set);
 }
 return [...map.entries()]
  .map(([name, pages]) => ({ name, pages: [...pages].sort((a, b) => a - b) }))
  .sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

function GeneratedIndex({ onJump }: { onJump: (sectionId: string, page: number) => void }) {
 const [q, setQ] = useState("");
 const entries = useMemo(buildIndexEntries, []);
 const shown = entries.filter((e) => !q || e.name.includes(q));
 const jumpToPage = (page: number) => {
  const target = [...ALL_SECTIONS].reverse().find((s) => s.bookPage <= page);
  if (target) onJump(target.id, page);
 };
 return <div>
  <input aria-label="索引検索" placeholder="名前で絞り込み" value={q} onChange={(e) => setQ(e.target.value)} />
  <p>{shown.length}件（全{entries.length}種）</p>
  <ul>{shown.map((e) => <li key={e.name}><strong>{e.name}</strong> {e.pages.map((p) => <button key={p} className="ghost" onClick={() => jumpToPage(p)}>p.{p}</button>)}</li>)}</ul>
  <p className="foot-note">この索引は、アプリに収録した原文照合済みデータから生成したものです。本書の索引の転記とは別に、ページ番号からそのページへ移動できます。</p>
 </div>;
}

const isWide = () => typeof window === "undefined" || !window.matchMedia || window.matchMedia("(min-width: 761px)").matches;

export default function Reader({store,update}:{store:StoreData;update:any}){
 const [sel,setSel]=useState(store.reader.sectionId || ALL_SECTIONS[0]!.id); const [query,setQuery]=useState("");
 const location = useLocation();
 // 全アプリ共通UIルール1（DECISIONS #55）: スマホ幅では目次（81節）を畳んで本文を先に見せる。PC幅では開いたまま。
 const [tocOpen,setTocOpen]=useState(isWide);
 // FIX（DECISIONS #51）: ページ指定ジャンプ（改訂ポイント・索引）では、節の先頭では
 // なく指定ページへ着地させる。遷移 state の targetPage を控え、節の描画後に
 // そのページのアンカーへスクロールする（1回だけ消費する）。
 const pendingTargetRef = useRef<number | null>(null);
 useEffect(()=>{ const tp = (location.state as { targetPage?: number } | null)?.targetPage; if (typeof tp === "number") pendingTargetRef.current = tp; }, [location.key]);
 // 監査C-14是正: 問題画面・検索画面から reader.sectionId 経由で遷移してきた場合に追随する。
 useEffect(()=>{ if (store.reader.sectionId && store.reader.sectionId!==sel) setSel(store.reader.sectionId); }, [store.reader.sectionId]);
 // ユーザー要望対応（DECISIONS #35）: スマホでは目次が本文の上に積まれるため、
 // 開いた直後や目次で節を選んだ直後は、スクロールせずに本文（ページ）へ
 // すぐ飛べるよう、本文の先頭へ自動でスクロールする。固定ヘッダーに本文が
 // 隠れないよう、本文側に scroll-margin-top（styles.css の #reader-page）を置く。
 const pageRef = useRef<HTMLElement | null>(null);
 useEffect(()=>{
  const tp = pendingTargetRef.current;
  if (tp !== null) {
   pendingTargetRef.current = null;
   const el = document.getElementById(`reader-pg-${tp}`);
   if (el) { el.scrollIntoView({ block: "start" }); return; }
  }
  pageRef.current?.scrollIntoView?.({ block: "start" });
 }, [sel ]);
 const sec = ALL_SECTIONS.find(s=>s.id===sel) ?? ALL_SECTIONS[0]!;
 const secPages = transcriptPagesForSection(sec.id);
 // UX3: 転記がないページ（写真のみのページ・部分転記の欠け分）も原画で読めるよう、
 // この節のページ範囲（次の節の開始ページ-1 まで、上限 p.147）のうち
 // 転記レコードがないページの原画を別枠で出す。
 const secIndex = ALL_SECTIONS.findIndex(s=>s.id===sec.id);
 const spanEnd = Math.min((ALL_SECTIONS[secIndex+1]?.bookPage ?? 148) - 1, 147);
 const transcribedNums = new Set(secPages.map(p=>p.bookPage));
 const extraPageImages: PageImageEntry[] = [];
 for (let pg = sec.bookPage; pg <= spanEnd; pg++) {
  if (transcribedNums.has(pg)) continue;
  const e = imageForBookPage(pg);
  if (e) extraPageImages.push(e);
 }
 const bookmarked = store.reader.bookmarks.includes(sec.id);
 const relatedCount = QUESTIONS.filter(q=>q.sectionId===sec.id).length;
 const openSection = (id: string) => { pendingTargetRef.current=null; setSel(id); update((d:StoreData)=>{d.reader.sectionId=id; return d;}); };
 const filtered = ALL_SECTIONS.filter(s=>!query || s.title.includes(query));
 // E2E導入バッチE2で発見した不具合の最小修正: ALL_SECTIONS は CHAPTERS の節を
 // スプレッドで複製した別オブジェクトのため、参照一致（includes）では目次の節が
 // 1件も一致せず、目次ボタンが一切描画されなかった。節IDでの一致に変更する。
 const filteredIds = new Set(filtered.map(s=>s.id));
 return <main data-dark={store.reader.dark}><h1>電子書籍リーダー</h1>
 <div className="split"><section className="card"><details className="fold" open={tocOpen} onToggle={e=>setTocOpen((e.currentTarget as HTMLDetailsElement).open)}><summary>目次</summary><input aria-label="節検索" placeholder="節名で絞り込み" value={query} onChange={e=>setQuery(e.target.value)}/>
 {CHAPTERS.map(c=><div key={c.id}><h3>{c.label} {c.title}</h3><ul>{c.sections.filter(s=>filteredIds.has(s.id)).map(s=><li key={s.id}><button className="ghost" aria-current={s.id===sec.id ? "true" : undefined} onClick={()=>{pendingTargetRef.current=null; setSel(s.id); if (!isWide()) setTocOpen(false); update((d:StoreData)=>{d.reader.sectionId=s.id; return d;});}}>{s.title}（p.{s.bookPage}）</button></li>)}</ul></div>)}
 <div><h3>本書の表紙・目次（原画）</h3>{FRONT_MATTER_IMAGES.map(e=><PageImage key={e.imageId} imageId={e.imageId} label={e.imageId} />)}</div>
 </details></section>
 <section className="card" id="reader-page" ref={pageRef} style={{fontSize: store.reader.fontSize}}><h2>{sec.title}</h2>
 <p className="actions"><button className="ghost" disabled={secIndex<=0} onClick={()=>openSection(ALL_SECTIONS[secIndex-1]!.id)}>前の節</button><button className="ghost" disabled={secIndex>=ALL_SECTIONS.length-1} onClick={()=>openSection(ALL_SECTIONS[secIndex+1]!.id)}>次の節</button><button className="ghost" aria-pressed={bookmarked} onClick={()=>update((d:StoreData)=>{ d.reader.bookmarks = bookmarked ? d.reader.bookmarks.filter(x=>x!==sec.id) : [...d.reader.bookmarks, sec.id]; return d;})}>{bookmarked ? "★ しおり" : "☆ しおり"}</button></p>
 {secPages.length===0 ? <p>この節の本文はまだ転記されていません。原本画像を目視読解して転記したテキストのみがここに掲載されます。推測で本文を補うことはしません。</p>
 : secPages.map((p,pi)=><div key={p.bookPage} id={`reader-pg-${p.bookPage}`} className="reader-pg"><p className="muted">― 本書 p.{p.bookPage} ―</p><PageImage imageId={p.imageId} label={`本書 p.${p.bookPage}`} defaultOpen={pi===0} />{p.blocks.map((b,i)=><TranscriptBlockView key={i} b={b}/>)}{p.unclear.length>0 && <p className="muted">不明瞭箇所: {p.unclear.map(u=>`${u.location}: ${u.note}`).join(" ／ ")}</p>}</div>)}
 {sec.id==="index" && secPages.length>0 && <div><h3>アプリ収録データからの索引（ページへ移動できます）</h3><GeneratedIndex onJump={(sid,page)=>{pendingTargetRef.current=page; setSel(sid); update((d:StoreData)=>{d.reader.sectionId=sid; return d;});}} /></div>}
 {extraPageImages.length>0 && <div><h3>{secPages.length===0 ? "この節の原画" : "この節の他のページの原画"}</h3>{extraPageImages.map(e=><div key={e.imageId} id={`reader-pg-${e.bookPage}`} className="reader-pg"><PageImage imageId={e.imageId} label={`本書 p.${e.bookPage}`} /></div>)}</div>}
 <p className="actions"><Link className="btn" to="/practice" state={{ sectionId: sec.id }}>この節の問題を演習する（{relatedCount}問）</Link></p>
 {store.reader.bookmarks.length>0 && <div><h3>しおり</h3><ul className="rows">{store.reader.bookmarks.map(id=>{ const b=ALL_SECTIONS.find(x=>x.id===id); return b ? <li key={id}><button className="row" onClick={()=>openSection(id)}><span>{b.title}</span><small>p.{b.bookPage}</small></button></li> : null; })}</ul></div>}
 <label>ハイライト（この節の強調メモ）<input value={store.reader.highlights[sec.id]??""} onChange={e=>update((d:StoreData)=>{d.reader.highlights[sec.id]=e.target.value; return d;})}/></label>
 <label>簡易メモ<textarea value={store.reader.notes[sec.id]??""} onChange={e=>update((d:StoreData)=>{d.reader.notes[sec.id]=e.target.value; return d;})}/></label>
 <label>文字サイズ<input type="range" min={14} max={22} value={store.reader.fontSize} onChange={e=>update((d:StoreData)=>{d.reader.fontSize=Number(e.target.value); return d;})}/></label>
 <p className="actions"><button className="ghost" onClick={()=>update((d:StoreData)=>{d.reader.dark=!d.reader.dark; return d;})}>ダークモード切替</button></p>
 <p className="foot-note">書籍 p.{sec.bookPage} ／ 転記状態: {sec.transcriptionStatus}</p>
 <p className="foot-note" style={{marginTop:0}}>本文は原本画像を目視で転記したテキストで、各ページの原画と見比べられます。文字サイズはこのリーダーの本文だけに適用され、メモとハイライトは原文とは別に端末内へ保存されます。</p>
 </section></div></main>;
}
