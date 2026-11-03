// 画面コンポーネント（ユーザー要望対応バッチUX2、docs/DECISIONS.md #36）
// 設定画面: 上部メニューを slim に保つため、表示設定（ダークモード）と
// 学習分析・品質管理への導線、学習記録のリセットをここに集約した。
import { Link } from "react-router";
import { resetStoreData, type StoreData } from "../domain/store";

export default function Settings({ store, update }: { store: StoreData; update: any }) {
  return (
    <main>
      <h1>設定</h1>
      <section className="card">
        <h2>表示</h2>
        <p>ダークモード: {store.reader.dark ? "オン" : "オフ"}（全画面共通）</p>
        <p>
          <button
            type="button"
            aria-pressed={store.reader.dark}
            onClick={() => update((d: StoreData) => { d.reader.dark = !d.reader.dark; return d; })}
          >
            ダークモード切替
          </button>
        </p>
      </section>
      <section className="card">
        <h2>演習</h2>
        <p>
          <label style={{ display: "inline-flex", alignItems: "center", gap: ".5rem", minHeight: 44 }}>
            <input
              type="checkbox"
              style={{ width: "auto" }}
              checked={store.autoAdvance}
              onChange={(e) => update((d: StoreData) => { d.autoAdvance = e.target.checked; return d; })}
            />
            正解したら自動で次の問題へ進む
          </label>
        </p>
      </section>
      <section className="card">
        <h2>学習の記録を見る</h2>
        <p>
          <Link className="btn" to="/stats">学習分析を開く</Link>{" "}
          <Link className="btn" to="/qa">品質管理を開く</Link>
        </p>
        <p className="muted">学習分析は正答率・網羅率などの集計、品質管理は教材データの検証集計です。</p>
      </section>
      <section className="card">
        <h2>データ</h2>
        <p className="muted">学習履歴はこのブラウザ内（localStorage）にのみ保存されています。リセットすると解答記録・復習予定・読書位置などがすべて消え、元に戻せません。</p>
        <p>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              if (window.confirm("学習記録をすべて消去して初期状態に戻します。よろしいですか？")) {
                resetStoreData();
                location.reload();
              }
            }}
          >
            学習記録をリセット
          </button>
        </p>
      </section>
    </main>
  );
}
