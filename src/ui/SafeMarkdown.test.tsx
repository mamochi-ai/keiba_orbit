import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SafeMarkdown } from './SafeMarkdown';
import { SafeLink } from './common';

describe('SafeMarkdown', () => {
  it('renders HTML strings as text, never as markup', () => {
    const html = renderToStaticMarkup(<SafeMarkdown source={'# 見出し<img src=x onerror=alert(1)>\n<script>alert(1)</script>\n- **強調**<b>x</b>'} />);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>x');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<strong>強調</strong>');
    expect(html).toContain('<h3 class="md-h1">');
  });

  it('only links http/https URLs', () => {
    expect(renderToStaticMarkup(<SafeLink href="javascript:alert(1)" />)).not.toContain('href');
    expect(renderToStaticMarkup(<SafeLink href="https://example.com" />)).toContain('href="https://example.com"');
  });
});
