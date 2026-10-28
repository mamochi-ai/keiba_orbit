// Start an analysis draft from a received race. sample data becomes a 架空デモ draft (kept out of
// real predictions and the ledger); mock wide odds are never carried into the draft.
import { emptyDraft, emptyItems, type Draft } from './draft';
import { formatRange, matchTrack, trackSummary, type FeedRace, type FeedTrack, type PastRun } from './feed';
import type { Source } from './schema';

const na = (v: string | number | null | undefined, unit = '') => (v === null || v === undefined ? '未取得' : `${v}${unit}`);
const q = (v: string | number | null | undefined, unit = '') => (v === null || v === undefined ? '?' : `${v}${unit}`);

/** One past run as a compact line; unknown parts are shown as ? (never filled in). */
export function pastRunLine(p: PastRun): string {
  const fin = p.finish === null || p.finish === undefined ? '着順?' : typeof p.finish === 'number' ? `${p.finish}着` : p.finish;
  return [
    q(p.date),
    q(p.venue),
    `${q(p.race_name)}${p.class ? `（${p.class}）` : ''}`,
    `${q(p.surface)}${q(p.distance_m, 'm')}`,
    q(p.going),
    `${q(p.field_size, '頭')}${q(p.horse_number, '番')}${q(p.popularity, '人気')}`,
    fin,
    `${q(p.time)}（${q(p.margin)}）`,
    `通過${q(p.passing)}`,
    `上がり${q(p.last_3f)}`,
    `騎手${q(p.jockey)}`,
    `斤量${q(p.weight_kg)}`,
    `馬体重${q(p.body_weight_kg)}`,
  ].join(' ');
}

