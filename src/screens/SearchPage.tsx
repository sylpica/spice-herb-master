// 画面コンポーネント（バンドル分割バッチE1で src/App.tsx から分割。docs/DECISIONS.md #23）
// 複合フィルタはフェーズ7・バッチS1で実装（docs/DECISIONS.md #31）、バッチS2で
// 章・形式の複数選択（OR）と節・状態・転記状態の条件を追加（docs/DECISIONS.md #33）。
// 絞り込みの純粋ロジックは src/domain/search.ts に置き、単体テストで固定する。
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ALL_SECTIONS, CHAPTERS } from "../data/structure";
import type { StoreData } from "../domain/store";
import { QUESTIONS } from "../data/questions";
import { FORMAT_LABELS, type QuestionFormat, type QuestionStatus } from "../domain/types";
import {
  DEFAULT_SEARCH_FILTERS,
  SEARCH_DIFFICULTIES,
  availableSearchFormats,
  availableSearchStatuses,
  availableTranscriptionStatuses,
  filterSearchResults,
  hasActiveSearchFilters,
  keywordExcerpt,
  buildLearningIndex,
  matchesLearningState,
  sortSearchQuestions,
  LEARNING_STATE_LABELS,
  SEARCH_SORT_LABELS,
  type LearningState,
  type SearchSort,
  type SearchFilters,
  type SearchTarget,
} from "../domain/search";
import { TRANSCRIPT_SECTION_TEXT } from "../data/transcripts";

const SECTION_BY_ID = new Map(ALL_SECTIONS.map((s) => [s.id, s]));
// 節には転記本文を付与する（キーワードはタイトルだけでなく本文にも一致する、監査C-15）。
const SEARCHABLE_SECTIONS = ALL_SECTIONS.map((s) => ({
  ...s,
  bodyText: TRANSCRIPT_SECTION_TEXT.get(s.id) ?? "",
}));
// 問題には所属する節の転記状態を付与する（転記状態フィルタの判定用、#33）。
// 節 ID は全問題で実在することを単体テストで固定している。
const ALL_QUESTIONS = [...QUESTIONS].map((q) => ({
  ...q,
  sectionTranscriptionStatus: SECTION_BY_ID.get(q.sectionId)?.transcriptionStatus,
}));
// 形式の選択肢は正式問題に実在する15形式（docs/DECISIONS.md #31）。
// サンプル問題は 2026-10-31 に全て削除したため、検索対象は正式問題のみ（#52）。
const FORMAT_OPTIONS = availableSearchFormats(QUESTIONS);
// 状態の選択肢は検索プールに実在する状態のみ（#33）。
const STATUS_OPTIONS = availableSearchStatuses(ALL_QUESTIONS);
const STATUS_LABELS: Record<QuestionStatus, string> = {
  verified: "正式",
  unverified: "未検証",
  excluded: "除外",
};
// 転記状態の選択肢は節データに実在する状態のみ（転記済み・未処理、#33）。
const TRANSCRIPTION_OPTIONS = availableTranscriptionStatuses(ALL_SECTIONS);

/** 一度に表示する問題の件数（全件を一度に描画しない。全アプリ共通UIルール1、DECISIONS #55） */
const PAGE_SIZE = 20;
const SECTION_PAGE_SIZE = 5;

