// 独立再集計（2026-11-11 監査、DECISIONS #55）。
// アプリの TypeScript・既存テスト・生成メタ・scripts/independent-recount.py を使わず、
// 元の JSON とファイル実体だけを数える。実行: node scripts/independent-recount-2.mjs
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
const J = (p) => JSON.parse(readFileSync(p, "utf8"));
const dirQ = "src/data/questions/";
const questions = [], cards = [];
for (const f of readdirSync(dirQ).sort()) (f.startsWith("formal") ? questions : cards).push(...J(dirQ + f));
const tally = (xs, key) => { const m = {}; for (const x of xs) { const k = key(x); m[k] = (m[k] ?? 0) + 1; } return m; };
const units = [];
for (const sub of ["spices", "units"]) for (const f of readdirSync(`src/data/knowledge/${sub}`).sort()) { const d = J(`src/data/knowledge/${sub}/${f}`); units.push(...(Array.isArray(d) ? d : d.units ?? d.items ?? Object.values(d).flat())); }
const transcripts = [];
for (const f of readdirSync("src/data/transcripts").sort()) { const d = J("src/data/transcripts/" + f); transcripts.push(...(Array.isArray(d) ? d : d.pages)); }
let chars = 0;
for (const p of transcripts) for (const b of p.blocks ?? []) { chars += (b.text ?? "").length + (b.title ?? "").length + (b.caption ?? "").length; for (const r of b.rows ?? []) for (const c of r) chars += String(c).length; }
const essay = ["short-essay", "long-essay", "compare-essay", "composite"];
const imgs = readdirSync("public/pages-b64").filter((f) => f.endsWith(".b64"));
const hashes = new Set(); let badWebp = 0, widthNot1000 = 0;
for (const f of imgs) { const buf = Buffer.from(readFileSync("public/pages-b64/" + f, "utf8"), "base64"); hashes.add(createHash("sha256").update(buf).digest("hex")); if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") badWebp++; else { const t = buf.toString("ascii", 12, 16); let w = null; if (t === "VP8 ") w = buf.readUInt16LE(26) & 0x3fff; else if (t === "VP8L") w = (buf.readUInt32LE(21) & 0x3fff) + 1; else if (t === "VP8X") w = buf.readUIntLE(24, 3) + 1; if (w !== 1000) widthNot1000++; } }
const nums = imgs.map((f) => Number(f.match(/IMG_(\d+)/)[1])).sort((a, b) => a - b);
const missing = []; for (let n = nums[0]; n <= nums[nums.length - 1]; n++) if (!nums.includes(n)) missing.push(n);
const pageImages = J("src/data/page-images.json");
const ruleViolations = pageImages.filter((e) => e.bookPage != null && Number(e.imageId.slice(4)) !== e.bookPage + (e.bookPage <= 71 ? 9575 : 9576)).map((e) => e.imageId);
const structure = readFileSync("src/data/structure.ts", "utf8");
const sectionCount = (structure.match(/bookPage:\s*\d+/g) ?? []).length;
const unitIds = new Set(units.map((u) => u.id));
const single = questions.filter((q) => q.format === "single-choice");
const out = {
  questions: questions.length, duplicateQuestionIds: questions.length - new Set(questions.map((q) => q.id)).size,
  formats: tally(questions, (q) => q.format), formatKinds: Object.keys(tally(questions, (q) => q.format)).length,
  difficulty: tally(questions, (q) => q.difficulty), byChapter: tally(questions, (q) => q.chapterId),
  statusQ: tally(questions, (q) => q.status), essayWithRubricAndModel: questions.filter((q) => ["short-essay", "long-essay", "compare-essay"].includes(q.format) && q.rubric?.length && q.modelAnswer).length,
  examPool: questions.filter((q) => q.status === "verified" && !essay.includes(q.format)).length, examExcluded: questions.filter((q) => essay.includes(q.format)).length,
  singleChoice: single.length, singleNot4: single.filter((q) => q.choices.length !== 4).length, singleDupChoices: single.filter((q) => new Set(q.choices).size !== q.choices.length).length, singleBadAnswer: single.filter((q) => q.correctChoiceIndexes?.length !== 1 || !(q.correctChoiceIndexes[0] in q.choices)).length,
  noSource: questions.filter((q) => !q.sourceRefs?.length).length, noExplanation: questions.filter((q) => !q.explanation?.trim()).length, brokenUnitRefs: questions.filter((q) => q.knowledgeUnitIds.some((id) => !unitIds.has(id))).length,
  cards: cards.length, cardKinds: tally(cards, (c) => c.kind ?? "?"), duplicateCardIds: cards.length - new Set(cards.map((c) => c.id)).size, cardStatus: tally(cards, (c) => c.status),
  units: units.length, unitStatus: tally(units, (u) => u.status), unitBatches: Object.keys(tally(units, (u) => u.collation?.batch ?? "none")).length, longpepperBatch: units.find((u) => u.id === "longpepper-profile")?.collation?.batch,
  unitsWithoutQuestion: units.filter((u) => !questions.some((q) => q.knowledgeUnitIds.includes(u.id))).length,
  sampleLike: questions.filter((q) => /sample/i.test(q.id) || q.status === "sample").length + cards.filter((c) => /sample/i.test(c.id) || c.status === "sample").length,
  transcriptRecords: transcripts.length, transcriptPages: new Set(transcripts.map((p) => p.bookPage)).size, transcriptChars: chars,
  images: imgs.length, imageUniqueHashes: hashes.size, badWebp, widthNot1000, missingImageNumbers: missing, pageRuleViolations: ruleViolations, pageImagesManifest: pageImages.length,
  sections: sectionCount, searchTotal: sectionCount + questions.length,
};
console.log(JSON.stringify(out, null, 1));
