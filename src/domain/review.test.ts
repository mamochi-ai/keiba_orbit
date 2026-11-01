import { describe, expect, it } from 'vitest';
import { buildReview, findResultRace, reviewStats } from './review';
import { goodResponse, realSnapshot } from '../test/fixtures';
import type { FeedRace, FeedResult } from './feed';
import type { SavedAnalysis } from './schema';

const s = realSnapshot();
const rec = (over: Partial<SavedAnalysis> = {}): SavedAnalysis => ({
  id: 'a-1', raceKey: s.race.id, version: 1, kind: 'original', parentId: null, isDemo: false,
  createdAt: '2026-11-01T10:00:00+09:00', snapshot: s, response: goodResponse(s), noteArticle: null, ...over,
});
// goodResponse: base order h01 > h02; bets 単勝1番 1,000 + ワイド1-2 2,000
const result = (finish: [number, number | string][], payouts: FeedResult['payouts']): FeedResult => ({
  status: '確定', confirmedAt: null, sourceUrl: null, finishOrder: finish.map(([n, f]) => ({ horseNumber: n, finish: f })), payouts,
});
const raceWith = (r: FeedResult) => ({ key: `live|${s.race.date}|${s.race.venue}|${s.race.number}`, result: r }) as unknown as FeedRace;

describe('review', () => {
  it('shows the top 3 with Claude’s rank, the centre pick and why each bet missed', () => {
    const res = result([[4, 1], [3, 2], [2, 3], [1, 11]], { win: [{ horseNumber: 4, yen: 1080 }], wide: [{ a: 3, b: 4, yen: 900 }, { a: 2, b: 4, yen: 400 }, { a: 2, b: 3, yen: 700 }] });
    const r = buildReview(rec(), res);
    expect(r.top3.map((x) => [x.number, x.predicted])).toEqual([[4, null], [3, null], [2, 2]]);
    expect(r.center).toMatchObject({ number: 1, predicted: 1, finish: 11 });
    expect(r.centerInTop3).toBe(false);
    expect(r.bets).toEqual([
      { label: '単勝 1番', amount: 1000, payout: 0, missedBy: [{ number: 1, finish: 11 }] },
      { label: 'ワイド 1-2', amount: 2000, payout: 0, missedBy: [{ number: 1, finish: 11 }] },
    ]);
  });

  it('counts hits, centre-in-top-3 and recovery only for real analyses with results', () => {
    const hit = result([[1, 1], [2, 2], [3, 3]], { win: [{ horseNumber: 1, yen: 320 }], wide: [{ a: 1, b: 2, yen: 180 }] });
    const races = [raceWith(hit)];
    expect(findResultRace(rec({ isDemo: true }), races)).toBeUndefined();
    const st = reviewStats([rec(), rec({ id: 'a-2', isDemo: true })], races);
    expect(st).toEqual({ races: 1, centerTop3: 1, centerKnown: 1, hitRaces: 1, spent: 3000, payout: 3200 + 3600 });
    // A re-analysis of the same race counts once (latest version only).
    const v2 = rec({ id: 'a-3', version: 2, response: { ...goodResponse(s), bets: [] } });
    expect(reviewStats([rec(), v2], races)).toMatchObject({ races: 1, hitRaces: 0, spent: 0 });
  });
});
