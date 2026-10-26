import { describe, expect, it } from 'vitest';
import { computeTotals, estimateBet, estimatePayout, floorTo100, payoutPer100, sharedHorseDependencies } from './money';
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
});
