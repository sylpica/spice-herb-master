// 画面コンポーネント（バンドル分割バッチE1で src/App.tsx から分割。docs/DECISIONS.md #23）
// 修正バッチFIX1（DECISIONS #34）: 既定モードを正式問題（verified）に変更し、出題順
// セレクト（シャッフル=既定／登録順）を追加した。
// 監査修正バッチ2（C-01／C-02／D-04）: 絞り込み（章・節・難易度・形式）と学習フォーカス
// （未回答・誤答・苦手・ブックマーク・復習期限・記述式）を domain/practice.ts の純粋関数で
// 演習プールに反映し、セッションは「問題数」で区切って終了時に結果を表示する。
// セッション中のプールは開始時点のスナップショットで固定し、回答のたびに
// 対象が入れ替わらないようにする（組み直しは条件変更・再開ボタンのときだけ）。
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { QUESTIONS } from "../data/questions";
import { CHAPTERS, ALL_SECTIONS } from "../data/structure";
import QuestionRunner, { type SavedAnswer } from "../components/QuestionRunner";
import { FORMAT_LABELS, type Question, type QuestionFormat } from "../domain/types";
import type { StoreData } from "../domain/store";
import { initSrs, reviewSrs, qualityFromResult } from "../domain/srs";
import { selectForPractice } from "../domain/validate";
import { seededShuffle } from "../domain/shuffle";
import { availableSearchFormats } from "../domain/search";
import {
  buildPracticePool,
  DEFAULT_PRACTICE_FILTERS,
  FOCUS_LABELS,
  PRACTICE_DIFFICULTIES,
  type PracticeFilters,
  type PracticeFocus,
} from "../domain/practice";
import type { GradeResult } from "../domain/grading";

const FORMAT_OPTIONS = availableSearchFormats(QUESTIONS);
const SECTION_BY_ID = new Map(ALL_SECTIONS.map((s) => [s.id, s]));
/** 正解時の自動進行までの待ち時間（正誤と正答を読む時間を残す） */
const AUTO_ADVANCE_MS = 1500;

interface PracticePreset {
  focus?: PracticeFocus;
  sectionId?: string;
  chapterId?: string;
  questionId?: string;
  count?: number;
  /** 「とりあえず5問」からの開始。設定UI（モード・出題順・問題数・絞り込み）を出さず、問題をすぐ表示する（UX9） */
  quickStart?: boolean;
}

function buildSession(pool: Question[], orderMode: string, seed: string, count: number, firstId?: string): Question[] {
  let ordered = orderMode === "shuffle" ? seededShuffle(pool, `practice|${seed}`) : [...pool];
  if (firstId) {
    const i = ordered.findIndex((q) => q.id === firstId);
    if (i > 0) ordered = [ordered[i]!, ...ordered.slice(0, i), ...ordered.slice(i + 1)];
  }
  return ordered.slice(0, Math.max(1, count));
}

