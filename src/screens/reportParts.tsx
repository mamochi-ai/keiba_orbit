import { useLayoutEffect, useRef } from 'react';
import { computeTotals, estimateBet, formatYen, sharedHorseDependencies, type PayoutEstimate } from '../domain/money';
import type { AnalysisResponse, Bet, RaceSnapshot, ScenarioId } from '../domain/schema';
import { SCENARIO_LABELS } from '../domain/schema';
import { horseLabel } from '../domain/validate';
import { formatJst } from '../domain/time';

export const STATUS_LABELS: Record<AnalysisResponse['status'], string> = {
  provisional: '暫定',
  ready: '分析完了',
  insufficient: 'データ不足で保留',
};

const BET_TYPE: Record<Bet['type'], string> = { win: '単勝', wide: 'ワイド' };

export function betLabel(snapshot: RaceSnapshot, b: Pick<Bet, 'type' | 'horseIds'>): string {
  const nums = b.horseIds.map((id) => snapshot.horses.find((h) => h.id === id));
  if (b.type === 'win') return `${BET_TYPE.win} ${nums[0] ? `${nums[0].number}番 ${nums[0].name}` : '?'}`;
  return `${BET_TYPE.wide} ${nums.map((h) => (h ? h.number : '?')).join('－')}（${nums.map((h) => h?.name ?? '?').join('・')}）`;
}

export function PayoutLine({ estimate, spent }: { estimate: PayoutEstimate; spent: number }) {
  switch (estimate.kind) {
    case 'fixed':
      return (
        <span className="payout">
          払戻目安 {formatYen(estimate.payout)}（オッズ{estimate.odds.toFixed(1)}・{formatJst(estimate.asOf)}時点・未確定）
          <br />
          この買い目だけ的中した場合の収支 {signedYen(estimate.payout - spent)}
        </span>
      );
    case 'range':
      return (
        <span className="payout">
          払戻目安 {formatYen(estimate.min)}〜{formatYen(estimate.max)}（オッズ{estimate.oddsMin.toFixed(1)}〜{estimate.oddsMax.toFixed(1)}・{formatJst(estimate.asOf)}時点・未確定）
          <br />
          この買い目だけ的中した場合の収支 {signedYen(estimate.min - spent)}〜{signedYen(estimate.max - spent)}
        </span>
      );
    case 'deferred':
      return <span className="payout warn-text">払戻目安は保留：{estimate.reason}</span>;
    default:
      return <span className="payout muted">{estimate.reason}</span>;
  }
}

export function signedYen(n: number): string {
  return `${n >= 0 ? '+' : '−'}${formatYen(Math.abs(n))}`;
}

const BAR_COLORS = ['var(--cyan)', 'var(--purple)', '#80aef8', '#5fc9b8', '#c9b3ff'];

