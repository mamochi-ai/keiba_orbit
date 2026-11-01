// Prediction vs official result. Facts only: Claude's base-scenario rank next to the finish,
// which bets hit (from the official payouts) and, for a miss, which horse missed the places.
import { raceIdentity, type FeedRace, type FeedResult } from './feed';
import type { SavedAnalysis } from './schema';
import { settleFromResult, type SettleResult } from './settle';

/** The received race (real data only) whose official result belongs to this analysis. */
export function findResultRace(a: SavedAnalysis, races: FeedRace[]): FeedRace | undefined {
  const r = a.snapshot.race;
  if (a.isDemo || !r.date || !r.venue || !r.number) return undefined;
  const key = raceIdentity(false, r.date, r.venue, r.number);
  return races.find((x) => x.key === key && x.result);
}

export interface ReviewRow {
  number: number;
  name: string;
  predicted: number | null;
  finish: number | string | null;
}

export interface BetReview {
  label: string;
  amount: number;
  payout: number;
  /** For a miss: the horses that did not finish where the bet needed them. */
  missedBy: { number: number; finish: number | string | null }[];
}

export interface Review {
  top3: ReviewRow[];
  center: ReviewRow | null;
  centerInTop3: boolean | null;
  predictedTop: ReviewRow[];
  bets: BetReview[];
  settle: SettleResult;
}

export function buildReview(a: SavedAnalysis, result: FeedResult): Review {
  const { snapshot, response } = a;
  const base = response.scenarios.find((s) => s.id === 'base');
  const order = base && base.status === 'analyzed' ? base.order : [];
  const finishOf = (n: number) => result.finishOrder.find((f) => f.horseNumber === n)?.finish ?? null;
  const row = (id: string): ReviewRow | null => {
    const h = snapshot.horses.find((x) => x.id === id);
    if (!h) return null;
    const rank = order.indexOf(id);
    return { number: h.number, name: h.name, predicted: rank >= 0 ? rank + 1 : null, finish: finishOf(h.number) };
  };
  const top3 = result.finishOrder
    .filter((f) => typeof f.finish === 'number' && f.finish <= 3)
    .sort((x, y) => (x.finish as number) - (y.finish as number))
    .map((f) => {
      const h = snapshot.horses.find((x) => x.number === f.horseNumber);
      const rank = h ? order.indexOf(h.id) : -1;
      return { number: f.horseNumber, name: h?.name ?? '', predicted: rank >= 0 ? rank + 1 : null, finish: f.finish };
    });
  const center = order[0] ? row(order[0]) : null;
  const inPlace = (f: number | string | null, need: number) => typeof f === 'number' && f <= need;
  const settle = settleFromResult(snapshot, response, result);
  const bets: BetReview[] = response.bets.map((b, i) => {
    const hs = b.horseIds.map((id) => snapshot.horses.find((h) => h.id === id)).filter((h): h is NonNullable<typeof h> => Boolean(h));
    const need = b.type === 'win' ? 1 : 3;
    const hit = settle.ok ? settle.hits.filter((x) => x.betIndex === i).reduce((s, x) => s + x.payout, 0) : 0;
    return {
      label: b.type === 'win' ? `単勝 ${hs[0]?.number ?? '?'}番` : `ワイド ${hs.map((h) => h.number).sort((x, y) => x - y).join('-')}`,
      amount: b.amount,
      payout: hit,
      missedBy: hit ? [] : hs.filter((h) => !inPlace(finishOf(h.number), need)).map((h) => ({ number: h.number, finish: finishOf(h.number) })),
    };
  });
  return {
    top3,
    center,
    centerInTop3: center ? inPlace(center.finish, 3) : null,
    predictedTop: order.slice(0, 5).map(row).filter((r): r is ReviewRow => Boolean(r)),
    bets,
    settle,
  };
}

export interface ReviewStats {
  races: number;
  centerTop3: number;
  centerKnown: number;
  hitRaces: number;
  spent: number;
  payout: number;
}

/**
 * Totals over real analyses that have an official result (computed from payouts, not records).
 * A race analysed several times counts once, using its latest version.
 */
export function reviewStats(analyses: SavedAnalysis[], races: FeedRace[]): ReviewStats {
  const s: ReviewStats = { races: 0, centerTop3: 0, centerKnown: 0, hitRaces: 0, spent: 0, payout: 0 };
  const latest = new Map<string, SavedAnalysis>();
  for (const a of analyses) {
    if (a.isDemo) continue;
    const cur = latest.get(a.raceKey);
    if (!cur || a.version > cur.version) latest.set(a.raceKey, a);
  }
  for (const a of latest.values()) {
    const race = findResultRace(a, races);
    if (!race?.result?.payouts) continue;
    const r = buildReview(a, race.result);
    if (!r.settle.ok) continue;
    s.races++;
    s.spent += r.settle.spent;
    s.payout += r.settle.payout;
    if (r.settle.payout > 0) s.hitRaces++;
    if (r.centerInTop3 !== null) {
      s.centerKnown++;
      if (r.centerInTop3) s.centerTop3++;
    }
  }
  return s;
}
