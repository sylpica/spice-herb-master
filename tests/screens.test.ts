// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { defaultStore, type StoreData } from "../src/domain/store";
import Home from "../src/screens/Home";
import Practice from "../src/screens/Practice";
import Reader from "../src/screens/Reader";
import Cards from "../src/screens/Cards";
import Exam from "../src/screens/Exam";
import Stats from "../src/screens/Stats";
import SearchPage from "../src/screens/SearchPage";
import QaPage from "../src/screens/QaPage";
import Settings from "../src/screens/Settings";
import Memorize from "../src/screens/Memorize";

// バンドル分割バッチE1（docs/DECISIONS.md #23）: 画面を src/screens/ へ分割し
// React.lazy 化した後も、8画面すべてが従来どおり描画できることを固定する。
// （データ・ドメインの正しさは他のテストファイルが担い、ここは画面の生存確認）
const store: StoreData = structuredClone(defaultStore);
const update = () => {};
const render = (el: React.ReactElement) => renderToString(createElement(MemoryRouter, null, el));

describe("画面スモーク（E1: 分割後の画面。UX2で設定、UX5で暗記モードを追加し10画面）", () => {
  it("ホーム: 件数表示が軽量サマリ経由で描画される", () => {
    const html = render(createElement(Home, { store, update }));
    expect(html).toContain("スパイス＆ハーブ検定1級 学習アプリ");
    expect(html).toContain("1795"); // 正式問題数
    expect(html).toContain("545"); // 取り込み済み知識単位数
    expect(html).toContain("140"); // 転記済みページ数
  });
  it("演習: 正式問題が QuestionRunner で描画され、前の問題ボタンがある（サンプルは全削除済み、#52）", () => {
    const html = render(createElement(Practice, { store, update }));
    expect(html).toContain("演習");
    expect(html).toContain("verified");
    expect(html).toContain("前の問題へ");
    expect(html).not.toContain("サンプル（通常出題対象外）");
  });
  it("リーダー: 目次と転記本文が描画される", () => {
    const html = render(createElement(Reader, { store, update }));
    expect(html).toContain("電子書籍リーダー");
    expect(html).toContain("目次");
    // E2: 目次の節ボタンが描画されること（ID一致への修正の回帰固定。
    // SSR 文字列では React のコメントマーカーが挟まるためボタン開始部で固定する）
    expect(html).toContain('<button class="ghost">日本における歴史');
  });
  it("カード: 正式カードが描画される", () => {
    const html = render(createElement(Cards, { store, update }));
    expect(html).toContain("フラッシュカード・単語帳");
    expect(html).toContain("正式カード");
    // C1（DECISIONS #32）: 自己評価UIの土台として、未評価の状態表示と評価方法の案内が出る
    // （評価ボタン自体は裏面表示後にのみ出るため SSR では描画されない）
    expect(html).toContain("このカードの状態: 未評価");
    // UX10: ボタンはカードの真下にあり、表面でも「裏面を表示」「次のカード」が出る
    expect(html).toContain("裏面を表示すると自己評価を記録できます");
    expect(html).toContain("裏面を表示");
    expect(html).toContain("次のカード");
  });
  it("模試: 出題候補数がサマリ経由で描画される", () => {
    const html = render(createElement(Exam, { store, update }));
    expect(html).toContain("模擬試験");
    expect(html).toContain("1795");
  });
  it("分析: 網羅率の5指標が描画される", () => {
    const html = render(createElement(Stats, { store }));
    expect(html).toContain("学習分析・可視化");
    expect(html).toContain("網羅率");
  });
  it("検索: 節と問題の件数が描画される", () => {
    const html = render(createElement(SearchPage));
    expect(html).toContain("横断検索");
    expect(html).toContain("問題");
    // S1（DECISIONS #31）: 複合フィルタの4条件（対象・章・形式・難易度）と合計件数
    expect(html).toContain("絞り込み条件");
    expect(html).toContain("検索対象");
    expect(html).toContain("検索結果 合計");
    // SSR では数値と「件」の間に React のコメントマーカーが挟まるため数値で固定する
    expect(html).toContain("1876");
  });
  it("品質管理: 検証集計が描画される", () => {
    const html = render(createElement(QaPage));
    expect(html).toContain("品質管理（管理・監査）");
    expect(html).toContain("取り込み済み知識単位");
  });
  it("設定: ダークモード切替と分析・品質管理への導線が描画される（UX2）", () => {
    const html = render(createElement(Settings, { store, update }));
    expect(html).toContain("設定");
    expect(html).toContain("ダークモード切替");
    expect(html).toContain("学習分析を開く");
    expect(html).toContain("品質管理を開く");
    expect(html).toContain("学習記録をリセット");
  });
  it("ホーム: 暗記モードへの入口が描画される（UX5）", () => {
    const html = render(createElement(Home, { store, update }));
    expect(html).toContain("全種類を覚える（暗記モード）");
    expect(html).toContain("暗記を始める");
  });
  it("暗記モード: 全80種のデッキと答え合わせボタンが描画される（UX5）", () => {
    const html = render(createElement(Memorize, { store, update }));
    // SSR では数値の前後に React のコメントマーカーが挟まるため、静的文言と数値を分けて固定する
    expect(html).toContain("暗記モード（全");
    expect(html).toContain("80");
    expect(html).toContain("プロフィールを表示（答え合わせ）");
    expect(html).toContain("評価済み（累計）");
    expect(html).toContain("最初から回し直す");
    // UX10: 答え合わせなしで進めるボタンと、逆モードの切替が出る（ラベルは「次へ」のみ、2026-10-31是正）
    expect(html).toContain("次へ</button>");
    expect(html).toContain("プロフィール → 名前（逆）");
  });
  it("リーダー: 世界のドリンクは自節の転記本文が表示される（UX4）", () => {
    const s2: StoreData = structuredClone(defaultStore);
    s2.reader.sectionId = "world-drink";
    const html = render(createElement(Reader, { store: s2, update }));
    expect(html).toContain("スパイスやハーブの香りが決め手の各国のドリンク");
    expect(html).not.toContain("この節の本文はまだ転記されていません");
  });
  it("リーダー: 索引節は本書の索引の転記と生成索引が併記される（UX4→T18）", () => {
    const s3: StoreData = structuredClone(defaultStore);
    s3.reader.sectionId = "index";
    const html = render(createElement(Reader, { store: s3, update }));
    // 本書の索引そのものの転記（T18、ユーザー提供の撮影画像から）
    expect(html).toContain("麻の実");
    expect(html).toContain("14・52・59・67・69・72");
    // 生成索引もナビゲーションとして併記される
    expect(html).toContain("アプリ収録データからの索引（ページへ移動できます）");
    expect(html).toContain("アニス");
    expect(html).not.toContain("この節の本文はまだ転記されていません");
    expect(html).not.toContain("転記できません");
  });
});
