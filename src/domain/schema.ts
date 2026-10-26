// Input (race snapshot) and output (Claude analysis) types, schemaVersion = 1.
// All objects are strict: unknown fields are rejected. Strings, arrays and numbers are bounded.
import { z } from 'zod';

export const MAX_BUDGET = 30000;
export const MAX_HORSES = 18;
export const MAX_PASTE_BYTES = 200_000;
export const MAX_IMPORT_BYTES = 5_000_000;
export const MAX_IMAGE_BYTES = 10_000_000;
export const MAX_IMAGES = 5;

export const VENUES = ['札幌', '函館', '福島', '新潟', '東京', '中山', '中京', '京都', '阪神', '小倉'] as const;
export type Venue = (typeof VENUES)[number];

const text = (max: number) => z.string().max(max, `${max}文字以内にしてください`);
const reqText = (max: number) => text(max).min(1, '空欄です');
export const idString = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, '英数字・-・_ の64文字以内のIDが必要です');
// ISO 8601 with explicit offset (e.g. 2026-10-26T15:00:00+09:00). JST is used for display.
export const isoDateTime = z.iso.datetime({ offset: true, message: '日時はタイムゾーン付きISO形式で指定してください' });
export const isoDate = z.iso.date({ message: '日付は YYYY-MM-DD 形式で指定してください' });

/** Only http/https URLs are accepted anywhere in the app. */
export function isSafeHttpUrl(value: string): boolean {
  if (value.length > 2000) return false;
  try {
    const u = new URL(value);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.username === '' && u.password === '';
  } catch {
    return false;
  }
}
export const httpUrl = z.string().refine(isSafeHttpUrl, 'URLは http:// または https:// のみ使用できます');

export const horseSchema = z.strictObject({
  id: idString,
  number: z.int().min(1).max(MAX_HORSES),
  name: reqText(40),
  scratched: z.boolean().optional(),
});
export type Horse = z.infer<typeof horseSchema>;

export const sourceSchema = z.strictObject({
  id: idString,
  label: reqText(60),
  provider: reqText(80),
  url: httpUrl.nullable(),
  fetchedAt: isoDateTime.nullable(),
  asOf: isoDateTime.nullable(),
  isDemo: z.boolean(),
});
export type Source = z.infer<typeof sourceSchema>;

export const ITEM_KEYS = ['identity', 'entries', 'past', 'track', 'weather', 'odds'] as const;
export type ItemKey = (typeof ITEM_KEYS)[number];
export const ITEM_LABELS: Record<ItemKey, string> = {
  identity: 'レース同定',
  entries: '出走表',
  past: '過去成績',
  track: '馬場',
  weather: '天気',
  odds: 'オッズ',
};

export const itemStatus = z.enum(['missing', 'ok', 'stale', 'error']);
export type ItemStatus = z.infer<typeof itemStatus>;

export const dataItemSchema = z.strictObject({
  status: itemStatus,
  sourceId: idString.nullable(),
  text: text(8000).nullable(),
  error: text(300).nullable().optional(),
});
export type DataItem = z.infer<typeof dataItemSchema>;

export const oddsRangeSchema = z
  .strictObject({ min: z.number().min(1).max(99999), max: z.number().min(1).max(99999) })
  .refine((r) => r.min <= r.max, 'オッズの min は max 以下にしてください');

export const oddsSchema = z.strictObject({
  asOf: isoDateTime.nullable(),
  sourceId: idString.nullable(),
  win: z.array(z.strictObject({ horseId: idString, odds: z.number().min(1).max(99999) })).max(MAX_HORSES),
  wide: z
    .array(z.strictObject({ horseIds: z.tuple([idString, idString]), min: z.number().min(1).max(99999), max: z.number().min(1).max(99999) }))
    .max(200),
});
export type Odds = z.infer<typeof oddsSchema>;

export const raceSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  isDemo: z.boolean(),
  race: z.strictObject({
    id: idString,
    date: isoDate.nullable(),
    name: reqText(80),
    venue: z.enum(VENUES).nullable(),
    number: z.int().min(1).max(12).nullable(),
  }),
  snapshotId: idString,
  cutoffAt: isoDateTime.nullable(),
  mode: z.enum(['day', 'eve']),
  budget: z.int().min(0).max(MAX_BUDGET).multipleOf(100, '予算は100円単位です'),
  horses: z.array(horseSchema).max(MAX_HORSES),
  sources: z.array(sourceSchema).max(30),
  missing: z.array(reqText(60)).max(20),
  note: text(500).optional(),
  items: z.partialRecord(z.enum(ITEM_KEYS), dataItemSchema).optional(),
  odds: oddsSchema.nullable().optional(),
  references: z.strictObject({ text: text(4000), imageNames: z.array(reqText(120)).max(5) }).optional(),
});
export type RaceSnapshot = z.infer<typeof raceSnapshotSchema>;