export function BudgetPanel({ snapshot, response }: { snapshot: RaceSnapshot; response: AnalysisResponse }) {
  const totals = computeTotals(snapshot.budget, response.bets);
  const deps = sharedHorseDependencies(response.bets);
  const noOdds = response.bets.some((b) => estimateBet(snapshot, b).kind === 'none');
  const mismatch = response.spent !== totals.spent || response.unspent !== totals.unspent || response.maxLoss !== totals.maxLoss;
  return (
    <section className="panel accent" aria-labelledby="budget-title">
      <span className="eyebrow">BUDGET SIMULATION</span>
      <h2 id="budget-title" className="h3">
        予算上限
      </h2>
      <div className="metric">{formatYen(snapshot.budget)}</div>
      <div
        className="budgetbar"
        role="img"
        aria-label={`配分の内訳。使う金額${totals.spent}円、残す金額${totals.unspent}円`}
      >
        {snapshot.budget > 0 &&
          response.bets.map((b, i) => (
            <span key={i} style={{ width: `${(b.amount / snapshot.budget) * 100}%`, background: BAR_COLORS[i % BAR_COLORS.length] }} />
          ))}
      </div>
      {response.bets.length === 0 && <p className="muted">配分はありません（購入しない判断を含む）。</p>}
      {response.bets.map((b, i) => (
        <div className="listrow bet" key={i}>
          <span>
            <i className="swatch" style={{ background: BAR_COLORS[i % BAR_COLORS.length] }} aria-hidden="true" />
            {betLabel(snapshot, b)}
            {b.reason && <span className="bet-reason">{b.reason}</span>}
            <PayoutLine estimate={estimateBet(snapshot, b)} spent={totals.spent} />
          </span>
          <b className="num">{formatYen(b.amount)}</b>
        </div>
      ))}
      <div className="listrow">
        <span>使う金額</span>
        <b className="num">{formatYen(totals.spent)}</b>
      </div>
      <div className="listrow">
        <span>残す金額</span>
        <b className="num">{formatYen(totals.unspent)}</b>
      </div>
      <p>
        最大損失 <b className="num">{formatYen(totals.maxLoss)}</b>
      </p>
      {mismatch && <p className="error-text">応答の合計値がアプリの再計算と一致しません。表示は再計算値です。</p>}
      <div className="notice">
        配分は根拠を検証していない裁量的な仮説です。的中確率・期待値は算出していません。
        {noOdds && ' オッズ未取得の買い目があるため、配分は候補です。'}
        {deps.map((d) => (
          <span key={d.horseId} className="dep">
            {horseLabel(snapshot, d.horseId)}を含む買い目が{d.betIndexes.length}点（{formatYen(d.amount)}）。この馬が着外なら、これらは同時に不的中です。
          </span>
        ))}
      </div>
      <p className="hint">券種は単勝（1着）とワイド（3着以内の2頭）のみ対応。ワイドの3着同着どうしの組み合わせは的中になりません（JRA）。</p>
    </section>
  );
}

/** Ranked list for one scenario. Order changes animate (FLIP, 240ms) unless reduced motion. */
export function ScenarioRanking({ snapshot, response, scenario }: { snapshot: RaceSnapshot; response: AnalysisResponse; scenario: ScenarioId }) {
  const sc = response.scenarios.find((s) => s.id === scenario);
  const refs = useRef(new Map<string, HTMLLIElement>());
  const prev = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const next = new Map<string, number>();
    refs.current.forEach((el, id) => {
      const top = el.getBoundingClientRect().top;
      next.set(id, top);
      const before = prev.current.get(id);
      if (!reduce && before !== undefined && before !== top && typeof el.animate === 'function') {
        el.animate([{ transform: `translateY(${before - top}px)` }, { transform: 'translateY(0)' }], { duration: 240, easing: 'ease-out' });
      }
    });
    prev.current = next;
  }, [scenario]);

  if (!sc || sc.status !== 'analyzed' || sc.order.length === 0) return null;
  return (
    <ol className="ranking">
      {sc.order.map((id, i) => {
        const h = snapshot.horses.find((x) => x.id === id);
        const info = response.horses.find((x) => x.id === id);
        return (
          <li
            key={id}
            className="horse"
            ref={(el) => {
              if (el) refs.current.set(id, el);
              else refs.current.delete(id);
            }}
          >
            <div className="number" aria-label={`馬番${h?.number ?? '?'}`}>
              {h ? String(h.number).padStart(2, '0') : '?'}
            </div>
            <div>
              <h3>
                <span className="rank">{i + 1}位</span> {h?.name ?? id} {h?.scratched && <span className="badge error">出走取消</span>}
              </h3>
              {info?.reasons.length ? (
                <ul className="plain">
                  {info.reasons.map((r, j) => (
                    <li key={j}>根拠：{r}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted">根拠の記載なし</p>
              )}
              {info?.concerns.map((c, j) => (
                <p key={j} className="muted">
                  懸念：{c}
                </p>
              ))}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export { SCENARIO_LABELS };
