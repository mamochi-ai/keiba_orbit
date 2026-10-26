// Semantic checks on top of the zod schemas. Errors block the import; warnings are shown on
// the confirmation screen and the report.
import {
  analysisResponseSchema,
  formatZodIssues,
  raceSnapshotSchema,
  type AnalysisResponse,
  type RaceSnapshot,
} from './schema';
import { activeRunners, computeTotals, findOdds, isValidStake, type Totals } from './money';

export interface Issue {
  level: 'error' | 'warning';
  message: string;
}

const error = (message: string): Issue => ({ level: 'error', message });
const warning = (message: string): Issue => ({ level: 'warning', message });

export function looksLikeDemoId(id: string): boolean {
  return /^demo[-_]/i.test(id);
}

export function horseLabel(snapshot: RaceSnapshot, id: string): string {
  const h = snapshot.horses.find((x) => x.id === id);
  return h ? `${h.number}番 ${h.name}` : `不明な馬(${id})`;
}

export function checkSnapshot(snapshot: RaceSnapshot): Issue[] {
  const issues: Issue[] = [];
  const ids = new Set<string>();
  const numbers = new Set<number>();
  for (const h of snapshot.horses) {
    if (ids.has(h.id)) issues.push(error(`馬ID「${h.id}」が重複しています`));
    if (numbers.has(h.number)) issues.push(error(`馬番 ${h.number} が重複しています`));
    ids.add(h.id);
    numbers.add(h.number);
  }
  const sourceIds = new Set<string>();
  for (const s of snapshot.sources) {
    if (sourceIds.has(s.id)) issues.push(error(`出典ID「${s.id}」が重複しています`));
    sourceIds.add(s.id);
  }
  for (const [key, item] of Object.entries(snapshot.items ?? {})) {
    if (item?.sourceId && !sourceIds.has(item.sourceId)) issues.push(error(`${key} の出典ID「${item.sourceId}」が出典一覧にありません`));
  }
  if (snapshot.odds) {
    if (snapshot.odds.sourceId && !sourceIds.has(snapshot.odds.sourceId)) issues.push(error('オッズの出典IDが出典一覧にありません'));
    for (const w of snapshot.odds.win) if (!ids.has(w.horseId)) issues.push(error(`単勝オッズに出走表にない馬ID「${w.horseId}」があります`));
    for (const w of snapshot.odds.wide) {
      for (const h of w.horseIds) if (!ids.has(h)) issues.push(error(`ワイドオッズに出走表にない馬ID「${h}」があります`));
      if (w.horseIds[0] === w.horseIds[1]) issues.push(error('ワイドオッズに同じ馬2頭の組み合わせがあります'));
      if (w.min > w.max) issues.push(error('ワイドオッズの min が max より大きい組み合わせがあります'));
    }
  }

  // Demo and real data must never mix.
  const demoMarks = [
    looksLikeDemoId(snapshot.race.id),
    looksLikeDemoId(snapshot.snapshotId),
    ...snapshot.horses.map((h) => looksLikeDemoId(h.id)),
    ...snapshot.sources.map((s) => s.isDemo),
  ];
  if (snapshot.isDemo) {
    if (!looksLikeDemoId(snapshot.race.id)) issues.push(error('デモデータのレースIDは demo- で始まる必要があります'));
  } else if (demoMarks.some(Boolean)) {
    issues.push(error('実データに架空デモのID・出典が混入しています'));
  }
  return issues;
}

export function parseSnapshot(value: unknown): { ok: true; snapshot: RaceSnapshot; issues: Issue[] } | { ok: false; issues: Issue[] } {
  const r = raceSnapshotSchema.safeParse(value);
  if (!r.success) return { ok: false, issues: formatZodIssues(r.error).map(error) };
  const issues = checkSnapshot(r.data);
  if (issues.some((i) => i.level === 'error')) return { ok: false, issues };
  return { ok: true, snapshot: r.data, issues };
}

export interface ResponseCheck {
  ok: boolean;
  response: AnalysisResponse | null;
  issues: Issue[];
  totals: Totals | null;
}

