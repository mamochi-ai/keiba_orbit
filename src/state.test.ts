import { describe, expect, it } from 'vitest';
import { isClaudeUrl } from './state';

describe('Claude link setting', () => {
  it('accepts only https claude.ai URLs', () => {
    expect(isClaudeUrl('https://claude.ai/new')).toBe(true);
    expect(isClaudeUrl('https://claude.ai/project/0193-abc')).toBe(true);
    expect(isClaudeUrl('https://claude.ai/chat/1234')).toBe(true);
    for (const bad of ['http://claude.ai/chat/1', 'https://claude.ai.evil.example/chat', 'https://example.com/', 'javascript:alert(1)', 'https://user:pw@claude.ai/', 'claude.ai/chat/1']) {
      expect(isClaudeUrl(bad), bad).toBe(false);
    }
  });
});
