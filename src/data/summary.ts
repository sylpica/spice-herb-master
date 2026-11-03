/**
 * 軽量サマリ（初期表示専用） — バンドル分割バッチE1（docs/DECISIONS.md #23）。
 *
 * ホーム画面と模試画面は「件数」しか必要としないのに、従来は QUESTIONS /
 * IMPORTED_KNOWLEDGE_UNITS / TRANSCRIPT_PAGES 等の全データを静的 import して
 * いたため、初期チャンクに全データが含まれていた。本モジュールは件数だけを
 * 定数として切り出し、初期表示が重いデータモジュールに依存しないようにする。
 *
 * 値は実データからの転記であり、tests/summary.test.ts が実データ
 * （src/data/questions.ts / knowledge.ts / transcripts.ts / source-manifest.json）
 * との一致を固定する。データが変わったらテストが失敗するので、ここだけを
 * 先に直すことはできない。
 */
export const APP_DATA_SUMMARY = {
  /** 正式問題数（QUESTIONS.length） */
  formalQuestions: 1795,
  /** 正式カード数（CARDS.length） */
  formalCards: 602,
  /** 取り込み済み知識単位数（IMPORTED_KNOWLEDGE_UNITS.length） */
  importedKnowledgeUnits: 545,
  /** うち原文照合済み（status="verified"） */
  verifiedImportedKnowledgeUnits: 545,
  /** うち未検証（status="unverified"） */
  unverifiedImportedKnowledgeUnits: 0,
  /** 一問一答ドラフト付き取り込み単位数（KNOWLEDGE_IMPORT_META.draftQaTotal） */
  draftQaTotal: 379,
  /** 取り込み元（KNOWLEDGE_IMPORT_META.origin） */
  knowledgeImportOrigin: "claude/build-learning-app",
  /** 本文転記ベースの検証済み知識単位数（KNOWLEDGE_UNITS.length。現状0件） */
  verifiedKnowledgeUnits: 0,
  /** 全文転記済みページ数（重複を除いたページ数。レコード数は同ページ開始の節で分割されるため一致しないことがある） */
  transcribedPages: 140,
  /** 取り込み済み原本画像数（source-manifest の totalPresent） */
  presentImages: 139,
  /** 欠落画像数（source-manifest の totalMissing。IMG_9647.PNG） */
  missingImages: 1,
} as const;
