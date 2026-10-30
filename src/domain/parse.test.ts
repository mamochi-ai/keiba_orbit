import { describe, expect, it } from 'vitest';
import { joinParts, parsePastedJson, stripOuterFence } from './parse';

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

describe('truncated replies', () => {
  it('flags JSON that simply stops (cut-off Claude reply), with or without a trailing newline', () => {
    for (const t of ['{"a":[1,2', '{"a":{"b":"x"', '{"schemaVersion":1,"horses":[{"id":"h01","sourceIds":["src-past"\n', '```json\n{"a":[1\n```']) {
      const r = parsePastedJson(t);
      expect(r.ok, t).toBe(false);
      if (!r.ok) {
        expect(r.truncated, t).toBe(true);
        expect(r.message).toContain('途中で終わっています');
      }
    }
  });

  it('does not call ordinary syntax errors truncated', () => {
    for (const t of ['{"a":1,}', '{"a": tru, "b": 1}', '{"a":1}\n以上です']) {
      const r = parsePastedJson(t);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.truncated ?? false, t).toBe(false);
    }
  });
});

describe('joinParts (a reply delivered in several messages)', () => {
  const reply = JSON.stringify({
    schemaVersion: 1,
    summary: '基本は1番。雨なら 3番 を再評価。',
    horses: Array.from({ length: 16 }, (_, i) => ({ id: `h${String(i + 1).padStart(2, '0')}`, reasons: [`【事実】ダート1400mで${i}着、着差1.${i}`], concerns: ['【推測】速い流れは不安'] })),
  });

  it('rebuilds the exact JSON wherever it was cut, with or without fences and repeated text', () => {
    for (const cut of [1, 37, 200, 511, reply.length - 3]) {
      for (const repeat of [0, 8, 25]) {
        const a = '```json\n' + reply.slice(0, cut) + '\n';
        const b = '\n' + reply.slice(Math.max(0, cut - repeat)) + '\n```\n';
        const { text } = joinParts([a, b]);
        expect(text, `cut=${cut} repeat=${repeat}`).toBe(reply);
        expect(parsePastedJson(text).ok).toBe(true);
      }
    }
  });

  it('joins three parts and reports what was removed', () => {
    const c1 = 300;
    const c2 = 900;
    const r = joinParts([reply.slice(0, c1), reply.slice(c1 - 10, c2), '```\n' + reply.slice(c2) + '\n```']);
    expect(r.text).toBe(reply);
    expect(r.overlaps).toEqual([10, 0]);
  });

  it('keeps a space that falls exactly on the seam inside a string', () => {
    const i = reply.indexOf(' 3番');
    expect(joinParts([reply.slice(0, i), reply.slice(i)]).text).toBe(reply);
  });

  it('a still-unfinished joined reply is reported as cut off', () => {
    const r = parsePastedJson(joinParts([reply.slice(0, 300), reply.slice(300, 600)]).text);
    expect(r.ok === false && r.truncated).toBe(true);
  });
});