export function feedRaceToDraft(race: FeedRace, tracks: FeedTrack[]): { draft: Draft; notes: string[] } {
  const demo = race.sample;
  const prefix = demo ? 'demo-h' : 'h';
  const notes: string[] = [];
  const src = (id: string, label: string, provider: string, url: string | null, asOf: string | null): Source => ({
    id,
    label,
    provider,
    url,
    fetchedAt: null, // checked_on_jst is a day, not a fetch time
    asOf,
    isDemo: demo,
  });

  const items = emptyItems();
  const sources: Source[] = [];

  const cond = [race.surface && race.distanceM ? `${race.surface}${race.distanceM}m` : race.surface ?? (race.distanceM ? `${race.distanceM}m` : null), race.direction ? `${race.direction}回り` : null, race.startTime ? `発走 ${race.startTime}` : null]
    .filter(Boolean)
    .join('／');
  items.identity = { status: 'ok', sourceId: race.sourceUrl ? 'src-identity' : null, text: `${race.name}${cond ? `（${cond}）` : ''}`, error: null };
  if (race.sourceUrl) sources.push(src('src-identity', 'レース同定', '受取データ（JRA出馬表）', race.sourceUrl, null));

  if (race.runners.length) {
    const lines = race.runners.map(
      (r) =>
        `${r.horseNumber} ${r.name}${r.scratched ? '（出走取消）' : ''}　${na(r.sex)}${na(r.age)}歳　斤量${na(r.weightKg, 'kg')}　騎手：${na(r.jockey)}　枠${na(r.bracket)}　単勝${na(r.winOdds)}（${na(r.popularity, '番人気')}）`,
    );
    items.entries = {
      status: 'ok',
      sourceId: 'src-entries',
      text: `出走表（斤量は負担重量。馬体重ではありません。確認日 ${race.runnersCheckedOn ?? '不明'}・時刻不明${race.runnersRetained ? '・前回取込の値' : ''}）\n${lines.join('\n')}`,
      error: null,
    };
    sources.push(src('src-entries', '出走表', '受取データ（JRA出馬表）', race.sourceUrl, null));
  }

  let odds: Draft['odds'] = null;
  const hid = (n: number) => `${prefix}${String(n).padStart(2, '0')}`;
  const win = race.runners.filter((r) => r.winOdds !== null && !r.scratched).map((r) => ({ horseId: hid(r.horseNumber), odds: r.winOdds! }));
  const w = race.wide;
  if (w && !w.isMock && w.pairs.length) {
    const usable = w.pairs.filter((p) => p.min !== null && p.max !== null);
    if (usable.length) {
      // Wide-level time, else the oldest per-pair time (conservative for freshness); unknown stays null.
      const pairTimes = usable.map((p) => p.updatedAt ?? null);
      const knownTimes = pairTimes.filter((t): t is string => Boolean(t)).sort();
      const asOf = w.sourceUpdatedAt ?? (knownTimes.length === usable.length ? knownTimes[0]! : null);
      if (!w.sourceUpdatedAt && knownTimes.length && new Set(knownTimes).size > 1) notes.push('ワイドの組ごとに情報時点が異なります。最も古い時点を基準にしています。');
      odds = {
        asOf,
        sourceId: 'src-odds',
        win: [],
        wide: usable.map((p) => ({ horseIds: [`${prefix}${String(p.a).padStart(2, '0')}`, `${prefix}${String(p.b).padStart(2, '0')}`] as [string, string], min: p.min!, max: p.max! })),
      };
      items.odds = { status: 'ok', sourceId: 'src-odds', text: null, error: null };
      sources.push(src('src-odds', 'オッズ', '受取データ（ワイドオッズ）', w.sourceUrl ?? usable.find((p) => p.sourceUrl)?.sourceUrl ?? null, asOf));
      if (!asOf) notes.push('ワイドオッズの情報時点が不明です。最終オッズではありません。');
      const missing = w.pairs.length - usable.length;
      if (missing) notes.push(`ワイド${missing}組は下限または上限が未取得のため、オッズに含めていません。`);
    }
  } else if (w?.isMock) {
    notes.push('ワイドオッズは仮データ（is_mock）のため、分析には使いません。');
  } else if (!w || !w.pairs.length) {
    notes.push('ワイドオッズは未取得です。');
  }

  if (win.length) {
    // One odds time per snapshot: the older of 単勝 and ワイド, so freshness is never overstated.
    const times = [race.winOddsUpdatedAt, odds?.asOf ?? null];
    const asOf = !race.winOddsUpdatedAt || (odds && !odds.asOf) ? null : times.filter((t): t is string => Boolean(t)).sort()[0] ?? null;
    if (odds && odds.asOf && race.winOddsUpdatedAt && odds.asOf !== race.winOddsUpdatedAt) notes.push('単勝とワイドのオッズ時点が異なります。古い方を基準にしています。');
    if (!race.winOddsUpdatedAt) notes.push('単勝オッズの情報時点が不明です。');
    odds = { asOf, sourceId: 'src-odds', win, wide: odds?.wide ?? [] };
    items.odds = { status: 'ok', sourceId: 'src-odds', text: null, error: null };
    const others = sources.filter((s) => s.id !== 'src-odds');
    sources.length = 0;
    sources.push(...others, src('src-odds', 'オッズ', '受取データ（単勝・ワイドオッズ）', race.winOddsSourceUrl ?? w?.sourceUrl ?? null, asOf));
  }

  const withPast = race.runners.filter((r) => r.pastRuns.length);
  if (withPast.length) {
    const blocks = withPast.map((r) => `${r.horseNumber} ${r.name}\n${r.pastRuns.map((p, i) => `  ${i + 1}走前：${pastRunLine(p)}`).join('\n')}`);
    const noPast = race.runners.filter((r) => !r.pastRuns.length).map((r) => r.horseNumber);
    items.past = {
      status: 'ok',
      sourceId: 'src-past',
      text: `過去成績（新しい順・?は未取得。斤量は負担重量、馬体重は別項目）${noPast.length ? `\n過去成績なし／未取得：馬番 ${noPast.join('・')}` : ''}\n${blocks.join('\n')}`.slice(0, 60000),
      error: null,
    };
    sources.push(src('src-past', '過去成績', '受取データ（JRA出馬表・過去成績）', race.sourceUrl, null));
  }

  const m = matchTrack(tracks, race);
  if (m) {
    items.track = { status: 'ok', sourceId: 'src-track', text: trackSummary(m), error: null };
    sources.push(src('src-track', '馬場', '受取データ（JRA馬場情報）', m.track.sourceUrl, m.track.goingAsOf));
    if (!m.current) notes.push(`馬場情報は参考・過去情報です。${m.reason}`);
  }

  const draft: Draft = {
    ...emptyDraft(),
    isDemo: demo,
    date: race.date,
    name: demo ? `${race.name}（テストデータ）` : race.name,
    venue: race.venue,
    number: String(race.number),
    horses: race.runners.map((r) => ({ id: `${prefix}${String(r.horseNumber).padStart(2, '0')}`, number: r.horseNumber, name: r.name, ...(r.scratched ? { scratched: true } : {}) })),
    sources,
    items,
    odds,
    ...(demo ? { demoNote: 'テストデータ（sample: true）から作成。実在レースの予想には使えません。' } : {}),
  };
  return { draft, notes };
}

export { formatRange };
