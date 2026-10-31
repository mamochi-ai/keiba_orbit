import { describe, expect, it } from 'vitest';
import { settleFromResult } from './settle';
import { goodResponse, realSnapshot } from '../test/fixtures';
import type { FeedResult } from './feed';

const result = (payouts: FeedResult['payouts']): FeedResult => ({ status: '確定', confirmedAt: null, sourceUrl: null, finishOrder: [], payouts });

describe('settleFromResult', () => {
  const s = realSnapshot();
  const r = goodResponse(s); // 単勝 1番 1,000円 + ワイド 1-2 2,000円

  it('pays 単勝 and ワイド from the official payouts per 100 yen', () => {
    const out = settleFromResult(s, r, result({ win: [{ horseNumber: 1, yen: 320 }], wide: [{ a: 1, b: 2, yen: 180 }, { a: 1, b: 5, yen: 900 }] }));
    expect(out).toEqual({
      ok: true,
      payout: 3200 + 3600,
      spent: 3000,
      hits: [
        { betIndex: 0, label: '単勝 1番', amount: 1000, payout: 3200 },
        { betIndex: 1, label: 'ワイド 1-2', amount: 2000, payout: 3600 },
      ],
    });
  });

  it('a miss pays 0, and missing payouts are not guessed', () => {
    const miss = settleFromResult(s, r, result({ win: [{ horseNumber: 4, yen: 500 }], wide: [{ a: 3, b: 4, yen: 400 }] }));
    expect(miss).toMatchObject({ ok: true, payout: 0, hits: [] });
    expect(settleFromResult(s, r, result(null))).toMatchObject({ ok: false });
  });

  it('dead heats: every listed winner pays', () => {
    const out = settleFromResult(s, r, result({ win: [{ horseNumber: 1, yen: 150 }, { horseNumber: 2, yen: 210 }], wide: [] }));
    expect(out).toMatchObject({ ok: true, payout: 1500 });
  });
});
