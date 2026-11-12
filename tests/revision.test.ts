// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { defaultStore, type StoreData } from "../src/domain/store";
import { ALL_SECTIONS } from "../src/data/structure";
import Revision, { sectionIdForBookPage } from "../src/screens/Revision";
import Home from "../src/screens/Home";
import {
  REVISION_AREAS,
  REVISION_BROAD,
  REVISION_ENTRIES,
  REVISION_EXAM_SCOPE,
  REVISION_LEVEL1_ADDED,
  REVISION_LEVEL1_REMOVED,
  REVISION_RENAMED,
} from "../src/data/revision";

// 改訂ポイント（docs/DECISIONS.md #42）: 出典は財団の公式資料（2026年3月）。
// ここではデータの整合性（ID・分野・ページ→節の解決）と画面の生存を固定する。
// 記載内容そのものの正しさは資料との照合による（データファイルの冒頭コメント参照）。

const store: StoreData = structuredClone(defaultStore);
const update = () => {};
const render = (el: React.ReactElement) =>
  renderToString(createElement(MemoryRouter, null, el));

describe("改訂ポイントのデータ（UX7）", () => {
  it("変更箇所は36件で、IDに重複がなく、分野は定義済みの4区分のみ", () => {
    expect(REVISION_ENTRIES.length).toBe(36);
    expect(new Set(REVISION_ENTRIES.map((e) => e.id)).size).toBe(36);
    for (const e of REVISION_ENTRIES) {
      expect(REVISION_AREAS).toContain(e.area);
      expect(e.item.length).toBeGreaterThan(0);
      expect(e.change.length).toBeGreaterThan(0);
    }
  });

  it("各項目の4訂版該当ページは本の範囲内で、そのページを含む節に解決できる", () => {
    const byId = new Map(ALL_SECTIONS.map((s) => [s.id, s]));
    for (const e of REVISION_ENTRIES) {
      expect(e.bookPage, e.id).toBeGreaterThanOrEqual(6);
      expect(e.bookPage, e.id).toBeLessThanOrEqual(147);
      const sec = byId.get(sectionIdForBookPage(e.bookPage!))!;
      expect(sec, e.id).toBeDefined();
      expect(sec.bookPage, e.id).toBeLessThanOrEqual(e.bookPage!);
      // 次の節の開始ページより前であること（＝その節の範囲にページが入る）
      const idx = ALL_SECTIONS.findIndex((s) => s.id === sec.id);
      const next = ALL_SECTIONS[idx + 1];
      if (next) expect(next.bookPage, e.id).toBeGreaterThan(e.bookPage!);
    }
    for (const b of REVISION_BROAD) {
      expect(b.bookPage).toBeGreaterThanOrEqual(128);
      expect(b.bookPage).toBeLessThanOrEqual(135);
    }
  });

  it("1級対象の変更（追加2・削除2・名称変更1）が資料どおりに固定されている", () => {
    expect(REVISION_LEVEL1_ADDED.map((x) => x.name)).toEqual([
      "ジュニパーベリー",
      "レモンバーム",
    ]);
    expect(REVISION_LEVEL1_REMOVED.map((x) => x.name)).toEqual([
      "麻の実",
      "サッサフラス",
    ]);
    expect(REVISION_RENAMED).toEqual([
      { from: "ニオイアダン", to: "パンダンリーフ", bookPage: 105 },
    ]);
    // 追加2品目と名称変更は変更箇所一覧にも載っている
    for (const page of [102, 105, 106]) {
      expect(REVISION_ENTRIES.some((e) => e.bookPage === page)).toBe(true);
    }
    expect(REVISION_LEVEL1_ADDED[0]).toMatchObject({ name: "ジュニパーベリー", bookPage: 102 });
  });

  it("第3回監査の是正: 資料PDFのテキスト抽出と本書転記で照合した個別事実", () => {
    const byId = new Map(REVISION_ENTRIES.map((e) => [e.id, e]));
    // カリカットは旧版「現在のコーチン」→ 4訂版「現・コーリコード」（方向の逆転を是正。
    // 現代表記は財団PDFの「コーリーコード」ではなく、本書 p.8 の印刷（原本画像 IMG_9583 で
    // 再照合）に合わせる。docs/DECISIONS.md #52）
    expect(byId.get("rv-calicut")!.change).toBe(
      "「カリカット（現在のコーチン）」→「カリカット（現・コーリコード）」",
    );
    // 該当ページは本書での品目ページ（転記で実在確認済み）
    expect(byId.get("rv-thyme")!.bookPage).toBe(71);
    expect(byId.get("rv-chili")!.bookPage).toBe(76);
    expect(byId.get("rv-nutmeg")!.bookPage).toBe(78);
    expect(byId.get("rv-parsley")!.bookPage).toBe(80);
    expect(byId.get("rv-juniper")!.bookPage).toBe(102);
    expect(byId.get("rv-celery")!.bookPage).toBe(103);
    // 利用部位の変更はコリアンダーのもの（スターアニスへの混入を是正）
    expect(byId.get("rv-coriander")!.change).toContain("葉、茎、種子（植物学上は果実）、根");
    expect(byId.get("rv-staranise")!.change).not.toContain("茎");
    // セロリーの利用部位はジュニパーベリーに混入させない
    expect(byId.get("rv-juniper")!.change).not.toContain("利用部位");
    expect(byId.get("rv-celery")!.change).toContain("種子（植物学上は果実）");
    // 全面見直しの開始ページ（本書の節開始ページで照合）
    expect(REVISION_BROAD.map((b) => b.bookPage)).toEqual([128, 129, 130, 131, 132, 134]);
  });

  it("試験への対応は第17回=両版・第18回以降=4訂版のみ", () => {
    expect(REVISION_EXAM_SCOPE.length).toBe(2);
    expect(REVISION_EXAM_SCOPE[0]!.round).toContain("第17回");
    expect(REVISION_EXAM_SCOPE[1]!.round).toContain("第18回以降");
    expect(REVISION_EXAM_SCOPE[1]!.scope).toContain("4訂版");
  });

  it("ページ→節の解決が代表ページで正しい", () => {
    expect(sectionIdForBookPage(8)).toBe("history-world");
    expect(sectionIdForBookPage(53)).toBe("item-allspice");
    expect(sectionIdForBookPage(103)).toBe("item-others");
    expect(sectionIdForBookPage(145)).toBe("index");
  });
});

describe("改訂ポイント画面（UX7）", () => {
  it("試験対応・1級対象の変更・変更箇所・出典が描画される", () => {
    const html = render(createElement(Revision, { store, update }));
    expect(html).toContain("改訂ポイント（4訂版）");
    expect(html).toContain("第18回以降（2027年〜）");
    expect(html).toContain("ジュニパーベリー");
    expect(html).toContain("サッサフラス");
    expect(html).toContain("パンダンリーフ");
    expect(html).toContain("古代ギリシア語で『喜びの山』");
    expect(html).toContain("山崎香辛料振興財団");
    expect(html).toContain("資料PDF（公式サイト）");
  });

  it("ホームに改訂ポイントの入口カードがある（入口はホームのカードと上部バーの「改訂」）", () => {
    const html = render(createElement(Home, { store, update }));
    expect(html).toContain("改訂ポイント");
    expect(html).toContain("/revision");
  });
});
