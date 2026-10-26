// IndexedDB persistence. Saved analyses are append-only (a new version never overwrites an old
// one); settlements, note articles and draft images live in their own stores.
import type { Draft } from '../domain/draft';
import type { SavedAnalysis, Settlement } from '../domain/schema';

const DB_NAME = 'keiba-orbit';
const DB_VERSION = 1;

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
    req.onupgradeneeded = () => {
      const db = req.result;
      const a = db.createObjectStore('analyses', { keyPath: 'id' });
      a.createIndex('raceKey', 'raceKey');
      db.createObjectStore('settlements', { keyPath: 'analysisId' });
      db.createObjectStore('drafts');
      db.createObjectStore('images', { keyPath: 'id' });
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
  const names = ['analyses', 'settlements', 'drafts', 'images'];
  const tx = db.transaction(names, 'readwrite');
  names.forEach((n) => tx.objectStore(n).clear());
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
