import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { addAnalysis, listAnalyses, nextVersion, setNoteArticle } from './db';
import { buildExport, parseImport } from './transfer';
import { goodResponse, realSnapshot } from '../test/fixtures';
import type { SavedAnalysis } from '../domain/schema';

function rec(id: string, version: number): SavedAnalysis {
  const s = realSnapshot();
  return { id, raceKey: s.race.id, version, kind: version === 1 ? 'original' : 'revision', parentId: null, isDemo: false, createdAt: `2026-11-01T10:0${version}:00+09:00`, snapshot: s, response: goodResponse(s), noteArticle: null };
}

describe('IndexedDB storage', () => {
  it('never overwrites an existing version and increments versions', async () => {
    await addAnalysis(rec('a-1', 1));
    await expect(addAnalysis({ ...rec('a-1', 1), version: 9 })).rejects.toBeTruthy();
    expect(await nextVersion(realSnapshot().race.id)).toBe(2);
    await addAnalysis(rec('a-2', 2));
    const all = await listAnalyses();
    expect(all.map((a) => a.version)).toEqual([2, 1]);
  });

  it('stores the note article without touching the prediction', async () => {
    const before = (await listAnalyses()).find((a) => a.id === 'a-1')!;
    const after = await setNoteArticle('a-1', '# 記事', '2026-11-01T12:00:00+09:00');
    expect(after.response).toEqual(before.response);
    expect(after.noteArticle?.text).toBe('# 記事');
  });
});

describe('JSON export / import', () => {
  it('round-trips and rejects tampered records', () => {
    const a = rec('a-9', 1);
    const bundle = buildExport([a], [{ analysisId: 'a-9', recordedAt: '2026-11-01T17:00:00+09:00', payout: 0, memo: '不的中' }], '2026-11-02T00:00:00+09:00');
    const ok = parseImport(JSON.stringify(bundle));
    expect(ok.ok && ok.analyses.length === 1 && ok.settlements.length === 1).toBe(true);

    const tampered = structuredClone(bundle);
    tampered.analyses[0]!.response.spent = 100;
    const r = parseImport(JSON.stringify(tampered));
    expect(r.ok && r.analyses.length === 0 && r.rejected.length > 0).toBe(true);

    expect(parseImport('{"format":"keiba-orbit-export"').ok).toBe(false);
    expect(parseImport(JSON.stringify({ ...bundle, extra: true })).ok).toBe(false);
  });
});
