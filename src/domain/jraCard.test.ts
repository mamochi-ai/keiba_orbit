import { describe, expect, it } from 'vitest';
import { parseHeader, parseJraCard } from './jraCard';

// Shape of a JRA 出馬表 copied from Safari: header, then one row per horse with tab-separated
// cells and line breaks inside cells. Horse names are fictional.
const TAB_COPY = [
  'ホーム>競馬メニュー>出馬表',
  '出馬表 2026年11月1日（日曜）4回東京9日 11レース',
  '枠\t馬番\t馬名 / 単勝オッズ(人気)\t性齢/毛色\t前走\t前々走\t3走前\t4走前',
  '枠1白\t1\tオービットスター',
  '18.6 (7 番人気 )',
  '516kg (+14)',
  '(有)テスト',
  '\t牝4/鹿',
  '56.0 kg',
  'テスト 騎手\t2026年7月11日',
  '福島',
  '1勝クラス',
  '8 着',
  '15 頭 14 番 2 番人気',
  '1150ダ',
  '1:10.2',
  '良',
  '3F 36.9',
  '枠1白\t2 ブリンカー着用\tマルガイ ギャラクシーロード',
  '3.4 (1 番人気 )',
  '480kg (0)',
  '\t牡5/栗',
  '57.0 kg\t2026年9月1日',
  '中山',
  '2 着',
  '16 頭 3 番 1 番人気',
  '枠2黒\t3\tネビュラクイーン',
  '出走取消',
  '\t牝3/鹿\t2026年8月1日',
  '新潟',
  '取消',
  '枠2黒\t4\tコメットテイル',
  '9.9 (4 番人気 )',
  '\t牡4/黒鹿\t',
].join('\n');

describe('parseJraCard', () => {
  it('reads header, numbers, names, win odds and scratches from a tab-separated copy', () => {
    const r = parseJraCard(TAB_COPY);
    expect(r.header).toEqual({ date: '2026-11-01', venue: '東京', number: 11 });
    expect(r.horses).toEqual([
      { id: 'h01', number: 1, name: 'オービットスター', winOdds: 18.6, popularity: 7 },
      { id: 'h02', number: 2, name: 'ギャラクシーロード', winOdds: 3.4, popularity: 1 },
      { id: 'h03', number: 3, name: 'ネビュラクイーン', scratched: true, winOdds: null, popularity: null },
      { id: 'h04', number: 4, name: 'コメットテイル', winOdds: 9.9, popularity: 4 },
    ]);
    expect(r.warnings).toEqual([]);
    expect(r.body.startsWith('枠1白')).toBe(true);
    expect(r.body).not.toContain('競馬メニュー');
  });

  it('works when every cell is on its own line and digits are full-width', () => {
    const lines = TAB_COPY.replace(/\t/g, '\n').replace(/18\.6/, '１８．６');
    const r = parseJraCard(lines);
    expect(r.horses.map((h) => [h.number, h.name, h.winOdds])).toEqual([
      [1, 'オービットスター', 18.6],
      [2, 'ギャラクシーロード', 3.4],
      [3, 'ネビュラクイーン', null],
      [4, 'コメットテイル', 9.9],
    ]);
  });

  it('does not take popularity from past races as current odds', () => {
    const r = parseJraCard('枠1白\t1\tオービットスター\n\t牝4/鹿\t2026年7月11日\n8 着\n15 頭 14 番 2 番人気\n1:10.2 (0.3)');
    expect(r.horses[0]!.winOdds).toBeNull();
  });

  it('warns about gaps and duplicates and reads nothing from unrelated text', () => {
    const r = parseJraCard('枠1白\t1\tエー\n2.0 (1 番人気)\n枠2黒\t3\tシー\n5.0 (2 番人気)\n枠2黒\t3\tシー\n5.0 (2 番人気)');
    expect(r.horses.map((h) => h.number)).toEqual([1, 3]);
    expect(r.warnings.join()).toContain('馬番 2');
    expect(r.warnings.join()).toContain('2回');
    const none = parseJraCard('今日はいい天気です。<script>alert(1)</script>');
    expect(none.horses).toEqual([]);
    expect(none.body).toBe('');
  });

  it('header needs the full 出馬表 title', () => {
    expect(parseHeader('2026年3月29日（日曜）2回中京6日 11レース')).toEqual({ date: '2026-03-29', venue: '中京', number: 11 });
    expect(parseHeader('11レース')).toEqual({ date: null, venue: null, number: null });
  });
});
