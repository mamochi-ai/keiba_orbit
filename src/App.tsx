import { useEffect } from 'react';
import { useApp, useHashRoute } from './state';
import { Home } from './screens/Home';
import { Prepare } from './screens/Prepare';
import { Paste } from './screens/Paste';
import { Report } from './screens/Report';
import { Saved } from './screens/Saved';
import { SettingsScreen } from './screens/Settings';
import { Icon } from './ui/common';

const NAV = [
  { href: '#/', label: 'レース', icon: 'calendar', match: (r: string) => r === '/' || r === '/prepare' || r === '/paste' },
  { href: '#/saved', label: '保存した分析', icon: 'history', match: (r: string) => r === '/saved' || r.startsWith('/report/') },
  { href: '#/settings', label: '設定', icon: 'settings', match: (r: string) => r === '/settings' },
] as const;

export function App() {
  const route = useHashRoute();
  const { draft, draftLoaded, storageError } = useApp();

  useEffect(() => {
    window.scrollTo(0, 0);
    // Move focus to the new screen's heading for keyboard / screen reader users.
    const t = window.setTimeout(() => document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true }), 0);
    return () => window.clearTimeout(t);
  }, [route]);

  let screen;
  const reportMatch = /^\/report\/([A-Za-z0-9_-]{1,64})$/.exec(route);
  if (!draftLoaded) {
    screen = (
      <p className="row section" aria-busy="true">
        <span className="spinner" aria-hidden="true" /> 端末の保存データを読み込み中
      </p>
    );
  } else if (route === '/') screen = <Home />;
  else if (route === '/prepare') screen = <Prepare />;
  else if (route === '/paste') screen = <Paste />;
  else if (route === '/saved') screen = <Saved />;
  else if (route === '/settings') screen = <SettingsScreen />;
  else if (reportMatch) screen = <Report id={reportMatch[1]!} />;
  else
    screen = (
      <section className="panel section">
        <h1 tabIndex={-1}>ページが見つかりません</h1>
        <a className="btn" href="#/">
          ホームへ
        </a>
      </section>
    );

  return (
    <div className="shell">
      <a className="skip" href="#main">
        本文へ移動
      </a>
      <header className="top">
        <a className="brand" href="#/" aria-label="KEIBA ORBIT ホーム">
          <img src="assets/orbit-mark.svg" alt="" />
          KEIBA ORBIT
        </a>
        <nav aria-label="メイン">
          <ul className="nav">
            {NAV.map((n) => (
              <li key={n.href}>
                <a href={n.href} aria-current={n.match(route) ? 'page' : undefined}>
                  <Icon name={n.icon} />
                  {n.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      {draft.isDemo && (
        <div className="demo-banner" role="note">
          <Icon name="warning" />
          <span>
            <b>架空デモ表示中</b>：馬・レース・金額はすべて架空です。予想や購入判断には使えません。
          </span>
        </div>
      )}
      {storageError && (
        <p className="error-box" role="alert">
          {storageError}
        </p>
      )}
      <main id="main">{screen}</main>
      <footer>
        KEIBA ORBIT — 個人用の分析ノート。実際の馬券購入機能はありません。分析結果の的中・利益は保証しません。天気：Weather data by Open-Meteo.com（CC BY 4.0）
      </footer>
    </div>
  );
}
