#!/usr/bin/env node
/**
 * 正式問題の生成パイプライン（再実行可能・決定的）。
 *
 * 方針（docs/DECISIONS.md #7 / #13 / #15）:
 * - Claude生成の1,185問は直接使わない。原文照合済み（verified）の知識単位の draftQa から
 *   Muse側で機械的に再生成し、検証を通ったものだけを正式問題にする。
 * - 生成できるのは draftQa の直接変換で根拠が機械検証できる形式のみ:
 *   - one-answer（一問一答）: prompt = draftQa.q、acceptedAnswers = [a, ...alt]、解説 = 単位の content
 *   - single-choice（四択）: 正答 = draftQa.a、誤答 = 同一章（取り込み章）の verified 単位の
 *     draftQa.a からのみ機械選択（教科書外の選択肢は作らない）
 *   - フラッシュカード: front = draftQa.q、back = draftQa.a
 * - 拡充Q2（フェーズ6、docs/DECISIONS.md #18）: draftQa のない単位のうち、定型文で構造化属性
 *   （科名・原産地・利用部位・別名・検定対象級）を保持する spice-profile 単位（80件）からは、
 *   属性値を content から機械抽出して以下を生成する（正答が単位記載と一致することを検証）:
 *   - fill-blank（穴埋め）: 科名 / 検定対象級
 *   - single-choice（四択）: 利用部位 / 原産地（誤答は他の照合済みプロフィールの同属性値からのみ
 *     機械選択し、正規化後一致・部分文字列関係の候補を除外する曖昧さガードを適用）
 *   - term-input（用語入力）: 別名を1つ答える問題（許容回答は別名トークンの全文と括弧注記を
 *     除いた基部のみ）と、別名から名称を答える逆引き（別名基部が全プロフィール中で一意な場合のみ）
 *   - フラッシュカード: 表 = 名称のプロフィール提示、裏 = 単位 content そのもの
 *   散文要約の事実単位・unit単位（86件）は設問・正答を機械検証できないため生成しない（理由を記録）。
 * - 監査A1（フェーズ6、docs/DECISIONS.md #20）: 四択486問の誤答意味的監査で「真の問題」と
 *   判定された誤答は、scripts/distractor-audit-exclusions.json の除外リストで決定的に外す
 *   （対象は q4-pepper-6 の同一品目形態名2値と qsc-part-dokudami-profile の「地上部」。
 *   詳細は scripts/distractor-audit-a1-report.json）。生成済みデータの手編集はしない。
 * - 監査A2（フェーズ6、docs/DECISIONS.md #25）: F1形式（○×・多択・組み合わせ・図表）の
 *   意味的監査で「真の問題」と判定された図表7問・組み合わせ1問を、生成パイプライン側で直す
 *   （詳細は scripts/distractor-audit-a2-report.json）。生成済みデータの手編集はしない:
 *   - 図表: 対象の利用部位の構成要素（語彙）が他の構成員の利用部位値に包含される対象は
 *     意味的に一意でないため選ばない。決定的ハッシュの対象が不適格な場合は、グループ順で
 *     最初に適格な構成員を対象にする（適格な構成員がないグループは生成しない）。
 *   - 組み合わせ: 除外リストの同種グループ除外（kind: match-cogroup）に載る単位ペアは、
 *     当該属性の組み合わせグループで同居させない。
 * - 監査B-07/B-08是正（2026-10-30独立品質監査、docs/AUDIT_DECISIONS.md AD-5/AD-6）:
 *   B-07: 名称を答える問題（qti-rev と、正答が品目名の q1）では、生成元プロフィールが
 *   「別名」として明記する語も許容回答に含める（別名も同じ品目の名称のため）。
 *   B-08: 四択（q4）の誤答は、設問文のパターンと正答の形状から決めた次元
 *   （人物／科名／部位／原産地／数量／品目名など）と同次元の候補だけに限る。
 *   次元基盤（プロフィールパース・別名集合・次元判定）は生成ループより前に定義する。
 * - 拡充F1（フェーズ6、docs/DECISIONS.md #21）: 残り13形式を全件評価し、プロフィール単位の
 *   構造化属性で正答・誤答の正しさを機械検証できる7形式を追加生成する:
 *   true-false（属性値そのままの真文＋他プロフィールの同属性値へ入れ替えた偽文。偽文の値には
 *   一致・部分文字列・構成トークンの共有を禁じ、監査A1除外リストも適用）、multiple-choice
 *   （同属性値を共有する群から「すべて選べ」。非該当候補は属性値と無関係なもののみ）、
 *   matching（名称↔属性の対応。同一問題内で属性値が重複しない4件グループ）、
 *   reverse-lookup（別名から名称を四択で逆引き。別名基部の一意性ガードは Q2 逆引きと同一）、
 *   table-fill（プロフィール表の科名・利用部位の空欄）、composite（科名＋利用部位の2要点
 *   ルーブリック。要点キーワードは属性値そのもの）、figure（プロフィール表の読み取り四択。
 *   表内では対象属性値が一意）。記述3形式・並べ替え・写真識別・カード形式（問題としての
 *   フラッシュカード）は根拠を機械検証できないため生成しない（理由は DECISIONS #21）。
 * - 難易度較正D1（フェーズ6、docs/DECISIONS.md #22）: 全正式問題の difficulty（型 1|2|3|4|5）を、
 *   一律2の仮置き（#15）から「検定の出題範囲の階層（転記 p.137 試験概要）＋問題形式の負荷」に
 *   基づく規則で付け直す。難易度は教科書・検定構造に基づく相対指標であり、実際の受験者の
 *   正答率ではない。規則で決められない問題は2に据え置き、較正済みと区別してレポートに記録する。
 * - 拡充Q3（フェーズ6、docs/DECISIONS.md #19）: 散文単位86件については、照合済み単位 content と
 *   出典ページの本文転記を突き合わせて人手作成した一問一答を、手書きデータ
 *   scripts/q3-manual-questions.json から取り込む。各項目は支持文（転記本文の原文）を保持し、
 *   生成時に「支持文が転記に原文のまま存在すること」「正答・許容回答が支持文に字句として
 *   含まれること」を機械検証する。四択は作らない（誤答の意味的監査が別途必要なため）。
 *   独立検証は scripts/verify-q3-questions.mjs（結果: scripts/q3-verification-report.json）。
 * - 追加形式F2（フェーズ6、docs/DECISIONS.md #26）: F1（#21）で機械生成では不採用とした
 *   ordering（並べ替え）と short-essay（短文記述）を、Q3 と同じ「人手作成＋検証」方式で追加する。
 *   手書きデータは scripts/f2-manual-questions.json。ordering は転記本文に番号付きで明示された
 *   手順（番号付き段落・番号付き見出し・1ブロック内の埋め込み手順）のみを対象とし、項目文は
 *   番号を除いた原文の字句そのもの、正解順序は原文の番号どおりであることを生成時検証で全件
 *   機械チェックする（3手順未満は自明なため作らない。対象外は手書きデータの skipped に記録）。
 *   short-essay は支持文（転記本文の原文）が2点以上の検証可能な要点を含む単位のみを対象とし、
 *   模範解答は支持文そのもの、ルーブリックの要点キーワードは支持文に字句として含まれる語句
 *   のみとする（生成時検証で全件チェック）。独立検証は scripts/verify-f2-questions.mjs
 *   （結果: scripts/f2-verification-report.json）。
 * - 追加形式F3（フェーズ6、docs/DECISIONS.md #27）: F2（#26）の方式を long-essay（長文記述）と
 *   compare-essay（比較記述）に拡張する。手書きデータは scripts/f3-manual-questions.json。
 *   long-essay は、支持範囲が同一テーマについて2つ以上の転記ブロックにまたがり、模範解答
 *   （支持文の連結）が300字以上・5文以上、要点が4点以上のテーマのみを対象とする（F2の
 *   short-essay は単一ブロック・最大201字・要点2〜4点であり、この基準で区別する）。
 *   compare-essay は、原文に対比が明示された対象（同一記事内で同じ観点の属性値が双方に
 *   並べて述べられているもの）のみを対象とし、設問は原文が対比している観点に限定する。
 *   いずれも模範解答は支持文の連結そのもの、ルーブリックの要点キーワードは支持範囲に
 *   字句として含まれる語句のみとする（生成時検証で全件チェック）。独立検証は
 *   scripts/verify-f3-questions.mjs（結果: scripts/f3-verification-report.json）。
 * - 各問題に生成元単位ID（knowledgeUnitIds）と出典（sourceRefs: manifest画像ID + 本書ページ）を必須保持。
 * - ページ→画像IDの対応は照合バッチで実測・記録された対応を使う
 *   （p.71 以下は ファイル番号 = ページ+9575、p.72 以上は +9576。docs/SOURCE_COVERAGE.md /
 *   docs/COLLATION_BATCH17.md 等）。生成時に manifest へ実在し「欠落」でないことを検証する。
 * - 章・節の割当ては src/data/structure.ts（目次画像で照合済みの構造）の開始ページで写像する
 *   （単位の出典ページを含む節 = 開始ページがそのページ以下の最後の節）。
 * - 検証を通らない問題は正式問題に含めず、理由を scripts/question-generation-report.json に記録する。
 *
 * 入力: src/data/knowledge/ 配下の分割JSON、src/data/source-manifest.json、src/data/structure.ts
 * 出力:
 *   - src/data/questions/formal-<章ID>.json（Question[]、128KB未満に自動分割）
 *   - src/data/questions/cards-<章ID>.json（Flashcard[]、同上）
 *   - src/data/formal-questions.ts（薄い集約モジュール。手で編集しない）
 *   - scripts/question-generation-report.json（試行・通過・除外の記録）
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_FILE_BYTES = 128 * 1024;
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

// ---- 正規化（src/domain/normalize.ts と同じ規則を複製。生成側の同一視判定に使う）
function normalizeText(s) {
  let t = s.normalize("NFKC").toLowerCase().trim();
  t = t.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)); // 監査B-06是正: かな畳み込み（アプリ側と同一規則）
  t = t.replace(/[\s　]+/g, "");
  t = t.replace(/[。、,.・:：;；!！?？「」『』（）()\[\]"'’]/g, "");
  t = t.replace(/ー/g, "");
  return t;
}
// 決定的ハッシュ（再実行で同じ誤答選択・同じ選択肢順になるように）
function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}

// ---- 入力読み込み
const knowledgeDir = join(repoRoot, "src", "data", "knowledge");
const unitFiles = [];
const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith(".json")) unitFiles.push(p); } };
walk(knowledgeDir);
unitFiles.sort();
const units = unitFiles.flatMap((f) => readJson(f));
const unitById = new Map(units.map((u) => [u.id, u]));

const manifest = readJson(join(repoRoot, "src", "data", "source-manifest.json"));
const manifestById = new Map(manifest.entries.map((e) => [e.imageId, e]));

// structure.ts の CHAPTERS 配列リテラル（JSON互換の表記）を抽出して使う
const structureSrc = readFileSync(join(repoRoot, "src", "data", "structure.ts"), "utf8");
const arrStart = structureSrc.indexOf("[", structureSrc.indexOf("= [", structureSrc.indexOf("CHAPTERS")));
let depth = 0, arrEnd = -1;
for (let i = arrStart; i < structureSrc.length; i++) {
  if (structureSrc[i] === "[") depth++;
  else if (structureSrc[i] === "]") { depth--; if (depth === 0) { arrEnd = i; break; } }
}
if (arrEnd < 0) throw new Error("structure.ts の CHAPTERS を抽出できない");
const CHAPTERS = JSON.parse(structureSrc.slice(arrStart, arrEnd + 1));
const allSections = CHAPTERS.flatMap((c) => c.sections.map((s) => ({ ...s, chapterId: c.id })))
  .sort((a, b) => a.bookPage - b.bookPage);
function sectionForPage(page) {
  let found = null;
  for (const s of allSections) { if (s.bookPage <= page) found = s; else break; }
  return found;
}

// ページ→原本画像ID（照合バッチで実測した対応。docs/SOURCE_COVERAGE.md 参照）
function imageIdForPage(page) { return `IMG_${page <= 71 ? page + 9575 : page + 9576}`; }

function sourceRefFor(unit) {
  const page = unit.source.page;
  const imageId = imageIdForPage(page);
  return { ref: { manifestImageId: imageId, bookPage: page, locationNote: `本書 p.${page}（原本画像 ${imageId}.PNG）。原文照合 ${unit.collation?.batch ?? "未記録"} で照合済みの知識単位 ${unit.id} から生成` }, imageId };
}

// ---- 難易度較正D1（フェーズ6、docs/DECISIONS.md #22）
// 対象級（最下級）= その知識が初めて検定の出題範囲に入る級。根拠は転記 p.137（試験概要の
// 出題内容表）のみで、転記・構造データで確認できない事項は使わない。
// - プロフィール単位: 定型文の検定対象級（「1・2・3」→最下級3、「1・2」→2、「1」のみ→1。
//   実測 25種/20種/35種で、p.137 の単品知識の種数〈3級25種・2級で追加20種・1級で追加35種〉と一致）。
// - spice-fact 単位: spice.id で対応するプロフィールの最下級を用いる。対応付かない品目
//   （sansho-extra / chili-paste のような続き・派生項目）は、出典ページが属する節のプロフィール
//   全件の最下級が一致する場合に限りその値を用いる。
// - それ以外の unit 単位: 下の節→最下級対応表（SECTION_SCOPE_GRADE）を p.137 の出題内容表から作る。
//   検定情報（appendix）の節は出題内容表の区分に現れないため対応付けない（較正不能→据え置き）。
// 基本難易度は最下級3→1、2→2、1→3。複数単位を使う問題は構成単位のうち最も上位級（最小の級数）を採る。
// 形式負荷（+1）は、複数の知識点・品目を同時に扱う形式（multiple-choice / matching / figure /
// table-fill〈空欄2つ〉/ composite〈要点2つ〉）と、逆方向の検索を要する形式（reverse-lookup と
// 用語入力の逆引き qti-rev-*）に限る。それ以外（単一の知識点の順方向の想起・判定）は +0。
// 値域は型の 1〜5 に収める（較正ルール上の到達範囲は1〜4）。
const SECTION_SCOPE_GRADE = {
  // 序章: ［歴史］世界における歴史・日本における歴史／［基礎知識］定義・分類・保存法 → 3級
  "history-world": 3, "history-japan": 3, "definition": 3, "classification": 3, "preservation": 3,
  // 第一章: ［料理］料理における働き・使うタイミングと使用量・各国での料理/飲み物への利用・定番料理 → 3級
  "basic-aroma": 3, "basic-timing": 3, "basic-compat": 3,
  "world-africa": 3, "world-europe": 3, "world-asia": 3, "world-america": 3, "world-drink": 3,
  "dish-curry": 3, "dish-genovese": 3, "dish-paella": 3, "dish-chili": 3, "dish-kakuni": 3, "dish-ceviche": 3, "dish-hummus": 3, "dish-lamb": 3, "dish-currywurst": 3, "dish-cumin-potato": 3, "dish-chai": 3, "dish-apple": 3,
  // 第一章: ［具体的な楽しみ方］手作り調味料 → 1級（2級全範囲に追加される区分）
  "season-oil": 1, "season-vinegar": 1, "season-soy": 1, "season-paste": 1, "season-dressing": 1, "season-plus": 1,
  // 第三章: ［ハーブティー］［栽培］［健康］→ 2級（3級全範囲に追加される区分）
  "life-tea": 2, "life-grow": 2, "life-health": 2,
  // 第三章: ［暮らし］ヘルス＆ビューティーへの利用・ハウスキーピングへの利用・ハンドメイド → 3級
  "life-beauty": 3, "life-house": 3, "life-handmade": 3,
};
function profileScopeGrade(content) {
  const m = content.match(/検定(.+?)級の対象。/);
  if (!m) return null;
  const grades = m[1].split("・").map((s) => Number(s)).filter((n) => [1, 2, 3].includes(n));
  return grades.length ? Math.max(...grades) : null; // 最下級 = 級数の最大値（例: 1・2・3 → 3級から対象）
}
const profileUnitBySpiceId = new Map();
const profileUnitsBySectionId = new Map();
for (const u of units) {
  if (u.kind !== "spice-profile") continue;
  if (u.spice?.id) profileUnitBySpiceId.set(u.spice.id, u);
  const sec = sectionForPage(u.source.page);
  if (sec) { if (!profileUnitsBySectionId.has(sec.id)) profileUnitsBySectionId.set(sec.id, []); profileUnitsBySectionId.get(sec.id).push(u); }
}
function unitScopeGrade(u) {
  if (!u) return null;
  if (u.kind === "spice-profile") return profileScopeGrade(u.content);
  if (u.kind === "spice-fact") {
    const prof = u.spice?.id ? profileUnitBySpiceId.get(u.spice.id) : undefined;
    if (prof) return profileScopeGrade(prof.content);
    const sec = sectionForPage(u.source.page);
    const profs = sec ? (profileUnitsBySectionId.get(sec.id) ?? []) : [];
    const grades = new Set(profs.map((p) => profileScopeGrade(p.content)));
    return grades.size === 1 ? [...grades][0] : null;
  }
  const sec = sectionForPage(u.source.page);
  return (sec && SECTION_SCOPE_GRADE[sec.id]) || null;
}
// F2（DECISIONS #26）で ordering（複数の手順項目を同時に扱う）と short-essay（複数の要点を
// 1つの回答にまとめる）を、#22 の形式負荷の定義（複数の知識点・品目を同時に扱う形式）に
// 当てはまるものとして負荷対象に追加した。既存形式の較正結果は変わらない。
// F3（DECISIONS #27）で long-essay（複数の段落にわたる複数要点）と compare-essay（複数対象の
// 複数観点を同時に扱う）も同じ定義に当てはまるため負荷対象に追加した。
const D1_LOAD_FORMATS = new Set(["multiple-choice", "matching", "reverse-lookup", "table-fill", "composite", "figure", "ordering", "short-essay", "long-essay", "compare-essay"]);
const D1_BASE = { 3: 1, 2: 2, 1: 3 };
// 較正できない場合は null を返す（呼び出し側で従来どおり2に据え置く）
function calibrateDifficulty(q) {
  const grades = q.knowledgeUnitIds.map((id) => unitScopeGrade(unitById.get(id)));
  if (grades.some((g) => g === null)) return null;
  const base = D1_BASE[Math.min(...grades)];
  const load = D1_LOAD_FORMATS.has(q.format) || q.id.startsWith("qti-rev-") ? 1 : 0;
  return Math.max(1, Math.min(5, base + load));
}

// ---- 監査A1の誤答除外リスト（DECISIONS #20）。kind: draft-choice（q4）/ profile-part / profile-origin（qsc）
const a1Exclusions = readJson(join(repoRoot, "scripts", "distractor-audit-exclusions.json")).exclusions;
const a1ExcludedFor = (unitId, kind) => new Set(a1Exclusions.filter((e) => e.unitId === unitId && e.kind === kind).flatMap((e) => e.values));
// 監査A2の同種グループ除外（DECISIONS #25）: kind "match-cogroup" の単位ペア（key は属性キー）
const a2CogroupPairs = (key) => a1Exclusions.filter((e) => e.kind === "match-cogroup" && e.key === key).map((e) => [...e.unitIds].sort().join("|"));
const a2CogroupConflict = (key, idA, idB) => a2CogroupPairs(key).includes([idA, idB].sort().join("|"));

// ---- Q3入力（散文単位の人手作成一問一答。DECISIONS #19）+ 転記断片（支持文照合用）
const q3Manual = readJson(join(repoRoot, "scripts", "q3-manual-questions.json"));
const q3ByUnit = new Map(q3Manual.questions.map((m) => [m.unitId, m]));
const transcriptDir = join(repoRoot, "src", "data", "transcripts");
const pageFragments = new Map();
for (const f of readdirSync(transcriptDir).filter((x) => x.endsWith(".json"))) {
  for (const pg of readJson(join(transcriptDir, f))) {
    const frags = [];
    for (const b of pg.blocks) {
      if (b.text) frags.push(b.text);
      if (b.title) frags.push(b.title);
      if (b.rows) for (const row of b.rows) for (const cell of row) frags.push(cell);
    }
    pageFragments.set(pg.bookPage, frags);
  }
}
const supportInTranscript = (page, text) => (pageFragments.get(page) ?? []).some((f) => f.includes(text));

// ---- F2入力（並べ替え・短文記述の人手作成データ。DECISIONS #26）
const f2Manual = readJson(join(repoRoot, "scripts", "f2-manual-questions.json"));
const f2OrderingBySlug = new Map(f2Manual.ordering.map((m) => [m.slug, m]));
const f2EssayBySlug = new Map(f2Manual.shortEssay.map((m) => [m.slug, m]));
// ordering の手順が転記本文に原文どおり存在することの照合:
// - blocks / headings: 各項目について「番号 + 半角空白 + 項目文」が転記フラグメントと完全一致する
// - embedded: 支持文（番号付き手順を連結した文）がフラグメントに含まれ、項目の連結と一致する
function f2StepsInTranscript(entry) {
  const frags = pageFragments.get(entry.page) ?? [];
  if (entry.mode === "embedded") {
    const joined = entry.items.map((t, i) => `${i + 1} ${t}`).join("。") + "。";
    return joined === entry.supportText && frags.some((f) => f.includes(entry.supportText));
  }
  return entry.items.every((t, i) => frags.some((f) => f === `${i + 1} ${t}`));
}
// 監査A3（DECISIONS #28）: 相互に独立した工程（副レシピ・下ごしらえ等）を別項目にすると
// 入れ替えても成立し正解順序が一意にならないため、entry.mergeGroups（原文手順の添字の
// 分割。各グループが表示項目1つになる）で独立工程を1項目に統合できるようにする。
// 統合項目の文は原文の字句の連結そのままで、転記照合は従来どおり原文手順（items）で行う。
// mergeGroups が原文手順の添字の順序どおりの分割でない場合は null を返し、生成から除外する。
function f2DisplayItems(entry) {
  if (!entry.mergeGroups) return [...entry.items];
  const flat = entry.mergeGroups.flat();
  if (JSON.stringify(flat) !== JSON.stringify(entry.items.map((_, i) => i))) return null;
  if (entry.mergeGroups.some((g) => g.length === 0)) return null;
  return entry.mergeGroups.map((g) => g.map((i) => entry.items[i]).join(""));
}

// ---- F3入力（長文記述・比較記述の人手作成データ。DECISIONS #27）
const f3Manual = readJson(join(repoRoot, "scripts", "f3-manual-questions.json"));
const f3LongBySlug = new Map(f3Manual.longEssay.map((m) => [m.slug, m]));
const f3CompareBySlug = new Map(f3Manual.compareEssay.map((m) => [m.slug, m]));
// F3の根拠チェック（生成・検証で共用する形の述語）:
// - 各支持文がそのページの転記本文に原文のまま含まれていること
// - 要点が4点以上で、各要点のキーワードがすべて支持範囲（支持文の連結）に含まれていること
// - long-essay は加えて: 支持範囲が2ブロック以上、連結が300字以上・5文以上（DECISIONS #27）
function f3EntryOk(entry, kind) {
  const union = entry.supports.map((s) => s.text).join("\n");
  if (!entry.supports.every((s) => supportInTranscript(s.page, s.text))) return false;
  if (entry.rubric.length < 4) return false;
  if (!entry.rubric.every((r) => r.keywords.length > 0 && r.keywords.every((k) => union.includes(k)))) return false;
  // G1（DECISIONS #29）: 近接AND結合の断片も支持範囲の字句に限り、subject は設問に含まれる対象名に限る
  if (!entry.rubric.every((r) => (r.keywordGroups ?? []).every((g) => g.length >= 2 && g.every((f) => union.includes(f))))) return false;
  if (!entry.rubric.every((r) => !r.subject || entry.prompt.includes(r.subject))) return false;
  if (kind === "long-essay") {
    if (entry.supports.length < 2) return false;
    if (union.length < 300) return false;
    if ((union.match(/。/g) || []).length < 5) return false;
  }
  return true;
}

// ---- 生成
const report = { attempted: { "one-answer": 0, "single-choice": 0, "flashcard": 0, "fill-blank": 0, "term-input": 0, "true-false": 0, "multiple-choice": 0, "matching": 0, "reverse-lookup": 0, "table-fill": 0, "composite": 0, "figure": 0, "ordering": 0, "short-essay": 0, "long-essay": 0, "compare-essay": 0 }, passed: { "one-answer": 0, "single-choice": 0, "flashcard": 0, "fill-blank": 0, "term-input": 0, "true-false": 0, "multiple-choice": 0, "matching": 0, "reverse-lookup": 0, "table-fill": 0, "composite": 0, "figure": 0, "ordering": 0, "short-essay": 0, "long-essay": 0, "compare-essay": 0 }, q2ByKind: { "family-fill": 0, "level-fill": 0, "part-choice": 0, "origin-choice": 0, "alias-term": 0, "reverse-term": 0, "profile-card": 0 }, f1ByKind: { "tf-family-true": 0, "tf-family-false": 0, "tf-part-true": 0, "tf-part-false": 0, "mc-family": 0, "mc-part": 0, "mc-origin": 0, "match-family": 0, "match-part": 0, "match-origin": 0, "reverse-alias": 0, "table-profile": 0, "composite-profile": 0, "figure-table": 0 }, f1Skipped: [], f2ByKind: { "ordering": 0, "short-essay": 0 }, f2Skipped: f2Manual.skipped, f3ByKind: { "long-essay": 0, "compare-essay": 0 }, f3Skipped: f3Manual.skipped, q3Questions: 0, fix1ByKind: { "term-card": 0, "reverse-card": 0 }, fix1Skipped: [], aliasExpansions: [], excluded: [] };
const exclude = (kind, unitId, reason) => report.excluded.push({ kind, unitId, reason });

const questions = [];
const cards = [];
const eligible = units.filter((u) => u.status === "verified" && u.draftQa && u.collation);
// Q2対象: draftQa はないが定型文の構造化属性を持つ照合済みプロフィール単位（DECISIONS #18）
const profileEligible = units.filter((u) => u.status === "verified" && !u.draftQa && u.collation && u.kind === "spice-profile");
// Q3対象: draftQa も構造化属性もない散文単位（事実79件＋unit 7件。DECISIONS #19）
const proseUnits = units.filter((u) => u.status === "verified" && !u.draftQa && u.collation && u.kind !== "spice-profile");
const ineligible = units.filter((u) => !(u.status === "verified" && u.draftQa && u.collation) && !profileEligible.includes(u) && !q3ByUnit.has(u.id));
for (const u of ineligible) {
  const reason = u.status !== "verified" ? "単位が verified でない" : !u.collation ? "照合記録がない" : "draftQa がなく構造化属性もない散文単位のため、機械検証可能な問題を生成できない（DECISIONS #18）。Q3手書きデータ（scripts/q3-manual-questions.json）にも作問がない";
  exclude("all", u.id, reason);
}

// ---- プロフィール定型文のパースと別名・次元基盤
// Q2生成だけでなく、Q1/Q4生成の監査是正（B-07 別名許容／B-08 誤答の次元型付け）でも
// 使うため、生成ループより前に定義する。
// プロフィール content の定型文: 「名称: 科名は…。原産地は…。利用部位は…。別名は…。検定…級の対象。」
// （ミックススパイスは「名称: ミックススパイス。検定…級の対象。」のみ。属性の無い項目は生成しない）
function parseProfile(content) {
  const g = (re) => content.match(re)?.[1] ?? null;
  return {
    name: g(/^(.+?):\s/),
    family: g(/科名は(.+?)。/),
    origin: g(/原産地は(.+?)。/),
    part: g(/利用部位は(.+?)。/),
    aliasesRaw: g(/別名は(.+?)。/),
    levels: g(/検定(.+?)級の対象。/),
  };
}
const splitAliases = (raw) => (raw ? raw.split("、").map((s) => s.trim()).filter(Boolean) : []);
// 別名トークンの基部（括弧注記を除いた部分）。括弧内は読みとは限らない（注記・対象指定）ため基部と全文のみを許容回答にする
const aliasBase = (tok) => tok.replace(/[(（].*$/, "").trim();
function nameVariants(name) {
  const out = [];
  const push = (v) => { if (v && !out.includes(v)) out.push(v); };
  push(name);
  for (const part of name.split("/")) { push(part.trim()); push(aliasBase(part)); const inner = part.match(/[(（](.+)[)）]/)?.[1]; if (inner) push(inner); }
  return out;
}
const parsedProfiles = new Map(profileEligible.map((u) => [u.id, parseProfile(u.content)]));
// 四択の誤答プールは「他の照合済みプロフィールの同属性値」のみ（教科書外の選択肢は作らない）
const profilePool = (key) => [...new Set(profileEligible.map((u) => parsedProfiles.get(u.id)[key]).filter(Boolean))];
// 別名→名称の逆引きガード: 別名基部の出現回数（全プロフィール）と、全プロフィールの名称バリアント集合
const aliasBaseCount = new Map();
for (const u of profileEligible) for (const tok of splitAliases(parsedProfiles.get(u.id).aliasesRaw)) {
  const b = normalizeText(aliasBase(tok));
  aliasBaseCount.set(b, (aliasBaseCount.get(b) ?? 0) + 1);
}
const allNameNorms = new Set();
for (const u of profileEligible) for (const v of nameVariants(parsedProfiles.get(u.id).name ?? "")) allNameNorms.add(normalizeText(v));
// 監査B-07是正: 名称を答える問題の追加許容回答 = 生成元プロフィールが「別名」として
// 明記する語（全文・基部）。別名も同じ品目の名称であるため正答に含める。
// 他のプロフィールの名称バリアントと一致する語は、別品目の正式名でもあるため除外する。
// 推測による別名は追加しない（AUDIT_DECISIONS AD-6）。
function aliasAnswersFor(profileUnit) {
  const p = parsedProfiles.get(profileUnit.id);
  if (!p) return [];
  const others = new Set();
  for (const u of profileEligible) { if (u.id === profileUnit.id) continue; for (const v of nameVariants(parsedProfiles.get(u.id).name ?? "")) others.add(normalizeText(v)); }
  const out = []; const seen = new Set();
  for (const tok of splitAliases(p.aliasesRaw)) for (const v of [tok, aliasBase(tok)]) {
    const n = normalizeText(v);
    if (n && !seen.has(n) && !others.has(n)) { seen.add(n); out.push(v); }
  }
  return out;
}
// 名称を答える問題の許容回答（名称バリアント＋別名。生成と検証で同一の構築を使う）
function nameAcceptedAnswers(profileUnit) {
  const p = parsedProfiles.get(profileUnit.id);
  const out = [...nameVariants(p?.name ?? "")];
  const seen = new Set(out.map(normalizeText));
  for (const v of aliasAnswersFor(profileUnit)) { const n = normalizeText(v); if (!seen.has(n)) { seen.add(n); out.push(v); } }
  return out;
}

// ---- 監査AU-04/AU-06（DECISIONS #54）: 問題文の引用語の写し・二者択一の判定
// 問題文が「」で示した語（別名・英名など）をそのまま書けば正解になる許容回答は、
// 知識を問わない（問題文の写しで正解できる）ため許容回答から外す。括弧注記を除いた
// 基部が引用語と一致するもの（例: 「馬芹」に対する「馬芹(うまぜり/ばきん)」）も同じ扱い。
function stripParenNote(s) { return s.replace(/[（(][^）)]*[）)]/g, ""); }
function promptQuotedNorms(prompt) {
  return new Set([...prompt.matchAll(/「([^」]+)」/g)].map((m) => normalizeText(m[1])).filter(Boolean));
}
function echoesPrompt(prompt, answer) {
  const quoted = promptQuotedNorms(prompt);
  return quoted.has(normalizeText(answer)) || quoted.has(normalizeText(stripParenNote(answer)));
}
function dropPromptEchoes(prompt, answers) { return answers.filter((a) => !echoesPrompt(prompt, a)); }
function isBinaryPrompt(prompt) {
  if (/どちら/.test(prompt)) return true;
  return /か[?？]$/.test(prompt) && !/何|どこ|誰|いつ|どの|どれ|どう|いくつ/.test(prompt);
}

// ---- 監査B-08是正: 四択（q4）の誤答の次元型付け
// フェーズ4の誤答生成は同一章の他問の正答を次元の照合なしに流用しており、人物を問う
// 問題に食材名、数量を問う問題に別次元の値が並ぶ不良が標本監査で40%を占めた。
// 設問文のパターンと正答の形状から次元を決め、同次元の候補だけを誤答にする。
const profileNameNorms = new Set();
for (const u of profileEligible) for (const v of nameVariants(parsedProfiles.get(u.id).name ?? "")) profileNameNorms.add(normalizeText(v));
const familyValNorms = new Set(profilePool("family").map(normalizeText));
const originValNorms = new Set(profilePool("origin").map(normalizeText));
const partValNorms = new Set(profilePool("part").map(normalizeText));
const aliasNormSet = new Set();
for (const u of profileEligible) for (const t of splitAliases(parsedProfiles.get(u.id).aliasesRaw)) { aliasNormSet.add(normalizeText(t)); aliasNormSet.add(normalizeText(aliasBase(t))); }
const QUESTION_DIM_PATTERNS = [
  ["person", /誰|人物|博士|著者|作者|作家|人名|発見者|提唱者|探検家/],
  ["family", /何科|科名/],
  ["part", /部位/],
  ["origin", /原産地|原産国|どこの国|産地は/],
  ["book", /著書の名|書名|何という(本|書物|著書)|本の名前|著作の題名/],
  ["drink", /飲み物|飲料|カクテル|ドリンク/],
  ["dish", /料理名|定番料理|代表的な料理/],
  ["quantity", /分量|何倍|何粒|何杯|何本|何枚|何個|何g|何mℓ|何ml|何分|何時間|何日|何年|どれだけの量/],
  ["place-name", /寺院|神社|寺の名|場所の名/],
];
// 数量は単位の種類まで揃える（監査B-08の標本で、分量の問題に倍率・杯数・時間が
// 並ぶ不良が確認されたため。mℓ と倍は同じ「数量」でも次元が違う）。
function quantityClass(raw) {
  if (/mℓ|ml|cc|リットル|大さじ|小さじ|カップ/.test(raw)) return "quantity:volume";
  if (/kg|キログラム|グラム|(^|[^a-zA-Z])g([^a-zA-Z]|$)/.test(raw)) return "quantity:mass";
  if (/倍|%|％|割/.test(raw)) return "quantity:ratio";
  if (/粒|杯|本|枚|個|滴|片|束/.test(raw)) return "quantity:count";
  // 暦年（「1520年」「16世紀」）と期間（「5〜9年」「1週間」）は別の種類の事実なので分ける（BV-13）
  if (/^(紀元前)?\d{3,4}年(頃)?$|世紀/.test(raw.trim())) return "quantity:year";
  if (/世紀|年|月|日|時間|分|秒|週間/.test(raw)) return "quantity:time";
  if (/cm|mm|センチ|メートル/.test(raw)) return "quantity:length";
  if (/度/.test(raw)) return "quantity:deg";
  return "quantity:plain";
}
function answerShapeDim(ans) {
  const raw = (ans ?? "").trim();
  const n = normalizeText(raw);
  if (!n) return "unknown";
  if (profileNameNorms.has(n) || aliasNormSet.has(n)) return "spice-name";
  if (familyValNorms.has(n)) return "family";
  if (originValNorms.has(n)) return "origin";
  if (partValNorms.has(n)) return "part";
  if (/^\d/.test(raw) || (/\d/.test(raw) && /(g|mℓ|ml|粒|倍|分|時間|日|年|杯|本|枚|個|度|%|cm|mm|kg|世紀)/.test(raw))) return quantityClass(raw);
  if (/(寺|神社|宮殿|城)$/.test(raw)) return "place-name";
  return "unknown";
}
const QUESTION_STEM_PATTERNS = [
  ["meaning", /の意味は|何を意味する/],
  ["compound", /成分|酵素|物質は/],
  ["language", /何語/],
  ["person", /医師|女王は[?？]$|の王は|美食家|ポルトガル人|ハンガリー人|妖精|天皇/],
  ["period", /時代[は?？]|時期は|いつ行う/],
  ["book", /歴史書|旅行記|料理書|法律書|薬草書|書物/],
  ["origin", /国は[?？]$|どの国|発祥の国/],
  ["place", /島は|場所は|都市|現在の名称|諸島は|どの地域|地域を/],
  ["seasoning", /調味料は|ペーストの名/],
  ["dish", /料理は[?？]$|郷土料理|家庭料理|米料理/],
  ["alias", /和名は|別名は|現地名は|漢方名は|呼び名は|何と呼ばれ|名前は[?？]$|何と呼んで/],
  ["term", /を意味する言葉|何という[?？]|何と呼ぶ[?？]|何性という|略称は|形状は|形状を|形態を/],
  ["ingredient", /素材は|食材は|肉は[?？]|魚は|ナッツは|豆は|何の粉/],
  ["spice-name", /(スパイス|ハーブ)は[?？]$|ハーブを1つ挙げよ/],
];
const dimCache = new Map();
function questionDim(unit) {
  if (dimCache.has(unit.id)) return dimCache.get(unit.id);
  let dim = null;
  for (const [d, re] of QUESTION_DIM_PATTERNS) if (re.test(unit.draftQa.q)) { dim = d; break; }
  if (dim === "quantity") { const s = answerShapeDim(unit.draftQa.a); dim = s.startsWith("quantity") ? s : "quantity:plain"; }
  if (!dim) dim = answerShapeDim(unit.draftQa.a);
  // 監査BV-13（旧AU-13、DECISIONS #55）: 正答の形からも次元が決まらない設問は、設問文が
  // 何を尋ねているか（意味・成分・言語・別名・用語・人物・書名・場所・食材など）で型を付ける。
  // 同じ型の設問の正答だけを誤答にするので、「調味料を問う設問に理由の文が並ぶ」不良が起きない。
  if (dim === "unknown") for (const [d, re] of QUESTION_STEM_PATTERNS) if (re.test(unit.draftQa.q)) { dim = d; break; }
  dimCache.set(unit.id, dim);
  return dim;
}
// 監査B-07是正の一般化: 正答（名称）が指すプロフィールを、名称バリアントの
// 正規化形から引く。2つ以上のプロフィールが同じ名称バリアントを持つ場合は
// 曖昧として null を記録し、展開対象にしない。
const profileByNameNorm = new Map();
for (const u of profileEligible) for (const v of nameVariants(parsedProfiles.get(u.id).name ?? "")) {
  const n = normalizeText(v);
  if (!n) continue;
  if (profileByNameNorm.has(n) && profileByNameNorm.get(n) !== u.id) profileByNameNorm.set(n, null);
  else profileByNameNorm.set(n, u.id);
}

// 同一章（取り込み章 chapterId）の verified draftQa 回答プール（誤答候補の母集団）
const poolByChapter = new Map();
for (const u of eligible) {
  if (!poolByChapter.has(u.chapterId)) poolByChapter.set(u.chapterId, []);
  poolByChapter.get(u.chapterId).push(u);
}

// ---- 監査BV-13（旧AU-13、DECISIONS #55）: 次元不明の設問の誤答を揃える。
// 残る次元不明の設問は、外部知識を使わず表記だけで判定する: 文か語か（述語・理由で終わる
// 答えと名詞の答えを混ぜない）と、文字数（長いほうが短いほうの2.5倍以内）が正答と揃う
// 候補だけを誤答にする。揃う候補が3つに満たない設問は四択を作らない（一問一答とカードは生成される）。
function shapeCore(s) { return stripParenNote(String(s ?? "")).replace(/[\s　・、,，\-‐―〜~「」『』"'’.。]/g, ""); }
function shapeClass(s) {
  const t = shapeCore(s);
  if (!t) return "empty";
  if (/(する|しない|ため|出す|込む|える|かす|ぎる|める|早い|熱い|必要)$/.test(t)) return "clause";
  if (t.length > 8 && /[ぁ-ん]/.test(t) && /[がをにで]/.test(t)) return "clause";
  return "noun";
}
function shapeTail(s) { const t = shapeCore(s); return t ? t[t.length - 1] : ""; }
function shapeCompatible(answer, cand) {
  if (shapeClass(answer) !== shapeClass(cand)) return false;
  const la = shapeCore(answer).length, lc = shapeCore(cand).length;
  return Math.max(la, lc) <= Math.min(la, lc) * 2.5;
}

function distractorsFor(unit) {
  const a = unit.draftQa.a;
  const normA = normalizeText(a);
  const normContent = normalizeText(unit.content);
  const dimQ = questionDim(unit);
  const forbidden = new Set([normA, ...unit.draftQa.alt.map(normalizeText)]);
  const a1Excluded = a1ExcludedFor(unit.id, "draft-choice");
  const cands = [];
  // 監査B-08是正の補完2: 次元が判明している設問では、同次元の候補が同一章で
  // 不足する場合に限り他章の照合済み回答も候補にする（温度・分量・科名などの
  // 値は章をまたいでも同じ種類の事実であり、弱い誤答を残すより正しい）。
  // 次元不明の設問は従来どおり同一章のみ（話題の近さが担保。加えて答えの形を揃える。BV-13）。
  const sameChapter = poolByChapter.get(unit.chapterId) ?? [];
  const crossChapter = dimQ !== "unknown" ? eligible.filter((o) => o.chapterId !== unit.chapterId) : [];
  for (const other of [...sameChapter, ...crossChapter]) {
    if (other.id === unit.id) continue;
    const cand = other.draftQa.a;
    if (a1Excluded.has(cand)) continue; // 監査A1で真の問題と判定された誤答（DECISIONS #20）
    const n = normalizeText(cand);
    if (!n || forbidden.has(n)) continue;
    // 曖昧さガード: 誤答候補が生成元単位の fact 本文に現れるものは「正答でもありうる」ため除外。
    // 正答と部分文字列関係にある候補（例: 正答の一部・拡張）も除外する。
    if (normContent.includes(n)) continue;
    if (n.includes(normA) || normA.includes(n)) continue;
    // 監査B-08是正: 次元（人物／数量／原産地／品目名など）が設問と異なる候補は、
    // 形式だけで排除できてしまう弱い誤答になるため使わない。
    if (questionDim(other) !== dimQ) continue;
    // 監査BV-13（旧AU-13、DECISIONS #55）: 次元不明の設問は、答えの「形」（文字種と長さ）が
    // 正答と揃わない候補を使わない（例: 調味料名を問う設問に理由の文や「しない」が並ぶ不良）。
    if (dimQ === "unknown" && !shapeCompatible(a, cand)) continue;
    cands.push({ cand, n, other });
  }
  // 重複（正規化後）を除き、優先度（同一節タイトル→同一ページ→同一カテゴリ→ハッシュ）で決定的に並べる
  const seen = new Set();
  const uniq = cands.filter((c) => (seen.has(c.n) ? false : (seen.add(c.n), true)));
  uniq.sort((x, y) => {
    // 数量の設問は、正答と単位（末尾の「日」「年」「分」など）が同じ候補を最優先する（BV-13）。
    const tailFirst = dimQ.startsWith("quantity");
    const tier = (c) => (tailFirst && shapeTail(c.cand) !== shapeTail(a) ? 16 : 0) + (c.other.sectionTitle === unit.sectionTitle ? 0 : 1) + (c.other.source.page === unit.source.page ? 0 : 2) + (c.other.category === unit.category ? 0 : 4) + (c.other.chapterId === unit.chapterId ? 0 : 8);
    return tier(x) - tier(y) || fnv(`${unit.id}|${x.other.id}`) - fnv(`${unit.id}|${y.other.id}`);
  });
  // 型が付かない設問では話題の近さだけが誤答のもっともらしさを支える。同じ節か同じページの
  // 回答が2つ以上ある場合だけ四択にする（章が同じだけの遠い話題の語ばかりだと消去法で解けてしまう。BV-13）。
  if (dimQ === "unknown" && uniq.filter((c) => c.other.sectionTitle === unit.sectionTitle || c.other.source.page === unit.source.page).length < 2) return [];
  const picked = uniq.slice(0, 3).map((c) => c.cand);
  // 監査B-08是正の補完: 科名・原産地・利用部位の次元では、同次元の候補が同一章の
  // draftQa 回答に不足する場合に限り、照合済みプロフィールの同属性値（qsc生成と
  // 同じ母集団）で補う。属性値は教科書の照合済み記載そのものである。
  if (picked.length < 3 && ["family", "origin", "part"].includes(dimQ)) {
    const have = new Set(picked.map(normalizeText));
    const a1x = a1ExcludedFor(unit.id, `profile-${dimQ}`);
    const extra = profilePool(dimQ).filter((v) => {
      const n = normalizeText(v);
      return n && !have.has(n) && !forbidden.has(n) && !a1x.has(v) && !normContent.includes(n) && !n.includes(normA) && !normA.includes(n);
    });
    extra.sort((x, y) => fnv(`${unit.id}|topup-${dimQ}|${x}`) - fnv(`${unit.id}|topup-${dimQ}|${y}`));
    for (const v of extra) { if (picked.length >= 3) break; picked.push(v); }
  }
  return picked;
}

for (const unit of eligible) {
  const { q, a, alt } = unit.draftQa;
  const sec = sectionForPage(unit.source.page);
  const { ref, imageId } = sourceRefFor(unit);
  const imgEntry = manifestById.get(imageId);
  const sourceOk = Boolean(imgEntry) && imgEntry.driveFileId !== null && imgEntry.extractionStatus !== "欠落";
  const baseOk = Boolean(sec) && sourceOk && q.trim() !== "" && a.trim() !== "";
  if (!baseOk) {
    const reason = !sec ? "出典ページに対応する節が構造データにない" : !sourceOk ? `出典画像 ${imageId} が manifest に実在しない/欠落` : "draftQa の q/a が空";
    exclude("one-answer", unit.id, reason); exclude("single-choice", unit.id, reason); exclude("flashcard", unit.id, reason);
    continue;
  }
  const common = { version: 1, status: "verified", chapterId: sec.chapterId, sectionId: sec.id, difficulty: 2, knowledgeUnitIds: [unit.id], sourceRefs: [ref] };

  // one-answer（一問一答）: draftQa の直接変換
  report.attempted["one-answer"]++;
  const accepted = [];
  const seenAcc = new Set();
  for (const t of [a, ...alt]) { const n = normalizeText(t); if (n && !seenAcc.has(n)) { seenAcc.add(n); accepted.push(t); } }
  // 監査B-07是正: 正答がスパイスの名称そのものの問題では、その品目の照合済み
  // プロフィールが「別名」として明記する語も正答に含める（別名も同じ品目の名称）。
  // 対象は、正答が指すプロフィールを名称バリアントから引ける問題すべて。
  {
    const profId = profileByNameNorm.get(normalizeText(a));
    if (profId) {
      const prof = unitById.get(profId);
      const added = [];
      for (const v of aliasAnswersFor(prof)) { const n = normalizeText(v); if (n && !seenAcc.has(n)) { seenAcc.add(n); accepted.push(v); added.push(v); } }
      if (added.length) report.aliasExpansions.push({ questionId: `q1-${unit.id}`, added });
    }
  }
  questions.push({ ...common, id: `q1-${unit.id}`, format: "one-answer", prompt: q, acceptedAnswers: accepted, explanation: unit.content });
  report.passed["one-answer"]++;

  // フラッシュカード: draftQa の直接変換
  report.attempted["flashcard"]++;
  cards.push({ id: `card-${unit.id}`, kind: "qa", front: q, back: a, reverseOf: null, chapterId: sec.chapterId, sectionId: sec.id, status: "verified", knowledgeUnitIds: [unit.id], sourceRefs: [ref] });
  report.passed["flashcard"]++;

  // single-choice（四択）: 誤答が3つ確保できる場合のみ
  report.attempted["single-choice"]++;
  // 監査AU-06（DECISIONS #54）: 二者択一（「AとBのどちら」）・可否（「〜か?」）の設問は
  // 答えの候補が2つしかなく、他問の正答を誤答に流用すると意味の通らない四択になる。
  // 一問一答・カードは従来どおり生成し、四択だけを作らない。
  if (isBinaryPrompt(q)) { exclude("single-choice", unit.id, "二者択一・可否の設問は四択に適さない（監査AU-06、DECISIONS #54）"); continue; }
  const distractors = distractorsFor(unit);
  if (distractors.length < 3) { exclude("single-choice", unit.id, `誤答候補が3つ確保できない（ガード通過 ${distractors.length} 件）`); continue; }
  const choices = [a, ...distractors];
  // 決定的シャッフル（ハッシュ順）
  const order = choices.map((c, i) => ({ c, k: fnv(`q4-${unit.id}|${i}|${c}`) })).sort((x, y) => x.k - y.k);
  const shuffled = order.map((o) => o.c);
  questions.push({ ...common, id: `q4-${unit.id}`, format: "single-choice", prompt: q, choices: shuffled, correctChoiceIndexes: [shuffled.indexOf(a)], explanation: unit.content });
  report.passed["single-choice"]++;
}

// ---- Q2生成（プロフィール単位の構造化属性から。DECISIONS #18）
// プロフィール定型文のパース・別名・次元基盤は、Q1/Q4生成の監査是正（B-07/B-08）でも
// 使うため生成ループより前に定義してある（重複定義は置かない）。
function profileDistractors(unit, key, answer) {
  const normA = normalizeText(answer);
  const a1Excluded = a1ExcludedFor(unit.id, `profile-${key}`);
  const cands = profilePool(key).filter((v) => {
    if (a1Excluded.has(v)) return false; // 監査A1で真の問題と判定された誤答（DECISIONS #20）
    const n = normalizeText(v);
    return n && n !== normA && !n.includes(normA) && !normA.includes(n); // 曖昧さガード: 一致・部分文字列関係を除外
  });
  cands.sort((x, y) => fnv(`${unit.id}|${key}|${x}`) - fnv(`${unit.id}|${key}|${y}`));
  return cands.slice(0, 3);
}
// 別名→名称の逆引きガード（aliasBaseCount / allNameNorms）は生成ループより前に定義済み。

for (const unit of profileEligible) {
  const p = parsedProfiles.get(unit.id);
  const sec = sectionForPage(unit.source.page);
  const { ref, imageId } = sourceRefFor(unit);
  const imgEntry = manifestById.get(imageId);
  const sourceOk = Boolean(imgEntry) && imgEntry.driveFileId !== null && imgEntry.extractionStatus !== "欠落";
  if (!sec || !sourceOk || !p.name || !p.levels) {
    const reason = !sec ? "出典ページに対応する節が構造データにない" : !sourceOk ? `出典画像 ${imageId} が manifest に実在しない/欠落` : "プロフィール定型文（名称・検定対象級）を抽出できない";
    for (const k of ["family-fill", "level-fill", "part-choice", "origin-choice", "alias-term", "reverse-term", "profile-card"]) exclude(k, unit.id, reason);
    continue;
  }
  const common = { version: 1, status: "verified", chapterId: sec.chapterId, sectionId: sec.id, difficulty: 2, knowledgeUnitIds: [unit.id], sourceRefs: [ref] };
  const missing = (kind, label) => exclude(kind, unit.id, `プロフィールに${label}の記載がない`);

  // fill-blank: 科名
  if (p.family) {
    report.attempted["fill-blank"]++;
    questions.push({ ...common, id: `qfb-family-${unit.id}`, format: "fill-blank", prompt: `${p.name}の科名は（　）である。`, acceptedAnswers: [p.family], explanation: unit.content });
    report.passed["fill-blank"]++; report.q2ByKind["family-fill"]++;
  } else missing("family-fill", "科名");
  // fill-blank: 検定対象級（全プロフィールが保持）
  report.attempted["fill-blank"]++;
  questions.push({ ...common, id: `qfb-level-${unit.id}`, format: "fill-blank", prompt: `${p.name}は検定（　）級の対象である。`, acceptedAnswers: [p.levels], explanation: unit.content });
  report.passed["fill-blank"]++; report.q2ByKind["level-fill"]++;
  // single-choice: 利用部位 / 原産地
  for (const [key, kind, label] of [["part", "part-choice", "利用部位"], ["origin", "origin-choice", "原産地"]]) {
    if (!p[key]) { missing(kind, label); continue; }
    report.attempted["single-choice"]++;
    const distractors = profileDistractors(unit, key, p[key]);
    if (distractors.length < 3) { exclude(kind, unit.id, `誤答候補が3つ確保できない（ガード通過 ${distractors.length} 件）`); continue; }
    const choices = [p[key], ...distractors];
    const order = choices.map((c, i) => ({ c, k: fnv(`${kind}-${unit.id}|${i}|${c}`) })).sort((x, y) => x.k - y.k);
    const shuffled = order.map((o) => o.c);
    questions.push({ ...common, id: `qsc-${key}-${unit.id}`, format: "single-choice", prompt: `${p.name}の${label}はどれか。`, choices: shuffled, correctChoiceIndexes: [shuffled.indexOf(p[key])], explanation: unit.content });
    report.passed["single-choice"]++; report.q2ByKind[kind]++;
  }
  // term-input: 別名（1つ答える。許容回答は各別名トークンの全文と基部）
  const aliasToks = splitAliases(p.aliasesRaw);
  if (aliasToks.length) {
    report.attempted["term-input"]++;
    const accepted = [];
    const seenAcc = new Set();
    for (const tok of aliasToks) for (const v of [tok, aliasBase(tok)]) { const n = normalizeText(v); if (n && !seenAcc.has(n)) { seenAcc.add(n); accepted.push(v); } }
    questions.push({ ...common, id: `qti-alias-${unit.id}`, format: "term-input", prompt: `${p.name}の別名を1つ答えよ。`, acceptedAnswers: accepted, explanation: unit.content });
    report.passed["term-input"]++; report.q2ByKind["alias-term"]++;
    // term-input（逆引き）: 別名基部が全プロフィール中で一意で、どの名称バリアントとも一致しない別名がある場合のみ
    report.attempted["term-input"]++;
    const uniqTok = aliasToks.find((t) => { const b = normalizeText(aliasBase(t)); return aliasBaseCount.get(b) === 1 && !allNameNorms.has(b); });
    if (uniqTok) {
      // 監査B-07是正: 名称を答える問題のため、この品目の別名も許容回答に含める。
      const acc = nameAcceptedAnswers(unit);
      if (acc.length > nameVariants(p.name).length) report.aliasExpansions.push({ questionId: `qti-rev-${unit.id}`, added: acc.slice(nameVariants(p.name).length) });
      questions.push({ ...common, id: `qti-rev-${unit.id}`, format: "term-input", prompt: `別名「${aliasBase(uniqTok)}」と呼ばれるスパイス＆ハーブの名称を答えよ。`, acceptedAnswers: acc, explanation: unit.content });
      report.passed["term-input"]++; report.q2ByKind["reverse-term"]++;
    } else exclude("reverse-term", unit.id, "一意な別名がない（他のプロフィールと共有される別名のみ）");
  } else { missing("alias-term", "別名"); missing("reverse-term", "別名"); }
  // フラッシュカード: 裏は単位 content そのもの（プロフィール全文）
  report.attempted["flashcard"]++;
  cards.push({ id: `card-profile-${unit.id}`, kind: "profile", front: `${p.name}のプロフィールは？`, back: unit.content, reverseOf: null, chapterId: sec.chapterId, sectionId: sec.id, status: "verified", knowledgeUnitIds: [unit.id], sourceRefs: [ref] });
  report.passed["flashcard"]++; report.q2ByKind["profile-card"]++;
}

// ---- Q3生成（散文単位の人手作成一問一答。DECISIONS #19）
// 手書きデータ scripts/q3-manual-questions.json の各項目について、支持文が転記本文に原文のまま
// 存在すること、正答・許容回答が支持文に字句として含まれることを生成時に機械検証する。
for (const unit of proseUnits) {
  const m = q3ByUnit.get(unit.id);
  if (!m) continue; // 作問のない単位は ineligible 側で理由を記録済み
  const sec = sectionForPage(unit.source.page);
  const { ref: baseRef, imageId } = sourceRefFor(unit);
  const imgEntry = manifestById.get(imageId);
  const sourceOk = Boolean(imgEntry) && imgEntry.driveFileId !== null && imgEntry.extractionStatus !== "欠落";
  const supportOk = supportInTranscript(m.supportPage, m.supportText);
  const answersOk = [m.answer, ...(m.altAnswers ?? [])].every((a) => a && m.supportText.includes(a));
  report.attempted["one-answer"]++;
  if (!sec || !sourceOk || !supportOk || !answersOk || !m.prompt.trim() || !m.answer.trim()) {
    const reason = !sec ? "出典ページに対応する節が構造データにない" : !sourceOk ? `出典画像 ${imageId} が manifest に実在しない/欠落` : !supportOk ? `支持文が転記本文 p.${m.supportPage} に原文のまま存在しない` : !answersOk ? "正答/許容回答が支持文に字句として含まれていない" : "手書きデータの prompt/answer が空";
    exclude("one-answer", unit.id, `Q3手書き問題を登録できない: ${reason}`);
    continue;
  }
  const ref = { ...baseRef, locationNote: `本書 p.${unit.source.page}（原本画像 ${imageId}.PNG）。原文照合 ${unit.collation?.batch ?? "未記録"} で照合済みの知識単位 ${unit.id} について、転記本文 p.${m.supportPage} の支持文に基づき人手作成（拡充Q3、DECISIONS #19）。支持文: ${m.supportText}` };
  const common = { version: 1, status: "verified", chapterId: sec.chapterId, sectionId: sec.id, difficulty: 2, knowledgeUnitIds: [unit.id], sourceRefs: [ref] };
  const accepted = [];
  const seenAcc = new Set();
  for (const t of [m.answer, ...(m.altAnswers ?? [])]) { const n = normalizeText(t); if (n && !seenAcc.has(n)) { seenAcc.add(n); accepted.push(t); } }
  questions.push({ ...common, id: `q1q3-${unit.id}`, format: "one-answer", prompt: m.prompt, acceptedAnswers: accepted, explanation: unit.content });
  report.passed["one-answer"]++; report.q3Questions++;
}

// ---- F1生成（残り形式のうち機械検証できる形式。DECISIONS #21）
// 対象は Q2 と同じ照合済みプロフィール単位の構造化属性のみ。複数単位を使う問題は
// knowledgeUnitIds と sourceRefs を単位順に揃え、解説は各単位 content を "\n" で連結する。
const f1Skip = (kind, detail) => report.f1Skipped.push({ kind, detail });
// 属性値の構成トークン（列挙の要素）。括弧内は注記のため基部のみをトークンにする
const attrTokens = (v) => v.split(/[、,・]/).flatMap((s) => s.split("および")).map((s) => s.replace(/[(（].*$/, "").trim()).filter(Boolean);
// 2つの属性値が「無関係」であること: 正規化後一致・部分文字列・構成トークン共有のいずれでもない
const valueUnrelated = (a, b) => {
  const na = normalizeText(a), nb = normalizeText(b);
  if (!na || !nb || na === nb || na.includes(nb) || nb.includes(na)) return false;
  const tb = new Set(attrTokens(b).map(normalizeText));
  return attrTokens(a).every((t) => !tb.has(normalizeText(t)));
};
function f1Common(us) {
  const sec = sectionForPage(us[0].source.page);
  return { version: 1, status: "verified", chapterId: sec.chapterId, sectionId: sec.id, difficulty: 2, knowledgeUnitIds: us.map((u) => u.id), sourceRefs: us.map((u) => sourceRefFor(u).ref) };
}
const f1Explanation = (us) => us.map((u) => u.content).join("\n");
// 利用部位の構成要素（語彙）抽出（監査A2、scripts/audit-f1-a2.mjs と同じ規則）。括弧内の
// 部位語彙も要素に含め、「種子の仁」は仁、「花の雌しべ」は雌しべ、「未熟な果実」は果実として
// 扱う（状態・形態の修飾は要素にしない）。「葉(芽)」は芽の指定が意味を持つため独立要素にする。
const PART_LEX = ["仮種皮", "雌しべ", "地上部", "根茎", "鱗茎", "果皮", "果実", "種子", "樹皮", "花弁", "花穂", "走根", "葉", "茎", "根", "花", "蕾", "仁"];
function partLexemes(v) {
  if (!v) return new Set();
  const out = new Set();
  for (const rawTok of v.split(/[、,]/).flatMap((s) => s.split("および"))) {
    const tok = rawTok.trim();
    if (!tok) continue;
    const paren = tok.match(/[(（]([^)）]+)[)）]/)?.[1] ?? "";
    const t = tok.replace(/[(（].*[)）]/, "").replace(/^未熟な/, "");
    if (t.includes("雌しべ")) out.add("雌しべ");
    else if (t.includes("仮種皮")) out.add("仮種皮");
    else if (t.includes("の仁")) out.add("仁");
    else if (t.includes("の")) out.add(t.split("の").pop());
    else out.add(t);
    for (const lx of PART_LEX) if (paren.includes(lx)) out.add(lx);
    if (tok.includes("葉") && paren.includes("芽")) out.add("葉(芽)");
  }
  return out;
}
const lexSubset = (a, b) => [...a].every((x) => b.has(x));
function shuffledChoices(idKey, values) {
  return values.map((c, i) => ({ c, k: fnv(`${idKey}|${i}|${c}`) })).sort((x, y) => x.k - y.k).map((o) => o.c);
}
// 偽文・非該当候補の値: 同属性プールから、対象値と無関係で A1 除外リストに載らないものを決定的に選ぶ
function unrelatedPoolValue(unit, key, answer, salt) {
  const a1 = a1ExcludedFor(unit.id, `profile-${key}`);
  const cands = profilePool(key).filter((v) => !a1.has(v) && valueUnrelated(answer, v));
  cands.sort((x, y) => fnv(`${unit.id}|${salt}|${x}`) - fnv(`${unit.id}|${salt}|${y}`));
  return cands[0] ?? null;
}

// true-false（○×）: 科名・利用部位のみ。原産地は列挙が部分的に重なり得る値（地中海沿岸と
// 地中海東部沿岸など）の切り分けが属性値単位では完結せず、検定級は包含関係（1・2 ⊂ 1・2・3）で
// 偽文が部分的に真になり得るため使わない（DECISIONS #21）
for (const unit of profileEligible) {
  const p = parsedProfiles.get(unit.id);
  const common = f1Common([unit]);
  for (const [key, label] of [["family", "科名"], ["part", "利用部位"]]) {
    if (!p[key]) { f1Skip(`tf-${key}`, `${unit.id}: プロフィールに${label}の記載がない`); continue; }
    report.attempted["true-false"]++;
    questions.push({ ...common, id: `qtf-${key}-${unit.id}`, format: "true-false", prompt: `${p.name}の${label}は${p[key]}である。`, correctBoolean: true, explanation: unit.content });
    report.passed["true-false"]++; report.f1ByKind[`tf-${key}-true`]++;
    report.attempted["true-false"]++;
    const fv = unrelatedPoolValue(unit, key, p[key], `tf-${key}`);
    if (!fv) { f1Skip(`tf-${key}`, `${unit.id}: 偽文に使える無関係な${label}の値がプールにない`); continue; }
    questions.push({ ...common, id: `qtf-${key}-false-${unit.id}`, format: "true-false", prompt: `${p.name}の${label}は${fv}である。`, correctBoolean: false, explanation: unit.content });
    report.passed["true-false"]++; report.f1ByKind[`tf-${key}-false`]++;
  }
  // table-fill（表の穴埋め）: プロフィール表の科名・利用部位の空欄
  // composite（複合・記述）: 科名＋利用部位の2要点ルーブリック（要点キーワードは属性値そのもの）
  if (p.family && p.part) {
    report.attempted["table-fill"]++;
    questions.push({ ...common, id: `qtable-${unit.id}`, format: "table-fill", prompt: `${p.name}のプロフィール表の空欄を埋めよ。`, table: { headers: ["項目", "内容"], rows: [["名称", p.name], ["科名", "（空欄A）"], ["利用部位", "（空欄B）"]] }, blankCellAnswers: { A: p.family, B: p.part }, explanation: unit.content });
    report.passed["table-fill"]++; report.f1ByKind["table-profile"]++;
    report.attempted["composite"]++;
    questions.push({ ...common, id: `qcomp-${unit.id}`, format: "composite", prompt: `${p.name}について、科名と利用部位をそれぞれ挙げて説明せよ。`, modelAnswer: `科名は${p.family}。利用部位は${p.part}。`, rubric: [{ id: "family", label: "科名を正しく挙げる", keywords: [p.family], required: true, points: 1 }, { id: "part", label: "利用部位を正しく挙げる", keywords: [p.part], required: true, points: 1 }], explanation: unit.content });
    report.passed["composite"]++; report.f1ByKind["composite-profile"]++;
  } else { f1Skip("table-profile", `${unit.id}: 科名または利用部位の記載がない`); f1Skip("composite-profile", `${unit.id}: 科名または利用部位の記載がない`); }
  // reverse-lookup（逆引き・選択式）: 別名基部が一意な場合のみ（ガードは Q2 の qti-rev と同一）
  const aliasToks = splitAliases(p.aliasesRaw);
  if (!aliasToks.length) { f1Skip("reverse-alias", `${unit.id}: 別名の記載がない`); }
  else {
    report.attempted["reverse-lookup"]++;
    const uniqTok = aliasToks.find((t) => { const b = normalizeText(aliasBase(t)); return aliasBaseCount.get(b) === 1 && !allNameNorms.has(b); });
    if (!uniqTok) f1Skip("reverse-alias", `${unit.id}: 一意な別名がない（他のプロフィールと共有される別名のみ）`);
    else {
      const base = aliasBase(uniqTok);
      const others = profileEligible.filter((o) => o.id !== unit.id).map((o) => parsedProfiles.get(o.id).name).filter((n) => normalizeText(n) !== normalizeText(p.name));
      others.sort((x, y) => fnv(`qrev-${unit.id}|${x}`) - fnv(`qrev-${unit.id}|${y}`));
      const shuffled = shuffledChoices(`qrev-${unit.id}`, [p.name, ...others.slice(0, 3)]);
      questions.push({ ...common, id: `qrev-${unit.id}`, format: "reverse-lookup", prompt: `別名「${base}」と呼ばれるスパイス＆ハーブはどれか。`, choices: shuffled, correctChoiceIndexes: [shuffled.indexOf(p.name)], explanation: unit.content });
      report.passed["reverse-lookup"]++; report.f1ByKind["reverse-alias"]++;
    }
  }
}

// multiple-choice（多択）: 同じ属性値を共有する群について「すべて選べ」。正解は属性値の
// 完全一致で機械判定し、非該当候補は対象値と無関係（一致・包含・トークン共有なし）なものだけにする
for (const [key, label] of [["family", "科名"], ["part", "利用部位"], ["origin", "原産地"]]) {
  const byValue = new Map();
  for (const u of profileEligible) { const v = parsedProfiles.get(u.id)[key]; if (v) { if (!byValue.has(v)) byValue.set(v, []); byValue.get(v).push(u); } }
  for (const [value, members] of [...byValue.entries()].filter(([, ms]) => ms.length >= 2).sort(([a], [b]) => (a < b ? -1 : 1))) {
    report.attempted["multiple-choice"]++;
    const correct = [...members].sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, 2);
    const candPool = profileEligible.filter((u) => { const v = parsedProfiles.get(u.id)[key]; return v && v !== value && valueUnrelated(value, v) && !correct.includes(u); });
    candPool.sort((x, y) => fnv(`qmc-${key}|${value}|${x.id}`) - fnv(`qmc-${key}|${value}|${y.id}`));
    const incorrect = candPool.slice(0, 2);
    if (incorrect.length < 2) { f1Skip(`mc-${key}`, `${value}: 非該当候補が2件確保できない（ガード通過 ${incorrect.length} 件）`); continue; }
    const chosen = [...correct, ...incorrect];
    const correctNames = new Set(correct.map((u) => parsedProfiles.get(u.id).name));
    const shuffled = shuffledChoices(`qmc-${key}-${correct[0].id}`, chosen.map((u) => parsedProfiles.get(u.id).name));
    questions.push({ ...f1Common(chosen), id: `qmc-${key}-${correct[0].id}`, format: "multiple-choice", prompt: `${label}が「${value}」であるものをすべて選べ。`, choices: shuffled, correctChoiceIndexes: shuffled.map((c, i) => (correctNames.has(c) ? i : -1)).filter((i) => i >= 0), explanation: f1Explanation(chosen) });
    report.passed["multiple-choice"]++; report.f1ByKind[`mc-${key}`]++;
  }
}

// matching（組み合わせ）: 同一問題内で属性値が重複しない4件グループで名称↔属性を対応付ける
// figure（図表）: 科名・利用部位とも重複しない4件のプロフィール表を読み、利用部位で1件を特定する
function distinctGroups(list, conflict, size = 4) {
  const groups = [];
  for (const u of list) {
    let placed = false;
    for (const g of groups) { if (g.length < size && !g.some((x) => conflict(x, u))) { g.push(u); placed = true; break; } }
    if (!placed) groups.push([u]);
  }
  return { complete: groups.filter((g) => g.length === size), leftover: groups.filter((g) => g.length < size).flat() };
}
for (const [key, label] of [["family", "科名"], ["part", "利用部位"], ["origin", "原産地"]]) {
  const list = profileEligible.filter((u) => parsedProfiles.get(u.id)[key]).sort((a, b) => (a.id < b.id ? -1 : 1));
  const { complete, leftover } = distinctGroups(list, (x, u) => parsedProfiles.get(x.id)[key] === parsedProfiles.get(u.id)[key] || a2CogroupConflict(key, x.id, u.id));
  for (const u of leftover) f1Skip(`match-${key}`, `${u.id}: ${label}の値が重複しない4件グループを作れなかった`);
  for (const g of complete) {
    report.attempted["matching"]++;
    const pairs = g.map((u) => ({ left: parsedProfiles.get(u.id).name, right: parsedProfiles.get(u.id)[key] }));
    questions.push({ ...f1Common(g), id: `qmatch-${key}-${g[0].id}`, format: "matching", prompt: `次の名称と${label}を組み合わせよ（対象: ${pairs.map((x) => x.left).join("・")}）。`, matchingPairs: pairs, explanation: f1Explanation(g) });
    report.passed["matching"]++; report.f1ByKind[`match-${key}`]++;
  }
}
{
  const list = profileEligible.filter((u) => { const p = parsedProfiles.get(u.id); return p.family && p.part; }).sort((a, b) => (a.id < b.id ? -1 : 1));
  const { complete, leftover } = distinctGroups(list, (x, u) => { const a = parsedProfiles.get(x.id), b = parsedProfiles.get(u.id); return a.family === b.family || a.part === b.part; });
  for (const u of leftover) f1Skip("figure-table", `${u.id}: 科名・利用部位とも重複しない4件グループを作れなかった`);
  for (const g of complete) {
    // 監査A2の意味的一意性ガード（DECISIONS #25）: 対象の利用部位の構成要素が他の構成員の
    // 利用部位値に包含される対象は、その構成員も対象値に該当してしまい一意でないため選ばない。
    // 決定的ハッシュの対象が適格なら維持し、不適格ならグループ順で最初に適格な構成員にする。
    const eligibleTarget = (m) => { const lm = partLexemes(parsedProfiles.get(m.id).part); return g.every((o) => o === m || !lexSubset(lm, partLexemes(parsedProfiles.get(o.id).part))); };
    const hashed = g[fnv(`qfig|${g[0].id}`) % g.length];
    const target = eligibleTarget(hashed) ? hashed : g.find(eligibleTarget);
    if (!target) { for (const u of g) f1Skip("figure-table", `${u.id}: 意味的に一意な対象を選べる構成員がグループにない（監査A2ガード）`); continue; }
    report.attempted["figure"]++;
    const tp = parsedProfiles.get(target.id);
    const shuffled = shuffledChoices(`qfig-${g[0].id}`, g.map((u) => parsedProfiles.get(u.id).name));
    questions.push({ ...f1Common(g), id: `qfig-${g[0].id}`, format: "figure", prompt: `表の中で、利用部位が「${tp.part}」である品目はどれか（対象: ${g.map((u) => parsedProfiles.get(u.id).name).join("・")}）。`, table: { headers: ["名称", "科名", "利用部位"], rows: g.map((u) => { const p = parsedProfiles.get(u.id); return [p.name, p.family, p.part]; }) }, choices: shuffled, correctChoiceIndexes: [shuffled.indexOf(tp.name)], explanation: f1Explanation(g) });
    report.passed["figure"]++; report.f1ByKind["figure-table"]++;
  }
}

// ---- F2生成（並べ替え・短文記述の人手作成。DECISIONS #26）
// 手書きデータ scripts/f2-manual-questions.json の各項目について、生成時に根拠を機械検証する:
// ordering は項目文と順序が転記本文の番号付き手順と原文どおり一致すること、short-essay は
// 支持文が転記に原文のまま存在し、要点キーワードがすべて支持文に含まれること。
for (const entry of f2Manual.ordering) {
  report.attempted["ordering"]++;
  const us = entry.unitIds.map((id) => unitById.get(id));
  const sec = us[0] ? sectionForPage(us[0].source.page) : null;
  const unitsOk = us.every((u) => u && u.status === "verified" && u.collation);
  const sourceOk = us.every((u) => { if (!u) return false; const e = manifestById.get(imageIdForPage(u.source.page)); return Boolean(e) && e.driveFileId !== null && e.extractionStatus !== "欠落"; });
  const stepsOk = f2StepsInTranscript(entry);
  const displayItems = f2DisplayItems(entry);
  const shapeOk = displayItems !== null && displayItems.length >= 3 && new Set(displayItems).size === displayItems.length && entry.prompt.trim() !== "";
  if (!unitsOk || !sec || !sourceOk || !stepsOk || !shapeOk) {
    const reason = !unitsOk ? "対象単位が存在しない/verified でない" : !sec ? "出典ページに対応する節が構造データにない" : !sourceOk ? "出典画像が manifest に実在しない/欠落" : !stepsOk ? `手順が転記本文 p.${entry.page} に番号どおり原文のまま存在しない` : "表示項目が3つ未満か項目に重複がある/mergeGroups が原文手順の分割でない/設問が空";
    exclude("ordering", entry.unitIds[0] ?? entry.slug, `F2手書き問題（並べ替え ${entry.slug}）を登録できない: ${reason}`);
    continue;
  }
  const numbered = displayItems.map((t, i) => `${i + 1} ${t}`).join(" ");
  const refs = us.map((u) => { const { ref, imageId } = sourceRefFor(u); return { ...ref, locationNote: `本書 p.${u.source.page}（原本画像 ${imageId}.PNG）。原文照合 ${u.collation?.batch ?? "未記録"} で照合済みの知識単位 ${u.id} について、転記本文 p.${entry.page} の番号付き手順に基づき人手作成（追加形式F2、DECISIONS #26）。手順: ${numbered}` }; });
  const common = { version: 1, status: "verified", chapterId: sec.chapterId, sectionId: sec.id, difficulty: 2, knowledgeUnitIds: entry.unitIds, sourceRefs: refs };
  // 初期表示順は決定的シャッフル（ハッシュ順）。正解順と一致した場合は1つ回転させてずらす
  const shuffled = displayItems.map((t) => ({ t, k: fnv(`qord-${entry.slug}|${t}`) })).sort((x, y) => x.k - y.k).map((o) => o.t);
  if (JSON.stringify(shuffled) === JSON.stringify(displayItems)) shuffled.push(shuffled.shift());
  questions.push({ ...common, id: `qord-${entry.slug}`, format: "ordering", prompt: entry.prompt, orderingItems: shuffled, correctOrder: [...displayItems], explanation: `正しい順序は次のとおり（本書 p.${entry.page} の転記本文に番号付きで示された手順どおり）。${numbered}` });
  report.passed["ordering"]++; report.f2ByKind["ordering"]++;
}
for (const entry of f2Manual.shortEssay) {
  report.attempted["short-essay"]++;
  const unit = unitById.get(entry.unitId);
  const sec = unit ? sectionForPage(unit.source.page) : null;
  const { ref: baseRef, imageId } = unit ? sourceRefFor(unit) : { ref: null, imageId: null };
  const imgEntry = imageId ? manifestById.get(imageId) : null;
  const sourceOk = Boolean(imgEntry) && imgEntry.driveFileId !== null && imgEntry.extractionStatus !== "欠落";
  const supportOk = supportInTranscript(entry.supportPage, entry.supportText);
  const rubricOk = entry.rubric.length >= 2 && entry.rubric.every((r) => r.keywords.length > 0 && r.keywords.every((k) => entry.supportText.includes(k)) && (r.keywordGroups ?? []).every((g) => g.length >= 2 && g.every((f) => entry.supportText.includes(f))));
  if (!unit || unit.status !== "verified" || !unit.collation || !sec || !sourceOk || !supportOk || !rubricOk || !entry.prompt.trim()) {
    const reason = !unit || unit.status !== "verified" || !unit.collation ? "対象単位が存在しない/verified でない" : !sec ? "出典ページに対応する節が構造データにない" : !sourceOk ? `出典画像 ${imageId} が manifest に実在しない/欠落` : !supportOk ? `支持文が転記本文 p.${entry.supportPage} に原文のまま存在しない` : !rubricOk ? "要点が2点未満か、要点キーワードが支持文に含まれていない" : "手書きデータの prompt が空";
    exclude("short-essay", entry.unitId, `F2手書き問題（短文記述 ${entry.slug}）を登録できない: ${reason}`);
    continue;
  }
  const ref = { ...baseRef, locationNote: `本書 p.${unit.source.page}（原本画像 ${imageId}.PNG）。原文照合 ${unit.collation?.batch ?? "未記録"} で照合済みの知識単位 ${unit.id} について、転記本文 p.${entry.supportPage} の支持文に基づき人手作成（追加形式F2、DECISIONS #26）。支持文: ${entry.supportText}` };
  const common = { version: 1, status: "verified", chapterId: sec.chapterId, sectionId: sec.id, difficulty: 2, knowledgeUnitIds: [unit.id], sourceRefs: [ref] };
  questions.push({ ...common, id: `qse-${entry.slug}`, format: "short-essay", prompt: entry.prompt, modelAnswer: entry.supportText, rubric: entry.rubric, explanation: unit.content });
  report.passed["short-essay"]++; report.f2ByKind["short-essay"]++;
}

// ---- F3生成（長文記述・比較記述の人手作成。DECISIONS #27）
// 手書きデータ scripts/f3-manual-questions.json の各項目について、生成時に根拠を機械検証する:
// 各支持文が転記に原文のまま存在すること、要点キーワードがすべて支持範囲に含まれること、
// long-essay は区別基準（2ブロック以上・300字以上・5文以上・要点4点以上）を満たすこと。
for (const [entries, kind, prefix] of [[f3Manual.longEssay, "long-essay", "qle"], [f3Manual.compareEssay, "compare-essay", "qce"]]) {
  for (const entry of entries) {
    report.attempted[kind]++;
    const us = entry.unitIds.map((id) => unitById.get(id));
    const sec = us[0] ? sectionForPage(us[0].source.page) : null;
    const unitsOk = us.every((u) => u && u.status === "verified" && u.collation);
    const sourceOk = us.every((u) => { if (!u) return false; const e = manifestById.get(imageIdForPage(u.source.page)); return Boolean(e) && e.driveFileId !== null && e.extractionStatus !== "欠落"; });
    const supportOk = f3EntryOk(entry, kind);
    if (!unitsOk || !sec || !sourceOk || !supportOk || !entry.prompt.trim()) {
      const reason = !unitsOk ? "対象単位が存在しない/verified でない" : !sec ? "出典ページに対応する節が構造データにない" : !sourceOk ? "出典画像が manifest に実在しない/欠落" : !supportOk ? "支持文が転記に原文のまま存在しない/要点が基準を満たさない（DECISIONS #27）" : "手書きデータの prompt が空";
      exclude(kind, entry.unitIds[0] ?? entry.slug, `F3手書き問題（${kind} ${entry.slug}）を登録できない: ${reason}`);
      continue;
    }
    const union = entry.supports.map((s) => s.text).join("\n");
    const supportNote = entry.supports.map((s) => `p.${s.page}: ${s.text}`).join(" / ");
    const refs = us.map((u) => { const { ref, imageId } = sourceRefFor(u); return { ...ref, locationNote: `本書 p.${u.source.page}（原本画像 ${imageId}.PNG）。原文照合 ${u.collation?.batch ?? "未記録"} で照合済みの知識単位 ${u.id} について、転記本文の支持文に基づき人手作成（追加形式F3、DECISIONS #27）。支持文: ${supportNote}` }; });
    const common = { version: 1, status: "verified", chapterId: sec.chapterId, sectionId: sec.id, difficulty: 2, knowledgeUnitIds: entry.unitIds, sourceRefs: refs };
    questions.push({ ...common, id: `${prefix}-${entry.slug}`, format: kind, prompt: entry.prompt, modelAnswer: union, rubric: entry.rubric, explanation: us.map((u) => u.content).join("\n") });
    report.passed[kind]++; report.f3ByKind[kind]++;
  }
}

// ---- 監査AU-04（DECISIONS #54）: 入力式の許容回答から問題文の引用語の写しを外す。
// 対象は入力で答える3形式のみ（選択式は選択肢の表示が前提のため対象外）。
report.promptEchoRemovals = [];
for (const q of questions) {
  if (!["one-answer", "fill-blank", "term-input"].includes(q.format)) continue;
  const kept = dropPromptEchoes(q.prompt, q.acceptedAnswers);
  if (kept.length === q.acceptedAnswers.length) continue;
  report.promptEchoRemovals.push({ questionId: q.id, removed: q.acceptedAnswers.filter((a) => !kept.includes(a)) });
  q.acceptedAnswers = kept;
}

// ---- 難易度較正D1の適用（DECISIONS #22）: 生成した全問題の difficulty を規則で一括で付け直す。
// 較正できない問題は仮置きの2のまま据え置き、較正済みと区別して d1Report に記録する。
const d1Report = { byDifficulty: {}, calibratedByDifficulty: {}, heldIds: [] };
for (const q of questions) {
  const d = calibrateDifficulty(q);
  if (d === null) d1Report.heldIds.push(q.id);
  else { q.difficulty = d; d1Report.calibratedByDifficulty[d] = (d1Report.calibratedByDifficulty[d] ?? 0) + 1; }
  d1Report.byDifficulty[q.difficulty] = (d1Report.byDifficulty[q.difficulty] ?? 0) + 1;
}

// ---- 検証（validate.ts の規則 + 根拠の機械チェック。通過しないものは落とす）
function validateGenerated(qs, cs) {
  const problems = [];
  const seenKey = new Set(); const seenId = new Set();
  for (const q of qs) {
    if (seenId.has(q.id)) problems.push(`${q.id}: ID重複`);
    seenId.add(q.id);
    const key = `${q.format}|${q.prompt.trim()}`;
    if (seenKey.has(key)) problems.push(`${q.id}: 形式+問題文の重複`);
    seenKey.add(key);
    if (!q.sourceRefs.length) problems.push(`${q.id}: 出典なし`);
    if (!q.explanation.trim()) problems.push(`${q.id}: 解説が空`);
    if (![1, 2, 3, 4, 5].includes(q.difficulty)) problems.push(`${q.id}: 難易度が型の値域（1〜5）外`);
    // 監査AU-04/AU-06（DECISIONS #54）
    if (["one-answer", "fill-blank", "term-input"].includes(q.format)) {
      if (!(q.acceptedAnswers ?? []).length) problems.push(`${q.id}: 許容回答が空`);
      for (const a of q.acceptedAnswers ?? []) if (echoesPrompt(q.prompt, a)) problems.push(`${q.id}: 許容回答「${a}」が問題文の引用語の写し（AU-04）`);
    }
    if (q.id.startsWith("q4-") && isBinaryPrompt(q.prompt)) problems.push(`${q.id}: 二者択一・可否の設問の四択（AU-06）`);
    // D1較正の再計算一致（較正済みは規則どおり、据え置きは仮置きの2であること。DECISIONS #22）
    { const expectedD = calibrateDifficulty(q); if (expectedD === null ? q.difficulty !== 2 : q.difficulty !== expectedD) problems.push(`${q.id}: 難易度が較正D1の規則と不一致`); }
    const unit = unitById.get(q.knowledgeUnitIds[0]);
    if (!unit) { problems.push(`${q.id}: 生成元単位が存在しない`); continue; }
    if (unit.status !== "verified") problems.push(`${q.id}: 生成元単位が verified でない`);
    if (q.sourceRefs[0].bookPage !== unit.source.page) problems.push(`${q.id}: 出典ページが単位と不一致`);
    const entry = manifestById.get(q.sourceRefs[0].manifestImageId);
    if (!entry || entry.driveFileId === null) problems.push(`${q.id}: 出典画像が manifest に実在しない`);
    if (q.format === "one-answer" && unit.draftQa) {
      if (q.prompt !== unit.draftQa.q) problems.push(`${q.id}: 問題文が draftQa.q と不一致`);
      if (q.acceptedAnswers[0] !== unit.draftQa.a) problems.push(`${q.id}: 正答が draftQa.a と不一致`);
    }
    // ---- Q3（散文単位の人手作成）の根拠チェック: 手書きデータとの一致 + 支持文の転記照合
    if (q.id.startsWith("q1q3-")) {
      const m = q3ByUnit.get(unit.id);
      if (!m) problems.push(`${q.id}: Q3手書きデータに存在しない`);
      else {
        if (q.prompt !== m.prompt) problems.push(`${q.id}: 問題文が Q3手書きデータと不一致`);
        const allowed = [m.answer, ...(m.altAnswers ?? [])];
        if (q.acceptedAnswers[0] !== m.answer) problems.push(`${q.id}: 正答が Q3手書きデータの answer と不一致`);
        for (const a of q.acceptedAnswers) if (!allowed.includes(a)) problems.push(`${q.id}: 許容回答「${a}」が Q3手書きデータにない`);
        if (!supportInTranscript(m.supportPage, m.supportText)) problems.push(`${q.id}: 支持文が転記本文 p.${m.supportPage} に原文のまま存在しない`);
        for (const a of q.acceptedAnswers) if (!m.supportText.includes(a)) problems.push(`${q.id}: 正答/許容回答「${a}」が支持文に含まれていない`);
        if (q.explanation !== unit.content) problems.push(`${q.id}: 解説が生成元単位の content と不一致`);
      }
    }
    // ---- F2（並べ替え・短文記述の人手作成。DECISIONS #26）の根拠チェック
    if (q.id.startsWith("qord-")) {
      const entry = f2OrderingBySlug.get(q.id.slice("qord-".length));
      if (!entry) problems.push(`${q.id}: F2手書きデータに存在しない`);
      else {
        if (q.prompt !== entry.prompt) problems.push(`${q.id}: 問題文が F2手書きデータと不一致`);
        if (JSON.stringify(q.knowledgeUnitIds) !== JSON.stringify(entry.unitIds)) problems.push(`${q.id}: 知識単位が F2手書きデータと不一致`);
        const displayItems = f2DisplayItems(entry);
        if (displayItems === null) problems.push(`${q.id}: mergeGroups が原文手順の分割でない（監査A3）`);
        else {
          if (JSON.stringify(q.correctOrder) !== JSON.stringify(displayItems)) problems.push(`${q.id}: 正解順序が F2手書きデータの表示項目と不一致`);
          if (JSON.stringify([...(q.orderingItems ?? [])].sort()) !== JSON.stringify([...displayItems].sort())) problems.push(`${q.id}: 並べ替え項目が表示項目と一致しない`);
        }
        if (JSON.stringify(q.orderingItems) === JSON.stringify(q.correctOrder)) problems.push(`${q.id}: 初期表示順が正解順と一致している（並べ替えにならない）`);
        if (entry.items.length < 3) problems.push(`${q.id}: 手順が3つ未満`);
        if (displayItems !== null && displayItems.length < 3) problems.push(`${q.id}: 表示項目が3つ未満（監査A3）`);
        if (new Set(entry.items).size !== entry.items.length) problems.push(`${q.id}: 手順の項目に重複がある`);
        if (!f2StepsInTranscript(entry)) problems.push(`${q.id}: 手順が転記本文 p.${entry.page} に番号どおり原文のまま存在しない`);
      }
    }
    if (q.id.startsWith("qse-")) {
      const entry = f2EssayBySlug.get(q.id.slice("qse-".length));
      if (!entry) problems.push(`${q.id}: F2手書きデータに存在しない`);
      else {
        if (q.prompt !== entry.prompt) problems.push(`${q.id}: 問題文が F2手書きデータと不一致`);
        if (JSON.stringify(q.knowledgeUnitIds) !== JSON.stringify([entry.unitId])) problems.push(`${q.id}: 知識単位が F2手書きデータと不一致`);
        if (q.modelAnswer !== entry.supportText) problems.push(`${q.id}: 模範解答が支持文と不一致`);
        if (!supportInTranscript(entry.supportPage, entry.supportText)) problems.push(`${q.id}: 支持文が転記本文 p.${entry.supportPage} に原文のまま存在しない`);
        if (JSON.stringify(q.rubric) !== JSON.stringify(entry.rubric)) problems.push(`${q.id}: ルーブリックが F2手書きデータと不一致`);
        if ((q.rubric ?? []).length < 2) problems.push(`${q.id}: 要点が2点未満`);
        for (const r of q.rubric ?? []) for (const k of r.keywords) if (!entry.supportText.includes(k)) problems.push(`${q.id}: 要点キーワード「${k}」が支持文に含まれていない`);
        if (q.explanation !== unit.content) problems.push(`${q.id}: 解説が生成元単位の content と不一致`);
      }
    }
    // ---- F3（長文記述・比較記述の人手作成。DECISIONS #27）の根拠チェック
    if (q.id.startsWith("qle-") || q.id.startsWith("qce-")) {
      const isLong = q.id.startsWith("qle-");
      const entry = isLong ? f3LongBySlug.get(q.id.slice("qle-".length)) : f3CompareBySlug.get(q.id.slice("qce-".length));
      const kind = isLong ? "long-essay" : "compare-essay";
      if (!entry) problems.push(`${q.id}: F3手書きデータに存在しない`);
      else {
        if (q.format !== kind) problems.push(`${q.id}: 形式が ${kind} でない`);
        if (q.prompt !== entry.prompt) problems.push(`${q.id}: 問題文が F3手書きデータと不一致`);
        if (JSON.stringify(q.knowledgeUnitIds) !== JSON.stringify(entry.unitIds)) problems.push(`${q.id}: 知識単位が F3手書きデータと不一致`);
        const union = entry.supports.map((s) => s.text).join("\n");
        if (q.modelAnswer !== union) problems.push(`${q.id}: 模範解答が支持文の連結と不一致`);
        if (JSON.stringify(q.rubric) !== JSON.stringify(entry.rubric)) problems.push(`${q.id}: ルーブリックが F3手書きデータと不一致`);
        if (!f3EntryOk(entry, kind)) problems.push(`${q.id}: 支持文・要点が F3 の基準（DECISIONS #27）を満たさない`);
        const us = entry.unitIds.map((id) => unitById.get(id));
        if (q.explanation !== us.map((u) => u?.content).join("\n")) problems.push(`${q.id}: 解説が生成元単位の content の連結と不一致`);
        if (q.sourceRefs.length !== us.length) problems.push(`${q.id}: 出典の数が生成元単位と不一致`);
      }
    }
    if (q.id.startsWith("q4-")) {
      if (q.correctChoiceIndexes.length !== 1) problems.push(`${q.id}: 四択の正解が1つでない`);
      else if (q.choices[q.correctChoiceIndexes[0]] !== unit.draftQa.a) problems.push(`${q.id}: 四択の正答が draftQa.a と不一致`);
      const norms = q.choices.map(normalizeText);
      if (new Set(norms).size !== norms.length) problems.push(`${q.id}: 選択肢に正規化後の重複`);
      for (const c of q.choices) {
        if (c === unit.draftQa.a) continue;
        const qDim = questionDim(unit);
        const srcUnits = eligible.filter((o) => o.id !== unit.id && o.draftQa.a === c);
        const ok = srcUnits.some((o) => o.chapterId === unit.chapterId || questionDim(o) === qDim)
          || (["family", "origin", "part"].includes(qDim) && profilePool(qDim).includes(c));
        if (!ok) problems.push(`${q.id}: 誤答「${c}」が同一章の照合済み回答にも同次元のプロフィール属性値にも存在しない`);
        if (normalizeText(unit.content).includes(normalizeText(c))) problems.push(`${q.id}: 誤答「${c}」が生成元単位の本文に現れる（曖昧さガード違反）`);
        if (a1ExcludedFor(unit.id, "draft-choice").has(c)) problems.push(`${q.id}: 誤答「${c}」が監査A1除外リストに登録されている（DECISIONS #20）`);
        // 同じ答えを持つ単位が同一章に複数あるときは、そのいずれかが設問と同次元であればよい
        // （先頭の1件だけで判定すると、同次元の出所があるのに誤検出する。BV-13）。
        const srcUnitsInChapter = (poolByChapter.get(unit.chapterId) ?? []).filter((o) => o.id !== unit.id && o.draftQa.a === c);
        if (srcUnitsInChapter.length > 0 && !srcUnitsInChapter.some((o) => questionDim(o) === questionDim(unit))) problems.push(`${q.id}: 誤答「${c}」の次元が設問と異なる（監査B-08是正）`);
      }
    }
    // ---- Q2（プロフィール属性由来）の根拠チェック: 正答・許容回答が単位 content の抽出値と一致すること
    if (!unit.draftQa) {
      const p = parseProfile(unit.content);
      const sameSet = (xs, ys) => xs.length === ys.length && xs.every((x) => ys.includes(x));
      if (q.id.startsWith("qfb-family-")) {
        if (q.prompt !== `${p.name}の科名は（　）である。`) problems.push(`${q.id}: 問題文がテンプレートと不一致`);
        if (!sameSet(q.acceptedAnswers ?? [], [p.family])) problems.push(`${q.id}: 正答がプロフィールの科名と不一致`);
      }
      if (q.id.startsWith("qfb-level-")) {
        if (q.prompt !== `${p.name}は検定（　）級の対象である。`) problems.push(`${q.id}: 問題文がテンプレートと不一致`);
        if (!sameSet(q.acceptedAnswers ?? [], [p.levels])) problems.push(`${q.id}: 正答がプロフィールの検定対象級と不一致`);
      }
      if (q.id.startsWith("qsc-part-") || q.id.startsWith("qsc-origin-")) {
        const key = q.id.startsWith("qsc-part-") ? "part" : "origin";
        const label = key === "part" ? "利用部位" : "原産地";
        if (q.prompt !== `${p.name}の${label}はどれか。`) problems.push(`${q.id}: 問題文がテンプレートと不一致`);
        if (q.correctChoiceIndexes.length !== 1) problems.push(`${q.id}: 四択の正解が1つでない`);
        else if (q.choices[q.correctChoiceIndexes[0]] !== p[key]) problems.push(`${q.id}: 四択の正答がプロフィールの${label}と不一致`);
        const norms = q.choices.map(normalizeText);
        if (new Set(norms).size !== norms.length) problems.push(`${q.id}: 選択肢に正規化後の重複`);
        const normAns = normalizeText(p[key]);
        for (const c of q.choices) {
          if (c === p[key]) continue;
          const ok = profileEligible.some((o) => o.id !== unit.id && parseProfile(o.content)[key] === c);
          if (!ok) problems.push(`${q.id}: 誤答「${c}」が他の照合済みプロフィールの${label}に存在しない`);
          const n = normalizeText(c);
          if (n.includes(normAns) || normAns.includes(n)) problems.push(`${q.id}: 誤答「${c}」が正答と部分文字列関係（曖昧さガード違反）`);
          if (a1ExcludedFor(unit.id, `profile-${key}`).has(c)) problems.push(`${q.id}: 誤答「${c}」が監査A1除外リストに登録されている（DECISIONS #20）`);
        }
      }
      if (q.id.startsWith("qti-alias-")) {
        if (q.prompt !== `${p.name}の別名を1つ答えよ。`) problems.push(`${q.id}: 問題文がテンプレートと不一致`);
        const expected = [];
        for (const tok of splitAliases(p.aliasesRaw)) for (const v of [tok, aliasBase(tok)]) if (!expected.includes(v)) expected.push(v);
        if (!sameSet(q.acceptedAnswers ?? [], expected)) problems.push(`${q.id}: 許容回答がプロフィールの別名（全文・基部）と不一致`);
      }
      if (q.id.startsWith("qti-rev-")) {
        const base = q.prompt.match(/別名「(.+)」/)?.[1];
        if (!base) problems.push(`${q.id}: 問題文から別名を抽出できない`);
        else {
          if (!splitAliases(p.aliasesRaw).some((t) => aliasBase(t) === base)) problems.push(`${q.id}: 別名「${base}」が生成元プロフィールに存在しない`);
          if (aliasBaseCount.get(normalizeText(base)) !== 1) problems.push(`${q.id}: 別名「${base}」が全プロフィール中で一意でない（逆引きガード違反）`);
          if (allNameNorms.has(normalizeText(base))) problems.push(`${q.id}: 別名「${base}」がプロフィール名称と一致する（逆引きガード違反）`);
        }
        if (!sameSet(q.acceptedAnswers ?? [], dropPromptEchoes(q.prompt, nameAcceptedAnswers(unit)))) problems.push(`${q.id}: 許容回答がプロフィールの名称バリアント＋別名（監査B-07是正、問題文の別名の写しは除く: AU-04）と不一致`);
      }
    }
    // ---- F1（プロフィール属性由来の追加形式。DECISIONS #21）の根拠チェック
    if (/^(qtf|qmc|qmatch|qrev|qtable|qcomp|qfig)-/.test(q.id)) {
      const us = q.knowledgeUnitIds.map((id) => unitById.get(id));
      if (us.some((u) => !u || u.kind !== "spice-profile" || u.draftQa)) problems.push(`${q.id}: 生成元がプロフィール単位でない`);
      else {
        if (q.explanation !== us.map((u) => u.content).join("\n")) problems.push(`${q.id}: 解説が生成元単位の content と不一致`);
        if (q.sourceRefs.length !== us.length) problems.push(`${q.id}: 出典の数が生成元単位と不一致`);
        us.forEach((u, i) => { if (q.sourceRefs[i]?.bookPage !== u.source.page) problems.push(`${q.id}: 出典ページが単位 ${u.id} と不一致`); });
        const profOf = (u) => parseProfile(u.content);
        const byName = new Map(profileEligible.map((u) => [parseProfile(u.content).name, u]));
        if (q.id.startsWith("qtf-")) {
          const key = q.id.startsWith("qtf-family-") ? "family" : "part";
          const label = key === "family" ? "科名" : "利用部位";
          const p = profOf(us[0]);
          const m = q.prompt.match(new RegExp(`^${p.name.replace(/[.*+?^${"{}"}()|[\]\\]/g, "\\$&")}の${label}は(.+)である。$`));
          if (!m) problems.push(`${q.id}: 問題文がテンプレートと不一致`);
          else if (q.correctBoolean === true) { if (m[1] !== p[key]) problems.push(`${q.id}: 真文の値がプロフィールの${label}と不一致`); }
          else if (q.correctBoolean === false) {
            if (!profilePool(key).includes(m[1])) problems.push(`${q.id}: 偽文の値「${m[1]}」が他の照合済みプロフィールの${label}に存在しない`);
            if (!valueUnrelated(p[key], m[1])) problems.push(`${q.id}: 偽文の値「${m[1]}」が正答と無関係でない（曖昧さガード違反）`);
            if (a1ExcludedFor(us[0].id, `profile-${key}`).has(m[1])) problems.push(`${q.id}: 偽文の値「${m[1]}」が監査A1除外リストに登録されている（DECISIONS #20）`);
          } else problems.push(`${q.id}: correctBoolean が設定されていない`);
        }
        if (q.id.startsWith("qmc-")) {
          const key = q.id.split("-")[1];
          const label = { family: "科名", part: "利用部位", origin: "原産地" }[key];
          const m = q.prompt.match(new RegExp(`^${label}が「(.+)」であるものをすべて選べ。$`));
          if (!m) problems.push(`${q.id}: 問題文がテンプレートと不一致`);
          else {
            const value = m[1];
            if ((q.choices ?? []).length !== 4) problems.push(`${q.id}: 選択肢が4つでない`);
            const norms = (q.choices ?? []).map(normalizeText);
            if (new Set(norms).size !== norms.length) problems.push(`${q.id}: 選択肢に正規化後の重複`);
            const expected = (q.choices ?? []).map((c, i) => { const u = byName.get(c); if (!u) { problems.push(`${q.id}: 選択肢「${c}」がプロフィール名称でない`); return -1; } return profOf(u)[key] === value ? i : -1; }).filter((i) => i >= 0);
            if (JSON.stringify([...(q.correctChoiceIndexes ?? [])].sort()) !== JSON.stringify(expected.sort())) problems.push(`${q.id}: 正解集合が属性値の完全一致と不一致`);
            if (expected.length !== 2) problems.push(`${q.id}: 正解が2件でない`);
            for (const c of q.choices ?? []) { const u = byName.get(c); if (u && profOf(u)[key] !== value && !valueUnrelated(value, profOf(u)[key])) problems.push(`${q.id}: 非該当候補「${c}」の属性値が対象値と無関係でない（曖昧さガード違反）`); }
          }
        }
        if (q.id.startsWith("qmatch-")) {
          const key = q.id.split("-")[1];
          const pairs = q.matchingPairs ?? [];
          if (pairs.length !== 4) problems.push(`${q.id}: ペアが4組でない`);
          if (new Set(pairs.map((x) => normalizeText(x.right))).size !== pairs.length) problems.push(`${q.id}: 属性値に重複がある`);
          for (const pr of pairs) { const u = byName.get(pr.left); if (!u) problems.push(`${q.id}: 名称「${pr.left}」がプロフィールに存在しない`); else if (profOf(u)[key] !== pr.right) problems.push(`${q.id}: ペア「${pr.left}→${pr.right}」がプロフィールの属性と不一致`); }
          // 監査A2の同種グループ除外（DECISIONS #25）
          for (let i = 0; i < us.length; i++) for (let j = i + 1; j < us.length; j++) if (a2CogroupConflict(key, us[i].id, us[j].id)) problems.push(`${q.id}: 単位ペア ${us[i].id} × ${us[j].id} が監査A2の同種グループ除外リストに登録されている（DECISIONS #25）`);
        }
        if (q.id.startsWith("qrev-")) {
          const p = profOf(us[0]);
          const base = q.prompt.match(/別名「(.+)」/)?.[1];
          if (!base) problems.push(`${q.id}: 問題文から別名を抽出できない`);
          else {
            if (!splitAliases(p.aliasesRaw).some((t) => aliasBase(t) === base)) problems.push(`${q.id}: 別名「${base}」が生成元プロフィールに存在しない`);
            if (aliasBaseCount.get(normalizeText(base)) !== 1) problems.push(`${q.id}: 別名「${base}」が全プロフィール中で一意でない（逆引きガード違反）`);
          }
          if (q.correctChoiceIndexes?.length !== 1 || q.choices?.[q.correctChoiceIndexes[0]] !== p.name) problems.push(`${q.id}: 正解が生成元プロフィールの名称でない`);
          for (const c of q.choices ?? []) if (!byName.has(c)) problems.push(`${q.id}: 選択肢「${c}」がプロフィール名称でない`);
        }
        if (q.id.startsWith("qtable-")) {
          const p = profOf(us[0]);
          if (JSON.stringify(q.table) !== JSON.stringify({ headers: ["項目", "内容"], rows: [["名称", p.name], ["科名", "（空欄A）"], ["利用部位", "（空欄B）"]] })) problems.push(`${q.id}: 表がテンプレートと不一致`);
          if (JSON.stringify(q.blankCellAnswers) !== JSON.stringify({ A: p.family, B: p.part })) problems.push(`${q.id}: 空欄の正答がプロフィールの属性と不一致`);
        }
        if (q.id.startsWith("qcomp-")) {
          const p = profOf(us[0]);
          if (q.modelAnswer !== `科名は${p.family}。利用部位は${p.part}。`) problems.push(`${q.id}: 模範解答がプロフィールの属性と不一致`);
          const rb = q.rubric ?? [];
          if (rb.length !== 2 || rb[0]?.keywords.join("") !== p.family || rb[1]?.keywords.join("") !== p.part || rb.some((r) => !r.required)) problems.push(`${q.id}: ルーブリックの要点がプロフィールの属性値と不一致`);
        }
        if (q.id.startsWith("qfig-")) {
          const rows = q.table?.rows ?? [];
          const expectedRows = us.map((u) => { const p = profOf(u); return [p.name, p.family, p.part]; });
          if (JSON.stringify(rows) !== JSON.stringify(expectedRows)) problems.push(`${q.id}: 表の行が生成元プロフィールの属性と不一致`);
          if (new Set(us.map((u) => profOf(u).family)).size !== us.length || new Set(us.map((u) => profOf(u).part)).size !== us.length) problems.push(`${q.id}: 表内で科名または利用部位が重複している`);
          const targetPart = q.prompt.match(/利用部位が「(.+)」である品目/)?.[1];
          const holders = us.filter((u) => profOf(u).part === targetPart);
          if (holders.length !== 1) problems.push(`${q.id}: 対象の利用部位を持つ品目が表内で一意でない`);
          else if (q.choices?.[q.correctChoiceIndexes?.[0] ?? -1] !== profOf(holders[0]).name) problems.push(`${q.id}: 正解が対象の利用部位を持つ品目でない`);
          // 監査A2の意味的一意性（DECISIONS #25）: 対象値の構成要素をすべて含む利用部位値は対象行だけであること
          if (targetPart) { const lt = partLexemes(targetPart); const semanticHolders = us.filter((u) => lexSubset(lt, partLexemes(profOf(u).part))); if (semanticHolders.length !== 1) problems.push(`${q.id}: 対象の利用部位「${targetPart}」の構成要素を含む品目が表内で一意でない（監査A2ガード違反）`); }
        }
      }
    }
  }
  for (const c of cs) {
    if (seenId.has(c.id)) problems.push(`${c.id}: ID重複`);
    seenId.add(c.id);
    const unit = unitById.get(c.knowledgeUnitIds[0]);
    if (!unit) { problems.push(`${c.id}: 生成元単位が存在しない`); continue; }
    if (!c.sourceRefs.length) problems.push(`${c.id}: 出典なし`);
    // FIX1: 種別（kind）の接頭辞整合（DECISIONS #34）
    const expectedKind = c.id.startsWith("card-term-") ? "term" : c.id.startsWith("card-rev-") ? "reverse" : c.id.startsWith("card-profile-") ? "profile" : "qa";
    if (c.kind !== expectedKind) problems.push(`${c.id}: kind が「${expectedKind}」でない`);
    if (c.id.startsWith("card-profile-")) {
      const p = parseProfile(unit.content);
      if (c.front !== `${p.name}のプロフィールは？`) problems.push(`${c.id}: 表がテンプレートと不一致`);
      if (c.back !== unit.content) problems.push(`${c.id}: 裏がプロフィール単位の content と不一致`);
    } else if (c.id.startsWith("card-term-")) {
      // FIX1 用語カード: 表=名称、裏=接頭辞を除いたプロフィール content、reverseOf は逆引きの有無と一致
      const p = parseProfile(unit.content);
      if (c.front !== p.name) problems.push(`${c.id}: 表がプロフィールの名称と不一致`);
      if (c.back !== unit.content.replace(/^.+?:\s/, "")) problems.push(`${c.id}: 裏がプロフィール content（接頭辞除き）と不一致`);
      const rev = cs.find((x) => x.id === `card-rev-${unit.id}`);
      if ((c.reverseOf ?? null) !== (rev ? rev.id : null)) problems.push(`${c.id}: reverseOf が逆引きカードの有無と不一致`);
    } else if (c.id.startsWith("card-rev-")) {
      // FIX1 逆引きカード: 表=選択規則どおりの名称非含有の事実、裏=名称、出典は [プロフィール, 事実]
      const p = parseProfile(unit.content);
      const factUnit = unitById.get(c.knowledgeUnitIds[1]);
      if (!factUnit) problems.push(`${c.id}: 逆引きの生成元事実単位が存在しない`);
      else {
        const expected = fix1ReverseFactFor(unit, p);
        if (!expected || expected.id !== factUnit.id) problems.push(`${c.id}: 逆引きの事実が選択規則（名称・別名基部を含まない最初の1件）と不一致`);
        if (c.front !== factUnit.content) problems.push(`${c.id}: 表が事実単位の content と不一致`);
        if (fix1ForbiddenFor(p).size && [...fix1ForbiddenFor(p)].some((v) => v && c.front.includes(v))) problems.push(`${c.id}: 表に名称・別名が含まれている`);
        if (c.sourceRefs.length !== 2 || c.sourceRefs[1].bookPage !== factUnit.source.page) problems.push(`${c.id}: 出典[1]が事実単位と不一致`);
      }
      if (c.back !== p.name) problems.push(`${c.id}: 裏がプロフィールの名称と不一致`);
      if (c.reverseOf !== `card-term-${unit.id}`) problems.push(`${c.id}: reverseOf が用語カードを指していない`);
    } else if (c.front !== unit.draftQa.q || c.back !== unit.draftQa.a) problems.push(`${c.id}: 表/裏が draftQa と不一致`);
  }
  return problems;
}
// ---- FIX1: 用語カード・逆引きカード（検証済みプロフィール／事実単位からのみ。DECISIONS #34）
// 用語カード: 表=名称、裏=プロフィール content から「名称: 」接頭辞を除いた検証済み要点（属性・別名・検定級・英名）。
// 逆引きカード: 表=その品目の検証済み spice-fact のうち名称・別名基部を含まない最初の1件（単位ID順）、裏=名称。
// 名称を含む事実しかない品目は表に答えが漏れるため作らず、fix1Skipped に記録する（除外集計には混ぜない）。
const fix1FactsBySpice = new Map();
for (const u of units) {
  if (u.kind !== "spice-fact" || u.status !== "verified" || !u.spice) continue;
  if (!fix1FactsBySpice.has(u.spice.id)) fix1FactsBySpice.set(u.spice.id, []);
  fix1FactsBySpice.get(u.spice.id).push(u);
}
for (const list of fix1FactsBySpice.values()) list.sort((a, b) => (a.id < b.id ? -1 : 1));
const fix1ForbiddenFor = (p) => {
  const forbidden = new Set([p.name, ...p.name.split("/").map((s) => s.trim())]);
  for (const tok of splitAliases(p.aliasesRaw)) { const b = aliasBase(tok); if (b) forbidden.add(b); }
  return forbidden;
};
const fix1ReverseFactFor = (unit, p) => {
  const forbidden = fix1ForbiddenFor(p);
  return (fix1FactsBySpice.get(unit.spice?.id) ?? []).find((f) => ![...forbidden].some((v) => v && f.content.includes(v))) ?? null;
};
for (const unit of profileEligible) {
  const p = parsedProfiles.get(unit.id);
  const sec = sectionForPage(unit.source.page);
  const { ref } = sourceRefFor(unit);
  // 用語カード
  report.attempted["flashcard"]++;
  const termCard = { id: `card-term-${unit.id}`, kind: "term", front: p.name, back: unit.content.replace(/^.+?:\s/, ""), reverseOf: null, chapterId: sec.chapterId, sectionId: sec.id, status: "verified", knowledgeUnitIds: [unit.id], sourceRefs: [ref] };
  cards.push(termCard);
  report.passed["flashcard"]++; report.fix1ByKind["term-card"]++;
  // 逆引きカード（名称・別名を含まない検証済み事実がある場合のみ）
  const cand = fix1ReverseFactFor(unit, p);
  if (!cand) { report.fix1Skipped.push({ kind: "reverse-card", unitId: unit.id, reason: "名称・別名基部を含まない検証済み事実がないため、表に答え（名称）が漏れる逆引きカードは作らない（DECISIONS #34）" }); continue; }
  report.attempted["flashcard"]++;
  const { ref: factRef } = sourceRefFor(cand);
  const revCard = { id: `card-rev-${unit.id}`, kind: "reverse", front: cand.content, back: p.name, reverseOf: termCard.id, chapterId: sec.chapterId, sectionId: sec.id, status: "verified", knowledgeUnitIds: [unit.id, cand.id], sourceRefs: [ref, factRef] };
  termCard.reverseOf = revCard.id;
  cards.push(revCard);
  report.passed["flashcard"]++; report.fix1ByKind["reverse-card"]++;
}

const problems = validateGenerated(questions, cards);
if (problems.length) {
  // 検証失敗は生成バグかデータ異常。落として続行せず、原因を報告して止める（握りつぶさない）。
  console.error("生成後検証で問題が検出されたため、正式問題を書き出しません:");
  for (const p of problems) console.error(" -", p);
  process.exit(1);
}

// ---- 章別に分割書き出し（1ファイル < 128KB を実測保証。超えれば連番分割）
const serialize = (arr) => JSON.stringify(arr, null, 1) + "\n";
const splitChunks = (arr) => {
  if (Buffer.byteLength(serialize(arr), "utf8") < MAX_FILE_BYTES || arr.length <= 1) return [arr];
  const mid = Math.ceil(arr.length / 2);
  return [...splitChunks(arr.slice(0, mid)), ...splitChunks(arr.slice(mid))];
};
const outDir = join(repoRoot, "src", "data", "questions");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const written = []; // { rel, ident, kind: "questions"|"cards", count, bytes }
const camel = (s) => s.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
function writeGrouped(items, prefix, kind) {
  const byChapter = new Map();
  for (const it of items) { if (!byChapter.has(it.chapterId)) byChapter.set(it.chapterId, []); byChapter.get(it.chapterId).push(it); }
  for (const ch of CHAPTERS.map((c) => c.id)) {
    const arr = byChapter.get(ch) ?? [];
    if (!arr.length) continue;
    splitChunks(arr).forEach((chunk, i, all) => {
      const suffix = all.length > 1 ? `-${i + 1}` : "";
      const rel = `${prefix}-${ch}${suffix}.json`;
      const body = serialize(chunk);
      const bytes = Buffer.byteLength(body, "utf8");
      if (bytes >= MAX_FILE_BYTES) throw new Error(`分割後もサイズ上限以上: ${rel} (${bytes} bytes)`);
      writeFileSync(join(outDir, rel), body);
      written.push({ rel, ident: camel(`${prefix}-${ch}${suffix}`), kind, count: chunk.length, bytes });
    });
  }
}
writeGrouped(questions, "formal", "questions");
writeGrouped(cards, "cards", "cards");

const byFormat = {};
for (const q of questions) byFormat[q.format] = (byFormat[q.format] ?? 0) + 1;
const meta = {
  generatedBy: "scripts/generate-questions.mjs",
  sourceUnitsTotal: units.length,
  eligibleUnits: eligible.length,
  profileEligibleUnits: profileEligible.length,
  q3Units: proseUnits.length,
  q3Questions: report.q3Questions,
  f1ByKind: report.f1ByKind,
  f1Questions: Object.values(report.f1ByKind).reduce((s, v) => s + v, 0),
  f1SkippedItems: report.f1Skipped.length,
  f2ByKind: report.f2ByKind,
  f2Questions: Object.values(report.f2ByKind).reduce((s, v) => s + v, 0),
  f2SkippedItems: report.f2Skipped.length,
  f3ByKind: report.f3ByKind,
  f3Questions: Object.values(report.f3ByKind).reduce((s, v) => s + v, 0),
  f3SkippedItems: report.f3Skipped.length,
  q2ByKind: report.q2ByKind,
  q2Questions: Object.entries(report.q2ByKind).filter(([k]) => k !== "profile-card").reduce((s, [, v]) => s + v, 0),
  formalQuestions: questions.length,
  byFormat,
  d1ByDifficulty: d1Report.byDifficulty,
  d1CalibratedByDifficulty: d1Report.calibratedByDifficulty,
  d1CalibratedQuestions: questions.length - d1Report.heldIds.length,
  d1HeldQuestions: d1Report.heldIds.length,
  d1HeldIds: d1Report.heldIds,
  formalCards: cards.length,
  aliasExpandedQuestions: report.aliasExpansions.length,
  fix1ByKind: report.fix1ByKind,
  fix1Cards: report.fix1ByKind["term-card"] + report.fix1ByKind["reverse-card"],
  fix1SkippedItems: report.fix1Skipped.length,
  excludedItems: report.excluded.filter((e) => e.kind !== "all").length,
  excludedUnits: report.excluded.filter((e) => e.kind === "all").length,
  files: written.map((w) => w.rel),
};
const qImports = written.filter((w) => w.kind === "questions");
const cImports = written.filter((w) => w.kind === "cards");
const header = `/**
 * 生成物（薄い集約モジュール） — 手で編集しないこと。再生成: node scripts/generate-questions.mjs
 * 正式問題・正式カードの生成物。生成元は原文照合済み（verified）知識単位のみ:
 * draftQa の直接変換（第一弾）と、プロフィール単位の構造化属性からの生成（拡充Q2、DECISIONS #18）、
 * 散文単位の転記支持文に基づく人手作成一問一答（拡充Q3、DECISIONS #19）、
 * プロフィール属性から機械検証できる追加7形式の生成（拡充F1、DECISIONS #21）、
 * 転記本文の番号付き手順・支持文に基づく人手作成の並べ替え・短文記述（追加形式F2、DECISIONS #26）、
 * 転記本文の複数段落の支持文・明示的な対比に基づく人手作成の長文記述・比較記述（追加形式F3、DECISIONS #27）、
 * プロフィール単位からの用語カードと、名称を含まない検証済み事実からの逆引きカード（修正バッチFIX1、DECISIONS #34）。
 * 難易度は較正D1（DECISIONS #22）で、出題範囲の階層と形式負荷に基づく相対指標として付与する
 * （実際の受験者の正答率ではない。較正できない問題は2に据え置き、メタの d1HeldIds に記録）。
 * データ本体は src/data/questions/ 配下の章別分割JSON（全ファイル128KB未満）。
 */
