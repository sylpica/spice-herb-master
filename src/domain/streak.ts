import type { AnswerRecord } from "./types";
import { dateKeyOfIso, localDateKey } from "./dates";

/**
 * 継続学習の指標（R29、DECISIONS #55）。解答記録だけから求める純粋関数。
 * 連続学習日数は「今日（まだ解いていなければ昨日）から遡って、解答が1件以上ある日が
 * 途切れずに続いた日数」。今日まだ解いていなくても、昨日まで続いていれば途切れた扱いにしない。
 */
export function studyDayKeys(records: readonly AnswerRecord[]): Set<string> {
  return new Set(records.map((r) => dateKeyOfIso(r.answeredAt)));
}

export function studyStreak(records: readonly AnswerRecord[], now = new Date()): number {
  const days = studyDayKeys(records);
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!days.has(localDateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let n = 0;
  while (days.has(localDateKey(cursor))) { n++; cursor.setDate(cursor.getDate() - 1); }
  return n;
}

export interface PeriodReport { days: number; answered: number; correct: number; accuracy: number | null; activeDays: number; }

/** 直近 days 日間（今日を含む）の解答数・正答率・学習した日数。 */
export function periodReport(records: readonly AnswerRecord[], days: number, now = new Date()): PeriodReport {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  from.setDate(from.getDate() - (days - 1));
  const inRange = records.filter((r) => { const t = new Date(r.answeredAt); return t >= from && t <= now; });
  const correct = inRange.filter((r) => r.correct === true).length;
  return { days, answered: inRange.length, correct, accuracy: inRange.length ? correct / inRange.length : null, activeDays: studyDayKeys(inRange).size };
}
