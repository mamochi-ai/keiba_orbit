import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import { FEED_STATE_LABEL, formatRange, matchTrack, parseFeed, trackSummary, unnumberedRunners, type FeedRace, type FeedTrack, type FeedWide } from '../domain/feed';
import { feedRaceToDraft, pastRunLine } from '../domain/feedDraft';
import { findJsonError } from '../domain/parse';
import { formatDateJa, formatJst, nowIso } from '../domain/time';
import { applyFeed, clearSampleFeed, deleteFeedRace, getFeedRace, listFeedRaces, listFeedTracks, type FeedApplyResult } from '../storage/db';
import { navigate, useApp } from '../state';
import { EmptyState, Icon, SafeLink } from '../ui/common';

const MAX_FEED_BYTES = 5_000_000;

export function feedHref(key: string) {
  return `#/feed/${encodeURIComponent(key)}`;
}

/** Accepts the JSON itself or one ```json fenced block copied from a document. */
function extractJson(raw: string): string {
  const t = raw.replace(/^﻿/, '').trim();
  const m = /```(?:json|JSON)?[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```/.exec(t);
  return m ? m[1]! : t;
}

type ImportView = { kind: 'ok'; result: FeedApplyResult; sample: boolean } | { kind: 'error'; lines: string[] };

export function Feed() {
  const [races, setRaces] = useState<FeedRace[] | null>(null);
  const [tracks, setTracks] = useState<FeedTrack[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<ImportView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setRaces(await listFeedRaces());
      setTracks(await listFeedTracks());
    } catch {
      setRaces([]);
      setLoadError('端末の保存領域を読み込めませんでした。');
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  async function importText(raw: string) {
    setView(null);
    if (!raw.trim()) return setView({ kind: 'error', lines: ['取り込む内容が空です。'] });
    if (new Blob([raw]).size > MAX_FEED_BYTES) return setView({ kind: 'error', lines: ['データが大きすぎます（上限5MB）。'] });
    const json = extractJson(raw);
    const syntax = findJsonError(json);
    if (syntax) return setView({ kind: 'error', lines: [`JSONとして読めません（${syntax.index + 1}文字目）：${syntax.message}`] });
    const parsed = parseFeed(JSON.parse(json), nowIso());
    if (!parsed.ok) return setView({ kind: 'error', lines: ['受け取りデータの形式に合いません。', ...parsed.errors] });
    setBusy(true);
    try {
      const result = await applyFeed(parsed.feed);
      setView({ kind: 'ok', result, sample: parsed.feed.sample });
      setText('');
      await reload();
    } catch (e) {
      setView({ kind: 'error', lines: [`保存できませんでした：${(e as Error).message}`] });
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_FEED_BYTES) return setView({ kind: 'error', lines: ['ファイルが大きすぎます（上限5MB）。'] });
    await importText(await file.text());
  }

  const live = (races ?? []).filter((r) => !r.sample);
  const sample = (races ?? []).filter((r) => r.sample);

  return (
    <>
      <div className="page-head">
        <span className="tag">Received data</span>
        <h1 tabIndex={-1} className="page-title">
          受け取ったデータ
        </h1>
        <p className="muted">受け取ったJRAの出馬表・ワイドオッズ・馬場情報を取り込み、レースを選んで分析を始めます。アプリがJRAから自動で取得するものではありません。</p>
      </div>

      <section className="sec first" aria-labelledby="feed-import">
        <div className="sec-head">
          <span className="tag">Import</span>
          <h2 id="feed-import" className="sec-title">
            取り込む
          </h2>
        </div>
        <div className="row">
          <label className="btn primary file-btn">
            <Icon name="paste" /> ファイルを選ぶ
            <input type="file" accept="application/json,.json,text/plain" onChange={onFile} className="visually-hidden" />
          </label>
          <span className="hint">または、下に貼り付け（```json の囲みごと貼っても読めます）</span>
        </div>
        <label className="mt">
          受け取りデータ（JSON）
          <textarea rows={6} className="mono" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        </label>
        <div className="row mt">
          <button type="button" className="btn" disabled={!text.trim() || busy} onClick={() => importText(text)}>
            {busy && <span className="spinner" aria-hidden="true" />}取り込む
          </button>
          {!text.trim() && <span className="hint">貼り付けると押せます</span>}
        </div>
        {view?.kind === 'error' && (
          <div className="error-box" role="alert">
            {view.lines.map((l, i) => (
              <p key={i}>{l}</p>
            ))}
          </div>
        )}
        {view?.kind === 'ok' && <ImportSummary result={view.result} sample={view.sample} />}
        {loadError && <p className="error-box">{loadError}</p>}
      </section>

      <section className="sec" aria-labelledby="feed-live">
        <div className="sec-head">
          <span className="tag">Races</span>
          <h2 id="feed-live" className="sec-title">
            受け取ったレース
          </h2>
        </div>
        {races === null ? (
          <p className="row">
            <span className="spinner" aria-hidden="true" /> 読み込み中
          </p>
        ) : live.length === 0 ? (
          <EmptyState title="まだ受け取ったレースはありません。">
            <p className="muted">データを受け取ったら、上の「取り込む」から読み込んでください。</p>
          </EmptyState>
        ) : (
          <RaceList races={live} />
        )}
        <TrackList tracks={tracks.filter((t) => !t.sample)} />
      </section>

      {(sample.length > 0 || tracks.some((t) => t.sample)) && (
        <section className="sec" aria-labelledby="feed-sample">
          <div className="sec-head">
            <span className="tag" style={{ color: 'var(--amber)' }}>
              Sample
            </span>
            <h2 id="feed-sample" className="sec-title">
              テストデータ（sample）
            </h2>
            <span className="badge warn">予想・収支には使いません</span>
          </div>
          <RaceList races={sample} />
          <TrackList tracks={tracks.filter((t) => t.sample)} />
          <button
            type="button"
            className="btn danger small mt"
            onClick={async () => {
              if (!window.confirm('テストデータ（sample）をすべて削除しますか？')) return;
              await clearSampleFeed();
              await reload();
            }}
          >
            テストデータを削除
          </button>
        </section>
      )}
    </>
  );
}

function ImportSummary({ result, sample }: { result: FeedApplyResult; sample: boolean }) {
  const errors = result.issues.filter((i) => i.level === 'error');
  const warnings = result.issues.filter((i) => i.level === 'warning');
  return (
    <div role="status">
      <div className="ok-box">
        <p>
          <b>取り込みました。</b>
          {sample && '（テストデータとして保存。予想や収支には使いません）'}
        </p>
        <p>
          レース：新規 {result.added}件・更新 {result.updated}件／出走馬 {result.runners}頭／ワイド {result.pairs}組
          {result.mockPairs > 0 && `＋仮オッズ ${result.mockPairs}組`}／馬場情報 {result.tracks}件
        </p>
      </div>
      {errors.length > 0 && (
        <div className="error-box">
          <p>
            <b>取り込まなかった項目（{errors.length}件）</b>
          </p>
          <ul>
            {errors.map((e, i) => (
              <li key={i}>
                {e.where}：{e.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="notice">
          <p>
            <b>注意（{warnings.length}件）</b>
          </p>
          <ul>
            {warnings.slice(0, 5).map((e, i) => (
              <li key={i}>
                {e.where}：{e.message}
              </li>
            ))}
          </ul>
          {warnings.length > 5 && (
            <details>
              <summary className="linkish">残り{warnings.length - 5}件を表示</summary>
              <ul>
                {warnings.slice(5).map((e, i) => (
                  <li key={i}>
                    {e.where}：{e.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function oddsBadge(w: FeedWide | null) {
  if (!w || w.pairs.length === 0) return <span className="badge">ワイド {w ? FEED_STATE_LABEL[w.state] : '未取得'}</span>;
  if (w.isMock) return <span className="badge warn">仮オッズ {w.pairs.length}組</span>;
  return <span className={`badge ${w.retained ? 'warn' : 'ok'}`}>ワイド {w.pairs.length}組{w.retained ? '（前回の値）' : ''}</span>;
}

function RaceList({ races }: { races: FeedRace[] }) {
  return (
    <ul className="saved-list">
      {races.map((r) => (
        <li key={r.key} className="saved-item">
          <div className="saved-head">
            <div>
              <p className="saved-title">
                <a href={feedHref(r.key)}>
                  {r.venue}
                  <span className="num">{r.number}R</span> {r.name}
                </a>
              </p>
              <p className="muted">
                {formatDateJa(r.date)}
                {r.startTime ? `　発走 ${r.startTime}` : ''}
                {r.surface || r.distanceM ? `　${r.surface ?? ''}${r.distanceM ?? ''}${r.distanceM ? 'm' : ''}` : ''}
              </p>
            </div>
            <div className="row">
              <span className={`badge ${r.runners.length ? 'ok' : ''}`}>
                出走表 {r.runners.length ? `${r.runners.length}頭` : FEED_STATE_LABEL[r.entriesState]}
                {unnumberedRunners(r).length ? '・馬番未発表' : ''}
                {r.runnersRetained ? '（前回の値）' : ''}
              </span>
              {oddsBadge(r.wide)}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function TrackList({ tracks }: { tracks: FeedTrack[] }) {
  if (!tracks.length) return null;
  return (
    <details className="subgroup mt">
      <summary>馬場情報（{tracks.length}件）</summary>
      <ul className="sources">
        {tracks.map((t) => (
          <li key={t.key}>
            <b>{t.venue}</b>　対象日 {t.pageRaceDate ?? '不明'}　{t.status}
            <br />
            <span className="hint">
              芝 {t.turfGoing ?? '未取得'}・ダート {t.dirtGoing ?? '未取得'}（{t.goingAsOf ? `${formatJst(t.goingAsOf)}時点` : '時点不明'}）
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/* ------------------------------------------------------------------ */

export function FeedRaceView({ fkey }: { fkey: string }) {
  const { draft, setDraft } = useApp();
  const [race, setRace] = useState<FeedRace | null | undefined>(undefined);
  const [tracks, setTracks] = useState<FeedTrack[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await getFeedRace(fkey);
        const t = await listFeedTracks();
        if (!alive) return;
        setRace(r ?? null);
        setTracks(t);
      } catch {
        if (alive) setRace(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [fkey]);

  if (race === undefined) {
    return (
      <section className="sec first" aria-busy="true">
        <h1 tabIndex={-1} className="visually-hidden">
          受け取ったレース
        </h1>
        <p className="row">
          <span className="spinner" aria-hidden="true" /> 読み込み中
        </p>
      </section>
    );
  }
  if (race === null) {
    return (
      <section className="sec first">
        <div className="page-head">
          <h1 tabIndex={-1} className="page-title">
            レースが見つかりません
          </h1>
        </div>
        <a className="btn" href="#/feed">
          受け取ったデータへ
        </a>
      </section>
    );
  }

  const match = matchTrack(tracks, race);
  const unnumbered = unnumberedRunners(race).length;
  const { notes } = feedRaceToDraft(race, tracks);
  const w = race.wide;

  function start() {
    const hasWork = Boolean(draft.name || draft.horses.length || draft.copied);
    if (hasWork && !window.confirm('作業中の内容を、このレースの内容で置き換えますか？（保存済みの分析は消えません）')) return;
    setDraft(feedRaceToDraft(race!, tracks).draft);
    navigate('/prepare');
  }

  return (
    <>
      <div className="page-head">
        <a href="#/feed" className="linkish">
          ← 受け取ったデータ
        </a>
        <h1 tabIndex={-1} className="page-title">
          {race.venue}
          <span className="num">{race.number}R</span> {race.name}
          {race.sample && <span className="badge warn">テストデータ</span>}
        </h1>
        <p className="race-line">
          <span>{formatDateJa(race.date)}</span>
          {race.startTime && <span>発走 {race.startTime}</span>}
          {(race.surface || race.distanceM) && (
            <span>
              {race.surface ?? ''}
              {race.distanceM ? `${race.distanceM}m` : ''}
            </span>
          )}
          {race.direction && <span>{race.direction}回り</span>}
        </p>
        <p className="hint">
          照合キー：開催日・競馬場・R（受取データ上の識別子 {race.externalKey} はJRA公式IDではありません）／確認日 {race.checkedOn ?? '不明'}（時刻不明）
          {race.retainedFields?.length ? `／前回の値を維持：${race.retainedFields.join('・')}` : ''}
        </p>
      </div>

      <div className="cta" style={{ marginBottom: 8 }}>
        <button type="button" className="btn primary cta-main" onClick={start} disabled={race.runners.length === 0 || unnumbered > 0} aria-describedby="start-note">
          {race.sample ? 'テストデータで試す（架空デモ扱い）' : 'このレースで分析を準備'} <Icon name="arrow" />
        </button>
        <p id="start-note" className={race.runners.length === 0 || unnumbered > 0 ? 'cta-reason' : 'hint'}>
          {race.runners.length === 0
            ? '出走表が未取得のため、分析を準備できません。'
            : unnumbered > 0
              ? `${unnumbered}頭の馬番が未発表のため、分析を準備できません。馬番が確定したデータを取り込んでください。`
              : notes.join(' ') || '出走表・オッズ・馬場情報を分析準備に入れます。'}
        </p>
      </div>

      <section className="sec" aria-labelledby="fr-runners">
        <div className="sec-head">
          <span className="tag">Entries</span>
          <h2 id="fr-runners" className="sec-title">
            出走表
          </h2>
          <span className="sec-note">
            {race.entriesStatus ?? '状態不明'}（{FEED_STATE_LABEL[race.entriesState]}）{race.runnersRetained && `・前回取込（確認日 ${race.runnersCheckedOn ?? '不明'}）の値`}
          </span>
        </div>
        {race.runners.length === 0 ? (
          <p className="muted">出走表は未取得です。</p>
        ) : (
          <ol className="plain feed-runners">
            {race.runners.map((r) => (
              <li key={`${r.horseNumber ?? 'x'}-${r.name}`} className={`feed-runner ${r.scratched ? 'is-scratched' : ''}`}>
                <span className="rank-no">{r.horseNumber !== null ? String(r.horseNumber).padStart(2, '0') : <span className="hint">未発表</span>}</span>
                <span>
                  <b>{r.name}</b> {r.scratched && <span className="badge error">出走取消</span>}
                  <span className="hint" style={{ display: 'block', margin: 0 }}>
                    {r.sex ?? '性未取得'}
                    {r.age ?? '?'}歳／斤量 {r.weightKg !== null ? `${r.weightKg}kg` : '未取得'}／{r.jockey ?? '騎手未取得'}／枠 {r.bracket ?? '未取得'}
                    {r.retained?.length ? `（前回の値：${r.retained.join('・')}）` : ''}
                  </span>
                  {(r.pastRuns?.length ?? 0) > 0 && (
                    <details className="past-runs">
                      <summary>過去成績 {r.pastRuns.length}走</summary>
                      <ol className="plain">
                        {r.pastRuns.map((p, i) => (
                          <li key={i}>
                            <span className="muted">{i + 1}走前</span> {pastRunLine(p)}
                          </li>
                        ))}
                      </ol>
                    </details>
                  )}
                </span>
                <span className="win-odds num">
                  {r.scratched ? '—' : r.winOdds !== null && r.winOdds !== undefined ? r.winOdds.toFixed(1) : '未取得'}
                  <span className="hint">{r.popularity ? `${r.popularity}番人気` : '単勝'}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
        <p className="hint">
          単勝オッズの時点：{race.winOddsUpdatedAt ? formatJst(race.winOddsUpdatedAt) : '不明'}（最終オッズではありません）
          {race.winOddsSourceUrl && (
            <>
              ／出典：<SafeLink href={race.winOddsSourceUrl} />
            </>
          )}
        </p>
        <p className="hint">斤量は負担重量で、馬体重ではありません。出典：<SafeLink href={race.sourceUrl} /></p>
      </section>

      <section className="sec" aria-labelledby="fr-wide">
        <div className="sec-head">
          <span className="tag">Wide</span>
          <h2 id="fr-wide" className="sec-title">
            ワイドオッズ
          </h2>
          {w?.isMock && <span className="badge warn">仮オッズ・分析に使いません</span>}
        </div>
        {!w ? (
          <p className="muted">ワイドオッズは受け取っていません（未取得）。</p>
        ) : (
          <>
            <dl className="kv">
              <dt>状態</dt>
              <dd>
                {w.status}（{FEED_STATE_LABEL[w.state]}）
              </dd>
              <dt>情報時点</dt>
              <dd>{w.sourceUpdatedAt ? formatJst(w.sourceUpdatedAt) : '不明'}</dd>
              <dt>仮データか</dt>
              <dd>{w.isMock ? '仮データ（is_mock）' : w.mockUnstated ? '記載なし（仮データとしては扱いません）' : '仮データではない'}</dd>
              <dt>確定</dt>
              <dd>{w.isFinal === null ? '不明（最終オッズとして扱いません）' : w.isFinal ? '確定と記載' : '未確定'}</dd>
              <dt>出典</dt>
              <dd>
                <SafeLink href={w.sourceUrl} />
              </dd>
            </dl>
            {w.reason && <p className="hint">{w.reason}</p>}
            {w.latestAttempt && <p className="notice mt">最新の取込（{w.latestAttempt.status}）：{w.latestAttempt.note}</p>}
            {w.orderUnknown && <p className="notice mt">情報時点が不明なため、前回の値とどちらが新しいかは判断していません。取込順で新しい方を表示しています。</p>}
            {w.pairs.length === 0 ? (
              <p className="muted mt">オッズの組み合わせは未取得です（出走馬がいないという意味ではありません）。</p>
            ) : (
              <ul className="pair-grid" aria-label="ワイドオッズ（範囲）">
                {w.pairs.map((p) => (
                  <li key={`${p.a}-${p.b}`}>
                    <span className="num pair-key">
                      {p.a}-{p.b}
                    </span>
                    <span className="num">
                      {formatRange(p)}
                      {p.updatedAt && <span className="hint pair-time">{formatJst(p.updatedAt)}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="hint">ワイドは範囲（下限〜上限）の目安で、最終オッズや払戻金ではありません。</p>
            {race.previousWide && race.previousWide.pairs.length > 0 && (
              <details className="subgroup mt">
                <summary>前回取り込んだワイド（{race.previousWide.pairs.length}組）</summary>
                <ul className="pair-grid">
                  {race.previousWide.pairs.map((p) => (
                    <li key={`${p.a}-${p.b}`}>
                      <span className="num pair-key">
                        {p.a}-{p.b}
                      </span>
                      <span className="num">{formatRange(p)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </section>

      <section className="sec" aria-labelledby="fr-track">
        <div className="sec-head">
          <span className="tag">Going</span>
          <h2 id="fr-track" className="sec-title">
            馬場情報
          </h2>
          {match && <span className={`badge ${match.current ? 'ok' : 'warn'}`}>{match.current ? '当日の情報' : '参考・過去情報'}</span>}
        </div>
        {match ? (
          <>
            <pre className="raw">{trackSummary(match)}</pre>
            <p className="hint">
              出典：<SafeLink href={match.track.sourceUrl} />
            </p>
          </>
        ) : (
          <p className="muted">この競馬場の馬場情報は受け取っていません（未取得）。</p>
        )}
      </section>

      <section className="sec">
        <button
          type="button"
          className="btn danger small"
          onClick={async () => {
            if (!window.confirm('このレースの受け取りデータを削除しますか？（保存済みの分析は消えません）')) return;
            await deleteFeedRace(race.key);
            navigate('/feed');
          }}
        >
          このレースのデータを削除
        </button>
      </section>
    </>
  );
}
