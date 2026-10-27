import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import { computeTotals, formatYen } from '../domain/money';
import type { SavedAnalysis, Settlement } from '../domain/schema';
import { formatDateJa, formatJst, nowIso } from '../domain/time';
import { addAnalysis, deleteAnalysis, deleteSettlement, listAnalyses, listSettlements, putSettlement } from '../storage/db';
import { buildExport, parseImport } from '../storage/transfer';
import { DemoBadge, downloadText, EmptyState, Icon } from '../ui/common';
import { signedYen, STATUS_LABELS } from './reportParts';

export function Saved() {
  const [items, setItems] = useState<SavedAnalysis[] | null>(null);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState<{ kind: 'ok' | 'error'; lines: string[] } | null>(null);

  const reload = useCallback(async () => {
    try {
      setItems(await listAnalyses());
      setSettlements(await listSettlements());
      setLoadError(null);
    } catch {
      setItems([]);
      setLoadError('端末の保存領域（IndexedDB）を読み込めませんでした。');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function doImport(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const r = parseImport(await file.text());
    if (!r.ok) return setImportMsg({ kind: 'error', lines: r.errors });
    const existing = new Set((items ?? []).map((a) => a.id));
    let added = 0;
    const skipped: string[] = [];
    for (const a of r.analyses) {
      if (existing.has(a.id)) {
        skipped.push(`${a.snapshot.race.name}（版${a.version}）: 既に保存済みのため上書きしません`);
        continue;
      }
      try {
        await addAnalysis(a);
        added++;
      } catch {
        skipped.push(`${a.snapshot.race.name}（版${a.version}）: 保存に失敗しました`);
      }
    }
    const known = new Set(settlements.map((s) => s.analysisId));
    for (const s of r.settlements) if (!known.has(s.analysisId)) await putSettlement(s);
    setImportMsg({ kind: r.rejected.length ? 'error' : 'ok', lines: [`${added}件を読み込みました。`, ...skipped, ...r.rejected.map((x) => `拒否：${x}`)] });
    await reload();
  }

  function doExport() {
    if (!items) return;
    const bundle = buildExport(items, settlements, nowIso());
    downloadText(`keiba-orbit-${nowIso().slice(0, 10)}.json`, JSON.stringify(bundle, null, 2));
  }

  const real = (items ?? []).filter((a) => !a.isDemo);
  const settled = real
    .map((a) => ({ a, s: settlements.find((x) => x.analysisId === a.id) }))
    .filter((x): x is { a: SavedAnalysis; s: Settlement } => Boolean(x.s));
  const totalSpent = settled.reduce((t, x) => t + computeTotals(x.a.snapshot.budget, x.a.response.bets).spent, 0);
  const totalPayout = settled.reduce((t, x) => t + x.s.payout, 0);

  return (
    <>
      <div className="page-head">
        <span className="tag">Archive</span>
        <h1 tabIndex={-1} className="page-title">
          保存した分析
        </h1>
        <p className="muted">
          分析はこの端末のブラウザ内に保存されます。ブラウザのデータ削除や長期間の未使用で消えることがあるため、ときどき書き出して「ファイル」などに保管してください。
        </p>
      </div>
      <div className="row">
        <button type="button" className="btn" onClick={doExport} disabled={!items || items.length === 0}>
          <Icon name="report" /> データを書き出す
        </button>
        <label className="btn file-btn">
          <Icon name="paste" /> データを読み込む
          <input type="file" accept="application/json,.json" onChange={doImport} className="visually-hidden" />
        </label>
      </div>
      {importMsg && (
        <div className={importMsg.kind === 'error' ? 'error-box' : 'ok-box'} role="alert">
          {importMsg.lines.map((l, i) => (
            <p key={i}>{l}</p>
          ))}
        </div>
      )}
      {loadError && (
        <p className="error-box" role="alert">
          {loadError}
        </p>
      )}

      <section className="sec" aria-labelledby="pnl">
        <div className="sec-head">
          <span className="tag">Ledger</span>
          <h2 id="pnl" className="sec-title">
            収支履歴
          </h2>
          <span className="sec-note">実データのみ・不的中を含む</span>
        </div>
        {settled.length === 0 ? (
          <p className="muted">記録された収支はまだありません。各分析の「レース後の記録」から入力します。</p>
        ) : (
          <div className="ledger metrics">
            <div className="metric-box">
              <span className="k">記録したレース</span>
              <span className="v">{settled.length}件</span>
            </div>
            <div className="metric-box">
              <span className="k">購入額（仮想）</span>
              <span className="v">{formatYen(totalSpent)}</span>
            </div>
            <div className="metric-box">
              <span className="k">払戻</span>
              <span className="v">{formatYen(totalPayout)}</span>
            </div>
            <div className="metric-box">
              <span className="k">収支</span>
              <span className="v">{signedYen(totalPayout - totalSpent)}</span>
            </div>
          </div>
        )}
        <p className="hint">架空デモの記録は収支履歴に含めません。</p>
      </section>

      <section className="sec" aria-label="保存した分析の一覧">
        {items === null ? (
          <p className="row">
            <span className="spinner" aria-hidden="true" /> 読み込み中
          </p>
        ) : items.length === 0 ? (
          <EmptyState title="保存した分析はまだありません。">
            <a className="btn primary" href="#/">
              レースを選ぶ
            </a>
          </EmptyState>
        ) : (
          <ul className="saved-list">
            {items.map((a) => (
              <SavedRow key={a.id} a={a} settlement={settlements.find((s) => s.analysisId === a.id)} onChanged={reload} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function SavedRow({ a, settlement, onChanged }: { a: SavedAnalysis; settlement?: Settlement; onChanged: () => Promise<void> }) {
  const spent = computeTotals(a.snapshot.budget, a.response.bets).spent;
  const [payout, setPayout] = useState(settlement ? String(settlement.payout) : '');
  const [memo, setMemo] = useState(settlement?.memo ?? '');
  const [error, setError] = useState<string | null>(null);

  async function saveSettlement() {
    const n = Number(payout);
    if (payout.trim() === '' || !Number.isInteger(n) || n < 0 || n > 100_000_000) {
      setError('払戻額は0以上の整数（円）で入力してください。不的中は0です。');
      return;
    }
    setError(null);
    await putSettlement({ analysisId: a.id, recordedAt: nowIso(), payout: n, memo: memo.slice(0, 500) });
    await onChanged();
  }

  return (
    <li className="saved-item">
      <div className="saved-head">
        <div>
          <p className="saved-title">
            <a href={`#/report/${a.id}`}>{a.snapshot.race.name}</a> {a.isDemo && <DemoBadge />}
          </p>
          <p className="muted">
            {formatDateJa(a.snapshot.race.date)}　{a.snapshot.race.venue ?? ''}
            {a.snapshot.race.number ? `${a.snapshot.race.number}R` : ''}　版{a.version}（{a.kind === 'original' ? '元' : '再分析'}）　{formatJst(a.createdAt)} 作成
          </p>
        </div>
        <div className="row">
          <span className="badge">{STATUS_LABELS[a.response.status]}</span>
          <span className="badge">使用 {formatYen(spent)}</span>
        </div>
      </div>
      <details className="subgroup mt">
        <summary>レース後の記録{settlement ? `（記録済：${signedYen(settlement.payout - spent)}）` : ''}</summary>
        <p className="hint">予想時点の内容は変更されません。払戻額は実際の結果から入力してください。</p>
        <div className="grid-2">
          <label>
            払戻額の合計（円・不的中は0）
            <input type="number" inputMode="numeric" min={0} step={10} value={payout} onChange={(e) => setPayout(e.target.value)} />
          </label>
          <label>
            メモ（着順など）
            <input value={memo} maxLength={500} onChange={(e) => setMemo(e.target.value)} />
          </label>
        </div>
        {payout.trim() !== '' && Number.isInteger(Number(payout)) && (
          <p>
            購入 {formatYen(spent)}／払戻 {formatYen(Number(payout))}／収支 <b>{signedYen(Number(payout) - spent)}</b>
          </p>
        )}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <button type="button" className="btn primary" onClick={saveSettlement}>
            記録する
          </button>
          {settlement && (
            <button
              type="button"
              className="btn ghost"
              onClick={async () => {
                await deleteSettlement(a.id);
                setPayout('');
                setMemo('');
                await onChanged();
              }}
            >
              記録を消す
            </button>
          )}
          <button
            type="button"
            className="btn danger"
            onClick={async () => {
              if (!window.confirm(`「${a.snapshot.race.name}」版${a.version}を削除しますか？元に戻せません。`)) return;
              await deleteAnalysis(a.id);
              await onChanged();
            }}
          >
            分析を削除
          </button>
        </div>
      </details>
    </li>
  );
}
