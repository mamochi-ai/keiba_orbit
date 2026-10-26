import { buildSnapshot, emptyDraft, parseEntries, type Draft } from '../domain/draft';
import type { AnalysisResponse, RaceSnapshot } from '../domain/schema';

export function realDraft(over: Partial<Draft> = {}): Draft {
  const { horses } = parseEntries(['1 アルファ', '2 ブラボー', '3 チャーリー', '4 デルタ', '5 エコー', '6 フォックス', '7 ゴルフ', '8 ホテル 取消', '9 インディア'].join('\n'));
  return {
    ...emptyDraft(),
    date: '2026-11-01',
    name: 'テスト記念',
    venue: '東京',
    number: '11',
    horses,
    sources: [{ id: 'src-entries', label: '出走表', provider: 'テスト提供者', url: 'https://example.com/entries', fetchedAt: '2026-11-01T09:00:00+09:00', asOf: '2026-11-01T09:00:00+09:00', isDemo: false }],
    items: { ...emptyDraft().items, entries: { status: 'ok', sourceId: 'src-entries', text: null, error: null } },
    odds: {
      asOf: '2026-11-01T14:30:00+09:00',
      sourceId: null,
      win: [{ horseId: 'h01', odds: 3.2 }],
      wide: [{ horseIds: ['h01', 'h02'], min: 2.1, max: 2.8 }],
    },
    ...over,
  };
}

export function realSnapshot(over: Partial<Draft> = {}): RaceSnapshot {
  return buildSnapshot(realDraft(over), Date.parse('2026-11-01T10:00:00+09:00'));
}

export function goodResponse(s: RaceSnapshot, over: Partial<AnalysisResponse> = {}): AnalysisResponse {
  return {
    schemaVersion: 1,
    raceId: s.race.id,
    snapshotId: s.snapshotId,
    isDemo: s.isDemo,
    status: 'provisional',
    summary: 'テスト',
    horses: [{ id: 'h01', reasons: ['理由'], concerns: [], sourceIds: ['src-entries'] }],
    scenarios: [
      { id: 'base', status: 'analyzed', order: ['h01', 'h02'], reason: 'r' },
      { id: 'wet', status: 'insufficient', order: [], reason: '' },
    ],
    bets: [
      { type: 'win', horseIds: ['h01'], amount: 1000, reason: '', odds: null, oddsAt: null },
      { type: 'wide', horseIds: ['h01', 'h02'], amount: 2000, reason: '', odds: null, oddsAt: null },
    ],
    budget: s.budget,
    spent: 3000,
    unspent: s.budget - 3000,
    maxLoss: 3000,
    calculation: { executed: false, method: '' },
    limitations: [],
    reviewTriggers: [],
    sourceIds: [],
    ...over,
  };
}
