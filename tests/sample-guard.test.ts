// サンプルデータ再混入の回帰ガード（DECISIONS #52、監査AU-10 / #54）。
// 正式データ（問題・カード）にも、検索・演習・模試・暗記・単語帳が参照する供給元にも、
// エンジン検証用サンプルが1件も存在しないことを、生成物のJSONとソースの両面から固定する。
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { QUESTIONS, CARDS } from "../src/data/questions";
import { examPool } from "../src/domain/exam";
import { selectForPractice } from "../src/domain/validate";
import { availableSearchStatuses } from "../src/domain/search";

const root = join(__dirname, "..");
const SAMPLE_ID = /^(s-|sample|q-sample|card-sample|demo)/i;

describe("サンプルデータ 0件の回帰ガード", () => {
  it("サンプル問題0件・サンプルカード0件（状態・ID の両面）", () => {
    const sampleQ = QUESTIONS.filter((q) => (q.status as string) === "sample" || SAMPLE_ID.test(q.id));
    const sampleC = CARDS.filter((c) => (c.status as string) === "sample" || SAMPLE_ID.test(c.id));
    expect(sampleQ).toHaveLength(0);
    expect(sampleC).toHaveLength(0);
    expect(QUESTIONS.length).toBeGreaterThan(1000); // 空集合で成功しないこと
    expect(CARDS.length).toBeGreaterThan(500);
  });
  it("生成物のJSONに sample 状態が存在しない", () => {
    const dir = join(root, "src", "data", "questions");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) expect(readFileSync(join(dir, f), "utf8"), f).not.toMatch(/"status":\s*"sample"/);
  });
  it("演習・模試・検索の各プールにサンプルが入らず、検索の状態選択肢は正式のみ", () => {
    expect(selectForPractice(QUESTIONS).length).toBe(QUESTIONS.length);
    expect(examPool(QUESTIONS).every((q) => q.status === "verified")).toBe(true);
    expect(availableSearchStatuses(QUESTIONS)).toEqual(["verified"]);
    const searchSrc = readFileSync(join(root, "src", "screens", "SearchPage.tsx"), "utf8");
    expect(searchSrc).not.toContain('"サンプル"');
  });
  it("サンプルの供給元（SAMPLE_QUESTIONS / SAMPLE_CARDS）がソースに残っていない", () => {
    const src = readFileSync(join(root, "src", "data", "questions.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(src).not.toMatch(/SAMPLE_(QUESTIONS|CARDS)/);
  });
});
