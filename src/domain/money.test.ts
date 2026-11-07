import { describe, expect, it } from 'vitest';
import { computeTotals, estimateBet, estimatePayout, floorTo100, payoutPer100, sharedHorseDependencies, shortfallBets } from './money';
import { realSnapshot } from '../test/fixtures';

describe('money', () => {
  it('recomputes spent / unspent / maxLoss', () => {
    expect(computeTotals(30000, [{ amount: 4000 }, { amount: 3000 }, { amount: 3000 }])).toEqual({ spent: 10000, unspent: 20000, maxLoss: 10000 });
  });

  it('rounds budgets down to 100 yen so the cap is never exceeded', () => {
    expect(floorTo100(29999)).toBe(29900);
    expect(floorTo100(-5)).toBe(0);
    expect(floorTo100(Number.NaN)).toBe(0);
  });

  it('computes integer payouts from 0.1-step odds', () => {
    expect(payoutPer100(3.2)).toBe(320);
    expect(payoutPer100(1.1)).toBe(110);
    expect(estimatePayout(1000, 3.2)).toBe(3200);
    expect(Number.isInteger(estimatePayout(300, 2.3))).toBe(true);
  });

  it('gives a range for wide odds and keeps payout separate from profit', () => {
    const s = realSnapshot();
    const e = estimateBet(s, { type: 'wide', horseIds: ['h02', 'h01'], amount: 2000, reason: '', odds: null, oddsAt: null });
    expect(e).toMatchObject({ kind: 'range', min: 4200, max: 5600 });
    const w = estimateBet(s, { type: 'win', horseIds: ['h01'], amount: 1000, reason: '', odds: null, oddsAt: null });
    expect(w).toMatchObject({ kind: 'fixed', payout: 3200 });
  });

  it('defers wide payouts in fields of 7 or fewer runners and has none without odds', () => {
    const s = realSnapshot({ horses: realSnapshot().horses.slice(0, 7) });
    expect(estimateBet(s, { type: 'wide', horseIds: ['h01', 'h02'], amount: 100, reason: '', odds: null, oddsAt: null }).kind).toBe('deferred');
    const none = realSnapshot({ odds: null });
    expect(estimateBet(none, { type: 'win', horseIds: ['h01'], amount: 100, reason: '', odds: null, oddsAt: null }).kind).toBe('none');
  });

  it('lists horses shared by several bets', () => {
    const deps = sharedHorseDependencies([
      { type: 'win', horseIds: ['a'], amount: 4000, reason: '', odds: null, oddsAt: null },
      { type: 'wide', horseIds: ['a', 'b'], amount: 3000, reason: '', odds: null, oddsAt: null },
      { type: 'wide', horseIds: ['a', 'c'], amount: 3000, reason: '', odds: null, oddsAt: null },
    ]);
    expect(deps[0]).toEqual({ horseId: 'a', betIndexes: [0, 1, 2], amount: 10000 });
  });

  it('finds bets that lose money even as the only hit (トリガミ), from recorded odds only', () => {
    const s = realSnapshot(); // win 1 = 3.2, wide 1-2 = 2.1〜2.8
    const bet = (type: 'win' | 'wide', horseIds: string[], amount: number) => ({ type, horseIds, amount, reason: '', odds: null, oddsAt: null });
    // spent 3,000: wide 1-2 ¥1,000 pays ¥2,100〜¥2,800 → always short; win ¥2,000 pays ¥6,400 → fine
    expect(shortfallBets(s, [bet('win', ['h01'], 2000), bet('wide', ['h01', 'h02'], 1000)])).toEqual([{ betIndex: 1, level: 'sure', min: 2100, max: 2800 }]);
    // wide ¥1,300 pays ¥2,730〜¥3,640 against ¥3,000 → depends on the final odds
    expect(shortfallBets(s, [bet('win', ['h01'], 1700), bet('wide', ['h01', 'h02'], 1300)])).toEqual([{ betIndex: 1, level: 'maybe', min: 2730, max: 3640 }]);
    // no odds recorded for 単勝 3番 → not judged
    expect(shortfallBets(s, [bet('win', ['h03'], 100), bet('win', ['h01'], 2900)])).toEqual([]);
  });
});
