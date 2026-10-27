import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { computeTotals, estimateBet, formatYen, sharedHorseDependencies, type PayoutEstimate } from '../domain/money';
import { SCENARIO_IDS, SCENARIO_LABELS, type AnalysisResponse, type Bet, type RaceSnapshot, type ScenarioId } from '../domain/schema';
import { horseLabel } from '../domain/validate';
import { formatJst } from '../domain/time';
import { EmptyState, Icon } from '../ui/common';

export const STATUS_LABELS: Record<AnalysisResponse['status'], string> = {
  provisional: '暫定',
  ready: '分析完了',
  insufficient: 'データ不足で保留',
};

const BET_TYPE: Record<Bet['type'], string> = { win: '単勝', wide: 'ワイド' };

export function betLabel(snapshot: RaceSnapshot, b: Pick<Bet, 'type' | 'horseIds'>): string {
  const hs = b.horseIds.map((id) => snapshot.horses.find((h) => h.id === id));
  if (b.type === 'win') return `${BET_TYPE.win} ${hs[0] ? `${hs[0].number}番 ${hs[0].name}` : '?'}`;
  return `${BET_TYPE.wide} ${hs.map((h) => (h ? h.number : '?')).join('－')}（${hs.map((h) => h?.name ?? '?').join('・')}）`;
}

export function signedYen(n: number): string {
  return `${n >= 0 ? '+' : '−'}${formatYen(Math.abs(n))}`;
}

export function PayoutLine({ estimate, spent }: { estimate: PayoutEstimate; spent: number }) {
  switch (estimate.kind) {
    case 'fixed':
      return (
        <span className="payout">
          払戻目安 <span className="num">{formatYen(estimate.payout)}</span>（オッズ{estimate.odds.toFixed(1)}・{formatJst(estimate.asOf)}時点・未確定）
          <br />
          この買い目だけ的中した場合の収支 <span className="num">{signedYen(estimate.payout - spent)}</span>
        </span>
      );
    case 'range':
      return (
        <span className="payout">
          払戻目安 <span className="num">{formatYen(estimate.min)}〜{formatYen(estimate.max)}</span>（オッズ{estimate.oddsMin.toFixed(1)}〜{estimate.oddsMax.toFixed(1)}・{formatJst(estimate.asOf)}時点・未確定）
          <br />
          この買い目だけ的中した場合の収支 <span className="num">{signedYen(estimate.min - spent)}〜{signedYen(estimate.max - spent)}</span>
        </span>
      );
    case 'deferred':
      return <span className="payout warn-text">払戻目安は保留：{estimate.reason}</span>;
    default:
      return <span className="payout">{estimate.reason}</span>;
  }
}

/* ------------------------------------------------------------------ */
/* Candidates: big horse number, name, Japanese role, reasons ↔ concerns */

const ROLE = ['中心候補', '対抗候補'] as const;

