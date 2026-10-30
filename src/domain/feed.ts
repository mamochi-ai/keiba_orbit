// Received JRA data ("受取データ", schema_version "1.0"): races with entries and wide odds, plus
// per-course track conditions. Validation, normalisation and the merge rules for re-imports.
//
// Rules from the data provider:
//  - race_key is NOT a JRA id. Races are matched by date + venue + race number.
//  - Runners are matched by horse_number. bracket (枠番) is never a key. Before 馬番 are
//    published horse_number is null: such runners are kept (matched by name on re-import)
//    but an analysis cannot start until the numbers arrive.
//  - weight_kg is 負担重量 (斤量), not 馬体重.
//  - null numbers are unknown: never filled with 0 or guesses.
//  - pairs: [] may mean "odds not collected"; it never means "no runners".
//  - checked_on_jst is the day the file was checked, not a measurement / update time.
//  - going_as_of_jst and moisture_measured_at_jst are independent; neither is derived from the other.
//  - sample: true is test data; is_mock: true odds are fabricated. Both stay out of real analysis.
import { z } from 'zod';
import { isSafeHttpUrl, VENUES, type Venue } from './schema';
import { formatJst } from './time';

const str = (max: number) => z.string().max(max);
const url = z.string().refine(isSafeHttpUrl, 'URLは http:// または https:// のみ使用できます').nullable();
const isoDate = z.iso.date({ message: '日付は YYYY-MM-DD 形式で指定してください' });
const isoTime = z.iso.datetime({ offset: true, message: '日時はタイムゾーン付きISO形式（例 2026-10-23T12:00:00+09:00）で指定してください' });
const odds = z.number().min(1).max(99999).nullable();

const opt = <T extends z.ZodType>(t: T) => t.nullable().optional();

/** One past run (前走〜4走前). Every field may be null = unknown. */
const pastRunSchema = z.object({
  date: opt(isoDate),
  venue: opt(str(20)),
  race_name: opt(str(80)),
  class: opt(str(30)),
  surface: opt(str(10)),
  distance_m: opt(z.int().min(800).max(5000)),
  going: opt(str(10)),
  field_size: opt(z.int().min(1).max(30)),
  horse_number: opt(z.int().min(1).max(30)),
  popularity: opt(z.int().min(1).max(30)),
  // A number, or text such as 「中止」「除外」「取消」.
  finish: opt(z.union([z.int().min(1).max(30), str(10)])),
  time: opt(str(12)),
  margin: opt(str(12)),
  passing: opt(str(30)),
  last_3f: opt(z.number().min(20).max(60)),
  jockey: opt(str(40)),
  weight_kg: opt(z.number().min(40).max(70)),
  body_weight_kg: opt(z.int().min(300).max(700)),
});
export type PastRun = z.infer<typeof pastRunSchema>;

const runnerSchema = z.object({
  bracket: z.int().min(1).max(8).nullable(),
  horse_number: z.int().min(1).max(18).nullable(),
  horse_name: str(40).min(1),
  sex: str(4).nullable(),
  age: z.int().min(1).max(20).nullable(),
  weight_kg: z.number().min(40).max(70).nullable(),
  jockey: str(40).nullable(),
  scratched: opt(z.boolean()),
  win_odds: opt(z.number().min(1).max(99999)),
  popularity: opt(z.int().min(1).max(18)),
  past_runs: z.array(pastRunSchema).max(10).optional(),
});

const pairSchema = z.object({
  horse_number_1: z.int().min(1).max(18),
  horse_number_2: z.int().min(1).max(18),
  odds_min: odds,
  odds_max: odds,
  source_updated_at_jst: isoTime.nullable().optional(),
  source_url: url.optional(),
});

const wideSchema = z.object({
  status: str(60),
  is_mock: z.boolean().optional(),
  source_url: url,
  source_updated_at_jst: isoTime.nullable(),
  is_final: z.boolean().nullable(),
  pairs: z.array(pairSchema).max(200),
  reason: str(500).nullable().optional(),
});

const raceSchema = z.object({
  race_key: str(80).min(1),
  date: isoDate,
  venue: z.enum(VENUES, { message: `競馬場は ${VENUES.join('・')} のいずれかです` }),
  race_number: z.int().min(1).max(12),
  name: str(80).min(1),
  start_time_jst: z.string().regex(/^\d{2}:\d{2}$/, '発走時刻は HH:MM です').nullable(),
  surface: str(10).nullable(),
  distance_m: z.int().min(800).max(5000).nullable(),
  direction: str(10).nullable(),
  entries_status: str(60).nullable(),
  source_url: url,
  runners: z.array(runnerSchema).max(18),
  wide_odds: wideSchema.nullable().optional(),
  win_odds_updated_at_jst: opt(isoTime),
  win_odds_source_url: url.optional(),
});

