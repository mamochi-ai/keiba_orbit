import { useRef, useState } from 'react';
import { buildSnapshot, itemStatus, parseEntries, parseOdds, validateHome, type Draft, type LineError } from '../domain/draft';
import { buildAnalysisPrompt } from '../domain/prompt';
import { ITEM_KEYS, ITEM_LABELS, ITEM_TEXT_LIMITS, isSafeHttpUrl, type ItemKey, type RaceSnapshot, type Source } from '../domain/schema';
import { parseSnapshot } from '../domain/validate';
import { formatDateJa, formatJst, isoToJstLocal, jstLocalToIso, nowIso } from '../domain/time';
import { fetchWeather, WEATHER_PROVIDER } from '../data/weather';
import { navigate, useApp } from '../state';
import { CLAUDE_URL, CopyButton, EmptyState, Icon, SafeLink, StatusBadge } from '../ui/common';
import { CardImport } from './CardImport';
import { CopyGuide } from '../ui/CopyGuide';

const HINTS: Record<ItemKey, string> = {
  identity: '開催日・レース名・競馬場・R番号がそろうと「取得済」になります。確認に使った出馬表のURLを記録できます。',
  entries: '1行に「馬番 馬名」。出走取消は行末に「取消」。例：4 オービットスター',
  past: '要約は不要です。JRA公式の出馬表ページ（各馬の近4走が載っています）を全選択してコピーし、そのまま貼り付けてください。整理はClaudeが行います。',
  track: '公式発表の馬場状態など。天気とは別の情報です。',
  weather: '天気予報。馬場状態とは同一視しません。',
  odds: '単勝「4 3.2」、ワイド「4-7 2.1-2.8」を1行ずつ。取得時刻を必ず入力してください。',
};

