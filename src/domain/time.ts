// All race dates and information times are handled and displayed in JST (Asia/Tokyo).
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function nowIso(): string {
  return toJstIso(new Date());
}

/** ISO string with +09:00 offset. */
export function toJstIso(d: Date): string {
  const j = new Date(d.getTime() + JST_OFFSET_MS);
  return `${j.toISOString().slice(0, 19)}+09:00`;
}

export function todayJst(): string {
  return toJstIso(new Date()).slice(0, 10);
}

/** datetime-local value ("2026-10-26T15:00") interpreted as JST → ISO with offset. */
export function jstLocalToIso(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  return `${local}:00+09:00`;
}

export function isoToJstLocal(iso: string | null): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return toJstIso(new Date(t)).slice(0, 16);
}

export function formatJst(iso: string | null | undefined): string {
  if (!iso) return '未記録';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '不明な日時';
  const s = toJstIso(new Date(t));
  return `${s.slice(0, 4)}/${s.slice(5, 7)}/${s.slice(8, 10)} ${s.slice(11, 16)} JST`;
}

export function formatDateJa(date: string | null): string {
  if (!date) return '日付なし';
  const [y, m, d] = date.split('-');
  // Noon JST is 03:00 UTC on the same calendar day.
  const wd = '日月火水木金土'[new Date(Date.parse(`${date}T12:00:00+09:00`)).getUTCDay()] ?? '';
  return `${y}年${Number(m)}月${Number(d)}日（${wd}）`;
}

export function ageMinutes(iso: string | null, now = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : (now - t) / 60000;
}