const sideSchema = z.object({ finish: z.number().min(0).max(100).nullable(), turn4: z.number().min(0).max(100).nullable() });

const trackSchema = z.object({
  venue: z.enum(VENUES, { message: `競馬場は ${VENUES.join('・')} のいずれかです` }),
  status: str(60),
  source_url: url,
  page_race_date: isoDate.nullable(),
  going_as_of_jst: isoTime.nullable(),
  weather: str(20).nullable(),
  turf_going: str(10).nullable(),
  dirt_going: str(10).nullable(),
  cushion_value: z.number().min(0).max(20).nullable(),
  cushion_measured_at_jst: isoTime.nullable(),
  moisture_pct: z.object({ turf: sideSchema.nullable(), dirt: sideSchema.nullable() }).nullable(),
  moisture_measured_at_jst: isoTime.nullable(),
  course: str(10).nullable(),
  turf_notes: str(500).nullable(),
  warning: str(500).nullable(),
});

export const feedSchema = z.object({
  schema_version: z.literal('1.0', { message: 'schema_version は "1.0" のみ対応しています' }),
  sample: z.boolean(),
  description: str(1000).optional(),
  checked_on_jst: isoDate.nullable(),
  collection_notes: z.array(str(2000)).max(500).optional(),
  races: z.array(raceSchema).max(300),
  track_conditions: z.array(trackSchema).max(100),
});
export type FeedFile = z.infer<typeof feedSchema>;

/** Keys the app does not use, with a readable path (e.g. races[].wide_odds.foo). Never an error. */
export function unknownFields(value: unknown): string[] {
  const out = new Set<string>();
  const keysOf = (o: unknown) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o) : []);
  const check = (o: unknown, schema: { shape: object }, path: string) => {
    const known = Object.keys(schema.shape);
    for (const k of keysOf(o)) if (!known.includes(k)) out.add(path ? `${path}.${k}` : k);
  };
  const v = value as Record<string, unknown>;
  check(v, feedSchema, '');
  for (const r of Array.isArray(v?.races) ? v.races : []) {
    check(r, raceSchema, 'races[]');
    const rr = r as Record<string, unknown>;
    for (const ru of Array.isArray(rr?.runners) ? rr.runners : []) check(ru, runnerSchema, 'races[].runners[]');
    if (rr?.wide_odds) {
      check(rr.wide_odds, wideSchema, 'races[].wide_odds');
      const w = rr.wide_odds as Record<string, unknown>;
      for (const p of Array.isArray(w.pairs) ? w.pairs : []) check(p, pairSchema, 'races[].wide_odds.pairs[]');
    }
  }
  for (const t of Array.isArray(v?.track_conditions) ? v.track_conditions : []) check(t, trackSchema, 'track_conditions[]');
  return [...out].slice(0, 20);
}

/* ------------------------------------------------------------------ */
/* Stored shapes                                                        */

export type FeedState = 'complete' | 'partial' | 'unpublished' | 'failed' | 'mock' | 'unknown';
export const FEED_STATE_LABEL: Record<FeedState, string> = {
  complete: '取得済み',
  partial: '部分取得',
  unpublished: '未公開',
  failed: '取得失敗',
  mock: '仮データ',
  unknown: '状態不明',
};

/** The provider writes statuses in Japanese free text; map them to a small set, keep the original too. */
export function classifyStatus(status: string | null | undefined): FeedState {
  const s = status ?? '';
  if (/仮/.test(s)) return 'mock';
  if (/未公開|未発表|発表前/.test(s)) return 'unpublished';
  if (/失敗|エラー/.test(s)) return 'failed';
  if (/一部|部分|未完了|途中/.test(s)) return 'partial';
  if (/取得済/.test(s)) return 'complete';
  return 'unknown';
}

export interface FeedRunner {
  /** null = 馬番未発表. */
  horseNumber: number | null;
  bracket: number | null;
  name: string;
  sex: string | null;
  age: number | null;
  weightKg: number | null;
  jockey: string | null;
  /** null = not stated. */
  scratched: boolean | null;
  winOdds: number | null;
  popularity: number | null;
  /** Newest first, as received (max 4 used). */
  pastRuns: PastRun[];
  /** Fields that came from an earlier import because this import had null. */
  retained?: string[];
}

