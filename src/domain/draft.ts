// The working draft on the Home / Preparation screens, and the conversion to a race snapshot.
import {
  ITEM_KEYS,
  ITEM_LABELS,
  type DataItem,
  type Horse,
  type ItemKey,
  type Odds,
  type RaceSnapshot,
  type Source,
  type Venue,
} from './schema';
import { ageMinutes, isoToJstLocal, jstLocalToIso } from './time';

export const VENUE_CODES: Record<Venue, string> = {
  札幌: 'sapporo',
  函館: 'hakodate',
  福島: 'fukushima',
  新潟: 'niigata',
  東京: 'tokyo',
  中山: 'nakayama',
  中京: 'chukyo',
  京都: 'kyoto',
  阪神: 'hanshin',
  小倉: 'kokura',
};

export interface Draft {
  isDemo: boolean;
  date: string;
  name: string;
  venue: Venue | '';
  number: string;
  mode: 'day' | 'eve';
  budget: number;
  cutoffLocal: string;
  referenceText: string;
  imageNames: string[];
  horses: Horse[];
  sources: Source[];
  items: Record<ItemKey, DataItem>;
  odds: Odds | null;
  confirmed: boolean;
  copied: RaceSnapshot | null;
  parentId: string | null;
  demoNote?: string;
}

export const emptyItem = (): DataItem => ({ status: 'missing', sourceId: null, text: null, error: null });

export function emptyItems(): Record<ItemKey, DataItem> {
  return Object.fromEntries(ITEM_KEYS.map((k) => [k, emptyItem()])) as Record<ItemKey, DataItem>;
}

export function emptyDraft(): Draft {
  return {
    isDemo: false,
    date: '',
    name: '',
    venue: '',
    number: '',
    mode: 'day',
    budget: 30000,
    cutoffLocal: '',
    referenceText: '',
    imageNames: [],
    horses: [],
    sources: [],
    items: emptyItems(),
    odds: null,
    confirmed: false,
    copied: null,
    parentId: null,
  };
}

/** FNV-1a 32-bit, used to give each distinct snapshot content a stable id. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function raceIdFor(d: Pick<Draft, 'isDemo' | 'date' | 'venue' | 'number' | 'name'>): string {
  const prefix = d.isDemo ? 'demo-' : '';
  if (d.isDemo) return `${prefix}race-${fnv1a(d.name)}`;
  if (d.venue && d.number) return `${d.date}-${VENUE_CODES[d.venue]}-${d.number}r`;
  return `${d.date}-race-${fnv1a(d.name)}`;
}

/** How old a source may get before it is shown as 「古い」. Null = does not go stale. */
export const STALE_MINUTES: Record<ItemKey, number | null> = {
  identity: null,
  entries: 12 * 60,
  past: null,
  track: 3 * 60,
  weather: 3 * 60,
  odds: 30,
};

export function hasData(d: Draft, key: ItemKey): boolean {
  switch (key) {
    case 'identity':
      return Boolean(d.date && d.name && d.venue && d.number);
    case 'entries':
      return d.horses.length > 0;
    case 'odds':
      return Boolean(d.odds && (d.odds.win.length > 0 || d.odds.wide.length > 0));
    default:
      return Boolean(d.items[key].text?.trim());
  }
}

export function itemStatus(d: Draft, key: ItemKey, now = Date.now()): DataItem['status'] {
  const item = d.items[key];
  if (item.status === 'error') return 'error';
  if (!hasData(d, key)) return 'missing';
  const src = d.sources.find((s) => s.id === item.sourceId);
  const limit = STALE_MINUTES[key];
  // The information time (asOf) decides freshness when known; otherwise the fetch time.
  const age = ageMinutes(src?.asOf ?? src?.fetchedAt ?? null, now);
  if (limit !== null && age !== null && age > limit) return 'stale';
  return 'ok';
}

export interface HomeErrors {
  date?: string;
  name?: string;
  budget?: string;
  number?: string;
}

export function validateHome(d: Draft): HomeErrors {
  const e: HomeErrors = {};
  if (!d.isDemo && !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) e.date = '開催日を入力してください';
  if (!d.name.trim()) e.name = 'レース名を入力してください';
  else if (d.name.length > 80) e.name = '80文字以内にしてください';
  if (!Number.isInteger(d.budget) || d.budget < 0 || d.budget > 30000 || d.budget % 100 !== 0)
    e.budget = '予算は0〜30,000円の100円単位で入力してください';
  if (d.number && !/^(?:[1-9]|1[0-2])$/.test(d.number)) e.number = 'レース番号は1〜12です';
  return e;
}

