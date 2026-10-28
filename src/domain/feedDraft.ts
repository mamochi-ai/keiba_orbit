// Start an analysis draft from a received race. sample data becomes a 架空デモ draft (kept out of
// real predictions and the ledger); mock wide odds are never carried into the draft.
import { emptyDraft, emptyItems, type Draft } from './draft';
import { formatRange, matchTrack, trackSummary, type FeedRace, type FeedTrack } from './feed';
import type { Source } from './schema';

const na = (v: string | number | null, unit = '') => (v === null ? '未取得' : `${v}${unit}`);

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
    const lines = race.runners.map((r) => `${r.horseNumber} ${r.name}　${na(r.sex)}${na(r.age)}歳　斤量${na(r.weightKg, 'kg')}　騎手：${na(r.jockey)}　枠${na(r.bracket)}`);
    items.entries = {
      status: 'ok',
      sourceId: 'src-entries',
      text: `出走表（斤量は負担重量。馬体重ではありません。確認日 ${race.runnersCheckedOn ?? '不明'}・時刻不明${race.runnersRetained ? '・前回取込の値' : ''}）\n${lines.join('\n')}`,
      error: null,
    };
    sources.push(src('src-entries', '出走表', '受取データ（JRA出馬表）', race.sourceUrl, null));
  }

  let odds: Draft['odds'] = null;
  const w = race.wide;
  if (w && !w.isMock && w.pairs.length) {
    const usable = w.pairs.filter((p) => p.min !== null && p.max !== null);
    if (usable.length) {
      odds = {
        asOf: w.sourceUpdatedAt,
        sourceId: 'src-odds',
        win: [],
        wide: usable.map((p) => ({ horseIds: [`${prefix}${String(p.a).padStart(2, '0')}`, `${prefix}${String(p.b).padStart(2, '0')}`] as [string, string], min: p.min!, max: p.max! })),
      };
      items.odds = { status: 'ok', sourceId: 'src-odds', text: null, error: null };
      sources.push(src('src-odds', 'オッズ', '受取データ（ワイドオッズ）', w.sourceUrl, w.sourceUpdatedAt));
      if (!w.sourceUpdatedAt) notes.push('ワイドオッズの情報時点が不明です。最終オッズではありません。');
      const missing = w.pairs.length - usable.length;
      if (missing) notes.push(`ワイド${missing}組は下限または上限が未取得のため、オッズに含めていません。`);
    }
  } else if (w?.isMock) {
    notes.push('ワイドオッズは仮データ（is_mock）のため、分析には使いません。');
  } else if (!w || !w.pairs.length) {
    notes.push('ワイドオッズは未取得です。');
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
    horses: race.runners.map((r) => ({ id: `${prefix}${String(r.horseNumber).padStart(2, '0')}`, number: r.horseNumber, name: r.name })),
    sources,
    items,
    odds,
    ...(demo ? { demoNote: 'テストデータ（sample: true）から作成。実在レースの予想には使えません。' } : {}),
  };
  return { draft, notes };
}

export { formatRange };