export default function Practice({ store, update }: { store: StoreData; update: any }) {
  const location = useLocation();
  const navigate = useNavigate();
  const preset = (location.state ?? {}) as PracticePreset;
  const presetQuestion = preset.questionId
    ? QUESTIONS.find((q) => q.id === preset.questionId)
    : undefined;
  const [mode, setMode] = useState("verified");
  const [filters, setFilters] = useState<PracticeFilters>({
    ...DEFAULT_PRACTICE_FILTERS,
    focus: preset.focus ?? "all",
    sectionId: preset.sectionId ?? presetQuestion?.sectionId ?? null,
    chapterIds: preset.chapterId ? [preset.chapterId] : [],
  });
  const [orderMode, setOrderMode] = useState("shuffle");
  const [count, setCount] = useState(preset.count ?? 10);
  const [quickStart, setQuickStart] = useState(preset.quickStart ?? false);
  const [idx, setIdx] = useState(0);
  const [results, setResults] = useState<{ questionId: string; correct: boolean | null }[]>([]);
  // 監査AU-02（DECISIONS #54）: セッション内で確定した回答（「前の問題へ」で戻ったときに復元する）。
  // 復元した問題は確定済みのまま表示し、再確定による記録・SRSの二重計上を起こさない。
  const [answered, setAnswered] = useState<Record<string, SavedAnswer>>({});
  // 正解時の自動進行（設定でオンにした場合のみ。R27/R46）。手動で移動したら取り消す。
  const autoTimer = useRef<number | null>(null);
  const cancelAuto = () => { if (autoTimer.current !== null) { window.clearTimeout(autoTimer.current); autoTimer.current = null; } };
  useEffect(() => cancelAuto, []);
  const [done, setDone] = useState(false);

  const basePool = (m: string): Question[] => selectForPractice(QUESTIONS);
  const ctx = { records: store.records, srs: store.srs, favorites: store.favorites };
  const poolCount = useMemo(
    () => buildPracticePool(basePool(mode), filters, ctx).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, filters, store.records, store.srs, store.favorites],
  );
  const [sessionQs, setSessionQs] = useState<Question[]>(() =>
    buildSession(buildPracticePool(basePool(mode), filters, ctx), "shuffle", String(Date.now()), preset.count ?? 10, preset.questionId),
  );

  const restart = (next: { mode?: string; filters?: PracticeFilters; orderMode?: string; count?: number }) => {
    const m = next.mode ?? mode;
    const f = next.filters ?? filters;
    const o = next.orderMode ?? orderMode;
    const c = next.count ?? count;
    setSessionQs(buildSession(buildPracticePool(basePool(m), f, ctx), o, String(Date.now()), c));
    cancelAuto();
    setIdx(0);
    setResults([]);
    setAnswered({});
    setDone(false);
  };
  const applyFilters = (f: PracticeFilters) => { setFilters(f); restart({ filters: f }); };

  // ユーザー要望対応（DECISIONS #35）: 演習画面を開いたまま上部メニューの
  // 苦手・間違い・ブックマーク等を押してもプリセットが効くよう、マウント後に
  // location.state が変わったら条件とセッションを組み直す。マウント時の適用は
  // useState の初期化側で行うため、初期キーと一致する間は何もしない。
  // questionId（1問だけの深いリンク）はマウント時のみ扱う。
  const presetKey = [preset.focus ?? "", preset.count ?? "", preset.sectionId ?? "", preset.chapterId ?? "", preset.quickStart ? "q" : ""].join("|");
  const appliedPresetKey = useRef(presetKey);
  useEffect(() => {
    if (appliedPresetKey.current === presetKey) return;
    appliedPresetKey.current = presetKey;
    const f: PracticeFilters = {
      ...DEFAULT_PRACTICE_FILTERS,
      focus: preset.focus ?? "all",
      sectionId: preset.sectionId ?? null,
      chapterIds: preset.chapterId ? [preset.chapterId] : [],
    };
    setFilters(f);
    setQuickStart(preset.quickStart ?? false);
    if (preset.count) setCount(preset.count);
    restart({ filters: f, count: preset.count ?? count });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetKey]);

  const toggleChapter = (chapterId: string, checked: boolean) => {
    const chapterIds = checked ? [...filters.chapterIds, chapterId] : filters.chapterIds.filter((c) => c !== chapterId);
    const section = filters.sectionId ? SECTION_BY_ID.get(filters.sectionId) : undefined;
    const sectionId = section && chapterIds.length > 0 && !chapterIds.includes(section.chapterId) ? null : filters.sectionId;
    applyFilters({ ...filters, chapterIds, sectionId });
  };
  const sectionChapters = filters.chapterIds.length > 0 ? CHAPTERS.filter((c) => filters.chapterIds.includes(c.id)) : CHAPTERS;

  const q = sessionQs[idx];
  const isFav = q ? store.favorites.includes(q.id) : false;
  const answeredInSession = results.length;
  const correctInSession = results.filter((r) => r.correct === true).length;

  return (
    <main>
      <h1>演習</h1>
      {done ? (
        <section className="card" aria-label="セッション結果">
          <h2>セッション完了</h2>
          <p>
            {answeredInSession} 問に回答し、正解 {correctInSession} 問（正答率{" "}
            {answeredInSession ? Math.round((correctInSession / answeredInSession) * 100) : 0}%）でした。記録は学習分析に保存されています。
          </p>
          <p>
            <button onClick={() => restart({})}>同じ条件でもう一度</button>
            {!quickStart && (
              <>
                {" "}
                <button
                  className="ghost"
                  onClick={() => { setFilters(DEFAULT_PRACTICE_FILTERS); restart({ filters: DEFAULT_PRACTICE_FILTERS }); }}
                >
                  条件をリセット
                </button>
              </>
            )}
          </p>
        </section>
      ) : !q ? (
        <p className="card">
          現在の条件に合う問題がありません。条件を緩めるか、学習フォーカスを「すべて」に戻してください。「問題が存在しない」ことを学習済みと誤認しないでください。
        </p>
      ) : (
        <>
          <p className="muted">セッション {Math.min(idx + 1, sessionQs.length)} / {sessionQs.length} 問</p>
          <QuestionRunner
            key={q.id}
            q={q}
            saved={answered[q.id]}
            onGraded={(r: GradeResult, self, responseMs, answer) => {
              setAnswered((m) => ({ ...m, [q.id]: { answer, result: r, selfRatio: self } }));
              if (store.autoAdvance && r.correct === true) {
                cancelAuto();
                const at = idx;
                autoTimer.current = window.setTimeout(() => {
                  autoTimer.current = null;
                  if (at + 1 >= sessionQs.length) setDone(true); else setIdx(at + 1);
                }, AUTO_ADVANCE_MS);
              }
              update((d: StoreData) => {
                d.records.push({ questionId: q.id, answeredAt: new Date().toISOString(), correct: r.correct, scoreRatio: r.scoreRatio, autoScoreRatio: r.autoScoreRatio, selfScoreRatio: self, responseMs });
                const cur = d.srs[q.id] ?? initSrs(q.id);
                d.srs[q.id] = reviewSrs(cur, qualityFromResult(r.correct, r.scoreRatio));
                return d;
              });
              setResults((rs) => [...rs, { questionId: q.id, correct: r.correct }]);
            }}
            onSelfScore={(self) => {
              setAnswered((m) => (m[q.id] ? { ...m, [q.id]: { ...m[q.id]!, selfRatio: self } } : m));
              update((d: StoreData) => {
                const i = d.records.map((x, j) => (x.questionId === q.id ? j : -1)).filter((j) => j >= 0).pop();
                if (i !== undefined) { const rec = d.records[i]; if (rec) rec.selfScoreRatio = self; }
                return d;
              });
            }}
            onOpenSection={(sectionId) => {
              update((d: StoreData) => { d.reader.sectionId = sectionId; return d; });
              navigate("/reader");
            }}
          />
          <p>
            <button className="ghost" disabled={idx === 0} onClick={() => { cancelAuto(); setIdx(idx - 1); }}>
              前の問題へ
            </button>{" "}
            <button className="ghost" onClick={() => { cancelAuto(); if (idx + 1 >= sessionQs.length) setDone(true); else setIdx(idx + 1); }}>
              {idx + 1 >= sessionQs.length ? "セッションを終了する" : "次の問題へ"}
            </button>{" "}
            <button
              className="ghost"
              onClick={() =>
                update((d: StoreData) => ({
                  ...d,
                  favorites: isFav ? d.favorites.filter((x) => x !== q.id) : [...d.favorites, q.id],
                }))
              }
            >
              {isFav ? "ブックマークから外す" : "ブックマークに追加"}
            </button>
          </p>
        </>
      )}
      {/* UX13: 設定と絞り込みは問題の下に置く（ユーザー指示） */}
      {!quickStart && (
        <>
      <label>
        モード
        <select
          value={mode}
          onChange={(e) => { setMode(e.target.value); restart({ mode: e.target.value }); }}
        >
          <option value="verified">通常演習（検証済みのみ）</option>
        </select>
      </label>
      <label>
        出題順
        <select
          aria-label="出題順"
          value={orderMode}
          onChange={(e) => { setOrderMode(e.target.value); restart({ orderMode: e.target.value }); }}
        >
          <option value="shuffle">シャッフル</option>
          <option value="sequence">登録順</option>
        </select>
      </label>
      <label>
        問題数（セッションの長さ）
        <input
          type="number"
          min={1}
          value={count}
          onChange={(e) => setCount(Number(e.target.value) || 10)}
          onBlur={() => restart({})}
        />
      </label>
      <section className="card" aria-label="演習の絞り込み">
        <h2>絞り込みと学習フォーカス</h2>
        <label>
          学習フォーカス
          <select
            aria-label="学習フォーカス"
            value={filters.focus}
            onChange={(e) => applyFilters({ ...filters, focus: e.target.value as PracticeFocus })}
          >
            {(Object.keys(FOCUS_LABELS) as PracticeFocus[]).map((f) => (
              <option key={f} value={f}>{FOCUS_LABELS[f]}</option>
            ))}
          </select>
        </label>
        <label>
          節
          <select
            aria-label="節"
            value={filters.sectionId ?? ""}
            onChange={(e) => applyFilters({ ...filters, sectionId: e.target.value || null })}
          >
            <option value="">すべて</option>
            {sectionChapters.map((c) => (
              <optgroup key={c.id} label={c.label}>
                {c.sections.map((s) => (
                  <option key={s.id} value={s.id}>{s.title}（p.{s.bookPage}）</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <div style={{ marginTop: ".8rem" }}>
          <span>章（複数選択可）</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: ".3rem 1rem" }}>
            {CHAPTERS.map((c) => (
              <label key={c.id}>
                <input type="checkbox" checked={filters.chapterIds.includes(c.id)} onChange={(e) => toggleChapter(c.id, e.target.checked)} /> {c.label}
              </label>
            ))}
          </div>
        </div>
        <div style={{ marginTop: ".8rem" }}>
          <span>難易度（複数選択可）</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: ".3rem 1rem" }}>
            {PRACTICE_DIFFICULTIES.map((d) => (
              <label key={d}>
                <input
                  type="checkbox"
                  checked={filters.difficulties.includes(d)}
                  onChange={(e) =>
                    applyFilters({
                      ...filters,
                      difficulties: e.target.checked ? [...filters.difficulties, d] : filters.difficulties.filter((x) => x !== d),
                    })
                  }
                />{" "}
                難易度{d}
              </label>
            ))}
          </div>
        </div>
        <div style={{ marginTop: ".8rem" }}>
          <span>問題形式（複数選択可）</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: ".3rem 1rem" }}>
            {FORMAT_OPTIONS.map((f: QuestionFormat) => (
              <label key={f}>
                <input
                  type="checkbox"
                  checked={filters.formats.includes(f)}
                  onChange={(e) =>
                    applyFilters({
                      ...filters,
                      formats: e.target.checked ? [...filters.formats, f] : filters.formats.filter((x) => x !== f),
                    })
                  }
                />{" "}
                {FORMAT_LABELS[f]}
              </label>
            ))}
          </div>
        </div>
        <p className="muted">
          対象プール {poolCount} 問から、問題数ぶんを1セッションとして出題します。条件を変えるとセッションは組み直されます。
        </p>
      </section>
        </>
      )}
    </main>
  );
}
