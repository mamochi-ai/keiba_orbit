import { useState } from 'react';
import { emptyDraft } from '../domain/draft';
import { clearAll } from '../storage/db';
import { useApp } from '../state';
import { CopyGuide } from '../ui/CopyGuide';

const SOURCES: { item: string; state: string; how: string }[] = [
  { item: 'レース候補・出走表', state: '自動取得は未接続', how: '出馬表ページを貼り付けて読み取り、または手入力' },
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
        <span className="tag">Settings</span>
        <h1 tabIndex={-1} className="page-title">
          設定
        </h1>
      </div>
      <div className="settings">
        <div>
          <section className="sec first" aria-labelledby="about">
            <div className="sec-head">
              <span className="tag">About</span>
              <h2 id="about" className="sec-title">
                このアプリについて
              </h2>
            </div>
            <div className="about-tags">
              <span className="badge">AI API不使用</span>
              <span className="badge">馬券購入機能なし</span>
              <span className="badge">1レース集中分析</span>
              <span className="badge">サーバー不要・端末内保存</span>
            </div>
            <ul className="plain">
              <li>実際の馬券は購入できません。上限3万円の仮想の配分だけを扱います。</li>
              <li>AIの従量課金APIは使いません。Claudeの通常チャットへコピーし、結果を貼り戻します。</li>
              <li>分析結果の的中・利益は保証しません。形式チェックは予想の正しさを検証するものではありません。</li>
              <li>SNS・掲示板の情報は使いません。</li>
            </ul>
          </section>

          <section className="sec" aria-labelledby="ds">
            <div className="sec-head">
              <span className="tag">Sources</span>
              <h2 id="ds" className="sec-title">
                データの接続状況
              </h2>
            </div>
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
              JRAなどのサイトへアプリから自動でアクセスすることはありません。中継サーバーや無断の情報収集も使いません。
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

          <section className="sec" aria-labelledby="howto">
            <div className="sec-head">
              <span className="tag">Guide</span>
              <h2 id="howto" className="sec-title">
                データの集め方（手作業でのコピー手順）
              </h2>
            </div>
            <CopyGuide topics={['card', 'track', 'wide', 'claude']} />
          </section>
        </div>
        <aside>
          <section className="sec first" aria-labelledby="danger">
            <div className="sec-head">
              <span className="tag">Storage</span>
              <h2 id="danger" className="sec-title">
                端末データ
              </h2>
            </div>
            <p className="muted">分析・収支・下書き・画像は、この端末のブラウザ内だけに保存されています。</p>
            <button type="button" className="btn danger mt" onClick={wipe}>
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
