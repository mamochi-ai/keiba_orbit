import { useEffect, useState } from 'react';
import { draftFromSnapshot } from '../domain/draft';
import { buildNotePrompt } from '../domain/prompt';
import { stripOuterFence } from '../domain/parse';
import { SCENARIO_IDS, SCENARIO_LABELS, type SavedAnalysis, type ScenarioId } from '../domain/schema';
import { checkResponse, horseLabel } from '../domain/validate';
import { formatDateJa, formatJst, nowIso } from '../domain/time';
import { getAnalysis, listAnalyses, setNoteArticle } from '../storage/db';
import { navigate, useApp } from '../state';
import { CopyButton, DemoBadge, EmptyState, Icon, OpenClaudeLink, SafeLink } from '../ui/common';
import { SafeMarkdown } from '../ui/SafeMarkdown';
import { BudgetPanel, ScenarioRanking, STATUS_LABELS } from './reportParts';

export function Report({ id }: { id: string }) {
  const [rec, setRec] = useState<SavedAnalysis | null | undefined>(undefined);
  const [siblings, setSiblings] = useState<SavedAnalysis[]>([]);
  const [scenario, setScenario] = useState<ScenarioId>('base');
  const { draft, setDraft } = useApp();

  useEffect(() => {
    let alive = true;
    setRec(undefined);
    (async () => {
      try {
        const r = await getAnalysis(id);
        if (!alive) return;
        setRec(r ?? null);
        if (r) setSiblings((await listAnalyses()).filter((x) => x.raceKey === r.raceKey).sort((a, b) => a.version - b.version));
      } catch {
        if (alive) setRec(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  if (rec === undefined) {
    return (
      <section className="panel section" aria-busy="true">
        <p className="row">
          <span className="spinner" aria-hidden="true" /> 保存した分析を読み込み中
        </p>
      </section>
    );
  }
  if (rec === null) {
    return (
      <section className="panel section">
        <h1 tabIndex={-1}>レポートが見つかりません</h1>
        <EmptyState title="この端末に保存されていないか、削除されています。">
          <a className="btn" href="#/saved">
            保存した分析へ
          </a>
        </EmptyState>
      </section>
    );
  }

  const { snapshot, response } = rec;
  const recheck = checkResponse(snapshot, response);
  const sc = response.scenarios.find((s) => s.id === scenario);
  const parent = rec.parentId ? siblings.find((s) => s.id === rec.parentId) : undefined;

  function reanalyze() {
    if (draft.name && draft.copied?.snapshotId !== snapshot.snapshotId && !window.confirm('作業中の下書きを、この分析の入力内容で置き換えて再分析しますか？')) return;
    setDraft({ ...draftFromSnapshot(snapshot, rec!.id) });
    navigate('/prepare');
  }

  return (
    <>
      <section className="report-cover" aria-labelledby="report-title">
        <div className="cover-grid" style={{ backgroundImage: 'url(assets/report-grid.svg)' }} aria-hidden="true" />
        <span className="eyebrow">03 / RACE REPORT</span>
        <h1 id="report-title" tabIndex={-1} className="cover-title">
          {snapshot.race.name} {rec.isDemo && <span className="badge warn">架空レース</span>}
        </h1>
        <p className="muted">
          {formatDateJa(snapshot.race.date)}　{snapshot.race.venue ?? '競馬場未確認'} {snapshot.race.number ? `${snapshot.race.number}R` : ''}　／　版{rec.version}（{rec.kind === 'original' ? '元レポート' : '再分析版'}）・{formatJst(rec.createdAt)} 作成
        </p>
        <p className="lead">{response.summary || '（結論の記載なし）'}</p>
        <div className="row">
          <span className="badge">{STATUS_LABELS[response.status]}</span>
          <span className="badge">Claude通常チャットの応答をアプリで形式チェック済（内容の正しさは未検証）</span>
          {rec.isDemo && <span className="badge warn">表示見本 / 架空デモ / 購入判断に使用不可</span>}
        </div>
      </section>

      {(parent || siblings.length > 1) && (
        <nav className="panel versions" aria-label="この分析の版">
          <span className="eyebrow">VERSIONS</span>
          <ul className="row plain">
            {siblings.map((s) => (
              <li key={s.id}>
                {s.id === rec.id ? (
                  <span className="badge ok" aria-current="page">
                    版{s.version}（表示中）
                  </span>
                ) : (
                  <a className="btn ghost" href={`#/report/${s.id}`}>
                    版{s.version}
                    {s.kind === 'original' ? '（元）' : ''}
                  </a>
                )}
              </li>
            ))}
          </ul>
          {parent && <p className="hint">この版は「版{parent.version}」をもとにした再分析です。元レポートは変更されていません。</p>}
        </nav>
      )}

      {!recheck.ok && (
        <div className="error-box section" role="alert">
          <p>
            <b>保存データの再チェックで問題が見つかりました：</b>
          </p>
          <ul>
            {recheck.issues
              .filter((i) => i.level === 'error')
              .map((i, k) => (
                <li key={k}>{i.message}</li>
              ))}
          </ul>
        </div>
      )}

      <div className="layout report-layout">
        <div className="stack">
          <section className="panel" aria-labelledby="scenario-title">
            <div className="row">
              <span className="eyebrow">SCENARIO</span>
              <span className="muted">条件ごとの見通し</span>
            </div>
            <h2 id="scenario-title" className="visually-hidden">
              条件別の評価
            </h2>
            <div className="tabs mt" role="tablist" aria-label="条件">
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
                    className="btn"
                    onClick={() => setScenario(sid)}
                  >
                    <Icon name={sid === 'base' ? 'sun' : sid === 'wet' ? 'cloud-rain' : 'wind'} />
                    {SCENARIO_LABELS[sid]}
                    {(!s || s.status !== 'analyzed') && <span className="tab-note">未分析</span>}
                  </button>
                );
              })}
            </div>
            <div id="scenario-panel" role="tabpanel" aria-labelledby={`tab-${scenario}`} aria-live="polite">
              {sc && sc.status === 'analyzed' && sc.order.length > 0 ? (
                <>
                  <p className="scenario-reason">
                    <b>順位の理由：</b>
                    {sc.reason || '記載なし'}
                  </p>
                  <ScenarioRanking snapshot={snapshot} response={response} scenario={scenario} />
                </>
              ) : (
                <EmptyState title={`「${SCENARIO_LABELS[scenario]}」は未分析です`}>
                  <p className="muted">{sc?.reason || 'この条件の分析結果は応答に含まれていません。'}</p>
                  <button type="button" className="btn" onClick={reanalyze}>
                    情報を補って再分析
                  </button>
                </EmptyState>
              )}
            </div>
            <p className="hint">条件を切り替えても、配分（賭け金）は変わりません。</p>
          </section>

          <section className="panel" aria-labelledby="compare-title">
            <h2 id="compare-title" className="h3">
              条件の比較
            </h2>
            <ul className="compare">
              {SCENARIO_IDS.map((sid) => {
                const s = response.scenarios.find((x) => x.id === sid);
                return (
                  <li key={sid}>
                    <span className="compare-label">{SCENARIO_LABELS[sid]}</span>
                    <span>{s && s.status === 'analyzed' && s.order.length ? s.order.slice(0, 3).map((id) => horseLabel(snapshot, id)).join(' → ') : '未分析'}</span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="panel" aria-labelledby="review-title">
            <h2 id="review-title" className="h3">
              予想を見直す条件
            </h2>
            {response.reviewTriggers.length ? (
              <ul className="plain">
                {response.reviewTriggers.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            ) : (
              <p className="muted">記載なし</p>
            )}
            <button type="button" className="btn mt" onClick={reanalyze}>
              <Icon name="history" /> 再分析（新しい版として保存）
            </button>
          </section>

          <section className="panel" aria-labelledby="missing-title">
            <h2 id="missing-title" className="h3">
              情報の不足
            </h2>
            <ul className="plain">
              {snapshot.missing.map((m, i) => (
                <li key={`m${i}`}>未取得：{m}</li>
              ))}
              {response.limitations.map((m, i) => (
                <li key={`l${i}`}>{m}</li>
              ))}
              {snapshot.missing.length + response.limitations.length === 0 && <li className="muted">記載なし</li>}
            </ul>
            <p className="hint">
              計算：{response.calculation.executed ? '実行済み' : '未実行'}（{response.calculation.method || '方法の記載なし'}）
            </p>
          </section>

          <section className="panel" aria-labelledby="source-title">
            <h2 id="source-title" className="h3">
              出典
            </h2>
            <p className="hint">情報締切：{formatJst(snapshot.cutoffAt)}／オッズ対象時点：{formatJst(snapshot.odds?.asOf ?? null)}</p>
            {snapshot.sources.length === 0 ? (
              <p className={rec.isDemo ? 'demo' : 'muted'}>出典の記録はありません{rec.isDemo ? '（架空デモ）' : ''}。</p>
            ) : (
              <ul className="sources">
                {snapshot.sources.map((s) => (
                  <li key={s.id}>
                    <b>{s.label}</b>：{s.provider} {s.isDemo && <DemoBadge />}
                    <br />
                    <SafeLink href={s.url} />
                    <br />
                    <span className="hint">
                      取得 {formatJst(s.fetchedAt)}／対象時点 {formatJst(s.asOf)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="stack side">
          <BudgetPanel snapshot={snapshot} response={response} />
          <NotePanel rec={rec} onChange={setRec} />
          <section className="panel">
            <h2 className="h3">レース後の記録</h2>
            <p className="muted">結果と収支は「保存した分析」で別に記録します。予想時点の内容は変わりません。</p>
            <a className="btn" href="#/saved">
              <Icon name="wallet" /> 収支を記録する
            </a>
          </section>
        </aside>
      </div>
    </>
  );
}

function NotePanel({ rec, onChange }: { rec: SavedAnalysis; onChange: (r: SavedAnalysis) => void }) {
  const [text, setText] = useState(rec.noteArticle?.text ?? '');
  const [view, setView] = useState<'preview' | 'raw'>('preview');
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(value: string | null) {
    setSaving(true);
    setError(null);
    try {
      onChange(await setNoteArticle(rec.id, value, nowIso()));
      setMsg(value === null ? '記事を削除しました' : '記事を保存しました');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="note-title">
      <span className="eyebrow">NOTE ARTICLE</span>
      <h2 id="note-title" className="h3">
        分析を記事に
      </h2>
      <p className="muted">根拠と注意点を保ったまま、Claudeへの記事作成指示をコピーします（noteへ直接投稿する機能ではありません）。</p>
      <div className="stack-sm">
        <CopyButton label="note記事作成用コピー" getText={() => buildNotePrompt(rec)} />
        <OpenClaudeLink />
      </div>
      <details className="subgroup" open={Boolean(rec.noteArticle)}>
        <summary>生成された記事を貼り戻す（任意）</summary>
        <label>
          記事の原文（Markdown）
          <textarea rows={8} maxLength={60000} value={text} onChange={(e) => setText(e.target.value)} className="mono" />
        </label>
        <div className="row mt">
          <button
            type="button"
            className="btn"
            disabled={!/^\s*`{3,}/.test(text)}
            onClick={() => {
              const r = stripOuterFence(text);
              setText(r.text);
              setMsg(r.stripped ? '外側のコードフェンスを外しました' : '外側のコードフェンスが見つかりません');
            }}
          >
            外側のコードフェンスを外す
          </button>
          <button type="button" className="btn primary" disabled={saving || !text.trim()} onClick={() => save(text)}>
            {saving && <span className="spinner" aria-hidden="true" />}保存
          </button>
          {rec.noteArticle && (
            <button type="button" className="btn danger" disabled={saving} onClick={() => save(null).then(() => setText(''))}>
              削除
            </button>
          )}
        </div>
        {msg && (
          <p className="ok-text" role="status">
            {msg}
          </p>
        )}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        {text.trim() && (
          <>
            <div className="tabs mt" role="tablist" aria-label="記事の表示">
              <button type="button" role="tab" className="btn" aria-selected={view === 'preview'} onClick={() => setView('preview')}>
                表示用プレビュー
              </button>
              <button type="button" role="tab" className="btn" aria-selected={view === 'raw'} onClick={() => setView('raw')}>
                コピー用原文
              </button>
            </div>
            <div role="tabpanel" className="mt">
              {view === 'preview' ? <SafeMarkdown source={stripOuterFence(text).text} /> : <pre className="raw">{text}</pre>}
            </div>
            {view === 'raw' && <CopyButton label="原文をコピー" primary={false} getText={() => text} />}
            <p className="hint">プレビューは簡易表示です。noteに貼り付けたとき見出し等が必ず変換されるとは限りません。</p>
          </>
        )}
      </details>
    </section>
  );
}
