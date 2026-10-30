import { describe, expect, it } from 'vitest';
import { humanizeIds, splitSummary } from './reportText';

const snap = { horses: [{ id: 'h05', number: 5, name: 'マルモリマイベスト' }, { id: 'h01', number: 1, name: 'A' }, { id: 'h10', number: 10, name: 'B' }] };

describe('report text helpers', () => {
  it('splits a tagged summary into one line per tag, keeping every word', () => {
    const s = '【事実】京都1R、16頭。【事実】馬場は前日の情報。【推測】h05を最上位とした。';
    expect(splitSummary(s)).toEqual([
      { tag: '事実', text: '京都1R、16頭。' },
      { tag: '事実', text: '馬場は前日の情報。' },
      { tag: '推測', text: 'h05を最上位とした。' },
    ]);
    expect(splitSummary('タグなしの結論。')).toEqual([{ tag: null, text: 'タグなしの結論。' }]);
    expect(splitSummary('前置き【推測】本文')).toEqual([
      { tag: null, text: '前置き' },
      { tag: '推測', text: '本文' },
    ]);
    expect(splitSummary('  ')).toEqual([]);
  });

  it('replaces only this race’s horse ids with 馬番', () => {
    expect(humanizeIds('h05マルモリマイベストと h10・h01、h1 と h050 と xh05 はそのまま', snap)).toBe('5番マルモリマイベストと 10番・1番、h1 と h050 と xh05 はそのまま');
    expect(humanizeIds('demo-a', { horses: [{ id: 'demo-a', number: 4, name: 'D' }] })).toBe('4番');
  });
});
