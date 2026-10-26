// Fictional demo data, clearly marked. Used only when the user explicitly starts the demo.
import sample from '../templates/sample-race.json';
import { draftFromSnapshot, type Draft } from './draft';
import { raceSnapshotSchema, type AnalysisResponse, type RaceSnapshot } from './schema';

export function demoDraft(): Draft {
  const snapshot = raceSnapshotSchema.parse(sample);
  return { ...draftFromSnapshot(snapshot), isDemo: true, budget: 30000 };
}

/**
 * A fictional Claude response for the demo flow (odds are intentionally missing).
 * The sample race has only 3 runners, and JRA does not sell ワイド below 4 runners, so the demo uses 単勝 only.
 */
export function demoResponse(snapshot: RaceSnapshot): AnalysisResponse {
  const [a, b, c] = snapshot.horses.map((h) => h.id);
  const A = a ?? 'demo-a';
  const B = b ?? 'demo-b';
  const C = c ?? 'demo-c';
  const bets: AnalysisResponse['bets'] = [
    { type: 'win', horseIds: [A], amount: 4000, reason: '【架空】基本の想定で中心候補とした表示例', odds: null, oddsAt: null },
    { type: 'win', horseIds: [B], amount: 3000, reason: '【架空】馬場悪化に備えた押さえの表示例', odds: null, oddsAt: null },
  ];
  return {
    schemaVersion: 1,
    raceId: snapshot.race.id,
    snapshotId: snapshot.snapshotId,
    isDemo: true,
    status: 'provisional',
    summary: '【架空デモ】良馬場ならA馬。雨ならB馬を再評価。実在レースの分析ではありません。',
    horses: [
      { id: A, reasons: ['【架空】同距離での実績を評価する表示例'], concerns: ['【架空】湿った馬場での情報が少ない想定'], sourceIds: [] },
      { id: B, reasons: ['【架空】馬場が悪化したときの候補という表示例'], concerns: ['【架空】良馬場では再検討する想定'], sourceIds: [] },
      { id: C, reasons: ['【架空】ペースが速い場合の候補という表示例'], concerns: ['【架空】ゆっくりした展開には不確実性'], sourceIds: [] },
    ],
    scenarios: [
      { id: 'base', status: 'analyzed', order: [A, B, C], reason: '【架空】基本の想定ではA馬の同距離実績を上位に置いた表示例。' },
      { id: 'wet', status: 'analyzed', order: [B, A, C], reason: '【架空】馬場が悪化した場合、B馬を繰り上げ、A馬は湿った馬場の情報不足で2番手とした表示例。' },
      { id: 'fast', status: 'insufficient', order: [], reason: '【架空】脚質・ペースの材料がないため未分析。' },
    ],
    bets,
    budget: snapshot.budget,
    spent: 7000,
    unspent: snapshot.budget - 7000,
    maxLoss: 7000,
    calculation: { executed: false, method: '計算環境なし（架空デモ）。合計はアプリで再計算。' },
    limitations: ['架空デモ：実際の出走表・過去成績・馬場・天気・オッズは未取得', 'オッズ未取得のため配分は候補', '3頭立てのためワイドは発売対象外（JRAでは4頭以上で発売）'],
    reviewTriggers: ['馬場の悪化', '出走取消', 'オッズの大きな変動'],
    sourceIds: [],
  };
}
