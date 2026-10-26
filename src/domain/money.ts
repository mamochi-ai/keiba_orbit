// Integer-yen arithmetic only. No probabilities, expected values or optimal stakes are computed.
import type { Bet, Odds, RaceSnapshot } from './schema';

export function formatYen(n: number): string {
  return `¥${Math.trunc(n).toLocaleString('ja-JP')}`;
}

export function isValidStake(amount: number): boolean {
  return Number.isInteger(amount) && amount > 0 && amount % 100 === 0;
}

/** Round a budget input down to 100-yen units so rounding can never exceed the cap. */
export function floorTo100(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n / 100) * 100;
}

export interface Totals {
  spent: number;
  unspent: number;
  maxLoss: number;
}

export function computeTotals(budget: number, bets: Pick<Bet, 'amount'>[]): Totals {
  const spent = bets.reduce((s, b) => s + b.amount, 0);
  return { spent, unspent: budget - spent, maxLoss: spent };
}

/** JRA odds are quoted to 0.1; payout per 100 yen = odds × 100 (integer yen). */
export function payoutPer100(odds: number): number {
  return Math.round(odds * 10) * 10;
}

export function estimatePayout(amount: number, odds: number): number {
  return (amount / 100) * payoutPer100(odds);
}

export function activeRunners(snapshot: RaceSnapshot) {
  return snapshot.horses.filter((h) => !h.scratched);
}

export type PayoutEstimate =
  | { kind: 'fixed'; payout: number; odds: number; asOf: string | null }
  | { kind: 'range'; min: number; max: number; oddsMin: number; oddsMax: number; asOf: string | null }
  | { kind: 'deferred'; reason: string }
  | { kind: 'none'; reason: string };

export const WIDE_SMALL_FIELD_REASON =
  '出走7頭以下のワイドは、少頭数時の払戻条件を公式資料で確認できていないため払戻目安を保留しています。';

function sameSet(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((x) => b.includes(x));
}

export function findOdds(odds: Odds | null | undefined, bet: Pick<Bet, 'type' | 'horseIds'>) {
  if (!odds) return null;
  if (bet.type === 'win') {
    const o = odds.win.find((w) => w.horseId === bet.horseIds[0]);
    return o ? { min: o.odds, max: o.odds } : null;
  }
  const o = odds.wide.find((w) => sameSet(w.horseIds, bet.horseIds));
  return o ? { min: o.min, max: o.max } : null;
}

/** Estimate uses only odds recorded in the snapshot (with time), never odds typed by Claude. */
export function estimateBet(snapshot: RaceSnapshot, bet: Bet): PayoutEstimate {
  const o = findOdds(snapshot.odds, bet);
  const asOf = snapshot.odds?.asOf ?? null;
  if (!o) return { kind: 'none', reason: 'オッズ未取得のため、この配分は候補です。' };
  if (bet.type === 'wide' && activeRunners(snapshot).length <= 7) {
    return { kind: 'deferred', reason: WIDE_SMALL_FIELD_REASON };
  }
  if (o.min === o.max) return { kind: 'fixed', payout: estimatePayout(bet.amount, o.min), odds: o.min, asOf };
  return {
    kind: 'range',
    min: estimatePayout(bet.amount, o.min),
    max: estimatePayout(bet.amount, o.max),
    oddsMin: o.min,
    oddsMax: o.max,
    asOf,
  };
}

/** Horses shared by several bets: if that horse misses, all of those bets lose together. */
export function sharedHorseDependencies(bets: Bet[]): { horseId: string; betIndexes: number[]; amount: number }[] {
  const map = new Map<string, number[]>();
  bets.forEach((b, i) => b.horseIds.forEach((h) => map.set(h, [...(map.get(h) ?? []), i])));
  return [...map.entries()]
    .filter(([, idx]) => idx.length >= 2)
    .map(([horseId, betIndexes]) => ({
      horseId,
      betIndexes,
      amount: betIndexes.reduce((s, i) => s + (bets[i]?.amount ?? 0), 0),
    }))
    .sort((a, b) => b.betIndexes.length - a.betIndexes.length);
}