import type { Question, Flashcard } from "../domain/types";
${written.map((w) => `import ${w.ident} from "./questions/${w.rel}";`).join("\n")}
export const QUESTION_GENERATION_META = ${JSON.stringify(meta, null, 2)} as const;
export const FORMAL_QUESTIONS: Question[] = [
${qImports.map((w) => `  ...(${w.ident} as unknown as Question[]),`).join("\n")}
];
export const FORMAL_CARDS: Flashcard[] = [
${cImports.map((w) => `  ...(${w.ident} as unknown as Flashcard[]),`).join("\n")}
];
`;
writeFileSync(join(repoRoot, "src", "data", "formal-questions.ts"), header);
writeFileSync(join(repoRoot, "scripts", "question-generation-report.json"), JSON.stringify({ meta, attempted: report.attempted, passed: report.passed, q2ByKind: report.q2ByKind, f1ByKind: report.f1ByKind, f1Skipped: report.f1Skipped, f2ByKind: report.f2ByKind, f2Skipped: report.f2Skipped, f3ByKind: report.f3ByKind, f3Skipped: report.f3Skipped, q3Questions: report.q3Questions, fix1ByKind: report.fix1ByKind, fix1Skipped: report.fix1Skipped, aliasExpansions: report.aliasExpansions, promptEchoRemovals: report.promptEchoRemovals, d1: d1Report, excluded: report.excluded }, null, 2) + "\n");

for (const w of written) console.log(`  ${w.rel}: ${w.count}件 / ${w.bytes} bytes`);
console.log(`生成完了: 正式問題 ${questions.length}問（one-answer ${byFormat["one-answer"] ?? 0} / single-choice ${byFormat["single-choice"] ?? 0} / fill-blank ${byFormat["fill-blank"] ?? 0} / term-input ${byFormat["term-input"] ?? 0} / true-false ${byFormat["true-false"] ?? 0} / multiple-choice ${byFormat["multiple-choice"] ?? 0} / matching ${byFormat["matching"] ?? 0} / reverse-lookup ${byFormat["reverse-lookup"] ?? 0} / table-fill ${byFormat["table-fill"] ?? 0} / composite ${byFormat["composite"] ?? 0} / figure ${byFormat["figure"] ?? 0} / ordering ${byFormat["ordering"] ?? 0} / short-essay ${byFormat["short-essay"] ?? 0} / long-essay ${byFormat["long-essay"] ?? 0} / compare-essay ${byFormat["compare-essay"] ?? 0}）、正式カード ${cards.length}件。Q2内訳: ${JSON.stringify(report.q2ByKind)}、Q3一問一答: ${report.q3Questions}問、F1内訳: ${JSON.stringify(report.f1ByKind)}、F1スキップ: ${report.f1Skipped.length}件、F2内訳: ${JSON.stringify(report.f2ByKind)}、F2スキップ: ${report.f2Skipped.length}件、F3内訳: ${JSON.stringify(report.f3ByKind)}、F3スキップ: ${report.f3Skipped.length}件、除外（項目）${meta.excludedItems}件・除外（単位）${meta.excludedUnits}件。FIX1内訳: ${JSON.stringify(report.fix1ByKind)}、FIX1スキップ: ${report.fix1Skipped.length}件。難易度較正D1: 分布 ${JSON.stringify(d1Report.byDifficulty)}（うち較正済み ${questions.length - d1Report.heldIds.length}問、据え置き ${d1Report.heldIds.length}問）。詳細は scripts/question-generation-report.json`);
