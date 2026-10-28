import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import sample from '../test/feed-sample.json';
import received from '../test/feed-received-2026-10-28.json';
import { formatRange, matchTrack, mergeRace, parseFeed, type FeedRace } from './feed';
import { feedRaceToDraft } from './feedDraft';
import { applyFeed, listFeedRaces, listFeedTracks } from '../storage/db';
import { buildSnapshot } from './draft';
import { parseSnapshot } from './validate';

const T = '2026-10-28T20:00:00+09:00';
const clone = () => structuredClone(sample) as typeof sample & Record<string, unknown>;
const parsed = (v: unknown) => {
  const r = parseFeed(v, T);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.feed;
};

describe('received JRA data (schema 1.0)', () => {
  it('1. imports the 7 runners and 21 mock wide pairs', () => {
    const f = parsed(sample);
    const race = f.races[0]!;
    expect(race.key).toBe('sample|2026-10-25|東京|2');
    expect(race.runners).toHaveLength(7);
    expect(race.runners[0]).toMatchObject({ horseNumber: 1, bracket: 1, name: 'アースグレイジング', weightKg: 55, jockey: '長浜鴻緒' });
    expect(race.wide?.pairs).toHaveLength(21);
    expect(race.wide?.isMock).toBe(true);
    expect(race.wide?.state).toBe('mock');
    expect(formatRange(race.wide!.pairs[0]!)).toBe('1.2〜1.6倍');
    expect(f.issues).toEqual([]);
  });

  it('2. sample and mock data never become real analysis data', () => {
    const f = parsed(sample);
    const { draft, notes } = feedRaceToDraft(f.races[0]!, f.tracks);
    expect(draft.isDemo).toBe(true);
    expect(draft.horses.every((h) => h.id.startsWith('demo-'))).toBe(true);
    expect(draft.odds).toBeNull();
    expect(notes.join()).toContain('仮データ');
    // The draft is a valid demo snapshot; real snapshots refuse demo ids.
    expect(parseSnapshot(buildSnapshot(draft)).ok).toBe(true);
    const asReal = { ...f.races[0]!, sample: false, wide: { ...f.races[0]!.wide!, isMock: true } };
    expect(feedRaceToDraft(asReal as FeedRace, f.tracks).draft.odds).toBeNull();
  });

  it('2b. the 10/23 going is reference information for the 10/25 race', () => {
    const f = parsed(sample);
    const m = matchTrack(f.tracks, f.races[0]!)!;
    expect(m.current).toBe(false);
    expect(m.reason).toContain('レース当日');
    const { draft } = feedRaceToDraft(f.races[0]!, f.tracks);
    expect(draft.items.track.text).toContain('【参考・過去情報】');
    expect(draft.items.track.text).toContain('クッション値：未取得');
    expect(draft.items.track.text).toContain('含水率（測定時刻：未取得）');
  });

  it('3. accepts null cushion value and null measurement times', () => {
    const f = parsed(sample);
    expect(f.tracks[0]).toMatchObject({ cushionValue: null, cushionMeasuredAt: null, moistureMeasuredAt: null, goingAsOf: '2026-10-23T12:00:00+09:00' });
  });

  it('4. odds "取得未完了 / is_mock=false / pairs=[]" still imports the entries', () => {
    const v = clone();
    v.races[0]!.wide_odds = { ...v.races[0]!.wide_odds, status: '取得未完了', is_mock: false, pairs: [] };
    const f = parsed(v);
    expect(f.races[0]!.runners).toHaveLength(7);
    expect(f.races[0]!.wide).toMatchObject({ state: 'partial', isMock: false, pairs: [] });
    const { draft, notes } = feedRaceToDraft(f.races[0]!, f.tracks);
    expect(draft.horses).toHaveLength(7);
    expect(notes.join()).toContain('未取得');
  });

  it('5. re-importing the same data updates instead of duplicating', async () => {
    await applyFeed(parsed(sample));
    const second = await applyFeed(parsed(sample));
    expect(second).toMatchObject({ added: 0, updated: 1 });
    const races = await listFeedRaces();
    expect(races.filter((r) => r.key === 'sample|2026-10-25|東京|2')).toHaveLength(1);
    expect(races[0]!.runners).toHaveLength(7);
    expect(await listFeedTracks()).toHaveLength(1);
  });

  it('6. detects unknown horse numbers, same-horse pairs, min > max and duplicate pairs', () => {
    const v = clone();
    const pairs = v.races[0]!.wide_odds.pairs as { horse_number_1: number; horse_number_2: number; odds_min: number | null; odds_max: number | null }[];
    pairs.push({ horse_number_1: 1, horse_number_2: 9, odds_min: 2, odds_max: 3 });
    pairs.push({ horse_number_1: 3, horse_number_2: 3, odds_min: 2, odds_max: 3 });
    pairs.push({ horse_number_1: 4, horse_number_2: 5, odds_min: 9, odds_max: 3 });
    pairs.push({ horse_number_1: 2, horse_number_2: 1, odds_min: 1.3, odds_max: 1.7 });
    const f = parsed(v);
    const msgs = f.issues.map((i) => i.message).join('\n');
    expect(msgs).toContain('同じ馬番どうし');
    expect(msgs).toContain('下限 9 が上限 3 を超えています');
    expect(msgs).toContain('重複');
    const { race, issues } = mergeRace(undefined, f.races[0]!);
    expect(issues.map((i) => i.message).join()).toContain('ワイド 1-9：出走馬にない馬番');
    expect(race.wide!.pairs).toHaveLength(21);
    expect(race.wide!.pairs.every((p) => p.a < p.b)).toBe(true);
  });

  it('rejects duplicated horse numbers in a race, keeps other races, and never uses bracket as a key', () => {
    const v = clone();
    const other = structuredClone(v.races[0]!);
    other.race_number = 3;
    other.race_key = 'anything';
    other.runners[1]!.horse_number = 1;
    v.races.push(other);
    const f = parsed(v);
    expect(f.races).toHaveLength(1);
    expect(f.issues[0]!.message).toContain('馬番 1 が出走馬に2回');
    const v2 = clone();
    v2.races[0]!.runners[1]!.bracket = 1; // same 枠 for two horses is valid
    expect(parsed(v2).races[0]!.runners).toHaveLength(7);
  });

  it('keeps previous values when a later import is partial, and marks them', () => {
    const first = parsed(sample).races[0]!;
    const v = clone();
    v.races[0]!.runners = [];
    v.races[0]!.start_time_jst = null as unknown as string;
    v.races[0]!.wide_odds = { ...v.races[0]!.wide_odds, status: '取得未完了', is_mock: false, pairs: [] };
    const { race, issues } = mergeRace(first, parsed(v).races[0]!);
    expect(race.runners).toHaveLength(7);
    expect(race.runnersRetained).toBe(true);
    expect(race.startTime).toBe('10:20');
    expect(race.retainedFields).toContain('発走時刻');
    expect(race.wide!.pairs).toHaveLength(21);
    expect(race.wide!.retained).toBe(true);
    expect(race.wide!.latestAttempt?.state).toBe('partial');
    expect(issues.map((i) => i.message).join()).toContain('前回の出走表');
  });

  it('does not decide old vs new when odds times are unknown, and mock never replaces real odds', () => {
    const base = parsed(sample).races[0]!;
    const real = { ...base, wide: { ...base.wide!, isMock: false, state: 'complete' as const } };
    const mock = mergeRace(real, base);
    expect(mock.race.wide!.isMock).toBe(false);
    const same = mergeRace(real, real);
    expect(same.race.wide!.orderUnknown).toBeFalsy();
    expect(same.race.previousWide ?? null).toBeNull();
    const again = mergeRace(real, { ...real, wide: { ...real.wide, pairs: real.wide.pairs.slice(0, 3) } });
    expect(again.race.wide!.orderUnknown).toBe(true);
    expect(again.race.previousWide!.pairs).toHaveLength(21);
  });

  it('ignores unknown fields with a warning; rejects bad URLs and wrong schema versions', () => {
    const extra = parseFeed({ ...clone(), extra: 1 }, T);
    expect(extra.ok).toBe(true);
    expect(extra.ok && extra.feed.issues[0]!.message).toContain('extra');
    const v = clone();
    v.races[0]!.source_url = 'javascript:alert(1)';
    expect(parseFeed(v, T).ok).toBe(false);
    const r = parseFeed({ ...clone(), schema_version: '2.0' }, T);
    expect(r.ok === false && r.errors.join()).toContain('1.0');
  });

  it('accepts the file received on 2026-10-28 (no is_mock, extra documentation fields)', () => {
    const f = parsed(received);
    const race = f.races[0]!;
    expect(race.runners).toHaveLength(7);
    expect(race.wide).toMatchObject({ state: 'partial', isMock: false, mockUnstated: true, pairs: [] });
    const warn = f.issues.find((i) => i.where === 'ファイル全体')!;
    expect(warn.level).toBe('warning');
    expect(warn.message).toContain('wide_odds_record_template');
    expect(warn.message).toContain('claude_code_instructions');
    expect(f.tracks[0]).toMatchObject({ cushionValue: null, moistureMeasuredAt: null });
    const { draft, notes } = feedRaceToDraft(race, f.tracks);
    expect(draft.isDemo).toBe(true);
    expect(draft.horses).toHaveLength(7);
    expect(draft.odds).toBeNull();
    expect(notes.join()).toContain('未取得');
  });

  it('keeps per-pair time and source (template format) and uses them for the odds time', () => {
    const v = structuredClone(received) as unknown as { sample: boolean; races: { wide_odds: Record<string, unknown> }[] };
    v.sample = false;
    v.races[0]!.wide_odds = {
      ...v.races[0]!.wide_odds,
      status: '取得済み',
      is_mock: false,
      pairs: [
        { horse_number_1: 2, horse_number_2: 1, odds_min: 1.5, odds_max: 2.1, source_updated_at_jst: '2026-11-01T09:30:00+09:00', source_url: 'https://www.jra.go.jp/odds' },
        { horse_number_1: 1, horse_number_2: 3, odds_min: 3.0, odds_max: 4.0, source_updated_at_jst: '2026-11-01T09:00:00+09:00', source_url: 'https://www.jra.go.jp/odds' },
      ],
    };
    const f = parsed(v);
    expect(f.races[0]!.wide!.pairs[0]).toMatchObject({ a: 1, b: 2, updatedAt: '2026-11-01T09:30:00+09:00' });
    const { draft, notes } = feedRaceToDraft(f.races[0]!, f.tracks);
    expect(draft.isDemo).toBe(false);
    expect(draft.odds?.wide).toHaveLength(2);
    expect(draft.odds?.asOf).toBe('2026-11-01T09:00:00+09:00');
    expect(notes.join()).toContain('最も古い時点');
  });
});