export interface WidePair {
  a: number;
  b: number;
  min: number | null;
  max: number | null;
  /** Per-pair information time / source, when the provider sends them. */
  updatedAt?: string | null;
  sourceUrl?: string | null;
}

export interface FeedWide {
  status: string;
  state: FeedState;
  isMock: boolean;
  /** is_mock was not present in the data (treated as not mock, shown as 記載なし). */
  mockUnstated?: boolean;
  sourceUrl: string | null;
  sourceUpdatedAt: string | null;
  isFinal: boolean | null;
  pairs: WidePair[];
  reason: string | null;
  checkedOn: string | null;
  importedAt: string;
  /** True when the latest import had no pairs and these are the earlier ones. */
  retained?: boolean;
  /** Replaced odds without a time to compare: which is newer is unknown. */
  orderUnknown?: boolean;
  /** Status of the latest import when it did not replace these pairs. */
  latestAttempt?: { status: string; state: FeedState; isMock: boolean; checkedOn: string | null; note: string };
}

export interface FeedRace {
  key: string;
  sample: boolean;
  date: string;
  venue: Venue;
  number: number;
  externalKey: string;
  name: string;
  startTime: string | null;
  surface: string | null;
  distanceM: number | null;
  direction: string | null;
  entriesStatus: string | null;
  entriesState: FeedState;
  sourceUrl: string | null;
  runners: FeedRunner[];
  runnersCheckedOn: string | null;
  runnersRetained?: boolean;
  retainedFields?: string[];
  wide: FeedWide | null;
  previousWide?: FeedWide | null;
  /** 単勝オッズの情報時点・出典 (race level). */
  winOddsUpdatedAt: string | null;
  winOddsSourceUrl: string | null;
  checkedOn: string | null;
  importedAt: string;
}

export interface FeedTrack {
  key: string;
  sample: boolean;
  venue: Venue;
  status: string;
  state: FeedState;
  sourceUrl: string | null;
  pageRaceDate: string | null;
  goingAsOf: string | null;
  weather: string | null;
  turfGoing: string | null;
  dirtGoing: string | null;
  cushionValue: number | null;
  cushionMeasuredAt: string | null;
  moisture: { turf: { finish: number | null; turn4: number | null } | null; dirt: { finish: number | null; turn4: number | null } | null } | null;
  moistureMeasuredAt: string | null;
  course: string | null;
  turfNotes: string | null;
  warning: string | null;
  checkedOn: string | null;
  importedAt: string;
  retainedFields?: string[];
}

export interface FeedIssue {
  level: 'error' | 'warning';
  where: string;
  message: string;
}

export function raceIdentity(sample: boolean, date: string, venue: string, number: number): string {
  return `${sample ? 'sample' : 'live'}|${date}|${venue}|${number}`;
}

export function raceTitle(r: Pick<FeedRace, 'date' | 'venue' | 'number' | 'name'>): string {
  return `${r.date} ${r.venue}${r.number}R ${r.name}`;
}

export function formatOdds(v: number | null): string {
  return v === null ? '未取得' : v.toFixed(1);
}

export function formatRange(p: Pick<WidePair, 'min' | 'max'>): string {
  if (p.min === null && p.max === null) return '未取得';
  return `${formatOdds(p.min)}〜${formatOdds(p.max)}倍`;
}

/* ------------------------------------------------------------------ */
/* Parse + structural checks (no stored data needed)                    */

export interface ParsedFeed {
  sample: boolean;
  checkedOn: string | null;
  description: string | null;
  notes: string[];
  races: FeedRace[];
  tracks: FeedTrack[];
  issues: FeedIssue[];
}

/** Valid ranges for past-run numbers. A value outside is a collection error: it becomes null (未取得) with a warning instead of rejecting the file. */
const PAST_RANGES: Record<string, [number, number]> = {
  distance_m: [800, 5000],
  field_size: [1, 30],
  horse_number: [1, 30],
  popularity: [1, 30],
  last_3f: [20, 60],
  weight_kg: [40, 70],
  body_weight_kg: [300, 700],
};
const PAST_LABEL: Record<string, string> = { distance_m: '距離', field_size: '頭数', horse_number: '馬番', popularity: '人気', last_3f: '上がり3F', weight_kg: '斤量', body_weight_kg: '馬体重' };