export function Prepare() {
  const { draft, setDraft, images } = useApp();
  const homeErrors = validateHome(draft);
  const snapshotRef = useRef<RaceSnapshot | null>(null);
  // Bumped after the 出馬表 import so the item editors re-read the draft.
  const [rev, setRev] = useState(0);
  const [opened, setOpened] = useState(false);

  if (!draft.name) {
    return (
      <section className="sec first">
        <div className="page-head">
          <span className="tag">Prep</span>
          <h1 tabIndex={-1} className="page-title">
            分析準備
          </h1>
        </div>
        <EmptyState title="まだレースが選ばれていません。">
          <a className="btn primary" href="#/">
            レースを選ぶ
          </a>
        </EmptyState>
      </section>
    );
  }

  const copyBlocked = !draft.confirmed
    ? '「分析対象と情報締切を確認しました」にチェックしてください。'
    : Object.keys(homeErrors).length
      ? 'レース画面の必須項目（開催日・レース名）に不備があります。'
      : undefined;

  function buildPromptText(): string {
    const snap = buildSnapshot(draft);
    const r = parseSnapshot(snap);
    if (!r.ok) throw new Error(`分析用データに問題があります：${r.issues.map((i) => i.message).join(' / ')}`);
    snapshotRef.current = r.snapshot;
    return buildAnalysisPrompt(r.snapshot);
  }

  // Which step of the Claude round trip the user is on (only for emphasis; nothing is automated).
  const step = !draft.copied ? 1 : !opened ? 2 : 3;
  const stepClass = (n: number) => `step ${step === n ? 'current' : step > n ? 'done' : ''}`;
  let devJson = '';
  try {
    devJson = JSON.stringify(buildSnapshot(draft), null, 2);
  } catch {
    devJson = '（作成できません）';
  }

  return (
    <>
      <div className="page-head">
        <span className="tag">Prep</span>
        <h1 tabIndex={-1} className="page-title">
          <span className="visually-hidden">分析準備：</span>
          {draft.name}
        </h1>
        <p className="race-line">
          <span>{draft.isDemo ? '日付なし（架空）' : draft.date ? formatDateJa(draft.date) : <span className="unconfirmed">開催日未入力</span>}</span>
          <span className={draft.venue ? '' : 'unconfirmed'}>{draft.venue || '競馬場未確認'}</span>
          <span className={draft.number ? 'num' : 'unconfirmed'}>{draft.number ? `${draft.number}R` : 'R番号未確認'}</span>
          <a href="#/" className="linkish">
            レース情報を変更
          </a>
        </p>
      </div>
      <div className="prep">
        <section aria-labelledby="data-title">
          <div className="sec-head">
            <span className="tag">Data</span>
            <h2 id="data-title" className="sec-title">
              データ状況
            </h2>
            <span className="sec-note">開くと出典・取得時刻・入力欄を表示</span>
          </div>
          {draft.horses.length === 0 && !draft.isDemo && (
            <div className="feed-hint" role="note">
              <p>
                <b>出走表がまだありません。</b>受け取ったデータからレースを選ぶと、出走表・オッズ・過去成績・馬場がまとめて入ります。
              </p>
              <a className="btn primary small" href="#/feed">
                受け取ったデータからレースを選ぶ <Icon name="arrow" />
              </a>
            </div>
          )}
          <div className="data-list">
            {ITEM_KEYS.filter((k) => k !== 'identity').map((k) => (
              <ItemEditor key={`${k}-${rev}`} itemKey={k} />
            ))}
            <CardImport onApplied={() => setRev((r) => r + 1)} />
          </div>
        </section>

        <aside className="prep-side" aria-labelledby="bridge">
          <section>
            <div className="sec-head">
              <span className="tag">Bridge</span>
              <h2 id="bridge" className="sec-title">
                Claudeで分析
              </h2>
            </div>
            <ol className="bridge plain">
              <li className={stepClass(1)} aria-current={step === 1 ? 'step' : undefined}>
                <span className="step-no">1</span>
                <span className="step-title">指示をコピー</span>
                <div className="step-body">
                  <label>
                    情報締切（JST。この時刻より後の情報は使わない）
                    <span className="date-wrap">
                      <input
                        type="datetime-local"
                        value={draft.cutoffLocal}
                        onChange={(e) => setDraft((d) => ({ ...d, cutoffLocal: e.target.value, confirmed: false }))}
                      />
                    </span>
                  </label>
                  <label className="check">
                    <input type="checkbox" checked={draft.confirmed} onChange={(e) => setDraft((d) => ({ ...d, confirmed: e.target.checked }))} />
                    分析対象と情報締切を確認しました
                  </label>
                  <CopyButton
                    label="分析用コピー"
                    primary={step === 1}
                    getText={buildPromptText}
                    disabled={Boolean(copyBlocked)}
                    disabledReason={copyBlocked}
                    onCopied={() => {
                      const snap = snapshotRef.current;
                      if (snap) setDraft((d) => ({ ...d, copied: snap }));
                      setOpened(false);
                    }}
                  />
                </div>
              </li>
              <li className={stepClass(2)} aria-current={step === 2 ? 'step' : undefined}>
                <span className="step-no">2</span>
                <span className="step-title">Claudeで分析</span>
                <div className="step-body">
                  <a className={`btn ${step === 2 ? 'primary' : ''}`} href={CLAUDE_URL} target="_blank" rel="noopener noreferrer" onClick={() => setOpened(true)}>
                    Claudeを開く <Icon name="external" />
                  </a>
                  <p className="hint">新しいチャットに貼り付けて送信します。{images.length > 0 && `参考画像${images.length}枚はここで添付してください。`}</p>
                </div>
              </li>
              <li className={stepClass(3)} aria-current={step === 3 ? 'step' : undefined}>
                <span className="step-no">3</span>
                <span className="step-title">結果を貼り付け</span>
                <div className="step-body">
                  <button type="button" className={`btn ${step === 3 ? 'primary' : ''}`} onClick={() => navigate('/paste')} disabled={!draft.copied} aria-describedby={draft.copied ? undefined : 'paste-reason'}>
                    <Icon name="paste" /> 結果を貼り付け
                  </button>
                  {!draft.copied && (
                    <p id="paste-reason" className="hint">
                      先に「分析用コピー」をしてください。
                    </p>
                  )}
                </div>
              </li>
            </ol>
            {draft.copied && (
              <p className="hint">
                コピー済みの版 <code>{draft.copied.snapshotId}</code>。内容を変えたらコピーし直してください。
              </p>
            )}
            <p className="hint">Claudeへのログインや入力の自動操作はしません。</p>
          </section>
          <section>
            <CopyGuide topics={['claude']} />
            <details className="subgroup dev-json">
              <summary>コピーする入力データを見る（開発者向け）</summary>
              <pre>{devJson}</pre>
            </details>
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

  // Rows start closed; received data (受け取ったデータ) is the main way to fill them.
  return (
    <details className="item">
      <summary className="item-head">
        <span className="item-label">{ITEM_LABELS[itemKey]}</span>
        <StatusBadge status={status} />
        <span className="item-meta">
          {source ? `${source.provider}・${formatJst(source.fetchedAt)}取得${source.isDemo ? '・デモ' : ''}` : itemKey === 'identity' ? '' : '出典未記録'}
        </span>
      </summary>
      <div className="item-body">
        <p className="hint">{HINTS[itemKey]}</p>
        {itemKey === 'track' && <CopyGuide topics={['track']} />}
        {itemKey === 'odds' && <CopyGuide topics={['wide']} />}
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
            <textarea rows={itemKey === 'past' ? 10 : 5} maxLength={ITEM_TEXT_LIMITS[itemKey]} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
        )}
        {itemKey !== 'identity' && (
          <p className="hint num">
            {text.length.toLocaleString('ja-JP')} / {ITEM_TEXT_LIMITS[itemKey].toLocaleString('ja-JP')} 文字
          </p>
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
          <div className="grid-2">
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
              <span className="date-wrap">
                <input type="datetime-local" value={fetchedLocal} onChange={(e) => setFetchedLocal(e.target.value)} />
              </span>
            </label>
            <label>
              対象時点（JST）
              <span className="date-wrap">
                <input type="datetime-local" value={asOfLocal} onChange={(e) => setAsOfLocal(e.target.value)} />
              </span>
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
