// Display-only Markdown preview. Builds React elements from a tiny subset (headings, lists,
// bold, paragraphs, code blocks). Raw HTML is never interpreted: everything is rendered as text.
import type { ReactNode } from 'react';

type Block =
  | { kind: 'h'; level: 1 | 2 | 3; text: string }
  | { kind: 'ul' | 'ol'; items: string[] }
  | { kind: 'p'; text: string }
  | { kind: 'code'; text: string };

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: 'p', text: para.join('\n') });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = /^(`{3,})/.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith(fence[1]!)) body.push(lines[i++]!);
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      blocks.push({ kind: 'h', level: h[1]!.length as 1 | 2 | 3, text: h[2]! });
      continue;
    }
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (ul || ol) {
      flush();
      const kind = ul ? 'ul' : 'ol';
      const last = blocks[blocks.length - 1];
      const item = (ul ?? ol)![1]!;
      if (last && last.kind === kind) last.items.push(item);
      else blocks.push({ kind, items: [item] });
      continue;
    }
    if (line.trim() === '') {
      flush();
      continue;
    }
    para.push(line);
  }
  flush();
  return blocks;
}

/** Only **bold** is interpreted; every other character (including < > &) is text. */
export function inline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => (p.startsWith('**') && p.endsWith('**') && p.length > 4 ? <strong key={i}>{p.slice(2, -2)}</strong> : p));
}

export function SafeMarkdown({ source }: { source: string }) {
  const blocks = parseMarkdown(source);
  return (
    <div className="md-preview">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'h':
            return b.level === 1 ? <h3 key={i} className="md-h1">{inline(b.text)}</h3> : b.level === 2 ? <h4 key={i} className="md-h2">{inline(b.text)}</h4> : <h5 key={i} className="md-h3">{inline(b.text)}</h5>;
          case 'ul':
            return <ul key={i}>{b.items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ul>;
          case 'ol':
            return <ol key={i}>{b.items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ol>;
          case 'code':
            return <pre key={i}>{b.text}</pre>;
          default:
            return <p key={i}>{inline(b.text)}</p>;
        }
      })}
    </div>
  );
}