export default function SearchPage({ store, update }: { store?: StoreData; update?: (fn: (d: StoreData) => StoreData) => void }) {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<SearchFilters>(DEFAULT_SEARCH_FILTERS);
  // 学習状況の条件と並べ替え（R28）。端末の学習履歴から決まる問題固有の条件。
  const [learning, setLearning] = useState<LearningState>("all");
  const [sort, setSort] = useState<SearchSort>("default");
  const [shown, setShown] = useState(PAGE_SIZE);
  const [secShown, setSecShown] = useState(SECTION_PAGE_SIZE);
  const index = useMemo(() => buildLearningIndex(store?.records ?? [], store?.favorites ?? []), [store?.records, store?.favorites]);
  const base = filterSearchResults(SEARCHABLE_SECTIONS, ALL_QUESTIONS, filters);
  const secs = learning === "all" ? base.sections : [];
  const qs = sortSearchQuestions(
    learning === "all" ? base.questions : base.questions.filter((x) => matchesLearningState(learning, x.id, index)),
    sort,
    index,
  );
  const total = secs.length + qs.length;
  // 条件が変わったら表示件数を先頭ページへ戻す。
  useEffect(() => { setShown(PAGE_SIZE); setSecShown(SECTION_PAGE_SIZE); }, [filters, learning, sort]);
  const set = (patch: Partial<SearchFilters>) => setFilters((f) => ({ ...f, ...patch }));

  // 章の複数選択: 値を足すと次元内 OR で広がり、外すとその分だけ戻る。
  // 選択中の節が新しい章集合の外に出た場合は、節の指定もあわせて解除する
  // （節の選択肢は選択中の章の節だけに限るため）。
  const toggleChapter = (chapterId: string, checked: boolean) => {
    const chapterIds = checked
      ? [...filters.chapterIds, chapterId]
      : filters.chapterIds.filter((c) => c !== chapterId);
    const section = filters.sectionId ? SECTION_BY_ID.get(filters.sectionId) : undefined;
    const sectionId =
      section && chapterIds.length > 0 && !chapterIds.includes(section.chapterId)
        ? null
        : filters.sectionId;
    set({ chapterIds, sectionId });
  };
  const toggleFormat = (format: QuestionFormat, checked: boolean) => {
    set({
      formats: checked
        ? [...filters.formats, format]
        : filters.formats.filter((f) => f !== format),
    });
  };

  // 節の選択肢は、章が選択されている場合はその章の節だけに限る。
  const sectionChapters =
    filters.chapterIds.length > 0
      ? CHAPTERS.filter((c) => filters.chapterIds.includes(c.id))
      : CHAPTERS;
  const sectionLabel = filters.sectionId
    ? SECTION_BY_ID.get(filters.sectionId)?.title
    : undefined;

  // 有効な条件の個別解除チップ（押すとその条件だけが解除される）。
  // 複数選択の次元は値ごとに1チップとし、その値だけを外す。
  // アクセシブル名は可視テキスト（「形式: 一問一答 ×」等）そのままにする:
  // aria-label に「キーワードを解除」等と付けると、入力欄のラベル
  // 「キーワード」と部分一致で曖昧になるため付けない（E2E S1 で実測）。
  const chips: Array<{ key: string; label: string; clear: () => void }> = [];
  if (filters.keyword)
    chips.push({
      key: "keyword",
      label: `キーワード: ${filters.keyword}`,
      clear: () => set({ keyword: "" }),
    });
  if (filters.target !== "all")
    chips.push({
      key: "target",
      label: `対象: ${filters.target === "sections" ? "教材（節）のみ" : "問題のみ"}`,
      clear: () => set({ target: "all" }),
    });
  for (const chapterId of filters.chapterIds)
    chips.push({
      key: `chapter-${chapterId}`,
      label: `章: ${CHAPTERS.find((c) => c.id === chapterId)?.label ?? chapterId}`,
      clear: () => toggleChapter(chapterId, false),
    });
  for (const format of filters.formats)
    chips.push({
      key: `format-${format}`,
      label: `形式: ${FORMAT_LABELS[format]}`,
      clear: () => toggleFormat(format, false),
    });
  if (filters.difficulty !== null)
    chips.push({
      key: "difficulty",
      label: `難易度: ${filters.difficulty}`,
      clear: () => set({ difficulty: null }),
    });
  if (filters.sectionId)
    chips.push({
      key: "section",
      label: `節: ${sectionLabel ?? filters.sectionId}`,
      clear: () => set({ sectionId: null }),
    });
  if (filters.status)
    chips.push({
      key: "status",
      label: `状態: ${STATUS_LABELS[filters.status]}`,
      clear: () => set({ status: null }),
    });
  if (filters.transcriptionStatus)
    chips.push({
      key: "transcription",
      label: `転記状態: ${filters.transcriptionStatus}`,
      clear: () => set({ transcriptionStatus: null }),
    });

  return (
    <main>
      <h1>横断検索</h1>
      <input
        aria-label="キーワード"
        placeholder="キーワード（教材の本文・問題文）"
        value={filters.keyword}
        onChange={(e) => set({ keyword: e.target.value })}
      />
      <section className="card">
        <h2>教材（節） {secs.length}件</h2>
        {secs.length === 0 ? (
          <p className="muted">該当する教材（節）はありません。</p>
        ) : (
          <ul className="rows">
            {secs.slice(0, secShown).map((s) => {
              // タイトルに一致せず本文にだけ一致した節は、一致箇所の抜粋を示す（監査C-15）
              const excerpt =
                filters.keyword && !s.title.includes(filters.keyword)
                  ? keywordExcerpt(s.bodyText ?? "", filters.keyword)
                  : null;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    className="row"
                    aria-label={`${s.title} リーダーで開く`}
                    onClick={() => {
                      update?.((d: StoreData) => { d.reader.sectionId = s.id; return d; });
                      navigate("/reader");
                    }}
                  >
                    <span>
                      {s.title}
                      {excerpt && (
                        <>
                          <br />
                          <span className="muted">{excerpt}</span>
                        </>
                      )}
                    </span>
                    <small>p.{s.bookPage}</small>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {secs.length > secShown && (
          <p className="actions">
            <button type="button" className="ghost" onClick={() => setSecShown(secs.length)}>
              節をさらに表示（残り {secs.length - secShown}件）
            </button>
          </p>
        )}
      </section>
      <section className="card">
        <h2>問題 {qs.length}件</h2>
        {qs.length === 0 ? (
          <p className="muted">該当する問題はありません。</p>
        ) : (
          <>
            <ul className="rows">
              {qs.slice(0, shown).map((x) => (
                <li key={x.id}>
                  <Link className="row" to="/practice" state={{ questionId: x.id }} aria-label={`${x.prompt} 演習で開く`}>
                    <span>{x.prompt}</span>
                    <small>{FORMAT_LABELS[x.format]}</small>
                  </Link>
                </li>
              ))}
            </ul>
            {qs.length > shown && (
              <p className="actions">
                <button type="button" className="ghost" onClick={() => setShown(shown + PAGE_SIZE * 2)}>
                  さらに表示（残り {qs.length - shown}件）
                </button>
              </p>
            )}
          </>
        )}
      </section>
      <section className="card" aria-label="検索条件">
        <h2>絞り込み条件</h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))",
            gap: ".8rem",
          }}
        >
          <label>
            検索対象
            <select
              aria-label="検索対象"
              value={filters.target}
              onChange={(e) => set({ target: e.target.value as SearchTarget })}
            >
              <option value="all">すべて</option>
              <option value="sections">教材（節）のみ</option>
              <option value="questions">問題のみ</option>
            </select>
          </label>
          <label>
            節
            <select
              aria-label="節"
              value={filters.sectionId ?? ""}
              onChange={(e) => set({ sectionId: e.target.value || null })}
            >
              <option value="">すべて</option>
              {sectionChapters.map((c) => (
                <optgroup key={c.id} label={c.label}>
                  {c.sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}（p.{s.bookPage}）
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label>
            難易度
            <select
              aria-label="難易度"
              value={filters.difficulty === null ? "" : String(filters.difficulty)}
              onChange={(e) =>
                set({
                  difficulty: e.target.value
                    ? (Number(e.target.value) as SearchFilters["difficulty"])
                    : null,
                })
              }
            >
              <option value="">すべて</option>
              {SEARCH_DIFFICULTIES.map((d) => (
                <option key={d} value={d}>
                  難易度{d}
                </option>
              ))}
            </select>
          </label>
          <label>
            問題の状態
            <select
              aria-label="問題の状態"
              value={filters.status ?? ""}
              onChange={(e) =>
                set({ status: (e.target.value || null) as QuestionStatus | null })
              }
            >
              <option value="">すべて</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label>
            学習状況
            <select aria-label="学習状況" value={learning} onChange={(e) => setLearning(e.target.value as LearningState)}>
              {(Object.keys(LEARNING_STATE_LABELS) as LearningState[]).map((k) => (
                <option key={k} value={k}>{LEARNING_STATE_LABELS[k]}</option>
              ))}
            </select>
          </label>
          <label>
            並び順
            <select aria-label="並び順" value={sort} onChange={(e) => setSort(e.target.value as SearchSort)}>
              {(Object.keys(SEARCH_SORT_LABELS) as SearchSort[]).map((k) => (
                <option key={k} value={k}>{SEARCH_SORT_LABELS[k]}</option>
              ))}
            </select>
          </label>
          <label>
            転記状態
            <select
              aria-label="転記状態"
              value={filters.transcriptionStatus ?? ""}
              onChange={(e) => set({ transcriptionStatus: e.target.value || null })}
            >
              <option value="">すべて</option>
              {TRANSCRIPTION_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div style={{ marginTop: ".8rem" }}>
          <span>章（複数選択可）</span>
          <div className="chips">
            {CHAPTERS.map((c) => (
              <label key={c.id} className="chip">
                <input
                  type="checkbox"
                  checked={filters.chapterIds.includes(c.id)}
                  onChange={(e) => toggleChapter(c.id, e.target.checked)}
                />{" "}
                {c.label}
              </label>
            ))}
          </div>
        </div>
        <div style={{ marginTop: ".8rem" }}>
          <span>問題形式（複数選択可）</span>
          <div className="chips">
            {FORMAT_OPTIONS.map((f) => (
              <label key={f} className="chip">
                <input
                  type="checkbox"
                  checked={filters.formats.includes(f)}
                  onChange={(e) => toggleFormat(f, e.target.checked)}
                />{" "}
                {FORMAT_LABELS[f]}
              </label>
            ))}
          </div>
        </div>
        {(hasActiveSearchFilters(filters) || learning !== "all" || sort !== "default") && (
          <p>
            {chips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                className="ghost"
                onClick={chip.clear}
                style={{ marginRight: ".5rem", marginBottom: ".5rem" }}
              >
                {chip.label} ×
              </button>
            ))}
            <button type="button" onClick={() => { setFilters(DEFAULT_SEARCH_FILTERS); setLearning("all"); setSort("default"); }}>
              すべての条件を解除
            </button>
          </p>
        )}
        <p aria-live="polite">
          検索結果 合計 {total}件（教材（節） {secs.length}件・問題 {qs.length}件）
        </p>
        <p className="foot-note">
          条件はキーワードと組み合わされます。章・問題形式は複数選択でき、同じ条件の中ではいずれかに一致すれば対象になります（OR）。異なる条件の間は
          AND です。問題形式・難易度・問題の状態・学習状況は問題固有の条件のため、指定した場合は教材（節）は対象外になります。転記状態は、問題については所属する節の転記状態で判定します。
        </p>
      </section>
    </main>
  );
}
