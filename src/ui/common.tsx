import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { isSafeHttpUrl, type ItemStatus } from '../domain/schema';

export type IconName =
  | 'arrow' | 'calendar' | 'check' | 'close' | 'cloud-rain' | 'copy' | 'external' | 'history'
  | 'paste' | 'report' | 'search' | 'settings' | 'sun' | 'wallet' | 'warning' | 'wind';

/** Decorative icon (alt=""); buttons carry their own text or aria-label. */
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return <img src={`assets/icons/${name}.svg`} alt="" aria-hidden="true" width={size} height={size} className="icon" />;
}

export const STATUS_TEXT: Record<ItemStatus, string> = { ok: '取得済', missing: '未取得', stale: '古い情報', error: '取得エラー' };

/** Status = shape + text (never colour alone): ● 取得済 / ○ 未取得 / ◆ 古い情報 / ■ 取得エラー. */
export function StatusBadge({ status }: { status: ItemStatus }) {
  return (
    <span className={`state ${status}`}>
      <span className="dot" aria-hidden="true" />
      {STATUS_TEXT[status]}
    </span>
  );
}

/** The generated orbit background. Used only on the home visual and the report cover. */
export function OrbitVisual({ className = '' }: { className?: string }) {
  return (
    <div className={`orbit-visual ${className}`} style={{ backgroundImage: 'url(assets/orbit-hero.png)' }} aria-hidden="true">
      <span className="orbit-ring" />
    </div>
  );
}

export function DemoBadge() {
  return <span className="badge warn">架空デモ</span>;
}

/** Link rendered only for http/https; anything else is shown as plain text. */
export function SafeLink({ href, children }: { href: string | null; children?: ReactNode }) {
  if (!href || !isSafeHttpUrl(href)) return <span className="muted">{children ?? 'URLなし'}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="break">
      {children ?? href}
    </a>
  );
}

export const CLAUDE_URL = 'https://claude.ai/new';

export function OpenClaudeLink() {
  return (
    <a className="btn" href={CLAUDE_URL} target="_blank" rel="noopener noreferrer">
      Claudeを開く <Icon name="external" />
    </a>
  );
}

type CopyState = 'idle' | 'copying' | 'done' | 'failed';

/**
 * Copies only on an explicit click. On failure (or no Clipboard API), shows the full text in a
 * selectable textarea with manual-copy instructions.
 */
export function CopyButton({
  label,
  getText,
  primary = true,
  disabled,
  disabledReason,
  onCopied,
}: {
  label: string;
  getText: () => string;
  primary?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onCopied?: (text: string) => void;
}) {
  const [state, setState] = useState<CopyState>('idle');
  const [fallback, setFallback] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const reasonId = useId();

  useEffect(() => {
    if (fallback !== null) {
      areaRef.current?.focus();
      areaRef.current?.select();
    }
  }, [fallback]);

  async function copy() {
    setErr(null);
    let text: string;
    try {
      text = getText();
    } catch (e) {
      setErr((e as Error).message);
      setState('failed');
      return;
    }
    setState('copying');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(text);
      setState('done');
      setFallback(null);
      onCopied?.(text);
    } catch {
      setState('failed');
      setFallback(text);
      onCopied?.(text);
    }
  }

  return (
    <div className="copy-block">
      <button
        type="button"
        className={`btn ${primary ? 'primary' : ''}`}
        onClick={copy}
        disabled={disabled || state === 'copying'}
        aria-describedby={disabled && disabledReason ? reasonId : undefined}
      >
        {state === 'copying' ? <span className="spinner" aria-hidden="true" /> : <Icon name="copy" />}
        {state === 'copying' ? 'コピー中' : label}
      </button>
      {disabled && disabledReason && (
        <p id={reasonId} className="hint">
          {disabledReason}
        </p>
      )}
      <p className="sr-status" role="status" aria-live="polite">
        {state === 'done' ? 'コピーしました' : ''}
      </p>
      {state === 'done' && <p className="ok-text" aria-hidden="true">✓ コピーしました</p>}
      {err && <p className="error-text" role="alert">{err}</p>}
      {fallback !== null && (
        <div className="manual-copy" role="alert">
          <p className="warn-text">
            自動コピーできませんでした。下の全文を長押し（またはCtrl/⌘+A）で全選択してコピーしてください。
          </p>
          <textarea ref={areaRef} readOnly value={fallback} rows={8} aria-label="コピー用の全文" onFocus={(e) => e.currentTarget.select()} />
        </div>
      )}
    </div>
  );
}

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <span id={id} className="field-error">
      {message}
    </span>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <img src="assets/empty-orbit.svg" alt="" aria-hidden="true" />
      <div>
        <p className="empty-title">{title}</p>
        {children}
      </div>
    </div>
  );
}

export function downloadText(filename: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
