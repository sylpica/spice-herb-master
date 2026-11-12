// 暗記モード（UX5、docs/DECISIONS.md #40）。
// スパイス＆ハーブ全種類（正式カードの profile 種別 = 検定対象の全80種）の
// プロフィールを「ひたすら」回す画面。名前を見てプロフィール（科名・原産地・
// 利用部位・別名・対象級）を思い出し、タップで答え合わせをして自己評価する。
// 自己評価は単語帳と共通の SRS（store.srs、キーはカードID）に反映する。
// 一周したら、自己評価で「分かった」以外が付いたものを先に並べ替えて
// 次の周を自動で始める（終わりのないドリル）。
// UX10（DECISIONS #46）: 答え合わせをしなくても次へ進める「次へ」ボタンを
// カードの真下に置き、説明から名前を当てる逆モード（プロフィール → 名前）を
// 追加した。逆モードの自己評価も同じカードの SRS に反映する（同じ知識項目）。
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { CARDS } from "../data/questions";
import type { StoreData } from "../domain/store";
import { applyCardReview, type CardSelfEval } from "../domain/srs";
import { seededShuffle } from "../domain/shuffle";

const EVAL_OPTIONS: { key: CardSelfEval; label: string }[] = [
 { key: "known", label: "覚えた" },
 { key: "unsure", label: "あいまい" },
 { key: "unknown", label: "まだ" },
];

type Direction = "name-first" | "desc-first";

function profileName(front: string): string {
 return front.replace(/のプロフィールは？$/, "");
}

/** 裏面テキスト（「名称: 説明文」）から名称部分を取り除いた説明文を返す（逆モードの表面用）。 */
function profileDescription(back: string, name: string): string {
 const prefix = `${name}: `;
 if (back.startsWith(prefix)) return back.slice(prefix.length);
 return back.replace(name, "＿＿");
}

export default function Memorize({ store, update }: { store: StoreData; update: any }) {
 const deck = useMemo(() => CARDS.filter((c) => c.kind === "profile"), []);
 const [order, setOrder] = useState<string[]>(() => seededShuffle(deck.map((c) => c.id), String(Date.now())));
 const [pos, setPos] = useState(0);
 const [flip, setFlip] = useState(false);
 const [round, setRound] = useState(1);
 const [roundKnown, setRoundKnown] = useState(0);
 const [direction, setDirection] = useState<Direction>("name-first");
 // このセッションで最後に付けた自己評価（次周の並べ替えに使う）
 const [lastEval, setLastEval] = useState<Record<string, CardSelfEval>>({});

 const card = deck.find((c) => c.id === order[pos]);
 const evaluatedKinds = deck.filter((c) => store.srs[c.id]).length;

 const startNextRound = (evals: Record<string, CardSelfEval>) => {
  const rest = deck.filter((c) => evals[c.id] && evals[c.id] !== "known").map((c) => c.id);
  const known = deck.filter((c) => !evals[c.id] || evals[c.id] === "known").map((c) => c.id);
  const nextSeed = String(Date.now());
  setOrder([...seededShuffle(rest, nextSeed), ...seededShuffle(known, nextSeed + "k")]);
  setPos(0);
  setFlip(false);
  setRound((r) => r + 1);
  setRoundKnown(0);
 };

 const advance = (evals: Record<string, CardSelfEval>) => {
  setFlip(false);
  if (pos + 1 >= order.length) startNextRound(evals);
  else setPos(pos + 1);
 };

 const evaluate = (ev: CardSelfEval) => {
  if (!card) return;
  update((d: StoreData) => { d.srs[card.id] = applyCardReview(d.srs[card.id], card.id, ev); return d; });
  const evals = { ...lastEval, [card.id]: ev };
  setLastEval(evals);
  if (ev === "known") setRoundKnown((n) => n + 1);
  advance(evals);
 };

 // 答え合わせも自己評価もせずに次へ進む（記録はしない。次の周では後半に回る）
 const skip = () => advance(lastEval);

 const restart = () => {
  setOrder(seededShuffle(deck.map((c) => c.id), String(Date.now())));
  setPos(0);
  setFlip(false);
  setRound(1);
  setRoundKnown(0);
  setLastEval({});
 };

 if (!card) return <main><h1>暗記モード</h1><p>対象のカードがありません。</p></main>;
 const page = card.sourceRefs[0]?.bookPage;
 const name = profileName(card.front);
 const reverse = direction === "desc-first";

 return <main>
  <h1>暗記モード（全{deck.length}種）</h1>
  <p className="muted" style={{ margin: "0 0 .3rem" }}>{round}周目 ・ {pos + 1} / {order.length}種 ・ 覚えた {roundKnown}種</p>
  <section className="card">
   {reverse ? <>
    <p className="muted">説明から名前を当てる{page ? `（本書 p.${page}）` : ""}</p>
    <p style={{ fontSize: "1.15rem", whiteSpace: "pre-wrap" }}>{profileDescription(card.back, name)}</p>
    {flip
     ? <>
       <h2 style={{ fontSize: "2rem", margin: ".4rem 0" }}>{name}</h2>
       <p style={{ whiteSpace: "pre-wrap" }}>{card.back}</p>
      </>
     : <p className="actions"><button type="button" onClick={() => setFlip(true)}>名前を表示（答え合わせ）</button></p>}
   </> : <>
    <p className="muted">スパイス＆ハーブの種類{page ? `（本書 p.${page}）` : ""}</p>
    <h2 style={{ fontSize: "2rem", margin: ".4rem 0" }}>{name}</h2>
    {flip
     ? <p style={{ whiteSpace: "pre-wrap" }}>{card.back}</p>
     : <p className="actions"><button type="button" onClick={() => setFlip(true)}>プロフィールを表示（答え合わせ）</button></p>}
   </>}
   {flip && <p className="actions" role="group" aria-label="自己評価">{EVAL_OPTIONS.map((o) => <button key={o.key} type="button" onClick={() => evaluate(o.key)}>{o.label}</button>)}</p>}
  </section>
  <p className="actions"><button type="button" className="ghost" disabled={pos === 0} onClick={() => { setFlip(false); setPos(pos - 1); }}>前へ</button><button type="button" className="ghost" onClick={skip}>次へ</button></p>
  {/* 出題の向き（逆モード）の切替は下に置く（ユーザー指示 2026-10-31） */}
  <p className="actions" role="group" aria-label="出題の向き">
   <button type="button" className={reverse ? "ghost" : ""} aria-pressed={!reverse} onClick={() => { setDirection("name-first"); setFlip(false); }}>名前 → プロフィール</button>
   <button type="button" className={reverse ? "" : "ghost"} aria-pressed={reverse} onClick={() => { setDirection("desc-first"); setFlip(false); }}>プロフィール → 名前（逆）</button>
  </p>
  <p className="actions"><button type="button" className="ghost" onClick={restart}>最初から回し直す</button><Link className="btn ghost" to="/cards">単語帳で復習する</Link></p>
  <p className="foot-note">思い出してから答え合わせをし、自己評価を付けます。自己評価は単語帳と共通の復習記録（SRS）に反映されます。一周すると、「覚えた」以外を先頭にして次の周が始まります。評価済み（累計）: {evaluatedKinds} / {deck.length}種</p>
 </main>;
}
