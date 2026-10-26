import { describe, expect, it } from 'vitest';
import { checkResponse, parseSnapshot } from './validate';
import { goodResponse, realSnapshot } from '../test/fixtures';
import { buildSnapshot } from './draft';
import { demoDraft, demoResponse } from './demo';
import sample from '../templates/sample-race.json';

const errors = (r: ReturnType<typeof checkResponse>) => r.issues.filter((i) => i.level === 'error').map((i) => i.message).join('\n');

describe('checkResponse', () => {
  const s = realSnapshot();

  it('accepts a consistent response', () => {
    const r = checkResponse(s, goodResponse(s));
    expect(errors(r)).toBe('');
    expect(r.ok).toBe(true);
    expect(r.totals).toEqual({ spent: 3000, unspent: 27000, maxLoss: 3000 });
  });

  it('rejects a response for another race', () => {
    const r = checkResponse(s, goodResponse(s, { raceId: '2026-11-01-kyoto-11r' }));
    expect(r.ok).toBe(false);
    expect(errors(r)).toContain('別レース');
  });

  it('rejects a mismatched snapshotId', () => {
    expect(errors(checkResponse(s, goodResponse(s, { snapshotId: 's-deadbeef' })))).toContain('版と一致しません');
  });

  it('rejects totals that do not match the bets (合計不一致)', () => {
    const r = checkResponse(s, goodResponse(s, { spent: 2500, unspent: 27500, maxLoss: 2500 }));
    expect(r.ok).toBe(false);
    expect(errors(r)).toContain('使用額の合計が一致しません');
    expect(errors(r)).toContain('最大損失が一致しません');
  });

  it('rejects a budget overrun', () => {
    const bets = [{ type: 'win' as const, horseIds: ['h01'], amount: 30100, reason: '', odds: null, oddsAt: null }];
    const r = checkResponse(s, goodResponse(s, { bets, spent: 30100, unspent: -100, maxLoss: 30100 }));
    expect(r.ok).toBe(false);
  });

  it('flags budget overrun even when amounts are within schema limits', () => {
    const bets = [
      { type: 'win' as const, horseIds: ['h01'], amount: 20000, reason: '', odds: null, oddsAt: null },
      { type: 'win' as const, horseIds: ['h02'], amount: 20000, reason: '', odds: null, oddsAt: null },
    ];
    const r = checkResponse(s, goodResponse(s, { bets, spent: 40000, unspent: -10000, maxLoss: 40000 }));
    expect(errors(r)).toContain('予算超過');
  });

  it('rejects a wide bet on the same horse twice', () => {
    const bets = [{ type: 'wide' as const, horseIds: ['h01', 'h01'], amount: 1000, reason: '', odds: null, oddsAt: null }];
    const r = checkResponse(s, goodResponse(s, { bets, spent: 1000, unspent: 29000, maxLoss: 1000 }));
    expect(errors(r)).toContain('同じ馬が2回');
  });

  it('rejects a win bet with two horses and unsupported bet types', () => {
    const win2 = [{ type: 'win' as const, horseIds: ['h01', 'h02'], amount: 1000, reason: '', odds: null, oddsAt: null }];
    expect(errors(checkResponse(s, goodResponse(s, { bets: win2, spent: 1000, unspent: 29000, maxLoss: 1000 })))).toContain('単勝は1頭');
    const bad = goodResponse(s) as unknown as { bets: { type: string }[] };
    bad.bets[0]!.type = 'trifecta';
    expect(checkResponse(s, bad).ok).toBe(false);
  });

  it('rejects horses that are not running and scratched horses in bets', () => {
    const ghost = [{ type: 'win' as const, horseIds: ['h17'], amount: 1000, reason: '', odds: null, oddsAt: null }];
    expect(errors(checkResponse(s, goodResponse(s, { bets: ghost, spent: 1000, unspent: 29000, maxLoss: 1000 })))).toContain('出走していない馬ID');
    const scratched = [{ type: 'win' as const, horseIds: ['h08'], amount: 1000, reason: '', odds: null, oddsAt: null }];
    expect(errors(checkResponse(s, goodResponse(s, { bets: scratched, spent: 1000, unspent: 29000, maxLoss: 1000 })))).toContain('出走取消');
  });

  it('rejects amounts that are not positive 100-yen units', () => {
    const bets = [{ type: 'win' as const, horseIds: ['h01'], amount: 150, reason: '', odds: null, oddsAt: null }];
    expect(errors(checkResponse(s, goodResponse(s, { bets, spent: 150, unspent: 29850, maxLoss: 150 })))).toContain('100円単位');
  });

  it('rejects unknown fields and oversized strings', () => {
    expect(checkResponse(s, { ...goodResponse(s), extra: 1 }).ok).toBe(false);
    expect(checkResponse(s, goodResponse(s, { summary: 'あ'.repeat(1001) })).ok).toBe(false);
  });

  it('rejects source ids that are not in the input', () => {
    expect(errors(checkResponse(s, goodResponse(s, { sourceIds: ['made-up'] })))).toContain('入力にない出典ID');
  });

  it('rejects a demo response mixed into real data', () => {
    expect(errors(checkResponse(s, goodResponse(s, { isDemo: true })))).toContain('架空デモ');
  });

  it('warns (not errors) on empty bets and missing odds', () => {
    const empty = checkResponse(s, goodResponse(s, { bets: [], spent: 0, unspent: 30000, maxLoss: 0, status: 'ready' }));
    expect(empty.ok).toBe(true);
    expect(empty.issues.some((i) => i.level === 'warning' && i.message.includes('配分が空'))).toBe(true);
    const noOdds = realSnapshot({ odds: null });
    const r = checkResponse(noOdds, goodResponse(noOdds));
    expect(r.ok).toBe(true);
    expect(r.issues.some((i) => i.message.includes('オッズが未取得'))).toBe(true);
  });

  it('rejects wide bets in a race with fewer than 4 runners', () => {
    const small = realSnapshot({ horses: realSnapshot().horses.slice(0, 3) });
    const bets = [{ type: 'wide' as const, horseIds: ['h01', 'h02'], amount: 1000, reason: '', odds: null, oddsAt: null }];
    expect(errors(checkResponse(small, goodResponse(small, { bets, spent: 1000, unspent: 29000, maxLoss: 1000 })))).toContain('ワイドは発売されません');
  });
});