export function buildSnapshot(d: Draft, now = Date.now()): RaceSnapshot {
  const items = Object.fromEntries(
    ITEM_KEYS.map((k) => [k, { ...d.items[k], status: itemStatus(d, k, now) }]),
  ) as Record<ItemKey, DataItem>;
  const missing = ITEM_KEYS.filter((k) => items[k].status !== 'ok').map((k) => {
    const s = items[k].status;
    return `${ITEM_LABELS[k]}${s === 'stale' ? '（古い情報）' : s === 'error' ? '（取得エラー）' : ''}`;
  });
  const base: Omit<RaceSnapshot, 'snapshotId'> = {
    schemaVersion: 1,
    isDemo: d.isDemo,
    race: {
      id: raceIdFor(d),
      date: d.date || null,
      name: d.name.trim(),
      venue: d.venue || null,
      number: d.number ? Number(d.number) : null,
    },
    cutoffAt: jstLocalToIso(d.cutoffLocal),
    mode: d.mode,
    budget: d.budget,
    horses: d.horses,
    sources: d.sources,
    missing,
    ...(d.demoNote ? { note: d.demoNote } : {}),
    items,
    odds: d.odds,
    references: { text: d.referenceText, imageNames: d.imageNames },
  };
  const hash = fnv1a(JSON.stringify(base));
  return { ...base, snapshotId: `${d.isDemo ? 'demo-' : 's-'}${hash}` } as RaceSnapshot;
}

/** Restore a draft from a snapshot (re-analysis or import of a race snapshot JSON). */
export function draftFromSnapshot(s: RaceSnapshot, parentId: string | null = null): Draft {
  const items = emptyItems();
  for (const k of ITEM_KEYS) {
    const it = s.items?.[k];
    if (it) items[k] = { ...it, status: it.status === 'error' ? 'error' : 'ok' };
  }
  return {
    ...emptyDraft(),
    isDemo: s.isDemo,
    date: s.race.date ?? '',
    name: s.race.name,
    venue: s.race.venue ?? '',
    number: s.race.number ? String(s.race.number) : '',
    mode: s.mode,
    budget: s.budget,
    cutoffLocal: isoToJstLocal(s.cutoffAt),
    referenceText: s.references?.text ?? '',
    imageNames: [],
    horses: s.horses,
    sources: s.sources,
    items,
    odds: s.odds ?? null,
    parentId,
    demoNote: s.note,
  };
}

export interface LineError {
  line: number;
  message: string;
}

/** "4 A馬" / "4,A馬" / "4\tA馬 取消" per line → horses with stable ids h01…h18. */
export function parseEntries(text: string, idPrefix = 'h'): { horses: Horse[]; errors: LineError[] } {
  const horses: Horse[] = [];
  const errors: LineError[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const m = /^(\d{1,2})[\s,，、\t]+(.+?)$/.exec(line);
    if (!m) return errors.push({ line: i + 1, message: '「馬番 馬名」の形で入力してください' });
    const number = Number(m[1]);
    let name = m[2]!.trim();
    const scratched = /(出走取消|取消|除外)$/.test(name);
    name = name.replace(/[\s(（]*(出走取消|取消|除外)[)）]?$/, '').trim();
    if (number < 1 || number > 18) return errors.push({ line: i + 1, message: '馬番は1〜18です' });
    if (!name || name.length > 40) return errors.push({ line: i + 1, message: '馬名は1〜40文字です' });
    if (horses.some((h) => h.number === number)) return errors.push({ line: i + 1, message: `馬番 ${number} が重複しています` });
    horses.push({ id: `${idPrefix}${String(number).padStart(2, '0')}`, number, name, ...(scratched ? { scratched: true } : {}) });
  });
  horses.sort((a, b) => a.number - b.number);
  return { horses, errors };
}

/** Win: "4 3.2". Wide: "4-7 2.1-2.8" or "4-7 2.1 2.8". Horse numbers must exist in the entries. */
export function parseOdds(text: string, horses: Horse[]): { win: Odds['win']; wide: Odds['wide']; errors: LineError[] } {
  const byNumber = new Map(horses.map((h) => [h.number, h]));
  const win: Odds['win'] = [];
  const wide: Odds['wide'] = [];
  const errors: LineError[] = [];
  const num = (s: string) => Number(s);
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim().replace(/[－―ー〜~]/g, '-');
    if (!line) return;
    const wm = /^(\d{1,2})\s*-\s*(\d{1,2})\s+(\d+(?:\.\d)?)(?:\s*-\s*|\s+)(\d+(?:\.\d)?)$/.exec(line);
    const sm = /^(\d{1,2})\s+(\d+(?:\.\d)?)$/.exec(line);
    if (wm) {
      const a = byNumber.get(num(wm[1]!));
      const b = byNumber.get(num(wm[2]!));
      const min = num(wm[3]!);
      const max = num(wm[4]!);
      if (!a || !b) return errors.push({ line: i + 1, message: '出走表にない馬番です' });
      if (a.id === b.id) return errors.push({ line: i + 1, message: 'ワイドは異なる2頭です' });
      if (min < 1 || max < min) return errors.push({ line: i + 1, message: 'オッズは 1.0 以上、min ≦ max にしてください' });
      wide.push({ horseIds: [a.id, b.id], min, max });
    } else if (sm) {
      const h = byNumber.get(num(sm[1]!));
      const odds = num(sm[2]!);
      if (!h) return errors.push({ line: i + 1, message: '出走表にない馬番です' });
      if (odds < 1) return errors.push({ line: i + 1, message: 'オッズは 1.0 以上です' });
      if (win.some((w) => w.horseId === h.id)) return errors.push({ line: i + 1, message: '同じ馬の単勝オッズが重複しています' });
      win.push({ horseId: h.id, odds });
    } else {
      errors.push({ line: i + 1, message: '単勝「4 3.2」またはワイド「4-7 2.1-2.8」の形で入力してください' });
    }
  });
  return { win, wide, errors };
}