const stringList = (maxItems: number, maxLen: number) => z.array(reqText(maxLen)).max(maxItems);

export const betOddsSchema = z.union([z.number().min(1).max(99999), oddsRangeSchema]).nullable();

export const betSchema = z.strictObject({
  type: z.enum(['win', 'wide'], { message: '券種は win（単勝）か wide（ワイド）のみ対応しています' }),
  horseIds: z.array(idString).min(1).max(2),
  amount: z.int().min(0).max(MAX_BUDGET),
  reason: text(300),
  odds: betOddsSchema,
  oddsAt: isoDateTime.nullable(),
});
export type Bet = z.infer<typeof betSchema>;

export const SCENARIO_IDS = ['base', 'wet', 'fast'] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];
export const SCENARIO_LABELS: Record<ScenarioId, string> = { base: '基本の想定', wet: '馬場が悪化', fast: '速いペース' };

export const analysisResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  raceId: idString,
  snapshotId: idString,
  isDemo: z.boolean(),
  status: z.enum(['provisional', 'ready', 'insufficient']),
  summary: text(1000),
  horses: z
    .array(
      z.strictObject({
        id: idString,
        reasons: stringList(8, 300),
        concerns: stringList(8, 300),
        sourceIds: z.array(idString).max(30),
      }),
    )
    .max(MAX_HORSES),
  scenarios: z
    .array(
      z.strictObject({
        id: z.enum(SCENARIO_IDS),
        status: z.enum(['analyzed', 'insufficient']),
        order: z.array(idString).max(MAX_HORSES),
        reason: text(1000),
      }),
    )
    .max(3),
  bets: z.array(betSchema).max(20),
  budget: z.int().min(0).max(MAX_BUDGET),
  spent: z.int().min(0),
  unspent: z.int(),
  maxLoss: z.int().min(0),
  calculation: z.strictObject({ executed: z.boolean(), method: text(500) }),
  limitations: stringList(20, 300),
  reviewTriggers: stringList(20, 300),
  sourceIds: z.array(idString).max(30),
});
export type AnalysisResponse = z.infer<typeof analysisResponseSchema>;

export const noteArticleSchema = z.strictObject({ text: text(60000), updatedAt: isoDateTime });

export const savedAnalysisSchema = z.strictObject({
  id: idString,
  raceKey: idString,
  version: z.int().min(1).max(999),
  kind: z.enum(['original', 'revision']),
  parentId: idString.nullable(),
  isDemo: z.boolean(),
  createdAt: isoDateTime,
  snapshot: raceSnapshotSchema,
  response: analysisResponseSchema,
  noteArticle: noteArticleSchema.nullable(),
});
export type SavedAnalysis = z.infer<typeof savedAnalysisSchema>;

export const settlementSchema = z.strictObject({
  analysisId: idString,
  recordedAt: isoDateTime,
  payout: z.int().min(0).max(100_000_000),
  memo: text(500),
});
export type Settlement = z.infer<typeof settlementSchema>;

export const exportBundleSchema = z.strictObject({
  format: z.literal('keiba-orbit-export'),
  schemaVersion: z.literal(1),
  exportedAt: isoDateTime,
  analyses: z.array(savedAnalysisSchema).max(500),
  settlements: z.array(settlementSchema).max(500),
});
export type ExportBundle = z.infer<typeof exportBundleSchema>;

/** Flatten zod issues into short Japanese messages with a JSON path. */
export function formatZodIssues(error: z.ZodError, max = 12): string[] {
  const out = error.issues.slice(0, max).map((i) => {
    const path = i.path.length ? i.path.map(String).join('.') : '(全体)';
    let msg = i.message;
    if (i.code === 'unrecognized_keys') msg = `未知のフィールド: ${i.keys.join(', ')}`;
    return `${path}: ${msg}`;
  });
  if (error.issues.length > max) out.push(`ほか ${error.issues.length - max} 件`);
  return out;
}