function sanitizePastRuns(value: unknown): { value: unknown; issues: FeedIssue[] } {
  const v = value as { races?: { date?: unknown; venue?: unknown; race_number?: unknown; runners?: { past_runs?: Record<string, unknown>[] }[] }[] };
  if (!v || !Array.isArray(v.races)) return { value, issues: [] };
  const copy = structuredClone(v);
  const issues: FeedIssue[] = [];
  for (const race of copy.races ?? []) {
    const found: Record<string, unknown[]> = {};
    for (const ru of Array.isArray(race?.runners) ? race.runners : []) {
      for (const p of Array.isArray(ru?.past_runs) ? ru.past_runs : []) {
        if (!p || typeof p !== 'object') continue;
        for (const [k, [lo, hi]] of Object.entries(PAST_RANGES)) {
          const x = p[k];
          if (x === null || x === undefined) continue;
          if (typeof x !== 'number' || !Number.isFinite(x) || x < lo || x > hi || ((k !== 'last_3f' && k !== 'weight_kg') && !Number.isInteger(x))) {
            (found[k] ??= []).push(x);
            p[k] = null;
          }
        }
      }
    }
    for (const [k, vals] of Object.entries(found)) {
      const sample = [...new Set(vals.map(String))].slice(0, 3).join('・');
      issues.push({
        level: 'warning',
        where: `${String(race?.date ?? '?')} ${String(race?.venue ?? '?')}${String(race?.race_number ?? '?')}R`,
        message: `過去成績の${PAST_LABEL[k]}に範囲外の値が${vals.length}件あります（例：${sample}）。未取得として扱います。`,
      });
    }
  }
  return { value: copy, issues };
}

