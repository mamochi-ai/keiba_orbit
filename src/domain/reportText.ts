// Display helpers for Claude's free text. They only re-arrange and relabel what Claude wrote;
// nothing is added, judged or summarised.
import type { RaceSnapshot } from './schema';

export type SummaryTag = '事実' | '推測' | '計算' | '仮定' | null;
export interface SummaryLine {
  tag: SummaryTag;
  text: string;
}

const TAG = /【(事実|推測|計算|仮定)】/g;

/** Split 「【事実】…【推測】…」 into one line per tag. Untagged text stays one line. */
export function splitSummary(summary: string): SummaryLine[] {
  const s = summary.trim();
  if (!s) return [];
  const marks = [...s.matchAll(TAG)];
  if (marks.length === 0) return [{ tag: null, text: s }];
  const lines: SummaryLine[] = [];
  const lead = s.slice(0, marks[0]!.index).trim();
  if (lead) lines.push({ tag: null, text: lead });
  marks.forEach((m, i) => {
    const text = s.slice(m.index! + m[0].length, marks[i + 1]?.index ?? s.length).trim();
    if (text) lines.push({ tag: m[1] as SummaryTag, text });
  });
  return lines;
}

/** Replace horse ids written by Claude (e.g. 「h05」) with 「5番」, only for ids in this race. */
export function humanizeIds(text: string, snapshot: Pick<RaceSnapshot, 'horses'>): string {
  const ids = [...snapshot.horses].sort((a, b) => b.id.length - a.id.length);
  if (!ids.length) return text;
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![A-Za-z0-9_-])(${ids.map((h) => esc(h.id)).join('|')})(?![A-Za-z0-9_-])`, 'g');
  const byId = new Map(snapshot.horses.map((h) => [h.id, h.number]));
  return text.replace(re, (id) => `${byId.get(id)}番`);
}
