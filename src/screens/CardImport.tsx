import { useState } from 'react';
import { parseJraCard, type CardParse } from '../domain/jraCard';
import { ITEM_TEXT_LIMITS, isSafeHttpUrl, type Source } from '../domain/schema';
import { formatDateJa, isoToJstLocal, jstLocalToIso, nowIso } from '../domain/time';
import { useApp } from '../state';
import { Icon } from '../ui/common';
import { CopyGuide } from '../ui/CopyGuide';

const PROVIDER = 'JRA公式サイト（出馬表）';
const MAX_INPUT = 150_000;

/** Paste a JRA 出馬表 page once to fill 出走表, 単勝オッズ and 過去成績, after confirmation. */
export function CardImport({ onApplied }: { onApplied: () => void }) {
  const { draft, setDraft } = useApp();
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [result, setResult] = useState<CardParse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [useOdds, setUseOdds] = useState(true);
  const [usePast, setUsePast] = useState(true);
  const [oddsLocal, setOddsLocal] = useState('');
  const [done, setDone] = useState<string | null>(null);
  // Opened by default only when the panel first appears without entries; never auto-collapses.
  const [initiallyOpen] = useState(draft.horses.length === 0);

  if (draft.isDemo) {
    return (
      <section className="item card-import" aria-labelledby="card-title" style={{ padding: "14px 12px" }}>
        <h2 id="card-title" className="item-label">
          出馬表を貼り付けて自動入力
        </h2>
        <p className="hint">架空デモでは使えません。実在のレースで「新しく始める」から使ってください。</p>
      </section>
    );
  }

  function read() {
    setDone(null);
    setError(null);
    if (url && !isSafeHttpUrl(url)) return setError('URLは http:// または https:// で始まるものだけ使えます');
    const r = parseJraCard(text);
    if (r.horses.length === 0) {
      setResult(null);
      return setError('出馬表として読み取れませんでした。JRA公式サイトの出馬表ページを、「枠1白」などの枠の表示を含めてコピーしてください。');
    }
    setResult(r);
    setUseOdds(r.horses.some((h) => h.winOdds !== null));
    setUsePast(r.body.length > 0);
    setOddsLocal(isoToJstLocal(nowIso()));
  }

  const header = result?.header;
  const headerDiffers =
    header && header.date && (header.date !== draft.date || header.venue !== (draft.venue || null) || String(header.number ?? '') !== draft.number);
  const hasOdds = Boolean(result?.horses.some((h) => h.winOdds !== null));
  const pastTooLong = Boolean(result && result.body.length > ITEM_TEXT_LIMITS.past);

  function applyHeader() {
    if (!header?.date) return;
    setDraft((d) => ({ ...d, date: header.date!, venue: header.venue ?? '', number: header.number ? String(header.number) : '', confirmed: false }));
  }

  function apply() {
    if (!result) return;
    if (draft.horses.length > 0 && !window.confirm('いま入力されている出走表とオッズを、読み取った内容で置き換えますか？')) return;
    const now = nowIso();
    const src = (id: string, label: string, asOf: string | null): Source => ({
      id,
      label,
      provider: PROVIDER,
      url: url.trim() || null,
      fetchedAt: now,
      asOf,
      isDemo: false,
    });
    const oddsAsOf = jstLocalToIso(oddsLocal) ?? now;
    const takeOdds = useOdds && hasOdds;
    const takePast = usePast && result.body.length > 0;
    const pastText = result.body.slice(0, ITEM_TEXT_LIMITS.past);
    const newSources = [src('src-entries', '出走表', now), ...(takeOdds ? [src('src-odds', 'オッズ', oddsAsOf)] : []), ...(takePast ? [src('src-past', '過去成績', null)] : [])];
    setDraft((d) => ({
      ...d,
      confirmed: false,
      horses: result.horses.map(({ id, number, name, scratched }) => ({ id, number, name, ...(scratched ? { scratched } : {}) })),
      odds: takeOdds
        ? {
            asOf: oddsAsOf,
            sourceId: 'src-odds',
            win: result.horses.filter((h) => h.winOdds !== null && !h.scratched).map((h) => ({ horseId: h.id, odds: h.winOdds! })),
            wide: [],
          }
        : null,
      sources: [...d.sources.filter((s) => !newSources.some((n) => n.id === s.id) && (takeOdds || s.id !== 'src-odds')), ...newSources],
      items: {
        ...d.items,
        entries: { status: 'ok', sourceId: 'src-entries', text: null, error: null },
        odds: takeOdds ? { status: 'ok', sourceId: 'src-odds', text: null, error: null } : { status: 'missing', sourceId: null, text: null, error: null },
        ...(takePast ? { past: { status: 'ok' as const, sourceId: 'src-past', text: pastText, error: null } } : {}),
      },
    }));
    setDone(
      `出走表 ${result.horses.length}頭${takeOdds ? '・単勝オッズ' : ''}${takePast ? '・過去成績' : ''}を反映しました。${!takeOdds && draft.odds ? '出走表を置き換えたため、オッズは未取得に戻しました。' : ''}`,
    );
    setResult(null);
    setText('');
    onApplied();
  }

  return (
    <details className="item card-import" open={initiallyOpen}>
      <summary className="item-head">
        <span className="item-label">
          <Icon name="paste" /> 出馬表を貼り付けて自動入力
        </span>
        <span className="badge ok">おすすめ</span>
        <span className="item-meta">出走表・単勝オッズ・過去成績をまとめて入力</span>
      </summary>
      <div className="item-body">
        <ol className="steps">
          <li>SafariでJRA公式サイトの出馬表ページを開く</li>
          <li>ページの文字を選択してコピー</li>
          <li>下に貼り付けて「読み取る」→ 内容を確認して「反映」</li>
        </ol>
        <CopyGuide topics={['card']} />
        <label>
          出馬表ページのテキスト
          <textarea rows={6} maxLength={MAX_INPUT} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <p className="hint num">
          {text.length.toLocaleString('ja-JP')} / {MAX_INPUT.toLocaleString('ja-JP')} 文字
        </p>
        <label>
          ページのURL（任意・出典として記録）
          <input type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.jra.go.jp/JRADB/…" />
        </label>
        <div className="row mt">
          <button type="button" className="btn primary" onClick={read} disabled={!text.trim()}>
            <Icon name="search" /> 読み取る
          </button>
          {!text.trim() && <span className="hint">貼り付けると押せます</span>}
        </div>
        {error && (
          <div className="error-box" role="alert">
            <p>{error}</p>
          </div>
        )}
        {done && (
          <p className="ok-text" role="status">
            ✓ {done}
          </p>
        )}

        {result && (
          <div className="card-preview" role="region" aria-label="読み取り結果の確認">
            <h3>読み取り結果の確認</h3>
            {header?.date ? (
              <p>
                ページの見出し：{formatDateJa(header.date)} {header.venue ?? '競馬場不明'} {header.number ? `${header.number}R` : ''}
              </p>
            ) : (
              <p className="hint">ページの見出し（開催日・競馬場・R）は読み取れませんでした。</p>
            )}
            {headerDiffers && (
              <div className="notice">
                <p>入力中のレース（{draft.date || '日付未入力'} {draft.venue || '競馬場未確認'} {draft.number ? `${draft.number}R` : 'R未確認'}）と見出しが違います。別のレースのページではないか確認してください。</p>
                <button type="button" className="btn mt" onClick={applyHeader}>
                  開催日・競馬場・R番号を見出しの値にする
                </button>
              </div>
            )}
            {result.warnings.length > 0 && (
              <div className="notice mt">
                <ul>
                  {result.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
            <ul className="runner-list" aria-label="読み取った出走馬">
              {result.horses.map((h) => (
                <li key={h.id} className={h.scratched ? 'scratched' : ''}>
                  <span className="num">{String(h.number).padStart(2, '0')}</span> {h.name}{' '}
                  {h.scratched ? (
                    <span className="badge error">出走取消</span>
                  ) : h.winOdds !== null ? (
                    <span className="hint num">
                      単勝 {h.winOdds.toFixed(1)}（{h.popularity}番人気）
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            <label className="check">
              <input type="checkbox" checked={useOdds && hasOdds} disabled={!hasOdds} onChange={(e) => setUseOdds(e.target.checked)} />
              単勝オッズも反映する{!hasOdds && '（ページにオッズがありません）'}
            </label>
            {useOdds && hasOdds && (
              <label>
                オッズの対象時点（JST・コピーした時刻）
                <input type="datetime-local" value={oddsLocal} onChange={(e) => setOddsLocal(e.target.value)} />
              </label>
            )}
            <label className="check">
              <input type="checkbox" checked={usePast} disabled={!result.body} onChange={(e) => setUsePast(e.target.checked)} />
              このページの本文を過去成績として使う（要約不要）
            </label>
            {usePast && pastTooLong && (
              <p className="warn-text">本文が {ITEM_TEXT_LIMITS.past.toLocaleString('ja-JP')} 文字を超えるため、超えた分は切り捨てます。</p>
            )}
            <div className="row mt">
              <button type="button" className="btn primary" onClick={apply}>
                <Icon name="check" /> この内容で反映
              </button>
              <button type="button" className="btn ghost" onClick={() => setResult(null)}>
                やめる
              </button>
            </div>
          </div>
        )}
      </div>
    </details>
  );
}