export function Candidates({ snapshot, response }: { snapshot: RaceSnapshot; response: AnalysisResponse }) {
  const base = response.scenarios.find((s) => s.id === 'base');
  const baseOrder = base && base.status === 'analyzed' ? base.order : [];
  // Top of the base order (up to 5), then any other horse Claude commented on.
  const top = baseOrder.slice(0, 5);
  const listed = [...top, ...response.horses.map((h) => h.id).filter((id) => !top.includes(id))];

  if (listed.length === 0) {
    return (
      <div className="hold">
        <b>候補は保留中です</b>
        <p className="muted">
          {response.status === 'insufficient' ? 'データが不足しているため、Claudeは候補を挙げていません。' : '応答に注目馬の記載がありません。'}
          {response.limitations[0] ? ` 理由：${response.limitations[0]}` : ''}
        </p>
      </div>
    );
  }
  return (
    <>
      {baseOrder.length === 0 && (
        <p className="hold">「基本の想定」が未分析のため、中心候補・対抗候補は保留です。応答で挙げられた注目馬を表示しています。</p>
      )}
      <ol className="cand-list">
        {listed.map((id) => {
          const h = snapshot.horses.find((x) => x.id === id);
          const info = response.horses.find((x) => x.id === id);
          const rank = baseOrder.indexOf(id);
          const role = rank >= 0 && rank < 2 ? ROLE[rank]! : '注目馬';
          return (
            <li key={id} className={`cand ${rank >= 0 && rank < 2 ? '' : 'sub'}`}>
              <div className="horse-no" aria-label={`馬番${h?.number ?? '不明'}`}>
                {h ? String(h.number).padStart(2, '0') : '–'}
              </div>
              <div>
                <h3 className="cand-name">
                  {h?.name ?? `不明な馬（${id}）`}
                  <span className={`role ${rank === 0 ? '' : rank === 1 ? 'second' : 'other'}`}>{role}</span>
                  {h?.scratched && <span className="badge error">出走取消</span>}
                </h3>
                <div className="pair">
                  <div className="pro">
                    <h4>評価理由</h4>
                    {info?.reasons.length ? (
                      <ul>
                        {info.reasons.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted">記載なし</p>
                    )}
                  </div>
                  <div className="con">
                    <h4>懸念点</h4>
                    {info?.concerns.length ? (
                      <ul>
                        {info.concerns.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted">記載なし</p>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {baseOrder.length > 0 && <p className="hint">中心候補・対抗候補は「基本の想定」での評価順にもとづく表示です。勝率や的中率ではありません。</p>}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Condition comparison: tabs, FLIP re-order keyed by horse id (240ms) */

export function ScenarioCompare({
  snapshot,
  response,
  scenario,
  onChange,
  onReanalyze,
}: {
  snapshot: RaceSnapshot;
  response: AnalysisResponse;
  scenario: ScenarioId;
  onChange: (s: ScenarioId) => void;
  onReanalyze: () => void;
}) {
  const sc = response.scenarios.find((s) => s.id === scenario);
  const base = response.scenarios.find((s) => s.id === 'base');
  const baseOrder = base && base.status === 'analyzed' ? base.order : [];
  const analyzed = Boolean(sc && sc.status === 'analyzed' && sc.order.length > 0);
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
        el.animate([{ transform: `translateY(${before - top}px)` }, { transform: 'translateY(0)' }], { duration: 240, easing: 'cubic-bezier(.2,.7,.2,1)' });
      }
    });
    prev.current = next;
  }, [scenario]);

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    // Move from the tab that has focus (falls back to the selected one).
    const focused = (e.target as HTMLElement).id.replace(/^tab-/, '') as ScenarioId;
    const i = SCENARIO_IDS.includes(focused) ? SCENARIO_IDS.indexOf(focused) : SCENARIO_IDS.indexOf(scenario);
    const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? i - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const id = SCENARIO_IDS[(next + SCENARIO_IDS.length) % SCENARIO_IDS.length]!;
    onChange(id);
    document.getElementById(`tab-${id}`)?.focus();
  }

  const changed = analyzed && scenario !== 'base' && baseOrder.length > 0 && sc!.order.some((id) => baseOrder.indexOf(id) !== sc!.order.indexOf(id));

  return (
    <>
      <div className="seg" role="tablist" aria-label="条件" onKeyDown={onKey}>
        {SCENARIO_IDS.map((sid) => {
          const s = response.scenarios.find((x) => x.id === sid);
          return (
            <button
              key={sid}
              type="button"
              role="tab"
              id={`tab-${sid}`}
              aria-selected={scenario === sid}
              aria-controls="scenario-panel"
              tabIndex={scenario === sid ? 0 : -1}
              onClick={() => onChange(sid)}
            >
              <Icon name={sid === 'base' ? 'sun' : sid === 'wet' ? 'cloud-rain' : 'wind'} />
              {SCENARIO_LABELS[sid]}
              {(!s || s.status !== 'analyzed') && <span className="tab-note">未分析</span>}
            </button>
          );
        })}
      </div>
      <div id="scenario-panel" role="tabpanel" aria-labelledby={`tab-${scenario}`}>
        {analyzed ? (
          <>
            {scenario !== 'base' && (
              <div className="change-reason">
                <span className="label">{changed ? '評価順が変わった理由' : 'この条件での見立て'}</span>
                <p>{sc!.reason || '理由の記載がありません（順位の変化だけで判断しないでください）。'}</p>
              </div>
            )}
            {scenario === 'base' && sc!.reason && <p className="muted" style={{ marginTop: 14 }}>{sc!.reason}</p>}
            <ol className="ranking" aria-live="polite">
              {sc!.order.map((id, i) => {
                const h = snapshot.horses.find((x) => x.id === id);
                const was = baseOrder.indexOf(id);
                const diff = scenario === 'base' || was < 0 ? null : was - i;
                return (
                  <li
                    key={id}
                    className="rank-row"
                    ref={(el) => {
                      if (el) refs.current.set(id, el);
                      else refs.current.delete(id);
                    }}
                  >
                    <span className="rank-pos">{i + 1}位</span>
                    <span className="rank-no" aria-label={`馬番${h?.number ?? '不明'}`}>
                      {h ? String(h.number).padStart(2, '0') : '–'}
                    </span>
                    <span className="rank-name">
                      {h?.name ?? id} {h?.scratched && <span className="badge error">出走取消</span>}
                    </span>
                    {diff !== null && (
                      <span className={`delta ${diff > 0 ? 'up' : diff < 0 ? 'down' : 'same'}`}>
                        {diff > 0 ? `▲ ${diff}つ上がった` : diff < 0 ? `▼ ${-diff}つ下がった` : '基本と同じ'}
                      </span>
                    )}
                    {diff !== null && diff !== 0 && (
                      <span className="rank-why">
                        {diff > 0 ? '評価が上がった理由' : '評価が下がった理由'}：{sc!.reason ? '上の「評価順が変わった理由」を参照' : '記載なし'}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </>
        ) : (
          <EmptyState title="この条件は未分析">
            <p className="muted">{sc?.reason || 'この条件の分析結果は応答に含まれていません。'}</p>
            <button type="button" className="btn" onClick={onReanalyze}>
              情報を補って再分析
            </button>
          </EmptyState>
        )}
      </div>
      <p className="basis">配分は条件ごとには作られていません。条件を切り替えても、買い目と金額は変わりません。</p>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Budget allocation                                                    */

const BAR_COLORS = ['var(--cyan)', 'var(--purple)', '#80aef8', '#5fc9b8', '#c9b3ff'];

export function BudgetPanel({ snapshot, response }: { snapshot: RaceSnapshot; response: AnalysisResponse }) {
  const totals = computeTotals(snapshot.budget, response.bets);
  const deps = sharedHorseDependencies(response.bets);
  const noOdds = response.bets.some((b) => estimateBet(snapshot, b).kind === 'none');
  const tentative = noOdds || response.status !== 'ready';
  const mismatch = response.spent !== totals.spent || response.unspent !== totals.unspent || response.maxLoss !== totals.maxLoss;
  const pct = (n: number) => (snapshot.budget > 0 ? (Math.max(0, n) / snapshot.budget) * 100 : 0);
  return (
    <section aria-labelledby="budget-title">
      <div className="sec-head">
        <span className="tag">Budget</span>
        <h2 id="budget-title" className="sec-title">
          {tentative ? '配分候補' : '予算配分'}
        </h2>
      </div>
      <p className="budget-cap">
        予算上限 <span className="num">{formatYen(snapshot.budget)}</span>
      </p>
      <div className="metrics">
        <div className="metric-box">
          <span className="k">使う金額</span>
          <span className="v">{formatYen(totals.spent)}</span>
        </div>
        <div className="metric-box">
          <span className="k">残す金額</span>
          <span className="v">{formatYen(totals.unspent)}</span>
        </div>
        <div className="metric-box loss">
          <span className="k">最大損失</span>
          <span className="v">{formatYen(totals.maxLoss)}</span>
        </div>
      </div>
      <div className="budgetbar" role="img" aria-label={`予算${totals.spent > 0 ? `のうち${totals.spent}円を使い、${totals.unspent}円を残す配分` : 'は未使用'}`}>
        {response.bets.map((b, i) => (
          <span key={i} style={{ width: `${pct(b.amount)}%`, background: BAR_COLORS[i % BAR_COLORS.length] }} />
        ))}
        <span className="unspent" style={{ width: `${pct(totals.unspent)}%` }} />
      </div>
      <div className="bar-legend">
        <span>使う {snapshot.budget > 0 ? Math.round(pct(totals.spent)) : 0}%</span>
        <span>残す（灰色）</span>
      </div>
      {mismatch && <p className="error-text">応答の合計値がアプリの再計算と一致しません。表示は再計算値です。</p>}
      {response.bets.length === 0 ? (
        <p className="muted mt">買い目はありません（購入しない判断を含む）。</p>
      ) : (
        <ul className="bets">
          {response.bets.map((b, i) => (
            <li key={i} className="bet">
              <span className="bet-label">
                <i className="swatch" style={{ background: BAR_COLORS[i % BAR_COLORS.length] }} aria-hidden="true" />
                {betLabel(snapshot, b)}
              </span>
              <span className="bet-amount">{formatYen(b.amount)}</span>
              <span className="bet-reason">{b.reason || '理由の記載なし'}</span>
              <PayoutLine estimate={estimateBet(snapshot, b)} spent={totals.spent} />
            </li>
          ))}
        </ul>
      )}
      {deps.length > 0 && (
        <div className="risk">
          {deps.map((d) => (
            <p key={d.horseId}>
              <Icon name="warning" size={16} /> {horseLabel(snapshot, d.horseId)}に{d.betIndexes.length}点（{formatYen(d.amount)}）が依存。この馬が崩れると同時に外れます。
            </p>
          ))}
        </div>
      )}
      <p className="hint">
        {tentative ? (noOdds ? 'オッズ未取得の買い目があるため、配分は候補です。' : '分析が確定していないため、配分は候補です。') : ''}
        配分は検証していない裁量的な仮説です。的中確率・期待値は計算していません。券種は単勝・ワイドのみ対応。
      </p>
    </section>
  );
}

export { SCENARIO_LABELS };