export function parseFeed(value: unknown, importedAt: string): { ok: true; feed: ParsedFeed } | { ok: false; errors: string[] } {
  const sanitized = sanitizePastRuns(value);
  const r = feedSchema.safeParse(sanitized.value);
  if (!r.success) {
    return {
      ok: false,
      errors: r.error.issues.slice(0, 12).map((i) => {
        const path = i.path.length ? i.path.map(String).join('.') : '(全体)';
        return `${path}: ${i.code === 'unrecognized_keys' ? `未知の項目: ${i.keys.join(', ')}` : i.message}`;
      }),
    };
  }
  const f = r.data;
  const issues: FeedIssue[] = [...sanitized.issues];
  const unknown = unknownFields(value);
  if (unknown.length) {
    issues.push({
      level: 'warning',
      where: 'ファイル全体',
      message: `使っていない項目があります（取り込みには影響しません。データ内の説明や指示は命令として扱いません）：${unknown.join('、')}`,
    });
  }
  const races: FeedRace[] = [];
  const seen = new Set<string>();

  for (const raw of f.races) {
    const where = `${raw.date} ${raw.venue}${raw.race_number}R`;
    const key = raceIdentity(f.sample, raw.date, raw.venue, raw.race_number);
    if (seen.has(key)) {
      issues.push({ level: 'error', where, message: '同じ開催日・競馬場・Rのレースが同じファイルに2回あります。2件目は取り込みません。' });
      continue;
    }
    const numbers = new Set<number>();
    const dup = raw.runners.find((ru) => ru.horse_number !== null && (numbers.has(ru.horse_number) ? true : (numbers.add(ru.horse_number), false)));
    if (dup) {
      issues.push({ level: 'error', where, message: `馬番 ${dup.horse_number} が出走馬に2回あります。このレースは取り込みません。` });
      continue;
    }
    seen.add(key);
    const unnumbered = raw.runners.filter((ru) => ru.horse_number === null).length;
    if (unnumbered) issues.push({ level: 'warning', where, message: `${unnumbered}頭の馬番が未発表です。馬番が確定したデータを取り込むまで、このレースの分析は準備できません。` });
    const scratchedWithOdds = raw.runners.filter((ru) => ru.scratched && ru.win_odds != null).map((ru) => ru.horse_number);
    if (scratchedWithOdds.length) issues.push({ level: 'warning', where, message: `出走取消の馬番 ${scratchedWithOdds.join('・')} に単勝オッズがあります。取消馬のオッズは使いません。` });
    if (raw.runners.some((ru) => ru.win_odds != null) && !raw.win_odds_updated_at_jst) issues.push({ level: 'warning', where, message: '単勝オッズの情報時点（win_odds_updated_at_jst）がありません。時点不明として扱います。' });

    let wide: FeedWide | null = null;
    if (raw.wide_odds) {
      const w = raw.wide_odds;
      const pairs: WidePair[] = [];
      const pairKeys = new Set<string>();
      for (const p of w.pairs) {
        const a = Math.min(p.horse_number_1, p.horse_number_2);
        const b = Math.max(p.horse_number_1, p.horse_number_2);
        const label = `ワイド ${a}-${b}`;
        if (a === b) {
          issues.push({ level: 'error', where, message: `${label}：同じ馬番どうしの組み合わせは無効です。除外しました。` });
          continue;
        }
        if (p.odds_min !== null && p.odds_max !== null && p.odds_min > p.odds_max) {
          issues.push({ level: 'error', where, message: `${label}：下限 ${p.odds_min} が上限 ${p.odds_max} を超えています。除外しました。` });
          continue;
        }
        const pk = `${a}-${b}`;
        if (pairKeys.has(pk)) {
          issues.push({ level: 'error', where, message: `${label}：同じ組み合わせが重複しています（順番違いを含む）。2件目は除外しました。` });
          continue;
        }
        pairKeys.add(pk);
        pairs.push({ a, b, min: p.odds_min, max: p.odds_max, ...(p.source_updated_at_jst !== undefined ? { updatedAt: p.source_updated_at_jst } : {}), ...(p.source_url !== undefined ? { sourceUrl: p.source_url } : {}) });
      }
      pairs.sort((x, y) => x.a - y.a || x.b - y.b);
      wide = {
        status: w.status,
        state: w.is_mock ? 'mock' : classifyStatus(w.status),
        isMock: w.is_mock ?? false,
        ...(w.is_mock === undefined ? { mockUnstated: true } : {}),
        sourceUrl: w.source_url,
        sourceUpdatedAt: w.source_updated_at_jst,
        isFinal: w.is_final,
        pairs,
        reason: w.reason ?? null,
        checkedOn: f.checked_on_jst,
        importedAt,
      };
    }

    races.push({
      key,
      sample: f.sample,
      date: raw.date,
      venue: raw.venue,
      number: raw.race_number,
      externalKey: raw.race_key,
      name: raw.name,
      startTime: raw.start_time_jst,
      surface: raw.surface,
      distanceM: raw.distance_m,
      direction: raw.direction,
      entriesStatus: raw.entries_status,
      entriesState: classifyStatus(raw.entries_status),
      sourceUrl: raw.source_url,
      runners: raw.runners
        .map((ru) => ({
          horseNumber: ru.horse_number,
          bracket: ru.bracket,
          name: ru.horse_name,
          sex: ru.sex,
          age: ru.age,
          weightKg: ru.weight_kg,
          jockey: ru.jockey,
          scratched: ru.scratched ?? null,
          winOdds: ru.win_odds ?? null,
          popularity: ru.popularity ?? null,
          pastRuns: (ru.past_runs ?? []).slice(0, 4),
        }))
        // Numbered runners by 馬番; unnumbered ones keep the received order after them.
        .sort((a, b) => (a.horseNumber ?? Infinity) - (b.horseNumber ?? Infinity)),
      runnersCheckedOn: raw.runners.length ? f.checked_on_jst : null,
      winOddsUpdatedAt: raw.win_odds_updated_at_jst ?? null,
      winOddsSourceUrl: raw.win_odds_source_url ?? null,
      wide,
      checkedOn: f.checked_on_jst,
      importedAt,
    });
  }

  const tracks: FeedTrack[] = f.track_conditions.map((t) => ({
    key: `${f.sample ? 'sample' : 'live'}|${t.venue}|${t.page_race_date ?? 'no-date'}`,
    sample: f.sample,
    venue: t.venue,
    status: t.status,
    state: classifyStatus(t.status),
    sourceUrl: t.source_url,
    pageRaceDate: t.page_race_date,
    goingAsOf: t.going_as_of_jst,
    weather: t.weather,
    turfGoing: t.turf_going,
    dirtGoing: t.dirt_going,
    cushionValue: t.cushion_value,
    cushionMeasuredAt: t.cushion_measured_at_jst,
    moisture: t.moisture_pct,
    moistureMeasuredAt: t.moisture_measured_at_jst,
    course: t.course,
    turfNotes: t.turf_notes,
    warning: t.warning,
    checkedOn: f.checked_on_jst,
    importedAt,
  }));

  return {
    ok: true,
    feed: { sample: f.sample, checkedOn: f.checked_on_jst, description: f.description ?? null, notes: f.collection_notes ?? [], races, tracks, issues },
  };
}

