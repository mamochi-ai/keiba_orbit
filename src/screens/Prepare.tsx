import { useRef, useState } from 'react';
import { buildSnapshot, itemStatus, parseEntries, parseOdds, validateHome, type Draft, type LineError } from '../domain/draft';
import { buildAnalysisPrompt } from '../domain/prompt';
import { ITEM_KEYS, ITEM_LABELS, isSafeHttpUrl, type ItemKey, type RaceSnapshot, type Source } from '../domain/schema';
import { parseSnapshot } from '../domain/validate';
import { formatDateJa, formatJst, isoToJstLocal, jstLocalToIso, nowIso } from '../domain/time';
import { fetchWeather, WEATHER_PROVIDER } from '../data/weather';
import { navigate, useApp } from '../state';
import { CopyButton, DemoBadge, Icon, OpenClaudeLink, SafeLink, StatusBadge } from '../ui/common';

const HINTS: Record<ItemKey, string> = {
  identity: '開催日・レース名・競馬場・R番号がそろうと「取得済」になります。確認に使った出馬表のURLを記録できます。',
  entries: '1行に「馬番 馬名」。出走取消は行末に「取消」。例：4 オービットスター',
  past: '過去成績を貼り付け（出典の利用条件を守ってください）。',
  track: '公式発表の馬場状態など。天気とは別の情報です。',
  weather: '天気予報。馬場状態とは同一視しません。',
  odds: '単勝「4 3.2」、ワイド「4-7 2.1-2.8」を1行ずつ。取得時刻を必ず入力してください。',
};

export function Prepare() {
  const { draft, setDraft, images } = useApp();
  const homeErrors = validateHome(draft);
  const snapshotRef = useRef<RaceSnapshot | null>(null);

  if (!draft.name) {
    return (
      <section className="panel section">
        <h1 tabIndex={-1}>分析準備</h1>
        <p>まだレースが選ばれていません。</p>
        <a className="btn primary" href="#/">
          レースを選ぶ
        </a>
      </section>
    );
  }

  const copyBlocked = !draft.confirmed
    ? '「分析対象と情報締切を確認しました」にチェックしてください。'
    : Object.keys(homeErrors).length
      ? 'ホームの必須項目（開催日・レース名）に不備があります。'
      : undefined;

  function buildPromptText(): string {
    const snap = buildSnapshot(draft);
    const r = parseSnapshot(snap);
    if (!r.ok) throw new Error(`分析用データに問題があります：${r.issues.map((i) => i.message).join(' / ')}`);
    snapshotRef.current = r.snapshot;
    return buildAnalysisPrompt(r.snapshot);
  }

  return (
    <>
      <div className="page-head">
        <span className="eyebrow">02 / ANALYSIS PREP</span>
        <h1 tabIndex={-1} className="page-title">
          分析準備 {draft.isDemo && <DemoBadge />}
        </h1>
        <p className="muted">
          {draft.isDemo ? '架空デモ' : formatDateJa(draft.date || null)}　{draft.venue || '競馬場未確認'} {draft.number ? `${draft.number}R` : 'R番号未確認'}　{draft.name}
        </p>
      </div>
      <div className="layout">
        <section className="stack" aria-label="情報の取得状況">
          {ITEM_KEYS.map((k) => (
            <ItemEditor key={k} itemKey={k} />
          ))}
        </section>
        <aside className="stack">
          <section className="panel accent" aria-labelledby="target">
            <span className="eyebrow">TARGET</span>
            <h2 id="target">分析対象と情報締切</h2>
            <div className="listrow">
              <span>レース</span>
              <b>{draft.name}</b>
            </div>
            <div className="listrow">
              <span>出走表</span>
              <b>{draft.horses.length ? `${draft.horses.filter((h) => !h.scratched).length}頭（取消${draft.horses.filter((h) => h.scratched).length}）` : '未取得'}</b>
            </div>
            <div className="listrow">
              <span>予算上限</span>
              <b className="num">¥{draft.budget.toLocaleString('ja-JP')}</b>
            </div>
            <label className="mt">
              情報締切（JST・この時刻より後の情報は使わない）
              <input
                type="datetime-local"
                value={draft.cutoffLocal}
                onChange={(e) => setDraft((d) => ({ ...d, cutoffLocal: e.target.value, confirmed: false }))}
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={draft.confirmed}
                onChange={(e) => setDraft((d) => ({ ...d, confirmed: e.target.checked }))}
              />
              分析対象と情報締切を確認しました
            </label>
          </section>

          <section className="panel" aria-labelledby="bridge">
            <span className="eyebrow">ANALYSIS BRIDGE</span>
            <h2 id="bridge">Claudeとつなぐ</h2>
            <ol className="steps">
              <li>指示をコピー</li>
              <li>Claudeで分析（通常のチャット）</li>
              <li>結果を貼り戻す</li>
            </ol>
            <div className="stack-sm">
              <CopyButton
                label="分析用コピー"
                getText={buildPromptText}
                disabled={Boolean(copyBlocked)}
                disabledReason={copyBlocked}
                onCopied={() => {
                  const snap = snapshotRef.current;
                  if (snap) setDraft((d) => ({ ...d, copied: snap }));
                }}
              />
              <OpenClaudeLink />
              <button type="button" className="btn" onClick={() => navigate('/paste')} disabled={!draft.copied} aria-describedby="paste-reason">
                <Icon name="paste" /> 結果を貼り付け
              </button>
              {!draft.copied && (
                <p id="paste-reason" className="hint">
                  先に「分析用コピー」をしてください。
                </p>
              )}
            </div>
            {images.length > 0 && <p className="notice mt">参考画像 {images.length} 枚は、Claudeのチャットへ別途添付してください。アプリは画像を読み取っていません。</p>}
            {draft.copied && (
              <p className="hint mt">
                コピー済みの版：<code>{draft.copied.snapshotId}</code>（内容を変えた場合はコピーし直してください）
              </p>
            )}
            <p className="hint">ClaudeへのログインやClaude画面への自動入力は行いません。</p>
          </section>
        </aside>
      </div>
    </>
  );
}

