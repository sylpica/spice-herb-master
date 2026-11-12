// 4訂版の改訂ポイント画面（docs/DECISIONS.md #42）。
// 出典は山崎香辛料振興財団の公式資料（2026年3月）で、データは src/data/revision.ts。
// 教科書の転記ではないため、リーダーとは独立した画面にし、該当ページへは
// リーダーの節へ移動するボタンでつなぐ。上部バー（ヘッダー）には手を入れない。
import { useNavigate } from "react-router";
import { ALL_SECTIONS } from "../data/structure";
import type { StoreData } from "../domain/store";
import {
  REVISION_AREAS,
  REVISION_BROAD,
  REVISION_ENTRIES,
  REVISION_EXAM_NOTE,
  REVISION_EXAM_SCOPE,
  REVISION_LEVEL1_ADDED,
  REVISION_LEVEL1_REMOVED,
  REVISION_RENAMED,
  REVISION_SOURCE,
  REVISION_STAR_NOTE,
} from "../data/revision";

/** 本のページ番号から、そのページを含む節を引く（節は本の順序でページを覆う） */
export function sectionIdForBookPage(page: number): string {
  let best = ALL_SECTIONS[0]!;
  for (const s of ALL_SECTIONS) {
    if (s.bookPage <= page && s.bookPage >= best.bookPage) best = s;
  }
  return best.id;
}

export default function Revision({ update }: { store: StoreData; update: any }) {
  const navigate = useNavigate();
  const jump = (page: number) => {
    const sid = sectionIdForBookPage(page);
    update((d: StoreData) => {
      d.reader.sectionId = sid;
      return d;
    });
    // FIX（DECISIONS #51）: 節の先頭ではなく、指定ページそのものへ着地させる
    navigate("/reader", { state: { targetPage: page } });
  };
  const pageButton = (page: number) => (
    <button type="button" onClick={() => jump(page)}>
      4訂版 p.{page} を読む
    </button>
  );
  return (
    <main>
      <h1>改訂ポイント（4訂版）</h1>

      <section className="card">
        <h2>1級対象スパイスの変更・見出し名称変更</h2>
        <h3>新規対象品目（新規掲載）</h3>
        <ul>
          {REVISION_LEVEL1_ADDED.map((x) => (
            <li key={x.name}>
              <strong>{x.name}</strong>（{x.note}） {pageButton(x.bookPage)}
            </li>
          ))}
        </ul>
        <h3>掲載削除</h3>
        <ul>
          {REVISION_LEVEL1_REMOVED.map((x) => (
            <li key={x.name}>
              <strong>{x.name}</strong>: {x.note}
              {x.bookPage != null ? <> {pageButton(x.bookPage)}</> : null}
            </li>
          ))}
        </ul>
        <h3>見出し名称変更</h3>
        <ul>
          {REVISION_RENAMED.map((x) => (
            <li key={x.to}>
              旧版「{x.from}」→ 新版「<strong>{x.to}</strong>」 {pageButton(x.bookPage)}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>主な変更箇所（旧版 → 4訂版）</h2>
        {REVISION_AREAS.map((area) => (
          <details key={area} className="fold">
            <summary>{area}（{REVISION_ENTRIES.filter((e) => e.area === area).length}件）</summary>
            <ul>
              {REVISION_ENTRIES.filter((e) => e.area === area).map((e) => (
                <li key={e.id}>
                  <strong>{e.item}</strong>: {e.change}
                  {e.bookPage != null ? <> {pageButton(e.bookPage)}</> : null}
                </li>
              ))}
            </ul>
          </details>
        ))}
      </section>

      <section className="card">
        <details className="fold">
        <summary>全面見直し・全面改訂（{REVISION_BROAD.length}件）</summary>
        <ul>
          {REVISION_BROAD.map((b) => (
            <li key={b.item}>
              <strong>{b.item}</strong>: {b.change} {pageButton(b.bookPage)}
            </li>
          ))}
        </ul>
        </details>
      </section>
      <section className="card">
        <h2>試験への対応</h2>
        <ul>
          {REVISION_EXAM_SCOPE.map((r) => (
            <li key={r.round}>
              <strong>{r.round}</strong>: {r.scope}
            </li>
          ))}
        </ul>
        <p className="muted">{REVISION_EXAM_NOTE}</p>
      </section>


      <section className="card">
        <h2>出典と注記</h2>
        <p className="muted">{REVISION_STAR_NOTE}</p>
        <p>
          出典: {REVISION_SOURCE.publisher}「{REVISION_SOURCE.title}」（{REVISION_SOURCE.date}）
          <br />
          <a className="btn ghost" href={REVISION_SOURCE.url} target="_blank" rel="noreferrer">
            資料PDF（公式サイト）
          </a>
        </p>
      </section>

      {/* 黄色い説明ブロックは下に置く（ユーザー指示 2026-10-31、UX11） */}
      <p className="badge">
        このアプリの教材である公式テキスト「4訂版」で、旧版（2020年発行「最新版」）から変わった点を、
        {REVISION_SOURCE.publisher}の公式資料（{REVISION_SOURCE.date}）から抜粋してまとめました。
        「全面見直し・全面改訂」の項目は、資料に個々の修正内容の記載がないため、4訂版の該当ページをそのまま確認してください。
      </p>
    </main>
  );
}
