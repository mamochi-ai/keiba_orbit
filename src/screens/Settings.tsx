import { useState } from 'react';
import { emptyDraft } from '../domain/draft';
import { clearAll } from '../storage/db';
import { useApp } from '../state';

const SOURCES: { item: string; state: string; how: string }[] = [
  { item: 'レース候補・出走表', state: '自動取得は未接続', how: '出馬表などを見て手入力・貼り付け' },
  { item: '過去成績', state: '自動取得は未接続', how: '貼り付け（出典を記録）' },
  { item: '馬場', state: '自動取得は未接続', how: '公式発表を見て貼り付け' },
  { item: 'オッズ', state: '自動取得は未接続', how: '時点を記録して貼り付け' },
  { item: '天気', state: 'Open-Meteo（気象庁モデル）に接続', how: 'ボタンを押したときだけ取得。非商用・CC BY 4.0' },
];

export function SettingsScreen() {
  const { settings, setSettings, setDraft, reloadImages } = useApp();
  const [msg, setMsg] = useState<string | null>(null);

  async function wipe() {
    if (!window.confirm('この端末に保存した分析・収支・下書き・画像をすべて削除します。元に戻せません。よろしいですか？')) return;
    try {
      await clearAll();
      setDraft(emptyDraft());
      await reloadImages();
      setMsg('すべて削除しました。');
    } catch {
      setMsg('削除できませんでした。');
    }
  }

  return (
    <>
      <div className="page-head">
        <span className="eyebrow">SETTINGS</span>
        <h1 tabIndex={-1} className="page-title">
          設定
        </h1>
      </div>
      <div className="layout">
        <div className="stack">
          <section className="panel" aria-labelledby="ds">
            <h2 id="ds" className="h3">
              データの取得元
            </h2>
            <ul className="compare">
              {SOURCES.map((s) => (
                <li key={s.item}>
                  <span className="compare-label">{s.item}</span>
                  <span>
                    {s.state}
                    <br />
                    <span className="hint">{s.how}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="hint">
              JRAなどのサイトへブラウザから直接アクセスする機能、CORS回避プロキシ、無断スクレイピングは使いません。調査結果はリポジトリの DATA_SOURCES.md
              にあります。
            </p>
            <label className="check mt">
              <input type="checkbox" checked={settings.weatherEnabled} onChange={(e) => setSettings({ ...settings, weatherEnabled: e.target.checked })} />
              天気予報の取得（Open-Meteo）を使う
            </label>
            <p className="hint">
              天気データ：
              <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">
                Weather data by Open-Meteo.com
              </a>
              （CC BY 4.0）。個人の非商用利用の範囲で使います。
            </p>
          </section>
        </div>
        <aside className="stack">
          <section className="panel" aria-labelledby="about">
            <h2 id="about" className="h3">
              このアプリについて
            </h2>
            <ul className="plain">
              <li>実際の馬券購入機能はありません（上限3万円の仮想配分のみ）。</li>
              <li>AIの従量課金APIは使いません。Claudeの通常チャットへコピー＆貼り戻しで連携します。</li>
              <li>分析結果の的中・利益・売上は保証しません。</li>
              <li>SNS・掲示板の情報は使いません。</li>
            </ul>
          </section>
          <section className="panel" aria-labelledby="danger">
            <h2 id="danger" className="h3">
              端末データ
            </h2>
            <button type="button" className="btn danger" onClick={wipe}>
              すべて削除
            </button>
            {msg && (
              <p role="status" className="hint">
                {msg}
              </p>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