function ItemEditor({ itemKey }: { itemKey: ItemKey }) {
  const { draft, setDraft, settings } = useApp();
  const item = draft.items[itemKey];
  const status = itemStatus(draft, itemKey);
  const source = draft.sources.find((s) => s.id === item.sourceId) ?? null;

  const initialText =
    itemKey === 'entries'
      ? draft.horses.map((h) => `${h.number} ${h.name}${h.scratched ? ' 取消' : ''}`).join('\n')
      : itemKey === 'odds'
        ? oddsToText(draft)
        : (item.text ?? '');
  const [text, setText] = useState(initialText);
  const [provider, setProvider] = useState(source?.provider ?? '');
  const [url, setUrl] = useState(source?.url ?? '');
  const [fetchedLocal, setFetchedLocal] = useState(isoToJstLocal(source?.fetchedAt ?? null));
  const [asOfLocal, setAsOfLocal] = useState(isoToJstLocal(source?.asOf ?? null));
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  function apply() {
    setSaved(false);
    const errs: string[] = [];
    if (url && !isSafeHttpUrl(url)) errs.push('URLは http:// または https:// で始まるものだけ使えます');
    if (provider.length > 80) errs.push('提供者は80文字以内です');
    const hasInput = itemKey === 'identity' ? true : text.trim() !== '';
    if (hasInput && itemKey !== 'identity' && !provider.trim()) errs.push('提供者（情報の出どころ）を入力してください');
    if (itemKey === 'odds' && hasInput && !asOfLocal) errs.push('オッズの対象時点（何時時点のオッズか）を入力してください');

    let lineErrors: LineError[] = [];
    let next: Draft = { ...draft, confirmed: false };
    if (itemKey === 'entries') {
      const r = parseEntries(text, draft.isDemo ? 'demo-h' : 'h');
      lineErrors = r.errors;
      next = { ...next, horses: r.horses, odds: null };
    } else if (itemKey === 'odds') {
      const r = parseOdds(text, draft.horses);
      lineErrors = r.errors;
      next = { ...next, odds: hasInput ? { asOf: jstLocalToIso(asOfLocal), sourceId: hasInput ? `src-odds` : null, win: r.win, wide: r.wide } : null };
    }
    errs.push(...lineErrors.map((l) => `${l.line}行目: ${l.message}`));
    if (errs.length) {
      setErrors(errs);
      return;
    }
    const sourceId = `src-${itemKey}`;
    const keepSource = hasInput && (provider.trim() || url.trim());
    const newSource: Source | null = keepSource
      ? {
          id: sourceId,
          label: ITEM_LABELS[itemKey],
          provider: provider.trim() || '（未記入）',
          url: url.trim() || null,
          fetchedAt: jstLocalToIso(fetchedLocal) ?? nowIso(),
          asOf: jstLocalToIso(asOfLocal),
          isDemo: draft.isDemo,
        }
      : null;
    next.sources = [...draft.sources.filter((s) => s.id !== sourceId), ...(newSource ? [newSource] : [])];
    next.items = {
      ...draft.items,
      [itemKey]: {
        status: 'ok',
        sourceId: newSource ? sourceId : null,
        text: itemKey === 'entries' || itemKey === 'odds' || itemKey === 'identity' ? null : text.trim() || null,
        error: null,
      },
    };
    if (next.odds && !newSource) next.odds = { ...next.odds, sourceId: null };
    if (itemKey === 'entries' && draft.odds) errs.push('出走表を変更したため、オッズを未取得に戻しました。');
    setErrors(errs);
    if (!fetchedLocal && newSource?.fetchedAt) setFetchedLocal(isoToJstLocal(newSource.fetchedAt));
    setDraft(next);
    setSaved(true);
  }

  async function loadWeather() {
    if (!draft.venue || !draft.date) return;
    setLoading(true);
    setErrors([]);
    setSaved(false);
    try {
      const r = await fetchWeather(draft.venue, draft.date);
      const now = nowIso();
      setText(r.text);
      setProvider(WEATHER_PROVIDER);
      setUrl(r.url);
      setFetchedLocal(isoToJstLocal(now));
      setAsOfLocal(isoToJstLocal(now));
      setDraft((d) => ({
        ...d,
        confirmed: false,
        sources: [
          ...d.sources.filter((s) => s.id !== 'src-weather'),
          { id: 'src-weather', label: '天気', provider: WEATHER_PROVIDER, url: r.url, fetchedAt: now, asOf: now, isDemo: false },
        ],
        items: { ...d.items, weather: { status: 'ok', sourceId: 'src-weather', text: r.text, error: null } },
      }));
      setSaved(true);
    } catch (e) {
      const msg = (e as Error).message || '天気を取得できませんでした';
      setDraft((d) => ({ ...d, items: { ...d.items, weather: { ...d.items.weather, status: 'error', error: msg.slice(0, 300) } } }));
      setErrors([`${msg}。手入力で補うこともできます。`]);
    } finally {
      setLoading(false);
    }
  }

  function clearError() {
    setDraft((d) => ({ ...d, items: { ...d.items, [itemKey]: { ...d.items[itemKey], status: 'missing', error: null } } }));
  }

  const weatherBlocked = draft.isDemo
    ? 'デモでは実データを取得しません'
    : !settings.weatherEnabled
      ? '設定で天気予報の取得がオフになっています'
      : !draft.venue || !draft.date
        ? '開催日と競馬場を確認すると取得できます'
        : null;

  return (
    <details className="panel item" open={itemKey === 'entries' && status === 'missing'}>
      <summary className="item-head">
        <span className="item-label">{ITEM_LABELS[itemKey]}</span>
        <StatusBadge status={status} />
        <span className="item-meta">
          {source ? `${source.provider}・${formatJst(source.fetchedAt)}取得${source.isDemo ? '・デモ' : ''}` : itemKey === 'identity' ? '' : '出典未記録'}
        </span>
      </summary>
      <div className="item-body">
        <p className="hint">{HINTS[itemKey]}</p>
        {item.status === 'error' && (
          <div className="error-box" role="alert">
            <p>取得エラー：{item.error}</p>
            <button type="button" className="btn ghost" onClick={clearError}>
              エラー表示を消す
            </button>
          </div>
        )}
        {itemKey === 'identity' ? (
          <dl className="kv">
            <dt>開催日</dt>
            <dd>{draft.date ? formatDateJa(draft.date) : '未入力'}</dd>
            <dt>競馬場</dt>
            <dd>{draft.venue || '未確認'}</dd>
            <dt>R番号</dt>
            <dd>{draft.number ? `${draft.number}R` : '未確認'}</dd>
            <dt>レース名</dt>
            <dd>{draft.name}</dd>
          </dl>
        ) : (
          <label>
            {itemKey === 'entries' ? '出走表（馬番 馬名）' : itemKey === 'odds' ? 'オッズ' : '内容'}
            <textarea rows={itemKey === 'past' ? 8 : 5} maxLength={8000} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
        )}
        {itemKey === 'entries' && draft.horses.length > 0 && (
          <ul className="runner-list" aria-label="反映済みの出走馬">
            {draft.horses.map((h) => (
              <li key={h.id} className={h.scratched ? 'scratched' : ''}>
                <span className="num">{String(h.number).padStart(2, '0')}</span> {h.name} {h.scratched && <span className="badge error">出走取消</span>}
              </li>
            ))}
          </ul>
        )}
        {itemKey === 'weather' && (
          <div className="row">
            <button type="button" className="btn" onClick={loadWeather} disabled={Boolean(weatherBlocked) || loading} aria-describedby="weather-reason">
              {loading ? <span className="spinner" aria-hidden="true" /> : <Icon name="cloud-rain" />}
              {loading ? '取得中' : '天気予報を取得（Open-Meteo）'}
            </button>
            {weatherBlocked && (
              <span id="weather-reason" className="hint">
                {weatherBlocked}
              </span>
            )}
          </div>
        )}
        <fieldset className="subgroup">
          <legend>出典</legend>
          <div className="formgrid">
            <label>
              提供者
              <input value={provider} maxLength={80} onChange={(e) => setProvider(e.target.value)} placeholder="例：JRA公式サイト" />
            </label>
            <label>
              元URL（http/https）
              <input type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
            </label>
            <label>
              取得日時（JST）
              <input type="datetime-local" value={fetchedLocal} onChange={(e) => setFetchedLocal(e.target.value)} />
            </label>
            <label>
              対象時点（JST）
              <input type="datetime-local" value={asOfLocal} onChange={(e) => setAsOfLocal(e.target.value)} />
            </label>
          </div>
          {source && (
            <p className="hint">
              記録済み：<SafeLink href={source.url}>{source.url ?? 'URLなし'}</SafeLink>／対象時点 {formatJst(source.asOf)}
            </p>
          )}
        </fieldset>
        <div className="row">
          <button type="button" className="btn primary" onClick={apply}>
            <Icon name="check" /> この内容で反映
          </button>
          {saved && <span className="ok-text" role="status">反映しました</span>}
        </div>
        {errors.length > 0 && (
          <div className="error-box" role="alert">
            {errors.map((e, i) => (
              <p key={i}>{e}</p>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

function oddsToText(d: Draft): string {
  if (!d.odds) return '';
  const num = (id: string) => d.horses.find((h) => h.id === id)?.number ?? '?';
  return [
    ...d.odds.win.map((w) => `${num(w.horseId)} ${w.odds}`),
    ...d.odds.wide.map((w) => `${num(w.horseIds[0])}-${num(w.horseIds[1])} ${w.min}-${w.max}`),
  ].join('\n');
}
