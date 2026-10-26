import { describe, expect, it } from 'vitest';
import { buildAnalysisPrompt, buildNotePrompt, NOTE_FOOTER } from './prompt';
import { goodResponse, realSnapshot } from '../test/fixtures';
import type { SavedAnalysis } from './schema';

describe('prompts', () => {
  it('embeds the validated snapshot in the analysis template', () => {
    const s = realSnapshot({ name: 'テスト$&記念' });
    const p = buildAnalysisPrompt(s);
    expect(p).not.toContain('{{RACE_SNAPSHOT_JSON}}');
    expect(p).toContain(s.snapshotId);
    expect(p).toContain('テスト$&記念');
    expect(p.startsWith('あなたは出典を明示する競馬分析担当です。')).toBe(true);
  });

  it('note prompt ends exactly with the footer and nothing after it', () => {
    const s = realSnapshot();
    const saved: SavedAnalysis = {
      id: 'a-1', raceKey: s.race.id, version: 1, kind: 'original', parentId: null, isDemo: false,
      createdAt: '2026-11-01T10:00:00+09:00', snapshot: s, response: goodResponse(s), noteArticle: null,
    };
    const p = buildNotePrompt(saved);
    expect(p.endsWith(NOTE_FOOTER)).toBe(true);
    expect(p.slice(p.length - NOTE_FOOTER.length)).toBe(NOTE_FOOTER);
    expect(NOTE_FOOTER.startsWith('出力はnoteに投稿するためのMarkdown形式でお願いします。')).toBe(true);
    expect(NOTE_FOOTER.endsWith('外側を ````markdown にしてください）')).toBe(true);
    expect(p).not.toContain('{{VALIDATED_REPORT_JSON}}');
  });
});