/* ------------------------------------------------------------------ */
/* Merge with what is already stored                                    */

function pickKeep<T>(incoming: T | null, existing: T | null | undefined, field: string, retained: string[]): T | null {
  if (incoming !== null && incoming !== undefined) return incoming;
  if (existing !== null && existing !== undefined) {
    retained.push(field);
    return existing;
  }
  return null;
}

/** Same horse in another import: by 馬番 when both have one, otherwise by name. */
function sameRunner(list: FeedRunner[], r: FeedRunner): FeedRunner | undefined {
  if (r.horseNumber !== null) {
    const byNo = list.find((o) => o.horseNumber === r.horseNumber);
    if (byNo) return byNo;
  }
  return list.find((o) => (o.horseNumber === null || r.horseNumber === null) && o.name === r.name);
}

export function unnumberedRunners(race: Pick<FeedRace, 'runners'>): FeedRunner[] {
  return race.runners.filter((r) => r.horseNumber === null);
}

function samePairs(a: WidePair[], b: WidePair[]): boolean {
  return a.length === b.length && a.every((p, i) => p.a === b[i]!.a && p.b === b[i]!.b && p.min === b[i]!.min && p.max === b[i]!.max);
}

function hasPairs(w: FeedWide | null | undefined): boolean {
  return Boolean(w && w.pairs.length > 0);
}

