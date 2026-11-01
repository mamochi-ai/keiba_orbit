import { useEffect, useState } from 'react';
import type { FeedRace } from '../domain/feed';
import { formatYen } from '../domain/money';
import { buildReview, findResultRace } from '../domain/review';
import type { SavedAnalysis } from '../domain/schema';
import { formatJst } from '../domain/time';
import { listFeedRaces } from '../storage/db';
import { SafeLink } from '../ui/common';
import { signedYen } from './reportParts';

const finishText = (f: number | string | null) => (f === null ? '着順不明' : typeof f === 'number' ? `${f}着` : f);
const rankText = (p: number | null) => (p === null ? '評価順なし' : `評価${p}位`);

/** Prediction vs the official result, shown only when a received result for this race exists. */
export function ResultReview({ a }: { a: SavedAnalysis }) {
  const [race, setRace] = useState<FeedRace | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    listFeedRaces()
      .then((rs) => alive && setRace(findResultRace(a, rs)))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [a]);

  if (!race?.result) return null;
  const r = buildReview(a, race.result);

  return (
    <section className="sec result-review" aria-labelledby="result-title">
      <div className="sec-head">
        <span className="tag">Result</span>
        <h2 id="result-title" className="sec-title">
          結果との照らし合わせ
        </h2>
        <span className="sec-note">受け取った公式結果から計算</span>
      </div>
      <ul className="compare">
        <li>
          <span className="compare-label">中心候補</span>
          <span>
            {r.center ? (
              <>
                {r.center.number}番 {r.center.name} → <b>{finishText(r.center.finish)}</b>
                {r.centerInTop3 === true ? '（3着内）' : r.centerInTop3 === false ? '（3着内に入らず）' : ''}
              </>
            ) : (
              '基本条件の評価順がありません'
            )}
          </span>
        </li>
        <li>
          <span className="compare-label">1〜3着</span>
          <span>
            {r.top3.length
              ? r.top3.map((t) => (
                  <span key={t.number} className="block">
                    {finishText(t.finish)} {t.number}番 {t.name || '（分析時の出走表になし）'}：{rankText(t.predicted)}
                  </span>
                ))
              : '着順データなし'}
          </span>
        </li>
        <li>
          <span className="compare-label">評価上位5頭</span>
          <span>
            {r.predictedTop.map((t) => (
              <span key={t.number} className="block">
                {t.predicted}位 {t.number}番 {t.name} → {finishText(t.finish)}
              </span>
            ))}
          </span>
        </li>
        <li>
          <span className="compare-label">買い目</span>
          <span>
            {r.bets.length === 0
              ? '買い目なし（見送り）'
              : r.bets.map((b, i) => (
                  <span key={i} className="block">
                    {b.label} {formatYen(b.amount)}：
                    {!r.settle.ok
                      ? '払戻データ待ち'
                      : b.payout > 0
                        ? `的中 払戻${formatYen(b.payout)}`
                        : `不的中${b.missedBy.length ? `（${b.missedBy.map((m) => `${m.number}番 ${finishText(m.finish)}`).join('・')}）` : ''}`}
                  </span>
                ))}
          </span>
        </li>
        <li>
          <span className="compare-label">収支（仮想）</span>
          <span>
            {r.settle.ok
              ? `購入${formatYen(r.settle.spent)} / 払戻${formatYen(r.settle.payout)} / ${signedYen(r.settle.payout - r.settle.spent)}`
              : r.settle.reason}
          </span>
        </li>
      </ul>
      <p className="hint">
        結果：{race.result.status}
        {race.result.confirmedAt ? `（${formatJst(race.result.confirmedAt)}）` : ''} 出典：<SafeLink href={race.result.sourceUrl}>公式結果</SafeLink>
        。次の分析では、外れた理由（評価が低かった好走馬・崩れた中心候補）を見直しの材料にしてください。
      </p>
    </section>
  );
}
