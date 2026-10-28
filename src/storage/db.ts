// IndexedDB persistence. Saved analyses are append-only (a new version never overwrites an old
// one); settlements, note articles and draft images live in their own stores.
import type { Draft } from '../domain/draft';
import type { SavedAnalysis, Settlement } from '../domain/schema';
import { mergeRace, mergeTrack, type FeedIssue, type FeedRace, type FeedTrack, type ParsedFeed } from '../domain/feed';

const DB_NAME = 'keiba-orbit';
const DB_VERSION = 2;

export interface StoredImage {
  id: string;
  name: string;
  type: string;
  size: number;
  blob: Blob;
  addedAt: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (e.oldVersion < 1) {
        const a = db.createObjectStore('analyses', { keyPath: 'id' });
        a.createIndex('raceKey', 'raceKey');
        db.createObjectStore('settlements', { keyPath: 'analysisId' });
        db.createObjectStore('drafts');
        db.createObjectStore('images', { keyPath: 'id' });
      }
      if (e.oldVersion < 2) {
        // Received data (受取データ). Keyed by sample|date|venue|R and sample|venue|date.
        db.createObjectStore('feedRaces', { keyPath: 'key' });
        db.createObjectStore('feedTracks', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error('IndexedDBを開けません'));
    };
  });
  return dbPromise;
}

export function resetDbForTests() {
  dbPromise = null;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name: string, mode: IDBTransactionMode) {
  const db = await openDb();
  return db.transaction(name, mode).objectStore(name);
}

export async function listAnalyses(): Promise<SavedAnalysis[]> {
  const all = (await wrap((await store('analyses', 'readonly')).getAll())) as SavedAnalysis[];
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getAnalysis(id: string): Promise<SavedAnalysis | undefined> {
  return (await wrap((await store('analyses', 'readonly')).get(id))) as SavedAnalysis | undefined;
}

/** Insert only. Fails if the id already exists, so earlier versions are never overwritten. */
export async function addAnalysis(a: SavedAnalysis): Promise<void> {
  await wrap((await store('analyses', 'readwrite')).add(a));
}

export async function nextVersion(raceKey: string): Promise<number> {
  const s = await store('analyses', 'readonly');
  const same = (await wrap(s.index('raceKey').getAll(raceKey))) as SavedAnalysis[];
  return same.reduce((m, x) => Math.max(m, x.version), 0) + 1;
}

/** The note article is an attachment; the prediction itself stays fixed. */
export async function setNoteArticle(id: string, text: string | null, updatedAt: string): Promise<SavedAnalysis> {
  const db = await openDb();
  const tx = db.transaction('analyses', 'readwrite');
  const s = tx.objectStore('analyses');
  const cur = (await wrap(s.get(id))) as SavedAnalysis | undefined;
  if (!cur) throw new Error('保存した分析が見つかりません');
  const next: SavedAnalysis = { ...cur, noteArticle: text === null ? null : { text, updatedAt } };
  await wrap(s.put(next));
  return next;
}

export async function deleteAnalysis(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['analyses', 'settlements'], 'readwrite');
  tx.objectStore('analyses').delete(id);
  tx.objectStore('settlements').delete(id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listSettlements(): Promise<Settlement[]> {
  return (await wrap((await store('settlements', 'readonly')).getAll())) as Settlement[];
}

export async function putSettlement(s: Settlement): Promise<void> {
  await wrap((await store('settlements', 'readwrite')).put(s));
}

export async function deleteSettlement(analysisId: string): Promise<void> {
  await wrap((await store('settlements', 'readwrite')).delete(analysisId));
}

export async function loadDraft(): Promise<Draft | undefined> {
  return (await wrap((await store('drafts', 'readonly')).get('current'))) as Draft | undefined;
}

export async function saveDraft(d: Draft): Promise<void> {
  await wrap((await store('drafts', 'readwrite')).put(d, 'current'));
}

export async function listImages(): Promise<StoredImage[]> {
  const all = (await wrap((await store('images', 'readonly')).getAll())) as StoredImage[];
  return all.sort((a, b) => a.addedAt.localeCompare(b.addedAt));
}

export async function addImage(img: StoredImage): Promise<void> {
  await wrap((await store('images', 'readwrite')).add(img));
}

export async function deleteImage(id: string): Promise<void> {
  await wrap((await store('images', 'readwrite')).delete(id));
}

export async function clearImages(): Promise<void> {
  await wrap((await store('images', 'readwrite')).clear());
}

export async function clearAll(): Promise<void> {
  const db = await openDb();
  const names = ['analyses', 'settlements', 'drafts', 'images', 'feedRaces', 'feedTracks'];
  const tx = db.transaction(names, 'readwrite');
  names.forEach((n) => tx.objectStore(n).clear());
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ---------------- Received data (受取データ) ---------------- */

export async function listFeedRaces(): Promise<FeedRace[]> {
  const all = (await wrap((await store('feedRaces', 'readonly')).getAll())) as FeedRace[];
  return all.sort((a, b) => a.date.localeCompare(b.date) || a.venue.localeCompare(b.venue) || a.number - b.number);
}

export async function getFeedRace(key: string): Promise<FeedRace | undefined> {
  return (await wrap((await store('feedRaces', 'readonly')).get(key))) as FeedRace | undefined;
}

export async function listFeedTracks(): Promise<FeedTrack[]> {
  return (await wrap((await store('feedTracks', 'readonly')).getAll())) as FeedTrack[];
}

export interface FeedApplyResult {
  added: number;
  updated: number;
  runners: number;
  pairs: number;
  mockPairs: number;
  tracks: number;
  issues: FeedIssue[];
}

/** Merge a parsed file into the stores in one transaction. Re-importing updates, never duplicates. */
export async function applyFeed(feed: ParsedFeed): Promise<FeedApplyResult> {
  const db = await openDb();
  const tx = db.transaction(['feedRaces', 'feedTracks'], 'readwrite');
  const races = tx.objectStore('feedRaces');
  const tracks = tx.objectStore('feedTracks');
  const result: FeedApplyResult = { added: 0, updated: 0, runners: 0, pairs: 0, mockPairs: 0, tracks: 0, issues: [...feed.issues] };
  for (const incoming of feed.races) {
    const existing = (await wrap(races.get(incoming.key))) as FeedRace | undefined;
    const { race, issues } = mergeRace(existing, incoming);
    races.put(race);
    if (existing) result.updated++;
    else result.added++;
    result.runners += race.runners.length;
    if (race.wide?.isMock) result.mockPairs += race.wide.pairs.length;
    else result.pairs += race.wide?.pairs.length ?? 0;
    result.issues.push(...issues);
  }
  for (const incoming of feed.tracks) {
    const existing = (await wrap(tracks.get(incoming.key))) as FeedTrack | undefined;
    tracks.put(mergeTrack(existing, incoming));
    result.tracks++;
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return result;
}

export async function deleteFeedRace(key: string): Promise<void> {
  await wrap((await store('feedRaces', 'readwrite')).delete(key));
}

/** Remove all sample (test) data, races and track conditions. */
export async function clearSampleFeed(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['feedRaces', 'feedTracks'], 'readwrite');
  for (const name of ['feedRaces', 'feedTracks']) {
    const s = tx.objectStore(name);
    const all = (await wrap(s.getAll())) as { key: string; sample: boolean }[];
    all.filter((x) => x.sample).forEach((x) => s.delete(x.key));
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
