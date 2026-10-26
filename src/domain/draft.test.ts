import { describe, expect, it } from 'vitest';
import { buildSnapshot, parseEntries, parseOdds, validateHome, emptyDraft } from './draft';
import { realDraft } from '../test/fixtures';
import { jstLocalToIso, formatJst } from './time';

describe('draft', () => {
  it('parses entries including scratched horses and rejects duplicates', () => {
    const r = parseEntries('4 A\n7,B 取消\n4 C\nxx');
    expect(r.horses).toEqual([
      { id: 'h04', number: 4, name: 'A' },
      { id: 'h07', number: 7, name: 'B', scratched: true },
    ]);
    expect(r.errors.map((e) => e.line)).toEqual([3, 4]);
  });

  it('parses win and wide odds by horse number', () => {
    const { horses } = parseEntries('1 A\n2 B');
    const r = parseOdds('1 3.2\n1-2 2.1-2.8\n1-1 2 3\n9 4.0', horses);
    expect(r.win).toEqual([{ horseId: 'h01', odds: 3.2 }]);
    expect(r.wide).toEqual([{ horseIds: ['h01', 'h02'], min: 2.1, max: 2.8 }]);
    expect(r.errors.map((e) => e.line)).toEqual([3, 4]);
  });

  it('requires date and race name for a real race', () => {
    const e = validateHome(emptyDraft());
    expect(e.date).toBeTruthy();
    expect(e.name).toBeTruthy();
    expect(validateHome({ ...emptyDraft(), date: '2026-11-01', name: 'x', budget: 150 }).budget).toBeTruthy();
  });

  it('gives identical content the same snapshotId and changed content a new one', () => {
    const now = Date.parse('2026-11-01T10:00:00+09:00');
    const a = buildSnapshot(realDraft(), now);
    expect(buildSnapshot(realDraft(), now).snapshotId).toBe(a.snapshotId);
    expect(buildSnapshot(realDraft({ budget: 20000 }), now).snapshotId).not.toBe(a.snapshotId);
    expect(a.race.id).toBe('2026-11-01-tokyo-11r');
    expect(a.missing).toContain('過去成績');
  });

  it('marks odds older than 30 minutes as stale', () => {
    const d = realDraft({
      sources: [...realDraft().sources, { id: 'src-odds', label: 'オッズ', provider: 'p', url: null, fetchedAt: '2026-11-01T09:00:00+09:00', asOf: null, isDemo: false }],
    });
    d.items.odds = { status: 'ok', sourceId: 'src-odds', text: null, error: null };
    const s = buildSnapshot(d, Date.parse('2026-11-01T10:00:00+09:00'));
    expect(s.items?.odds?.status).toBe('stale');
  });

  it('handles JST conversion', () => {
    expect(jstLocalToIso('2026-11-01T15:40')).toBe('2026-11-01T15:40:00+09:00');
    expect(formatJst('2026-11-01T06:40:00Z')).toBe('2026/11/01 15:40 JST');
  });
});
