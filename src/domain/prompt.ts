// Fill the bundled templates. Placeholders are replaced with JSON only; the templates already
// tell Claude that the embedded data is untrusted and not instructions.
import analysisTemplate from '../templates/analysis-prompt.txt?raw';
import noteTemplate from '../templates/note-article-prompt.txt?raw';
import noteFooter from '../templates/note-format-footer.txt?raw';
import type { RaceSnapshot, SavedAnalysis } from './schema';
import { computeTotals, estimateBet } from './money';

export const NOTE_FOOTER = noteFooter;

function fill(template: string, placeholder: string, json: string): string {
  if (!template.includes(placeholder)) throw new Error(`テンプレートに ${placeholder} がありません`);
  // Function replacer: "$&" etc. inside the JSON must not be interpreted.
  return template.replace(placeholder, () => json);
}

export function buildAnalysisPrompt(snapshot: RaceSnapshot): string {
  return fill(analysisTemplate, '{{RACE_SNAPSHOT_JSON}}', JSON.stringify(snapshot, null, 2));
}

/** The confirmed report handed to Claude for the note article. Only already-validated values. */
export function validatedReport(saved: SavedAnalysis) {
  const { snapshot, response } = saved;
  const totals = computeTotals(snapshot.budget, response.bets);
  return {
    isDemo: saved.isDemo,
    version: saved.version,
    createdAt: saved.createdAt,
    race: snapshot.race,
    cutoffAt: snapshot.cutoffAt,
    mode: snapshot.mode,
    horses: snapshot.horses,
    sources: snapshot.sources,
    missing: snapshot.missing,
    oddsAsOf: snapshot.odds?.asOf ?? null,
    analysis: response,
    recalculated: {
      budget: snapshot.budget,
      ...totals,
      payoutEstimates: response.bets.map((b) => estimateBet(snapshot, b)),
      note: '払戻目安はオッズ取得時点の値で、確定値ではありません。',
    },
    allocationIsDiscretionaryHypothesis: true,
  };
}

export function buildNotePrompt(saved: SavedAnalysis): string {
  const out = fill(noteTemplate, '{{VALIDATED_REPORT_JSON}}', JSON.stringify(validatedReport(saved), null, 2));
  if (!out.endsWith(NOTE_FOOTER)) throw new Error('note用指示の末尾が指定の文と一致しません');
  return out;
}
