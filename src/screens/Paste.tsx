import { useState } from 'react';
import { demoResponse } from '../domain/demo';
import { activeRunners, computeTotals, estimateBet, formatYen } from '../domain/money';
import { parsePastedJson } from '../domain/parse';
import { SCENARIO_LABELS, type SavedAnalysis } from '../domain/schema';
import { checkResponse, horseLabel, type ResponseCheck } from '../domain/validate';
import { nowIso } from '../domain/time';
import { addAnalysis, nextVersion } from '../storage/db';
import { navigate, useApp } from '../state';
import { EmptyState, Icon } from '../ui/common';
import { betLabel, PayoutLine, STATUS_LABELS } from './reportParts';

export function Paste() {
  const { draft, setDraft } = useApp();
  const [text, setText] = useState('');
  const [parseError, setParseError] = useState<{ message: string; line?: number; truncated?: boolean } | null>(null);
  const [check, setCheck] = useState<ResponseCheck | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const snapshot = draft.copied;

  if (!snapshot) {
    return (
      <section className="sec first">
        <div className="page-head">
          <h1 tabIndex={-1} className="page-title">
            結果を貼り付け
          </h1>
        </div>
        <EmptyState title="まだ分析用コピーをしていません。">
          <p className="muted">貼り付けた結果は、コピーした版と照合します。</p>
          <a className="btn primary" href="#/prepare">
            分析準備へ
          </a>
        </EmptyState>
      </section>
    );
  }

  function read() {
    setCheck(null);
    setSaveError(null);
    const p = parsePastedJson(text);
    if (!p.ok) {
      setParseError({ message: p.message, line: p.line, truncated: p.truncated });
      return;
    }
    setParseError(null);
    setCheck(checkResponse(snapshot!, p.value));
  }

  async function save() {
    if (!check?.ok || !check.response || !snapshot) return;
    setSaving(true);
    setSaveError(null);
    try {
      const version = await nextVersion(snapshot.race.id);
      const rec: SavedAnalysis = {
        id: `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        raceKey: snapshot.race.id,
        version,
        kind: draft.parentId ? 'revision' : version > 1 ? 'revision' : 'original',
        parentId: draft.parentId,
        isDemo: snapshot.isDemo,
        createdAt: nowIso(),
        snapshot,
        response: check.response,
        noteArticle: null,
      };
      await addAnalysis(rec);
      setDraft((d) => ({ ...d, parentId: rec.id }));
      navigate(`/report/${rec.id}`);
    } catch (e) {
      setSaveError(`保存できませんでした：${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  const errors = check?.issues.filter((i) => i.level === 'error') ?? [];
  const warnings = check?.issues.filter((i) => i.level === 'warning') ?? [];
  const res = check?.response;

  return (
    <>
      <div className="page-head">
        <span className="tag">Step 3</span>
        <h1 tabIndex={-1} className="page-title">
          結果を貼り付け
        </h1>
        <p className="muted">
          照合先：{snapshot.race.name}／版 <code>{snapshot.snapshotId}</code>
        </p>
      </div>
      <section className="sec first">
        <label>
          Claudeの応答（JSONのみ、または ```json のコードフェンス1個）
          <textarea
            rows={10}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setCheck(null);
            }}
            spellCheck={false}
            className="mono"
            aria-invalid={Boolean(parseError)}
            aria-describedby="paste-error"
          />
        </label>
        <div className="row mt">
          <button type="button" className="btn primary" onClick={read} disabled={!text.trim()}>
            <Icon name="search" /> 読み込んで確認
          </button>
          {snapshot.isDemo && (
            <button type="button" className="btn" onClick={() => setText(JSON.stringify(demoResponse(snapshot), null, 2))}>
              架空デモの応答を入れる
            </button>
          )}
          <a className="btn ghost" href="#/prepare">
            分析準備に戻る
          </a>
        </div>
        {!text.trim() && <p className="hint">貼り付け欄が空のため読み込めません。</p>}
        {parseError && (
          <div id="paste-error" className="error-box" role="alert">
            <p>{parseError.message}</p>
            {parseError.truncated ? (
              <div className="truncated-help">
                <p>
                  <b>Claudeの応答が途中で切れています。</b>次のどちらかで直せます。
                </p>
                <ol className="guide-steps">
                  <li>
                    Claudeに「続きを、前の出力の最後の文字の直後からそのまま出力してください」と送り、出てきた続きをこの欄の最後に貼り足して、もう一度「読み込んで確認」。
                  </li>
                  <li>
                    Claudeに「JSONが長すぎて途中で切れました。horses は注目する馬5頭まで、reasons と concerns は各2件まで、各文は短くして、JSONだけを最初から出力し直してください」と送り、新しい応答を貼り直す。
                  </li>
                </ol>
                <p className="hint">Claudeがまだ書いている途中でコピーした場合も、こうなります。応答が終わってからコピーしてください。</p>
              </div>
            ) : (
              parseError.line !== undefined && <ErrorLine text={text} line={parseError.line} />
            )}
          </div>
        )}
      </section>

      {check && (
        <section className="sec confirm" aria-labelledby="confirm">
          <div className="sec-head">
            <span className="tag">Confirm</span>
            <h2 id="confirm" className="sec-title">
              取り込み内容の確認
            </h2>
          </div>
          {errors.length > 0 ? (
            <div className="error-box" role="alert">
              <p>
                <b>取り込めません（{errors.length}件）</b>
              </p>
              <ul>
                {errors.map((e, i) => (
                  <li key={i}>{e.message}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="ok-text">形式と照合のチェックを通過しました。予想の正しさは検証していません。内容を確認して保存してください。</p>
          )}
          {warnings.length > 0 && (
            <div className="notice">
              <p>
                <b>注意（{warnings.length}件）</b>
              </p>
              <ul>
                {warnings.map((w, i) => (
                  <li key={i}>{w.message}</li>
                ))}
              </ul>
            </div>
          )}
          {res && check.ok && (
            <div className="confirm">
              <div>
                <span className="badge">{STATUS_LABELS[res.status]}</span>
                <p className="conclusion-text">{res.summary || '（結論の記載なし）'}</p>
              </div>
              <div>
                <h3 className="subhead">条件別</h3>
                <ul className="plain">
                  {res.scenarios.map((s) => (
                    <li key={s.id}>
                      {SCENARIO_LABELS[s.id]}：{s.status === 'analyzed' ? s.order.map((id) => horseLabel(snapshot, id)).join(' → ') || '順位なし' : '未分析'}
                    </li>
                  ))}
                  {res.scenarios.length === 0 && <li>条件別の分析はありません</li>}
                </ul>
              </div>
              <div>
                <h3 className="subhead">配分（裁量的な仮説）</h3>
                {res.bets.length === 0 ? (
                  <p className="muted">配分は空です。</p>
                ) : (
                  res.bets.map((b, i) => (
                    <div className="listrow" key={i}>
                      <span>
                        {betLabel(snapshot, b)}
                        <PayoutLine estimate={estimateBet(snapshot, b)} spent={computeTotals(snapshot.budget, res.bets).spent} />
                      </span>
                      <b className="num">{formatYen(b.amount)}</b>
                    </div>
                  ))
                )}
                {check.totals && (
                  <>
                    <div className="listrow">
                      <span>使う金額（再計算）</span>
                      <b className="num">{formatYen(check.totals.spent)}</b>
                    </div>
                    <div className="listrow">
                      <span>残す金額</span>
                      <b className="num">{formatYen(check.totals.unspent)}</b>
                    </div>
                  </>
                )}
                <p className="hint">出走 {activeRunners(snapshot).length} 頭。対応券種は単勝・ワイドのみです。</p>
              </div>
              <div className="row">
                <button type="button" className="btn primary" onClick={save} disabled={saving}>
                  {saving ? <span className="spinner" aria-hidden="true" /> : <Icon name="report" />}
                  {saving ? '保存中' : 'この内容で保存してレポートを表示'}
                </button>
                <button type="button" className="btn ghost" onClick={() => setCheck(null)}>
                  やり直す
                </button>
              </div>
              {saveError && (
                <p className="error-text" role="alert">
                  {saveError}
                </p>
              )}
            </div>
          )}
        </section>
      )}
    </>
  );
}

function ErrorLine({ text, line }: { text: string; line: number }) {
  const lines = text.split('\n');
  const from = Math.max(0, line - 2);
  return (
    <pre className="error-snippet" aria-label="エラー箇所の前後">
      {lines.slice(from, line + 1).map((l, i) => {
        const n = from + i + 1;
        return (
          <span key={n} className={n === line ? 'hl' : ''}>
            {String(n).padStart(3, ' ')}| {l.slice(0, 200)}
            {'\n'}
          </span>
        );
      })}
    </pre>
  );
}
