import { useEffect, useState } from 'react';
import { draftFromSnapshot } from '../domain/draft';
import { buildNotePrompt } from '../domain/prompt';
import { stripOuterFence } from '../domain/parse';
import type { SavedAnalysis, ScenarioId } from '../domain/schema';
import { checkResponse } from '../domain/validate';
import { formatDateJa, formatJst, nowIso } from '../domain/time';
import { getAnalysis, listAnalyses, setNoteArticle } from '../storage/db';
import { navigate, useApp } from '../state';
import { CopyButton, EmptyState, Icon, OpenClaudeLink, OrbitVisual, SafeLink } from '../ui/common';
import { SafeMarkdown } from '../ui/SafeMarkdown';
import { BudgetPanel, Candidates, ScenarioCompare, STATUS_LABELS, SummaryLines, Verdict } from './reportParts';
import { humanizeIds, splitSummary } from '../domain/reportText';

export function Report({ id }: { id: string }) {
  const [rec, setRec] = useState<SavedAnalysis | null | undefined>(undefined);
  const [siblings, setSiblings] = useState<SavedAnalysis[]>([]);
  const [scenario, setScenario] = useState<ScenarioId>('base');
  const { draft, setDraft, setReportIsDemo } = useApp();

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

  useEffect(() => {
    setReportIsDemo(Boolean(rec?.isDemo));
    return () => setReportIsDemo(false);
  }, [rec?.isDemo, setReportIsDemo]);

  if (rec === undefined) {
    return (
      <section className="sec first" aria-busy="true">
        <h1 tabIndex={-1} className="visually-hidden">
          レポート
        </h1>
        <p className="row">
          <span className="spinner" aria-hidden="true" /> 保存した分析を読み込み中
        </p>
      </section>
    );
  }
  if (rec === null) {
    return (
      <section className="sec first">
        <div className="page-head">
          <h1 tabIndex={-1} className="page-title">
            レポートが見つかりません
          </h1>
        </div>
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
  const race = snapshot.race;

  function reanalyze() {
    if (draft.name && draft.copied?.snapshotId !== snapshot.snapshotId && !window.confirm('作業中の内容を、この分析の入力内容で置き換えて再分析しますか？')) return;
    setDraft({ ...draftFromSnapshot(snapshot, rec!.id) });
    navigate('/prepare');
  }

  return (
    <>
      <header className="cover" aria-labelledby="report-title">
        <div>
          <span className="tag">Race report</span>
          <h1 id="report-title" tabIndex={-1} className="cover-race">
            {race.name}
          </h1>
          <p className="cover-meta">
            <span className={race.date ? '' : 'unconfirmed'}>{race.date ? formatDateJa(race.date) : rec.isDemo ? '日付なし（架空）' : '開催日未確認'}</span>
            <span className={race.venue ? '' : 'unconfirmed'}>{race.venue ?? '競馬場未確認'}</span>
            <span className={race.number ? 'num' : 'unconfirmed'}>{race.number ? `${race.number}R` : 'R番号未確認'}</span>
          </p>
          <div className="conclusion">
            <div className="row">
              <span className="tag">結論</span>
              <span className={`badge ${response.status === 'ready' ? 'ok' : 'warn'}`}>{STATUS_LABELS[response.status]}</span>
            </div>
            <Verdict snapshot={snapshot} response={response} />
            <details className="summary-box">
              <summary>Claudeの要約を読む（{splitSummary(response.summary).length}項目）</summary>
              <SummaryLines snapshot={snapshot} summary={response.summary} />
            </details>
          </div>
        </div>
        <OrbitVisual />
      </header>

      {!recheck.ok && (
        <div className="error-box" role="alert">
          <p>
            <b>保存データの再チェックで問題が見つかりました。</b>
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

      <div className="report">
        <section className="sec first r-cand" aria-labelledby="cand-title">
          <div className="sec-head">
            <span className="tag">Focus</span>
            <h2 id="cand-title" className="sec-title">
              中心候補と注目馬
            </h2>
          </div>
          <Candidates snapshot={snapshot} response={response} />
        </section>

        <section className="sec r-comp" aria-labelledby="comp-title">
          <div className="sec-head">
            <span className="tag purple">Scenario</span>
            <h2 id="comp-title" className="sec-title">
              条件別の比較
            </h2>
          </div>
          <ScenarioCompare snapshot={snapshot} response={response} scenario={scenario} onChange={setScenario} onReanalyze={reanalyze} />
        </section>

        <aside className="r-side" aria-label="予算配分">
          <BudgetPanel snapshot={snapshot} response={response} />
        </aside>

        <section className="sec r-review" aria-labelledby="review-title">
          <div className="sec-head">
            <span className="tag">Review</span>
            <h2 id="review-title" className="sec-title">
              見直す条件
            </h2>
          </div>
          {response.reviewTriggers.length ? (
            <ul className="plain">
              {response.reviewTriggers.map((t, i) => (
                <li key={i}>・{humanizeIds(t, snapshot)}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">記載なし</p>
          )}
          <button type="button" className="btn mt" onClick={reanalyze}>
            <Icon name="history" /> 再分析（新しい版として保存）
          </button>
        </section>

        <section className="sec r-details" aria-labelledby="details-title">
          <div className="sec-head">
            <span className="tag">Detail</span>
            <h2 id="details-title" className="sec-title">
              詳しい根拠・不足情報・出典
            </h2>
          </div>
          <details>
            <summary>
              不足している情報 <span className="badge warn">{snapshot.missing.length + response.limitations.length}件</span>
            </summary>
            <div className="detail-body">
              <ul className="plain">
                {snapshot.missing.map((m, i) => (
                  <li key={`m${i}`}>未取得：{m}</li>
                ))}
                {response.limitations.map((m, i) => (
                  <li key={`l${i}`}>{humanizeIds(m, snapshot)}</li>
                ))}
                {snapshot.missing.length + response.limitations.length === 0 && <li className="muted">記載なし</li>}
              </ul>
            </div>
          </details>
          <details>
            <summary>
              出典 <span className="badge">{snapshot.sources.length}件</span>
            </summary>
            <div className="detail-body">
              <p className="hint">
                情報締切 {formatJst(snapshot.cutoffAt)}／オッズ対象時点 {formatJst(snapshot.odds?.asOf ?? null)}
              </p>
              {snapshot.sources.length === 0 ? (
                <p className="muted">出典の記録はありません。</p>
              ) : (
                <ul className="sources">
                  {snapshot.sources.map((s) => (
                    <li key={s.id}>
                      <b>{s.label}</b>：{s.provider}
                      {s.isDemo && <span className="badge warn" style={{ marginLeft: 8 }}>架空</span>}
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
            </div>
          </details>
          <details>
            <summary>分析の詳細</summary>
            <div className="detail-body">
              <dl className="kv">
                <dt>作成日時</dt>
                <dd>{formatJst(rec.createdAt)}</dd>
                <dt>版</dt>
                <dd>
                  版{rec.version}（{rec.kind === 'original' ? '元レポート' : '再分析版'}）
                </dd>
                <dt>形式チェック</dt>
                <dd>{recheck.ok ? '形式と照合のチェックに合格。予想の正しさは検証していません。' : '問題あり（上部の表示を参照）'}</dd>
                <dt>計算</dt>
                <dd>
                  {response.calculation.executed ? 'Claude側で実行済み' : 'Claude側では未実行'}（{response.calculation.method || '方法の記載なし'}）。金額はアプリで再計算しています。
                </dd>
                <dt>データ</dt>
                <dd>{rec.isDemo ? '架空デモ' : '利用者が入力・貼り付けした情報'}</dd>
              </dl>
              {siblings.length > 1 && (
                <nav aria-label="この分析の版">
                  <ul className="row plain">
                    {siblings.map((s) =>
                      s.id === rec.id ? (
                        <li key={s.id}>
                          <span className="badge ok" aria-current="page">
                            版{s.version}（表示中）
                          </span>
                        </li>
                      ) : (
                        <li key={s.id}>
                          <a className="btn small" href={`#/report/${s.id}`}>
                            版{s.version}
                            {s.kind === 'original' ? '（元）' : ''}
                          </a>
                        </li>
                      ),
                    )}
                  </ul>
                </nav>
              )}
              <a className="btn small" href="#/saved">
                <Icon name="wallet" /> レース後の収支を記録する
              </a>
            </div>
          </details>
        </section>

        <NotePanel rec={rec} onChange={setRec} />
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
    <section className="sec r-note" aria-labelledby="note-title">
      <div className="sec-head">
        <span className="tag">Note</span>
        <h2 id="note-title" className="sec-title">
          note記事にする
        </h2>
      </div>
      <p className="muted">予想・金額・出典を変えずに、Claudeへの記事作成指示をコピーします。noteへ直接投稿する機能ではありません。</p>
      <div className="row mt">
        <CopyButton label="note記事作成用コピー" getText={() => buildNotePrompt(rec)} />
        <OpenClaudeLink />
      </div>
      <details className="subgroup mt" open={Boolean(rec.noteArticle)}>
        <summary>生成された記事を貼り戻す（任意）</summary>
        <div className="detail-body" style={{ display: 'grid', gap: 12 }}>
          <label>
            記事の原文（Markdown）
            <textarea rows={8} maxLength={60000} value={text} onChange={(e) => setText(e.target.value)} className="mono" />
          </label>
          <div className="row">
            <button
              type="button"
              className="btn small"
              disabled={!/^\s*`{3,}/.test(text)}
              onClick={() => {
                const r = stripOuterFence(text);
                setText(r.text);
                setMsg(r.stripped ? '外側のコードフェンスを外しました' : '外側のコードフェンスが見つかりません');
              }}
            >
              外側のコードフェンスを外す
            </button>
            <button type="button" className="btn primary small" disabled={saving || !text.trim()} onClick={() => save(text)}>
              {saving && <span className="spinner" aria-hidden="true" />}保存
            </button>
            {rec.noteArticle && (
              <button type="button" className="btn danger small" disabled={saving} onClick={() => save(null).then(() => setText(''))}>
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
              <div className="tabs" role="tablist" aria-label="記事の表示">
                <button type="button" role="tab" className="btn small" aria-selected={view === 'preview'} onClick={() => setView('preview')}>
                  表示用プレビュー
                </button>
                <button type="button" role="tab" className="btn small" aria-selected={view === 'raw'} onClick={() => setView('raw')}>
                  コピー用原文
                </button>
              </div>
              <div role="tabpanel">{view === 'preview' ? <SafeMarkdown source={stripOuterFence(text).text} /> : <pre className="raw">{text}</pre>}</div>
              {view === 'raw' && <CopyButton label="原文をコピー" primary={false} getText={() => text} />}
              <p className="hint">プレビューは簡易表示です。noteに貼り付けたとき見出しが必ず変換されるとは限りません。</p>
            </>
          )}
        </div>
      </details>
    </section>
  );
}
