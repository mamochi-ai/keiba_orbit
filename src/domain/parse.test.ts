import { describe, expect, it } from 'vitest';
import { parsePastedJson, stripOuterFence } from './parse';

describe('parsePastedJson', () => {
  it('accepts plain JSON and a single json fence', () => {
    expect(parsePastedJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(parsePastedJson('```json\n{"a":1}\n```')).toEqual({ ok: true, value: { a: 1 } });
    expect(parsePastedJson('  \n```\n{"a":[1,2]}\n```\n')).toEqual({ ok: true, value: { a: [1, 2] } });
  });

  it('reports the position of text mixed with JSON', () => {
    const before = parsePastedJson('分析結果です。\n```json\n{"a":1}\n```');
    expect(before.ok).toBe(false);
    if (!before.ok) expect(before.line).toBe(1);
    const after = parsePastedJson('{"a":1}\n以上です');
    expect(after.ok).toBe(false);
    if (!after.ok) {
      expect(after.line).toBe(2);
      expect(after.column).toBe(1);
      expect(after.message).toContain('余分な文章');
    }
    const fenceAfter = parsePastedJson('```json\n{"a":1}\n```\n補足：これは仮説です');
    expect(fenceAfter.ok).toBe(false);
    if (!fenceAfter.ok) expect(fenceAfter.line).toBe(4);
    expect(parsePastedJson('```json\n{}\n```\n```json\n{}\n```').ok).toBe(false);
  });

  it('reports syntax errors with line and column', () => {
    const r = parsePastedJson('{\n  "a": 1,\n  "b": tru\n}');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.line).toBe(3);
      expect(r.column).toBe(8);
    }
    const trailing = parsePastedJson('{"a":1,}');
    expect(trailing.ok).toBe(false);
  });

  it('never evaluates code', () => {
    const r = parsePastedJson('{"a": (function(){ globalThis.pwned = 1 })()}');
    expect(r.ok).toBe(false);
    expect((globalThis as { pwned?: number }).pwned).toBeUndefined();
  });

  it('rejects empty and oversized input', () => {
    expect(parsePastedJson('   ').ok).toBe(false);
    expect(parsePastedJson(`{"a":"${'x'.repeat(210_000)}"}`).ok).toBe(false);
  });
});

describe('stripOuterFence', () => {
  it('removes one outer markdown fence, including the 4-backtick form', () => {
    expect(stripOuterFence('```markdown\n# T\n本文\n```')).toEqual({ text: '# T\n本文', stripped: true });
    expect(stripOuterFence('````markdown\n# T\n```js\nx\n```\n````')).toEqual({ text: '# T\n```js\nx\n```', stripped: true });
    expect(stripOuterFence('# no fence').stripped).toBe(false);
  });
});