describe('snapshot checks', () => {
  it('accepts the bundled sample-race.json (demo)', () => {
    expect(parseSnapshot(sample).ok).toBe(true);
  });

  it('rejects duplicate horse numbers', () => {
    const s = realSnapshot();
    const dup = { ...s, horses: [...s.horses, { id: 'h99', number: 1, name: '重複' }] };
    const r = parseSnapshot(dup);
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.message).join()).toContain('馬番 1 が重複');
  });

  it('rejects fictional demo data mixed into a real snapshot', () => {
    const s = realSnapshot();
    expect(parseSnapshot({ ...s, horses: [...s.horses, { id: 'demo-a', number: 18, name: 'A馬（架空）' }] }).ok).toBe(false);
    expect(parseSnapshot({ ...s, sources: [{ ...s.sources[0]!, isDemo: true }] }).ok).toBe(false);
  });

  it('rejects dangerous URLs in sources', () => {
    const s = realSnapshot();
    for (const url of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd', 'https://user:pw@example.com/']) {
      expect(parseSnapshot({ ...s, sources: [{ ...s.sources[0]!, url }] }).ok, url).toBe(false);
    }
    expect(parseSnapshot({ ...s, sources: [{ ...s.sources[0]!, url: 'http://example.com/a?b=1' }] }).ok).toBe(true);
  });

  it('the demo flow validates end to end', () => {
    const snap = buildSnapshot(demoDraft());
    expect(parseSnapshot(snap).ok).toBe(true);
    const r = checkResponse(snap, demoResponse(snap));
    expect(r.ok).toBe(true);
  });
});
