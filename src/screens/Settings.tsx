import { useState } from 'react';
import { emptyDraft } from '../domain/draft';
import { clearAll } from '../storage/db';
import { DEFAULT_CLAUDE_URL, isClaudeUrl, useApp } from '../state';
import { CopyGuide } from '../ui/CopyGuide';

const SOURCES: { item: string; state: string; how: string }[] = [
  { item: 'レース候補・出走表', state: '自動取得は未接続', how: '受け取ったデータ（JSON）の取り込み、出馬表ページの貼り付け、または手入力' },
  { item: '過去成績', state: '自動取得は未接続', how: '出馬表ページの貼り付け（出典を記録）' },
  { item: '馬場', state: '自動取得は未接続', how: '受け取ったデータの取り込み、または公式発表を見て貼り付け' },
  { item: 'オッズ', state: '自動取得は未接続', how: '受け取ったデータ（ワイド）の取り込み、または時点を記録して入力' },
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

          <ClaudeTarget />

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

/** Which Claude chat 「Claudeを開く」 opens. */
function ClaudeTarget() {
  const { settings, setSettings } = useApp();
  const [url, setUrl] = useState(settings.claudeUrl === DEFAULT_CLAUDE_URL ? '' : settings.claudeUrl);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const custom = settings.claudeUrl !== DEFAULT_CLAUDE_URL;

  function save() {
    const v = url.trim();
    if (!isClaudeUrl(v)) {
      setMsg({ ok: false, text: 'https://claude.ai/ で始まるURLを入れてください。' });
      return;
    }
    setSettings({ ...settings, claudeUrl: v });
    setMsg({ ok: true, text: '保存しました。「Claudeを開く」でこのチャットが開きます。' });
  }

  return (
    <section className="sec" aria-labelledby="claude-target">
      <div className="sec-head">
        <span className="tag">Claude</span>
        <h2 id="claude-target" className="sec-title">
          Claudeの開き先
        </h2>
      </div>
      <p className="muted">
        「Claudeを開く」で開くチャットです。いまは{custom ? '設定したチャット' : '毎回新しいチャット'}を開きます。「競馬予想AI」など決まったチャットやプロジェクトを使う場合は、そのURLを保存してください。
      </p>
      <ol className="guide-steps">
        <li>Safariで claude.ai を開き、使いたいチャット（またはプロジェクト）を表示する。</li>
        <li>アドレスバーをタップしてURLを長押し →「コピー」。</li>
        <li>下に貼り付けて「保存」。</li>
      </ol>
      <label>
        開き先のURL（https://claude.ai/ で始まるもの）
        <input type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://claude.ai/project/… または https://claude.ai/chat/…" />
      </label>
      <div className="row mt">
        <button type="button" className="btn primary small" onClick={save} disabled={!url.trim()}>
          保存
        </button>
        {custom && (
          <button
            type="button"
            className="btn ghost small"
            onClick={() => {
              setSettings({ ...settings, claudeUrl: DEFAULT_CLAUDE_URL });
              setUrl('');
              setMsg({ ok: true, text: '新しいチャットを開く設定に戻しました。' });
            }}
          >
            新しいチャットに戻す
          </button>
        )}
      </div>
      {msg && (
        <p className={msg.ok ? 'ok-text' : 'error-text'} role={msg.ok ? 'status' : 'alert'}>
          {msg.text}
        </p>
      )}
      <p className="hint">
        同じチャットに何レースも続けて貼ると、前のやり取りが長くなり、応答が途中で切れやすくなります。プロジェクトの中で、レースごとに新しいチャットを始める使い方がおすすめです。
      </p>
    </section>
  );
}
