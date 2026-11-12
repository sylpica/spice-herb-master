import { Component, Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { Routes, Route, Link, useLocation } from "react-router";
import { loadStore, saveStore, resetStoreData, type StoreData } from "./domain/store";

/**
 * アプリシェル（バンドル分割バッチE1、docs/DECISIONS.md #23）。
 * 10画面は src/screens/ 配下に分割し、React.lazy でルート単位に遅延読み込みする。
 * 初期表示（ホーム）は軽量サマリ（src/data/summary.ts）の件数だけに依存し、
 * 問題・知識・転記の全データは各画面のチャンクとデータ種別チャンク
 * （vite.config.ts の manualChunks）側に分離される。PWA の precache は
 * シェル（HTML/CSS/画面・基盤チャンク）に限り、データチャンクは初回利用時に
 * runtime caching（CacheFirst）で保存される（監査E-06/E-07是正、AD-3）。
 * そのためオフラインでも、一度開いた画面は従来どおり開ける。
 */
const Home = lazy(() => import("./screens/Home"));
const Practice = lazy(() => import("./screens/Practice"));
const Reader = lazy(() => import("./screens/Reader"));
const Cards = lazy(() => import("./screens/Cards"));
const Exam = lazy(() => import("./screens/Exam"));
const Stats = lazy(() => import("./screens/Stats"));
const SearchPage = lazy(() => import("./screens/SearchPage"));
const QaPage = lazy(() => import("./screens/QaPage"));
const Settings = lazy(() => import("./screens/Settings"));
const Memorize = lazy(() => import("./screens/Memorize"));
const Revision = lazy(() => import("./screens/Revision"));

function useAppStore(){ const [store,setStore]=useState<StoreData>(()=>loadStore()); const [saveFailed,setSaveFailed]=useState(false); const update=(fn:(d:StoreData)=>StoreData)=>{ setStore(prev=>{ const n=fn(structuredClone(prev)); setSaveFailed(!saveStore(n)); return n; }); }; return {store,update,saveFailed}; }

/** 監査C-12是正: 描画例外で白画面のまま復旧不能にならないよう、リセット導線付きの受け皿を置く。 */
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }>{
 state = { failed: false };
 static getDerivedStateFromError(){ return { failed: true }; }
 render(){
  if (this.state.failed) return <main><div className="card"><h1>表示できませんでした</h1><p>保存データの形式が想定と異なる可能性があります。学習記録を消去して初期状態で起動できます（記録は失われます）。</p><p><button onClick={()=>{ resetStoreData(); location.reload(); }}>データをリセットして再起動</button></p></div></main>;
  return this.props.children;
 }
}

function ScreenLoading(){
 return <main><p className="card">読み込み中…</p></main>;
}

// UX11（DECISIONS #48）: 画面遷移時にスクロールを最上部へ戻す。
// 電子書籍（/reader）は選択中のページへ自分でスクロールするため対象外にする
// （読書位置の復元を邪魔しない）。同一画面内の遷移（演習のフォーカス切替など、
// パスが変わらない場合）はスクロールを維持する。
function ScrollToTop(){
 const { pathname } = useLocation();
 useEffect(()=>{ if (pathname !== "/reader") window.scrollTo(0, 0); }, [pathname]);
 return null;
}

export default function App(){
 const {store,update,saveFailed}=useAppStore();
 // ダークテーマの変数は <html> に適用する（UX2、DECISIONS #36）。従来はラッパー div の
 // 中だけに効き、body の背景（画面の余白・はみ出し部分）がライトのまま残る不具合があった。
 useEffect(()=>{ document.documentElement.dataset.dark = String(store.reader.dark); }, [store.reader.dark]);
 return <div data-dark={store.reader.dark}>
 <header className="top"><nav className="main" aria-label="メインナビゲーション"><Link to="/">ホーム</Link><Link to="/practice">演習</Link><Link to="/practice" state={{ focus: "weak" }}>苦手</Link><Link to="/practice" state={{ focus: "wrong" }}>間違い</Link><Link to="/practice" state={{ focus: "favorites" }}>ブックマーク</Link><Link to="/memorize">暗記</Link><Link to="/cards">単語帳</Link><Link to="/exam">模擬試験</Link><Link to="/revision">改訂</Link><Link to="/reader">電子書籍</Link><Link to="/search">検索</Link><Link to="/settings">設定</Link></nav></header>
 {saveFailed && <p role="alert" className="card">学習記録の保存に失敗しました（ブラウザの保存容量が不足している可能性があります）。このまま続けると記録が残らない場合があります。</p>}
 <ScrollToTop/>
 <ErrorBoundary>
 <Suspense fallback={<ScreenLoading/>}>
 <Routes><Route path="/" element={<Home store={store} update={update}/>}/><Route path="/practice" element={<Practice store={store} update={update}/>}/><Route path="/reader" element={<Reader store={store} update={update}/>}/><Route path="/cards" element={<Cards store={store} update={update}/>}/><Route path="/exam" element={<Exam store={store} update={update}/>}/><Route path="/stats" element={<Stats store={store}/>}/><Route path="/search" element={<SearchPage store={store} update={update}/>}/><Route path="/qa" element={<QaPage store={store} update={update}/>}/><Route path="/settings" element={<Settings store={store} update={update}/>}/><Route path="/memorize" element={<Memorize store={store} update={update}/>}/><Route path="/revision" element={<Revision store={store} update={update}/>}/></Routes>
 </Suspense>
 </ErrorBoundary>
 <footer style={{padding:".6rem 1rem",paddingBottom:"calc(.6rem + env(safe-area-inset-bottom))",fontSize:".8rem"}} className="muted">学習履歴はこの端末のブラウザ内にのみ保存されます（同期・バックアップなし）。</footer></div>;
}