/** Merge an incoming race into the stored one. Never blanks existing values with nulls/empties. */
export function mergeRace(existing: FeedRace | undefined, incoming: FeedRace): { race: FeedRace; issues: FeedIssue[] } {
  const where = `${incoming.date} ${incoming.venue}${incoming.number}R`;
  const issues: FeedIssue[] = [];
  const retained: string[] = [];
  const race: FeedRace = { ...incoming };

  if (existing) {
    race.startTime = pickKeep(incoming.startTime, existing.startTime, '発走時刻', retained);
    race.surface = pickKeep(incoming.surface, existing.surface, '芝・ダート', retained);
    race.distanceM = pickKeep(incoming.distanceM, existing.distanceM, '距離', retained);
    race.direction = pickKeep(incoming.direction, existing.direction, '回り', retained);
    race.sourceUrl = pickKeep(incoming.sourceUrl, existing.sourceUrl, '出馬表URL', retained);
    // The time belongs to the odds values: keep the old time when no new 単勝 value arrived.
    if (!incoming.runners.some((r) => r.winOdds !== null)) {
      race.winOddsUpdatedAt = existing.winOddsUpdatedAt ?? null;
      race.winOddsSourceUrl = existing.winOddsSourceUrl ?? null;
    }

    if (incoming.runners.length === 0 && existing.runners.length > 0) {
      race.runners = existing.runners;
      race.runnersCheckedOn = existing.runnersCheckedOn;
      race.runnersRetained = true;
      issues.push({ level: 'warning', where, message: `今回の出走馬が空のため、前回の出走表（確認日 ${existing.runnersCheckedOn ?? '不明'}）を維持しました。` });
    } else {
      race.runnersRetained = false;
      race.runners = incoming.runners.map((ru) => {
        const old = sameRunner(existing.runners, ru);
        if (!old) return ru;
        const r: string[] = [];
        return {
          ...ru,
          horseNumber: pickKeep(ru.horseNumber, old.horseNumber, '馬番', r),
          bracket: pickKeep(ru.bracket, old.bracket, '枠番', r),
          sex: pickKeep(ru.sex, old.sex, '性', r),
          age: pickKeep(ru.age, old.age, '年齢', r),
          weightKg: pickKeep(ru.weightKg, old.weightKg, '斤量', r),
          jockey: pickKeep(ru.jockey, old.jockey, '騎手', r),
          scratched: pickKeep(ru.scratched, old.scratched ?? null, '取消', r),
          winOdds: pickKeep(ru.winOdds, old.winOdds ?? null, '単勝オッズ', r),
          popularity: pickKeep(ru.popularity, old.popularity ?? null, '人気', r),
          pastRuns: ru.pastRuns.length ? ru.pastRuns : (old.pastRuns?.length ? (r.push('過去成績'), old.pastRuns) : []),
          ...(r.length ? { retained: r } : {}),
        };
      });
      const dropped = existing.runners.filter((o) => !sameRunner(incoming.runners, o));
      if (incoming.runners.length && dropped.length) {
        issues.push({ level: 'warning', where, message: `前回あった ${dropped.map((d) => (d.horseNumber !== null ? `${d.horseNumber}番` : d.name)).join('・')} が今回の出走表にありません（取消の可能性）。今回の出走表を使います。` });
      }
    }

    const ow = existing.wide;
    const iw = incoming.wide;
    race.previousWide = existing.previousWide ?? null;
    if (!iw) {
      race.wide = ow;
    } else if (!hasPairs(iw) && hasPairs(ow)) {
      race.wide = { ...ow!, retained: true, latestAttempt: { status: iw.status, state: iw.state, isMock: iw.isMock, checkedOn: iw.checkedOn, note: '今回はオッズの組み合わせが空でした。前回の値を表示しています。' } };
    } else if (hasPairs(iw) && hasPairs(ow) && iw.isMock && !ow!.isMock) {
      race.wide = { ...ow!, latestAttempt: { status: iw.status, state: iw.state, isMock: true, checkedOn: iw.checkedOn, note: '仮オッズは実オッズを上書きしません。' } };
      issues.push({ level: 'warning', where, message: '仮オッズ（is_mock）を受け取りましたが、既存の実オッズは上書きしていません。' });
    } else if (hasPairs(iw) && hasPairs(ow) && iw.sourceUpdatedAt && ow!.sourceUpdatedAt && Date.parse(iw.sourceUpdatedAt) < Date.parse(ow!.sourceUpdatedAt)) {
      race.wide = { ...ow!, latestAttempt: { status: iw.status, state: iw.state, isMock: iw.isMock, checkedOn: iw.checkedOn, note: `受け取ったオッズ（${formatJst(iw.sourceUpdatedAt)}時点）の方が古いため、前回の値を維持しました。` } };
    } else if (hasPairs(iw) && hasPairs(ow) && samePairs(iw.pairs, ow!.pairs) && iw.isMock === ow!.isMock) {
      // Identical odds received again: same data, nothing to compare.
      race.wide = { ...iw, sourceUpdatedAt: iw.sourceUpdatedAt ?? ow!.sourceUpdatedAt, orderUnknown: ow!.orderUnknown };
    } else {
      const unknownOrder = hasPairs(iw) && hasPairs(ow) && (!iw.sourceUpdatedAt || !ow!.sourceUpdatedAt);
      race.wide = { ...iw, orderUnknown: unknownOrder || undefined };
      if (hasPairs(ow) && hasPairs(iw)) race.previousWide = ow;
      if (unknownOrder) issues.push({ level: 'warning', where, message: 'ワイドオッズの情報時点が不明なため、前回と今回のどちらが新しいか判断できません。今回取り込んだ値を表示し、前回の値も残しています。' });
    }
  } else {
    race.runnersRetained = false;
  }
  race.retainedFields = retained.length ? retained : undefined;

  // Pairs must refer to runners of this race.
  if (race.wide && race.runners.length > 0) {
    const nums = new Set(race.runners.map((r) => r.horseNumber).filter((n): n is number => n !== null));
    const bad = race.wide.pairs.filter((p) => !nums.has(p.a) || !nums.has(p.b));
    if (bad.length) {
      for (const p of bad) issues.push({ level: 'error', where, message: `ワイド ${p.a}-${p.b}：出走馬にない馬番を含むため除外しました。` });
      race.wide = { ...race.wide, pairs: race.wide.pairs.filter((p) => nums.has(p.a) && nums.has(p.b)) };
    }
  } else if (race.wide && race.wide.pairs.length > 0 && race.runners.length === 0) {
    issues.push({ level: 'warning', where, message: '出走馬が未取得のため、ワイドの馬番を照合できていません。' });
  }
  return { race, issues };
}

export function mergeTrack(existing: FeedTrack | undefined, incoming: FeedTrack): FeedTrack {
  if (!existing) return incoming;
  const r: string[] = [];
  const t: FeedTrack = {
    ...incoming,
    sourceUrl: pickKeep(incoming.sourceUrl, existing.sourceUrl, '出典URL', r),
    // Each time stays attached to its own value: a kept value keeps its own time.
    goingAsOf: incoming.turfGoing !== null || incoming.dirtGoing !== null ? incoming.goingAsOf : existing.goingAsOf,
    weather: pickKeep(incoming.weather, existing.weather, '天気', r),
    turfGoing: pickKeep(incoming.turfGoing, existing.turfGoing, '芝の状態', r),
    dirtGoing: pickKeep(incoming.dirtGoing, existing.dirtGoing, 'ダートの状態', r),
    cushionValue: incoming.cushionValue ?? existing.cushionValue,
    cushionMeasuredAt: incoming.cushionValue !== null ? incoming.cushionMeasuredAt : existing.cushionMeasuredAt,
    moisture: incoming.moisture ?? existing.moisture,
    moistureMeasuredAt: incoming.moisture ? incoming.moistureMeasuredAt : existing.moistureMeasuredAt,
    course: pickKeep(incoming.course, existing.course, 'コース', r),
    turfNotes: pickKeep(incoming.turfNotes, existing.turfNotes, '芝の状態メモ', r),
  };
  if (incoming.cushionValue === null && existing.cushionValue !== null) r.push('クッション値');
  if (!incoming.moisture && existing.moisture) r.push('含水率');
  t.retainedFields = r.length ? r : undefined;
  return t;
}

