import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { emptyDraft, type Draft } from './domain/draft';
import { todayJst } from './domain/time';
import { loadDraft, saveDraft, listImages, type StoredImage } from './storage/db';

export interface Settings {
  weatherEnabled: boolean;
  /** Where 「Claudeを開く」 goes: a new chat by default, or the user's own chat / project on claude.ai. */
  claudeUrl: string;
}

export const DEFAULT_CLAUDE_URL = 'https://claude.ai/new';

/** Only https links on claude.ai (no other sites, no credentials in the URL). */
export function isClaudeUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && u.hostname === 'claude.ai' && !u.username && !u.password && value.length <= 500;
  } catch {
    return false;
  }
}

const SETTINGS_KEY = 'keiba-orbit:settings';
const defaultSettings: Settings = { weatherEnabled: true, claudeUrl: DEFAULT_CLAUDE_URL };

function readSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings;
    const v = JSON.parse(raw) as Partial<Settings>;
    return {
      weatherEnabled: typeof v.weatherEnabled === 'boolean' ? v.weatherEnabled : true,
      claudeUrl: typeof v.claudeUrl === 'string' && isClaudeUrl(v.claudeUrl) ? v.claudeUrl : DEFAULT_CLAUDE_URL,
    };
  } catch {
    return defaultSettings;
  }
}

interface AppState {
  draft: Draft;
  draftLoaded: boolean;
  storageError: string | null;
  setDraft: (update: Draft | ((d: Draft) => Draft)) => void;
  images: StoredImage[];
  reloadImages: () => Promise<void>;
  settings: Settings;
  setSettings: (s: Settings) => void;
  /** Set by the report screen while it shows a saved demo analysis (drives the demo strip). */
  reportIsDemo: boolean;
  setReportIsDemo: (v: boolean) => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [draft, setDraftState] = useState<Draft>(() => ({ ...emptyDraft(), date: todayJst() }));
  const [draftLoaded, setLoaded] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [images, setImages] = useState<StoredImage[]>([]);
  const [settings, setSettingsState] = useState<Settings>(readSettings);
  const saveTimer = useRef<number | undefined>(undefined);
  const [reportIsDemo, setReportIsDemo] = useState(false);

  const reloadImages = useCallback(async () => {
    try {
      setImages(await listImages());
    } catch {
      setImages([]);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await loadDraft();
        if (alive && d) setDraftState({ ...emptyDraft(), ...d });
        await reloadImages();
      } catch {
        if (alive) setStorageError('端末への保存（IndexedDB）が使えません。プライベートブラウズ等では保存されません。');
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [reloadImages]);

  const setDraft = useCallback((update: Draft | ((d: Draft) => Draft)) => {
    setDraftState((prev) => {
      const next = typeof update === 'function' ? update(prev) : update;
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        saveDraft(next).catch(() => setStorageError('下書きを端末に保存できませんでした。'));
      }, 300);
      return next;
    });
  }, []);

  const setSettings = useCallback((s: Settings) => {
    setSettingsState(s);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch {
      /* settings stay in memory only */
    }
  }, []);

  return (
    <Ctx.Provider value={{ draft, draftLoaded, storageError, setDraft, images, reloadImages, settings, setSettings, reportIsDemo, setReportIsDemo }}>
      {children}
    </Ctx.Provider>
  );
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('AppProvider missing');
  return v;
}

export function useHashRoute(): string {
  const get = () => window.location.hash.replace(/^#/, '') || '/';
  const [route, setRoute] = useState(get);
  useEffect(() => {
    const on = () => setRoute(get());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function navigate(path: string) {
  window.location.hash = path;
}
