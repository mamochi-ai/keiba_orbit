// JSON export / import of saved analyses and settlements. Imported data is re-validated with
// the same schema and semantic checks as a fresh paste.
import { exportBundleSchema, formatZodIssues, MAX_IMPORT_BYTES, type ExportBundle, type SavedAnalysis, type Settlement } from '../domain/schema';
import { checkResponse, checkSnapshot } from '../domain/validate';
import { findJsonError } from '../domain/parse';

export function buildExport(analyses: SavedAnalysis[], settlements: Settlement[], exportedAt: string): ExportBundle {
  return { format: 'keiba-orbit-export', schemaVersion: 1, exportedAt, analyses, settlements };
}

export type ImportResult =
  | { ok: true; analyses: SavedAnalysis[]; settlements: Settlement[]; rejected: string[] }
  | { ok: false; errors: string[] };

export function parseImport(text: string): ImportResult {
  if (new Blob([text]).size > MAX_IMPORT_BYTES) return { ok: false, errors: ['ファイルが大きすぎます（上限5MB）'] };
  const syntax = findJsonError(text.replace(/^﻿/, ''));
  if (syntax) return { ok: false, errors: [`JSONの構文エラー（${syntax.index + 1}文字目）: ${syntax.message}`] };
  const r = exportBundleSchema.safeParse(JSON.parse(text.replace(/^﻿/, '')));
  if (!r.success) return { ok: false, errors: formatZodIssues(r.error) };
  const rejected: string[] = [];
  const analyses = r.data.analyses.filter((a) => {
    const snapIssues = checkSnapshot(a.snapshot).filter((i) => i.level === 'error');
    const res = checkResponse(a.snapshot, a.response);
    const demoMismatch = a.isDemo !== a.snapshot.isDemo;
    if (snapIssues.length || !res.ok || demoMismatch || a.raceKey !== a.snapshot.race.id) {
      const first = snapIssues[0]?.message ?? res.issues.find((i) => i.level === 'error')?.message ?? 'デモ表示またはレースIDが一致しません';
      rejected.push(`${a.snapshot.race.name}（版${a.version}）: ${first}`);
      return false;
    }
    return true;
  });
  const ids = new Set(analyses.map((a) => a.id));
  const settlements = r.data.settlements.filter((s) => {
    if (!ids.has(s.analysisId)) {
      rejected.push(`収支記録 ${s.analysisId}: 対応する分析がありません`);
      return false;
    }
    return true;
  });
  return { ok: true, analyses, settlements, rejected };
}