/* ------------------------------------------------------------------ */
/* Track condition ↔ race                                               */

export type TrackMatch = { track: FeedTrack; current: boolean; reason: string };

/** Only "current" when the page date and the going time are both the race day; otherwise reference. */
export function matchTrack(tracks: FeedTrack[], race: Pick<FeedRace, 'sample' | 'venue' | 'date'>): TrackMatch | null {
  const same = tracks.filter((t) => t.sample === race.sample && t.venue === race.venue);
  if (!same.length) return null;
  const byDate = same.find((t) => t.pageRaceDate === race.date);
  const track = byDate ?? [...same].sort((a, b) => (b.goingAsOf ?? '').localeCompare(a.goingAsOf ?? ''))[0]!;
  const asOfDay = track.goingAsOf ? new Date(Date.parse(track.goingAsOf) + 9 * 3600_000).toISOString().slice(0, 10) : null;
  if (track.pageRaceDate === race.date && asOfDay === race.date) return { track, current: true, reason: 'レース当日の発表です。' };
  const reason = !track.pageRaceDate || track.pageRaceDate !== race.date
    ? `対象日（${track.pageRaceDate ?? '不明'}）がレース日（${race.date}）と一致しません。`
    : `馬場状態は${track.goingAsOf ? `${formatJst(track.goingAsOf)}時点` : '時点不明'}の表示で、レース当日（${race.date}）の状態ではありません。`;
  return { track, current: false, reason };
}

const na = (v: string | number | null | undefined, unit = '') => (v === null || v === undefined || v === '' ? '未取得' : `${v}${unit}`);

export function trackSummary(m: TrackMatch): string {
  const t = m.track;
  const lines = [
    m.current ? '【当日の馬場情報】' : `【参考・過去情報】${m.reason}`,
    `対象ページの開催日：${t.pageRaceDate ?? '不明'}／馬場状態の時点：${t.goingAsOf ? formatJst(t.goingAsOf) : '不明'}`,
    `天気：${na(t.weather)}／芝：${na(t.turfGoing)}／ダート：${na(t.dirtGoing)}／コース：${na(t.course)}`,
    `クッション値：${na(t.cushionValue)}（測定時刻：${t.cushionMeasuredAt ? formatJst(t.cushionMeasuredAt) : '未取得'}）`,
    `含水率（測定時刻：${t.moistureMeasuredAt ? formatJst(t.moistureMeasuredAt) : '未取得'}）：芝 ゴール前 ${na(t.moisture?.turf?.finish, '%')}・4コーナー ${na(t.moisture?.turf?.turn4, '%')}／ダート ゴール前 ${na(t.moisture?.dirt?.finish, '%')}・4コーナー ${na(t.moisture?.dirt?.turn4, '%')}`,
  ];
  if (t.turfNotes) lines.push(`芝の状態メモ：${t.turfNotes}`);
  if (t.warning) lines.push(`注意：${t.warning}`);
  if (t.retainedFields?.length) lines.push(`前回の取込から維持した項目：${t.retainedFields.join('・')}`);
  return lines.join('\n');
}

/** Fill fields added after a race was stored (older imports), so every reader sees one shape. */
export function normalizeStoredRace(r: FeedRace): FeedRace {
  return {
    ...r,
    winOddsUpdatedAt: r.winOddsUpdatedAt ?? null,
    winOddsSourceUrl: r.winOddsSourceUrl ?? null,
    runners: r.runners.map((ru) => ({
      ...ru,
      scratched: ru.scratched ?? null,
      winOdds: ru.winOdds ?? null,
      popularity: ru.popularity ?? null,
      pastRuns: ru.pastRuns ?? [],
    })),
  };
}
