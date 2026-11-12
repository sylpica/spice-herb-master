// 画面コンポーネント（バンドル分割バッチE1で src/App.tsx から分割。docs/DECISIONS.md #23）
// 2026-11-11（DECISIONS #55、全アプリ共通UIルール）: 説明文つきの縦積みカードをやめ、
// 主要機能を2列のタイルにまとめて一画面に収めた。各タイルは見出しと現在の数値だけを持ち、
// 説明・教材の収録状況・注記は画面の末尾に置く。
import { Link } from "react-router";
import { APP_DATA_SUMMARY } from "../data/summary";
import { ALL_SECTIONS } from "../data/structure";
const SECTION_TITLE = new Map(ALL_SECTIONS.map((s) => [s.id, s.title]));
import type { StoreData } from "../domain/store";
import { computeStats } from "../domain/stats";
import { isDue } from "../domain/srs";
import { dateKeyOfIso, todayKey } from "../domain/dates";
import { studyStreak } from "../domain/streak";

export default function Home({store}:{store:StoreData;update:any}){
 // 復習予定は演習で復習できる問題の件数（単語帳のカードは単語帳側で数える）。
 const due = Object.values(store.srs).filter(s=>!s.itemId.startsWith("card-") && isDue(s)).length;
 // ホームで使うのは total / accuracy のみで、どちらも records だけで決まる（domain/stats.ts）。
 // 章別等の内訳は問題データが必要だがホームでは表示しないため、空配列を渡して全データへの依存を断つ（E1）。
 const stats = computeStats(store.records, []);
 const today = todayKey(); const todayCount = store.records.filter(r=>dateKeyOfIso(r.answeredAt)===today).length;
 const wrong = new Map<string, boolean>(); for (const r of store.records) wrong.set(r.questionId, r.correct===false);
 const wrongCount = [...wrong.values()].filter(Boolean).length;
 const streak = studyStreak(store.records);
 const goal = Math.max(1, store.goalPerDay);
 const readingTitle = store.reader.sectionId ? (SECTION_TITLE.get(store.reader.sectionId) ?? "電子書籍") : "電子書籍";
 return <main><h1 className="home-title">スパイス＆ハーブ検定1級 学習アプリ</h1>
 <section className="tiles" aria-label="主要機能">
  <Link className="tile primary" to="/practice" state={{ focus: "all", count: 5, quickStart: true }}><strong>とりあえず5問</strong><span>すぐ始める</span></Link>
  <Link className="tile" to="/practice" state={{ focus: "due" }}><strong>今日の復習</strong><span>期限 {due}件</span></Link>
  <Link className="tile" to="/reader"><strong>前回の続き</strong><span>{readingTitle}</span></Link>
  <Link className="tile" to="/practice"><strong>演習</strong><span>{APP_DATA_SUMMARY.formalQuestions}問</span></Link>
  <Link className="tile" to="/practice" state={{ focus: "wrong" }}><strong>苦手克服</strong><span>誤答 {wrongCount}件</span></Link>
  <Link className="tile" to="/exam"><strong>模擬試験</strong><span>練習用</span></Link>
  <Link className="tile" to="/cards"><strong>単語帳</strong><span>{APP_DATA_SUMMARY.formalCards}枚</span></Link>
  <Link className="tile" to="/memorize"><strong>暗記</strong><span>全80種</span></Link>
  <Link className="tile" to="/revision"><strong>改訂ポイント</strong><span>4訂版</span></Link>
  <Link className="tile" to="/stats"><strong>学習進捗</strong><span>正答率 {stats.accuracy==null?"—":Math.round(stats.accuracy*100)+"%"}</span></Link>
 </section>
 <section className="goal" aria-label="今日の目標">
  <progress max={goal} value={Math.min(todayCount, goal)} aria-label="今日の目標の達成度"/>
  <span>今日 {todayCount}/{goal}問</span><span>連続 {streak}日</span><span>総解答 {stats.total}</span>
 </section>
 {/* 収録状況と注記は下に置く（UX11、全アプリ共通UIルール3） */}
 <details className="foot-note"><summary>教材の収録状況</summary>
  <p>原本画像 {APP_DATA_SUMMARY.presentImages}件（欠落 {APP_DATA_SUMMARY.missingImages}件: IMG_9647）／ 全文転記 {APP_DATA_SUMMARY.transcribedPages}ページ ／ 知識単位 {APP_DATA_SUMMARY.importedKnowledgeUnits}件（原文照合済み {APP_DATA_SUMMARY.verifiedImportedKnowledgeUnits}件）／ 正式問題 {APP_DATA_SUMMARY.formalQuestions}問 ／ 正式カード {APP_DATA_SUMMARY.formalCards}件</p>
  <p className="muted">収録範囲は本文テキスト・表データと、各ページの原画（スキャンを圧縮した画像）です。写真のみのページ（p.32・p.34）は原画だけを収録しています。</p>
 </details>
 {/* 黄色い説明ブロックは画面の末尾に置く（ユーザー指示 2026-10-31、UX11） */}
 <p className="badge">正式問題は、原本画像と照合した知識単位から生成し、出典・正答の検証を通ったものだけを登録しています。</p>
 </main>;
}
