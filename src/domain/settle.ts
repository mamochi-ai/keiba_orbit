// Payout from an official result received as data. Only 単勝 and ワイド, per 100 yen, using the
// payouts in the result itself (never odds). The user confirms before anything is recorded.
import type { FeedResult } from './feed';
import type { AnalysisResponse, RaceSnapshot } from './schema';

export interface SettleLine {
  betIndex: number;
  label: string;
  amount: number;
  payout: number;
}

export type SettleResult =
  | { ok: true; payout: number; hits: SettleLine[]; spent: number }
  | { ok: false; reason: string };

export function settleFromResult(snapshot: RaceSnapshot, response: AnalysisResponse, result: FeedResult): SettleResult {
  if (!result.payouts) return { ok: false, reason: '払戻金のデータがまだありません。' };
  const numberOf = new Map(snapshot.horses.map((h) => [h.id, h.number]));
  const hits: SettleLine[] = [];
  let spent = 0;
  for (const [i, b] of response.bets.entries()) {
    spent += b.amount;
    const nums = b.horseIds.map((id) => numberOf.get(id));
    if (nums.some((n) => n === undefined)) return { ok: false, reason: '買い目の馬番を照合できません。' };
    if (b.type === 'win') {
      for (const w of result.payouts.win) if (w.horseNumber === nums[0]) hits.push({ betIndex: i, label: `単勝 ${nums[0]}番`, amount: b.amount, payout: (b.amount / 100) * w.yen });
    } else {
      const a = Math.min(nums[0]!, nums[1]!);
      const c = Math.max(nums[0]!, nums[1]!);
      for (const w of result.payouts.wide) if (w.a === a && w.b === c) hits.push({ betIndex: i, label: `ワイド ${a}-${c}`, amount: b.amount, payout: (b.amount / 100) * w.yen });
    }
  }
  return { ok: true, payout: hits.reduce((s, h) => s + h.payout, 0), hits, spent };
}