export function checkResponse(snapshot: RaceSnapshot, value: unknown): ResponseCheck {
  const r = analysisResponseSchema.safeParse(value);
  if (!r.success) return { ok: false, response: null, issues: formatZodIssues(r.error).map(error), totals: null };
  const res = r.data;
  const issues: Issue[] = [];

  if (res.raceId !== snapshot.race.id) issues.push(error(`別レースの応答です（応答: ${res.raceId} / 分析対象: ${snapshot.race.id}）`));
  if (res.snapshotId !== snapshot.snapshotId)
    issues.push(error(`分析用コピーの版と一致しません（応答: ${res.snapshotId} / コピーした版: ${snapshot.snapshotId}）。最新の分析用コピーで再分析してください`));
  if (res.isDemo !== snapshot.isDemo)
    issues.push(error(snapshot.isDemo ? 'デモの分析に実データ扱いの応答が混入しています' : '実データの分析に架空デモの応答が混入しています'));
  if (res.budget !== snapshot.budget) issues.push(error(`予算が一致しません（応答: ${res.budget}円 / 設定: ${snapshot.budget}円）`));

  const known = new Map(snapshot.horses.map((h) => [h.id, h]));
  const sourceIds = new Set(snapshot.sources.map((s) => s.id));
  const runners = activeRunners(snapshot).length;

  const seenHorse = new Set<string>();
  for (const h of res.horses) {
    if (!known.has(h.id)) issues.push(error(`出走していない馬ID「${h.id}」が含まれています`));
    if (seenHorse.has(h.id)) issues.push(error(`注目馬「${h.id}」が重複しています`));
    seenHorse.add(h.id);
    for (const s of h.sourceIds) if (!sourceIds.has(s)) issues.push(error(`入力にない出典ID「${s}」が使われています`));
  }
  for (const s of res.sourceIds) if (!sourceIds.has(s)) issues.push(error(`入力にない出典ID「${s}」が使われています`));

  const seenScenario = new Set<string>();
  for (const sc of res.scenarios) {
    if (seenScenario.has(sc.id)) issues.push(error(`条件「${sc.id}」が重複しています`));
    seenScenario.add(sc.id);
    const inOrder = new Set<string>();
    for (const id of sc.order) {
      const h = known.get(id);
      if (!h) issues.push(error(`条件「${sc.id}」の順位に出走していない馬ID「${id}」があります`));
      else if (h.scratched) issues.push(warning(`条件「${sc.id}」の順位に出走取消の${horseLabel(snapshot, id)}が含まれています`));
      if (inOrder.has(id)) issues.push(error(`条件「${sc.id}」の順位に同じ馬が重複しています`));
      inOrder.add(id);
    }
    if (sc.status === 'analyzed' && sc.order.length === 0) issues.push(warning(`条件「${sc.id}」は分析済みですが順位が空です`));
  }

  const betKeys = new Set<string>();
  res.bets.forEach((b, i) => {
    const n = `買い目${i + 1}`;
    if (b.type === 'win' && b.horseIds.length !== 1) issues.push(error(`${n}: 単勝は1頭を指定してください`));
    if (b.type === 'wide') {
      if (b.horseIds.length !== 2) issues.push(error(`${n}: ワイドは異なる2頭を指定してください`));
      else if (b.horseIds[0] === b.horseIds[1]) issues.push(error(`${n}: ワイドに同じ馬が2回指定されています`));
      if (runners > 0 && runners < 4) issues.push(error(`${n}: 出走${runners}頭ではワイドは発売されません`));
    }
    for (const id of b.horseIds) {
      const h = known.get(id);
      if (!h) issues.push(error(`${n}: 出走していない馬ID「${id}」です`));
      else if (h.scratched) issues.push(error(`${n}: 出走取消の${horseLabel(snapshot, id)}を含む配分は登録できません`));
    }
    if (!isValidStake(b.amount)) issues.push(error(`${n}: 金額は100円単位の正の整数にしてください（${b.amount}円）`));
    const key = `${b.type}:${[...b.horseIds].sort().join('-')}`;
    if (betKeys.has(key)) issues.push(warning(`${n}: 同じ券種・同じ馬の買い目が重複しています`));
    betKeys.add(key);
    const recorded = findOdds(snapshot.odds, b);
    if (!recorded) issues.push(warning(`${n}: オッズが未取得のため、この配分は候補です（払戻目安は出しません）`));
    else if (b.odds !== null) {
      const claimed = typeof b.odds === 'number' ? { min: b.odds, max: b.odds } : b.odds;
      if (claimed.min !== recorded.min || claimed.max !== recorded.max)
        issues.push(warning(`${n}: 応答のオッズが取得済みオッズと異なります。表示と計算は取得済みオッズを使います`));
    }
  });

  const totals = computeTotals(snapshot.budget, res.bets);
  if (res.spent !== totals.spent) issues.push(error(`使用額の合計が一致しません（応答: ${res.spent}円 / 再計算: ${totals.spent}円）`));
  if (res.unspent !== totals.unspent) issues.push(error(`残額が一致しません（応答: ${res.unspent}円 / 再計算: ${totals.unspent}円）`));
  if (res.maxLoss !== totals.maxLoss) issues.push(error(`最大損失が一致しません（応答: ${res.maxLoss}円 / 再計算: ${totals.maxLoss}円）`));
  if (totals.spent > snapshot.budget) issues.push(error(`予算超過です（使用 ${totals.spent}円 > 予算 ${snapshot.budget}円）`));

  if (res.bets.length === 0) {
    issues.push(warning(res.status === 'ready' ? '分析は ready ですが配分が空です（購入なしの判断として扱います）' : '配分は空です'));
  }
  if (res.status === 'insufficient' && res.bets.length > 0) issues.push(warning('分析はデータ不足（insufficient）ですが配分があります。配分は参考扱いです'));
  if (!res.calculation.executed) issues.push(warning('計算は未実行と申告されています。金額はこのアプリで再計算しています'));

  return { ok: !issues.some((i) => i.level === 'error'), response: res, issues, totals };
}
