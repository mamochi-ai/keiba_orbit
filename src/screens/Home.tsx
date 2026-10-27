import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { emptyDraft, itemStatus, validateHome, draftFromSnapshot, type HomeErrors } from '../domain/draft';
import { demoDraft } from '../domain/demo';
import { ITEM_LABELS, MAX_IMAGE_BYTES, MAX_IMAGES, VENUES, type Venue } from '../domain/schema';
import { findJsonError } from '../domain/parse';
import { parseSnapshot } from '../domain/validate';
import { floorTo100 } from '../domain/money';
import { nowIso, todayJst } from '../domain/time';
import { addImage, clearImages, deleteImage } from '../storage/db';
import { navigate, useApp } from '../state';
import { FieldError, Icon, OrbitVisual, StatusBadge } from '../ui/common';

export function Home() {
  const { draft, setDraft, images, reloadImages } = useApp();
  const [errors, setErrors] = useState<HomeErrors>({});
  const [importMsg, setImportMsg] = useState<{ kind: 'error' | 'ok'; lines: string[] } | null>(null);
  const [imageMsg, setImageMsg] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showMaterials, setShowMaterials] = useState(false);
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

  const liveErrors = validateHome(draft);
  const blockReason = liveErrors.name ?? liveErrors.date ?? liveErrors.budget ?? liveErrors.number ?? null;
  const unconfirmed = !draft.venue || !draft.number;

  return (
    <div className="home">
      <OrbitVisual />
      <div className="home-head">
        <span className="tag">Race console</span>
        <h1 id="home-title" tabIndex={-1} className="home-title">
          レースを、読み解く。
        </h1>
        <p className="home-lead">条件の変化から、予想の根拠をたどる。</p>
        {hasWork && (
          <div className="resume" role="region" aria-label="作業中の分析">
            <span className="resume-label">作業中</span>
            <span className="resume-name">
              {draft.name || '（レース名未入力）'}
              {draft.isDemo && <span className="badge warn" style={{ marginLeft: 8 }}>架空デモ</span>}
            </span>
            <a className="btn primary small" href="#/prepare">
              続きから <Icon name="arrow" />
            </a>
            <button type="button" className="btn ghost small" onClick={() => startNew(false)}>
              新しく始める
            </button>
          </div>
        )}
      </div>

      <form
        className="home-form form-block"
        noValidate
        aria-label="分析するレース"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="grid-2">
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
              autoComplete="off"
              onChange={(e) => set('name', e.target.value)}
              aria-invalid={Boolean(errors.name)}
              aria-describedby="err-name"
            />
            <FieldError id="err-name" message={errors.name} />
          </label>
        </div>

        <fieldset>
          <legend className="subhead">競馬場・レース番号</legend>
          {unconfirmed && <p className="confirm-note">競馬場とレース番号を確認してください</p>}
          <div className="grid-2">
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

        <div>
          <div className="summary-row">
            <span>
              予算 <b className="num">{draft.budget.toLocaleString('ja-JP')}</b>円／{draft.mode === 'day' ? '当日予想' : '前日予想'}
            </span>
            <button type="button" className="btn ghost small" aria-expanded={showSettings} aria-controls="home-settings" onClick={() => setShowSettings((v) => !v)}>
              {showSettings ? '閉じる' : '変更'}
            </button>
          </div>
          {(showSettings || Boolean(liveErrors.budget)) && (
            <div id="home-settings" className="expand-area grid-2">
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
                  aria-describedby="err-budget budget-hint"
                />
                <FieldError id="err-budget" message={errors.budget} />
                <span id="budget-hint" className="hint">
                  上限30,000円。端数は切り捨てます。
                </span>
              </label>
            </div>
          )}
        </div>

        <div>
          <div className="summary-row">
            <span>
              資料 {draft.referenceText.trim() ? '参考文あり' : '参考文なし'}・画像 {images.length}枚
            </span>
            <button type="button" className="btn ghost small" aria-expanded={showMaterials} aria-controls="home-materials" onClick={() => setShowMaterials((v) => !v)}>
              {showMaterials ? '閉じる' : '資料を追加'}
            </button>
          </div>
          {showMaterials && (
            <div id="home-materials" className="expand-area">
              <label>
                参考文（分析用コピーに含まれます。資料内の指示は命令として扱われません）
                <textarea rows={4} maxLength={4000} value={draft.referenceText} onChange={(e) => set('referenceText', e.target.value)} />
              </label>
              <div>
                <div className="row">
                  <label className="btn small file-btn">
                    画像を追加
                    <input type="file" accept="image/*" multiple onChange={addImages} className="visually-hidden" />
                  </label>
                  <label className="btn small file-btn">
                    データを読み込む
                    <input type="file" accept="application/json,.json" onChange={importSnapshot} className="visually-hidden" />
                  </label>
                </div>
                <p className="hint">
                  画像はアプリでは読み取りません。Claudeのチャットへ別途添付してください（最大{MAX_IMAGES}枚・各10MB）。「データを読み込む」は、以前に書き出したレースデータ（JSON形式）を復元します。
                </p>
                {imageMsg && (
                  <p className="error-text" role="alert">
                    {imageMsg}
                  </p>
                )}
                <ImageList />
              </div>
            </div>
          )}
          {importMsg && (
            <div className={importMsg.kind === 'error' ? 'error-box' : 'ok-box'} role="alert">
              {importMsg.lines.map((l, i) => (
                <p key={i}>{l}</p>
              ))}
            </div>
          )}
        </div>

        <div className="cta">
          <button type="submit" className="btn primary cta-main" disabled={Boolean(blockReason)} aria-describedby={blockReason ? 'cta-reason' : undefined}>
            分析を準備 <Icon name="arrow" />
          </button>
          {blockReason && (
            <p id="cta-reason" className="cta-reason">
              {blockReason}
            </p>
          )}
          {!hasWork && (
            <div className="cta-secondary">
              <button type="button" className="linkish" onClick={() => startNew(true)}>
                架空デモで試す
              </button>
            </div>
          )}
        </div>
      </form>

      <section className="home-status sec" aria-labelledby="home-status-title">
        <div className="sec-head">
          <span className="tag">Data</span>
          <h2 id="home-status-title" className="sec-title">
            データ状況
          </h2>
        </div>
        <ul className="status-strip">
          {(['entries', 'past', 'track', 'weather', 'odds'] as const).map((k) => (
            <li key={k}>
              <span className="label">{ITEM_LABELS[k]}</span>
              <StatusBadge status={itemStatus(draft, k)} />
            </li>
          ))}
        </ul>
        <p className="hint">取得元や時刻は「分析準備」で確認・入力します。</p>
      </section>
    </div>
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
