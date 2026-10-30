// Parse pasted Claude output. Accepts plain JSON, or exactly one ```json fenced block with
// nothing else around it. JSON is parsed with JSON.parse only (never eval).
import { MAX_PASTE_BYTES } from './schema';

export type ParseResult =
  | { ok: true; value: unknown }
  | { ok: false; message: string; line?: number; column?: number; truncated?: boolean };

export function lineCol(text: string, index: number): { line: number; column: number } {
  const before = text.slice(0, index);
  const lines = before.split('\n');
  return { line: lines.length, column: (lines[lines.length - 1]?.length ?? 0) + 1 };
}

function fail(text: string, index: number, message: string): ParseResult {
  const { line, column } = lineCol(text, index);
  return { ok: false, message: `${line}行 ${column}文字目: ${message}`, line, column };
}

/** Minimal JSON syntax scanner that reports the exact error offset (browser messages differ). */
export function findJsonError(src: string): { index: number; message: string } | null {
  let i = 0;
  const ws = () => {
    while (i < src.length && ' \t\n\r'.includes(src[i]!)) i++;
  };
  const err = (message: string) => ({ index: i, message });
  type E = { index: number; message: string } | null;
  const str = (): E => {
    i++; // opening quote
    while (i < src.length) {
      const c = src[i]!;
      if (c === '"') {
        i++;
        return null;
      }
      if (c === '\\') {
        const n = src[i + 1];
        if (n === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(src.slice(i + 2, i + 6))) return err('不正な \\u エスケープです');
          i += 6;
          continue;
        }
        if (n === undefined || !'"\\/bfnrt'.includes(n)) return err('不正なエスケープです');
        i += 2;
        continue;
      }
      if (c.charCodeAt(0) < 0x20) return err('文字列の中に改行や制御文字があります（\\n でエスケープが必要）');
      i++;
    }
    return err('文字列が閉じていません');
  };
  const value = (depth: number): E => {
    if (depth > 64) return err('入れ子が深すぎます');
    ws();
    const c = src[i];
    if (c === undefined) return err('値がありません（途中で終わっています）');
    if (c === '"') return str();
    if (c === '{') {
      i++;
      ws();
      if (src[i] === '}') {
        i++;
        return null;
      }
      for (;;) {
        ws();
        if (src[i] !== '"') return err('キーは " で囲む必要があります');
        const e = str();
        if (e) return e;
        ws();
        if (src[i] !== ':') return err(': がありません');
        i++;
        const v = value(depth + 1);
        if (v) return v;
        ws();
        if (src[i] === ',') {
          i++;
          continue;
        }
        if (src[i] === '}') {
          i++;
          return null;
        }
        return err(', または } がありません');
      }
    }
    if (c === '[') {
      i++;
      ws();
      if (src[i] === ']') {
        i++;
        return null;
      }
      for (;;) {
        const v = value(depth + 1);
        if (v) return v;
        ws();
        if (src[i] === ',') {
          i++;
          continue;
        }
        if (src[i] === ']') {
          i++;
          return null;
        }
        return err(', または ] がありません');
      }
    }
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(src.slice(i));
    if (m && m[0].length > 0 && m[0] !== '-') {
      i += m[0].length;
      return null;
    }
    for (const lit of ['true', 'false', 'null']) {
      if (src.startsWith(lit, i)) {
        i += lit.length;
        return null;
      }
    }
    return err('JSONとして読めない文字があります');
  };
  const e = value(0);
  if (e) return e;
  ws();
  if (i < src.length) return { index: i, message: 'JSONの後ろに余分な文章があります' };
  return null;
}

export function parsePastedJson(raw: string): ParseResult {
  if (new Blob([raw]).size > MAX_PASTE_BYTES) {
    return { ok: false, message: `貼り付け内容が大きすぎます（上限 ${Math.round(MAX_PASTE_BYTES / 1000)}KB）` };
  }
  const text = raw.replace(/^﻿/, '');
  if (text.trim() === '') return { ok: false, message: '貼り付け欄が空です' };

  let body = text;
  let offset = 0;
  const fenceCount = (text.match(/^\s*```/gm) ?? []).length;
  if (fenceCount > 0) {
    const m = /^(\s*)```(?:json|JSON)?[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```[ \t]*(\r?\n\s*)?$/.exec(text);
    if (!m || fenceCount !== 2) {
      // Point at the first character outside of a single fenced block.
      const firstFence = text.search(/```/);
      const leading = text.slice(0, firstFence).search(/\S/);
      if (leading >= 0) return fail(text, leading, 'コードフェンスの前に文章があります。JSONだけを貼り付けてください');
      if (fenceCount > 2) return fail(text, nthIndex(text, '```', 2), 'コードフェンスが複数あります。JSONのコードフェンスは1個だけにしてください');
      const close = nthIndex(text, '```', 1);
      if (close < 0) return fail(text, text.length, 'コードフェンスが閉じていません');
      const after = text.slice(close + 3);
      const trailing = after.search(/\S/);
      return fail(text, close + 3 + Math.max(trailing, 0), 'コードフェンスの後ろに文章があります。JSONだけを貼り付けてください');
    }
    body = m[2]!;
    offset = text.indexOf(body);
  }

  const lead = body.search(/\S/);
  if (lead >= 0 && body[lead] !== '{') {
    return fail(text, offset + lead, 'JSONは { で始まる必要があります。前置きの文章を削除してください');
  }
  const syntax = findJsonError(body);
  if (syntax) {
    // An error at the very end means the JSON simply stops: Claude's reply was cut off.
    if (syntax.index >= body.trimEnd().length) {
      return { ...(fail(text, offset + syntax.index, 'JSONが途中で終わっています（応答が最後まで出力されていません）') as Extract<ParseResult, { ok: false }>), truncated: true };
    }
    return fail(text, offset + syntax.index, syntax.message);
  }
  try {
    return { ok: true, value: JSON.parse(body) as unknown };
  } catch (e) {
    return { ok: false, message: `JSONを読み込めません: ${(e as Error).message}` };
  }
}

function nthIndex(s: string, needle: string, n: number): number {
  let idx = -1;
  for (let k = 0; k <= n; k++) {
    idx = s.indexOf(needle, idx + 1);
    if (idx < 0) return -1;
  }
  return idx;
}

/** Remove one outer ```markdown / ````markdown fence (explicit user action for note articles). */
export function stripOuterFence(raw: string): { text: string; stripped: boolean } {
  const m = /^\s*(`{3,})[ \t]*(?:markdown|md)?[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\1[ \t]*\s*$/.exec(raw);
  if (!m) return { text: raw, stripped: false };
  return { text: m[2]!, stripped: true };
}
