import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { emptyDraft, itemStatus, validateHome, draftFromSnapshot, type HomeErrors } from '../domain/draft';
import { demoDraft } from '../domain/demo';
import { MAX_IMAGE_BYTES, MAX_IMAGES, VENUES, type Venue } from '../domain/schema';
import { findJsonError } from '../domain/parse';
import { parseSnapshot } from '../domain/validate';
import { floorTo100 } from '../domain/money';
import { nowIso, todayJst } from '../domain/time';
import { addImage, clearImages, deleteImage } from '../storage/db';
import { navigate, useApp } from '../state';
import { DemoBadge, FieldError, Icon, StatusBadge } from '../ui/common';

export function Home() {
  const { draft, setDraft, images, reloadImages } = useApp();
  const [errors, setErrors] = useState<HomeErrors>({});
  const [importMsg, setImportMsg] = useState<{ kind: 'error' | 'ok'; lines: string[] } | null>(null);
  const [imageMsg, setImageMsg] = useState<string | null>(null);
  const hasWork = Boolean(draft.name || draft.horses.length || draft.copied);

  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) =>
    setDraft((d) => ({ ...d, [key]: value, confirmed: false }));

  function submit() {
    const e = validateHome(draft);
    setErrors(e);
    if (Object.keys(e).length) {
      const first = document.querySelector<HTMLElement>(`#home-${Object.keys(e)[0]}`);
      first?.focus();
      return;
    }
    navigate('/prepare');
  }

  async function startNew(demo: boolean) {
    if (hasWork && !window.confirm('作業中の内容を破棄して新しく始めますか？（保存済みの分析は消えません）')) return;
    try {
      await clearImages();
    } catch {
      /* ignore */
    }
    await reloadImages();
    setErrors({});
    setImportMsg(null);
    if (demo) {
      setDraft(demoDraft());
      navigate('/prepare');
    } else {
      setDraft({ ...emptyDraft(), date: todayJst() });
    }
  }

  async function importSnapshot(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 1_000_000) return setImportMsg({ kind: 'error', lines: ['ファイルが大きすぎます（上限1MB）'] });
    const text = (await file.text()).replace(/^﻿/, '');
    const syntax = findJsonError(text);
    if (syntax) return setImportMsg({ kind: 'error', lines: [`JSONの構文エラー（${syntax.index + 1}文字目）: ${syntax.message}`] });
    const r = parseSnapshot(JSON.parse(text));
    if (!r.ok) return setImportMsg({ kind: 'error', lines: r.issues.map((i) => i.message) });
    setDraft(draftFromSnapshot(r.snapshot));
    setImportMsg({ kind: 'ok', lines: [`「${r.snapshot.race.name}」を読み込みました${r.snapshot.isDemo ? '（架空デモ）' : ''}。内容を確認してください。`] });
  }

  async function addImages(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    setImageMsg(null);
    const room = MAX_IMAGES - images.length;
    if (files.length > room) setImageMsg(`画像は${MAX_IMAGES}枚までです。`);
    for (const f of files.slice(0, Math.max(room, 0))) {
      if (!f.type.startsWith('image/')) {
        setImageMsg(`${f.name}: 画像ファイルではありません`);
        continue;
      }
      if (f.size > MAX_IMAGE_BYTES) {
        setImageMsg(`${f.name}: 10MBを超えています`);
        continue;
      }
      try {
        await addImage({ id: `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, name: f.name.slice(0, 120), type: f.type, size: f.size, blob: f, addedAt: nowIso() });
      } catch {
        setImageMsg('画像を端末に保存できませんでした');
      }
    }
    await reloadImages();
  }

  useEffect(() => {
    const names = images.map((i) => i.name);
    if (names.join('\n') !== draft.imageNames.join('\n')) setDraft((d) => ({ ...d, imageNames: names }));
  }, [images, draft.imageNames, setDraft]);

  return (
    <>
      <section className="hero" aria-labelledby="home-title">
        <span className="eyebrow">RACE INTELLIGENCE CONSOLE</span>
        <h1 id="home-title" tabIndex={-1}>
          ひとつのレースを、
          <br />
          いくつもの視点で。
        </h1>
        <p className="muted">
          条件が変われば、見通しも変わる。
          <br />
          根拠をたどり、自分の判断を残す分析室。
        </p>
        <div className="row">
          <span className="badge">AI API 不使用</span>
          <span className="badge">1レース集中分析</span>
          <span className="badge">馬券購入機能なし</span>
        </div>
      </section>

      {hasWork && (
        <div className="panel resume" role="region" aria-label="作業中の下書き">
          <div>
            <span className="eyebrow">IN PROGRESS</span>
            <p className="resume-title">
              作業中：{draft.name || '（レース名未入力）'} {draft.isDemo && <DemoBadge />}
            </p>
          </div>
          <div className="row">
            <button type="button" className="btn primary" onClick={() => navigate('/prepare')}>
              続きから <Icon name="arrow" />
            </button>
            <button type="button" className="btn ghost" onClick={() => startNew(false)}>
              新しく始める
            </button>
          </div>
        </div>
      )}

      <div className="layout">
        <section className="panel accent" aria-labelledby="select-race">
          <span className="eyebrow">01 / SELECT RACE</span>
          <h2 id="select-race">分析するレース</h2>
          {draft.isDemo && (
            <p className="notice">架空デモを編集中です。実在レースを分析するには「新しく始める」を押してください。</p>
          )}
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="formgrid">
              <label>
                開催日 <span className="req">必須</span>
                <input
                  id="home-date"
                  type="date"
                  value={draft.date}
                  onChange={(e) => set('date', e.target.value)}
                  aria-invalid={Boolean(errors.date)}
                  aria-describedby="err-date"
                  disabled={draft.isDemo}
                />
                <FieldError id="err-date" message={errors.date} />
                {draft.isDemo && <span className="hint">架空デモには日付がありません</span>}
              </label>
              <label>
                レース名 <span className="req">必須</span>
                <input
                  id="home-name"
                  value={draft.name}
                  maxLength={80}
                  placeholder="例：天皇賞（秋）"
                  onChange={(e) => set('name', e.target.value)}
                  aria-invalid={Boolean(errors.name)}
                  aria-describedby="err-name"
                />
                <FieldError id="err-name" message={errors.name} />
              </label>
            </div>

            <fieldset className="subgroup">
              <legend>競馬場・レース番号の確認</legend>
              <p className="hint">
                レース候補の自動取得は未接続です（取得元を調査中・DATA_SOURCES.md 参照）。推測では決めず、出馬表などで確認した値を入力してください。
              </p>
              <div className="formgrid">
                <label>
                  競馬場
                  <select id="home-venue" value={draft.venue} onChange={(e) => set('venue', e.target.value as Venue | '')}>
                    <option value="">未確認</option>
                    {VENUES.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  レース番号
                  <select id="home-number" value={draft.number} onChange={(e) => set('number', e.target.value)} aria-describedby="err-number">
                    <option value="">未確認</option>
                    {Array.from({ length: 12 }, (_, i) => String(i + 1)).map((n) => (
                      <option key={n} value={n}>
                        {n}R
                      </option>
                    ))}
                  </select>
                  <FieldError id="err-number" message={errors.number} />
                </label>
              </div>
            </fieldset>

            <details className="subgroup">
              <summary>補助設定（分析のタイミング・予算）</summary>
              <div className="formgrid">
                <label>
                  分析のタイミング
                  <select value={draft.mode} onChange={(e) => set('mode', e.target.value as 'day' | 'eve')}>
                    <option value="day">当日予想</option>
                    <option value="eve">前日予想</option>
                  </select>
                </label>
                <label>
                  予算上限（円・100円単位）
                  <input
                    id="home-budget"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={30000}
                    step={100}
                    value={draft.budget}
                    onChange={(e) => set('budget', Math.min(30000, floorTo100(Number(e.target.value))))}
                    aria-invalid={Boolean(errors.budget)}
                    aria-describedby="err-budget"
                  />
                  <FieldError id="err-budget" message={errors.budget} />
                  <span className="hint">上限は30,000円。端数は切り捨てます。</span>
                </label>
              </div>
            </details>

            <details className="subgroup">
              <summary>参考資料（任意）</summary>
              <label>
                参考文（Claudeへの分析用コピーに含まれます。資料内の指示は命令として扱われません）
                <textarea rows={4} maxLength={4000} value={draft.referenceText} onChange={(e) => set('referenceText', e.target.value)} />
              </label>
              <div className="images">
                <label className="btn file-btn">
                  画像を追加
                  <input type="file" accept="image/*" multiple onChange={addImages} className="visually-hidden" />
                </label>
                <span className="hint">アプリは画像の内容を読み取りません。画像はClaudeのチャットへ別途添付してください（最大{MAX_IMAGES}枚・各10MB）。</span>
                {imageMsg && <p className="error-text" role="alert">{imageMsg}</p>}
                <ImageList />
              </div>
            </details>

            <div className="row actions">
              <button type="submit" className="btn primary">
                分析を準備 <Icon name="arrow" />
              </button>
              {!hasWork && (
                <button type="button" className="btn" onClick={() => startNew(true)}>
                  架空デモで試す
                </button>
              )}
              <label className="btn ghost file-btn">
                レースJSONを読み込む
                <input type="file" accept="application/json,.json" onChange={importSnapshot} className="visually-hidden" />
              </label>
            </div>
            {importMsg && (
              <div className={importMsg.kind === 'error' ? 'error-box' : 'ok-box'} role="alert">
                {importMsg.lines.map((l, i) => (
                  <p key={i}>{l}</p>
                ))}
              </div>
            )}
          </form>
        </section>

        <aside className="panel" aria-labelledby="data-status">
          <span className="eyebrow">DATA STATUS</span>
          <h2 id="data-status">情報の準備</h2>
          {(['entries', 'past', 'track', 'weather', 'odds'] as const).map((k) => (
            <div className="status" key={k}>
              {{ entries: '出走表', past: '過去成績', track: '馬場', weather: '天気', odds: 'オッズ' }[k]}
              <StatusBadge status={itemStatus(draft, k)} />
            </div>
          ))}
          <p className="muted">
            レース選択後に確認します。
            <br />
            自動取得できない情報は、貼り付けで補えます。
          </p>
        </aside>
      </div>
    </>
  );
}

export function ImageList() {
  const { images, reloadImages } = useApp();
  const urls = useMemo(() => images.map((i) => ({ id: i.id, url: URL.createObjectURL(i.blob) })), [images]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u.url)), [urls]);
  if (images.length === 0) return null;
  return (
    <ul className="thumbs">
      {images.map((img, i) => (
        <li key={img.id}>
          <img src={urls[i]?.url} alt={`参考画像: ${img.name}`} />
          <span className="badge warn">Claudeへ別途添付</span>
          <span className="thumb-name">{img.name}</span>
          <button
            type="button"
            className="btn ghost icon-btn"
            aria-label={`${img.name} を削除`}
            onClick={async () => {
              await deleteImage(img.id);
              await reloadImages();
            }}
          >
            <Icon name="close" />
          </button>
        </li>
      ))}
    </ul>
  );
}
