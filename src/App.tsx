import { useEffect } from 'react';
import { useApp, useHashRoute } from './state';
import { Home } from './screens/Home';
import { Prepare } from './screens/Prepare';
import { Paste } from './screens/Paste';
import { Report } from './screens/Report';
import { Saved } from './screens/Saved';
import { SettingsScreen } from './screens/Settings';
import { Icon, type IconName } from './ui/common';

const NAV: { href: string; label: string; icon: IconName; match: (r: string) => boolean }[] = [
  { href: '#/', label: 'レース', icon: 'calendar', match: (r) => r === '/' || r === '/prepare' || r === '/paste' },
  { href: '#/saved', label: '保存した分析', icon: 'history', match: (r) => r === '/saved' || r.startsWith('/report/') },
  { href: '#/settings', label: '設定', icon: 'settings', match: (r) => r === '/settings' },
];

function NavLinks({ route }: { route: string }) {
  return (
    <ul>
      {NAV.map((n) => (
        <li key={n.href}>
          <a href={n.href} aria-current={n.match(route) ? 'page' : undefined}>
            <Icon name={n.icon} />
            {n.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

export function App() {
  const route = useHashRoute();
  const { draft, draftLoaded, storageError, reportIsDemo } = useApp();

  useEffect(() => {
    window.scrollTo(0, 0);
    // Move focus to the new screen's heading for keyboard / screen reader users.
    const t = window.setTimeout(() => document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true }), 0);
    return () => window.clearTimeout(t);
  }, [route]);

  const reportMatch = /^\/report\/([A-Za-z0-9_-]{1,64})$/.exec(route);
  // One compact demo notice per screen: the working draft on race screens, the record on a report.
  const showDemo = reportMatch ? reportIsDemo : (route === '/' || route === '/prepare' || route === '/paste') && draft.isDemo;

  let screen;
  if (!draftLoaded) {
    screen = (
      <p className="row" style={{ paddingTop: 32 }} aria-busy="true">
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
      <section className="sec first">
        <h1 tabIndex={-1} className="page-title">
          ページが見つかりません
        </h1>
        <a className="btn" href="#/">
          レースへ戻る
        </a>
      </section>
    );

  return (
    <div className="shell">
      <a className="skip" href="#main">
        本文へ移動
      </a>
      <div className="top-sticky">
        <header className="topbar">
          <a className="brand" href="#/" aria-label="KEIBA ORBIT レース画面へ">
            <img src="assets/orbit-mark.svg" alt="" />
            KEIBA ORBIT
          </a>
          <nav className="topnav" aria-label="メイン">
            <NavLinks route={route} />
          </nav>
        </header>
        {showDemo && (
          <p className="demo-strip" role="note">
            <Icon name="warning" />
            <span>
              <b>架空デモ</b>｜実在レースの予想ではありません
            </span>
          </p>
        )}
      </div>
      {storageError && (
        <p className="error-box storage-error" role="alert">
          {storageError}
        </p>
      )}
      <main id="main">{screen}</main>
      <footer className="app-foot">
        個人用の分析ノートです。実際の馬券購入機能はありません。的中・利益は保証しません。天気：Weather data by Open-Meteo.com（CC BY 4.0）
      </footer>
      <nav className="bottomnav" aria-label="メイン（下部）">
        <NavLinks route={route} />
      </nav>
    </div>
  );
}
