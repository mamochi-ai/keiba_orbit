// Reads text the user copied from a JRA 出馬表 page (jra.go.jp, desktop layout) and pasted into
// the app. Nothing is fetched. Each horse row starts with 「枠N色」 then 馬番 and 馬名; the 単勝
// odds appear as 「18.6 (7 番人気)」 and the past four runs follow. Results are always shown for
// confirmation before they are applied.
import { VENUES, type Horse, type Venue } from './schema';

export interface CardHorse extends Horse {
  winOdds: number | null;
  popularity: number | null;
}

export interface CardHeader {
  date: string | null;
  venue: Venue | null;
  number: number | null;
}

export interface CardParse {
  header: CardHeader;
  horses: CardHorse[];
  warnings: string[];
  /** Text from the first horse row onward (site menus dropped), for use as past performances. */
  body: string;
}

const WAKU = /枠\s*([1-8])\s*(白|黒|赤|青|黄|緑|橙|桃)/g;
const ODDS = /(\d{1,4}\.\d)\s*[(（]\s*(\d{1,2})\s*番人気\s*[)）]/;
const PAST_DATE = /\d{4}年\s*\d{1,2}月\s*\d{1,2}日/;
const SCRATCH = /出走取消|競走除外|取消|除外/;
// Origin marks rendered from images (マル外 / カク地 …) and stray symbols before the name.
const NAME_PREFIX = /^(?:[㊀-㊿㋐-㋾]|(?:マル|カク)(?:外|地|ガイ|チ|父|市))\s*/;

function toHalfWidth(s: string): string {
  return s.replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/ /g, ' ');
}

export function parseHeader(text: string): CardHeader {
  const t = toHalfWidth(text);
  const d = /(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日\s*[（(][^）)]*[）)]\s*\d+回\s*(札幌|函館|福島|新潟|東京|中山|中京|京都|阪神|小倉)\s*\d+日\s*(\d{1,2})\s*レース/.exec(t);
  if (!d) return { date: null, venue: null, number: null };
  const n = Number(d[5]);
  return {
    date: `${d[1]}-${d[2]!.padStart(2, '0')}-${d[3]!.padStart(2, '0')}`,
    venue: (VENUES as readonly string[]).includes(d[4]!) ? (d[4] as Venue) : null,
    number: n >= 1 && n <= 12 ? n : null,
  };
}

function cleanName(raw: string): string {
  // Names never contain digits or brackets, so anything from there on (odds, 戦績) is dropped.
  let name = raw.replace(/\s*[\d(（].*$/, '').trim();
  while (NAME_PREFIX.test(name)) name = name.replace(NAME_PREFIX, '');
  return name.replace(/\s+/g, ' ').trim();
}

export function parseJraCard(input: string): CardParse {
  const text = toHalfWidth(input.replace(/\r\n?/g, '\n'));
  const warnings: string[] = [];
  const anchors = [...text.matchAll(WAKU)].map((m) => ({ index: m.index!, end: m.index! + m[0].length, waku: Number(m[1]) }));
  const horses: CardHorse[] = [];

  anchors.forEach((a, i) => {
    const block = text.slice(a.end, anchors[i + 1]?.index ?? text.length);
    // Tokens = table cells / lines. Safari copies cells with tabs and line breaks.
    const tokens = block
      .split(/[\t\n|]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const numTok = tokens.findIndex((t) => /^\d{1,2}(\s|$)/.test(t));
    if (numTok < 0) return;
    const numMatch = /^(\d{1,2})(?:\s+(.*))?$/.exec(tokens[numTok]!)!;
    const number = Number(numMatch[1]);
    // The name is the next token, unless the number cell also carried text other than ブリンカー着用.
    let nameRaw = numMatch[2] && !/ブリンカー/.test(numMatch[2]) ? numMatch[2] : (tokens[numTok + 1] ?? '');
    if (/^ブリンカー/.test(nameRaw)) nameRaw = tokens[numTok + 2] ?? '';
    const name = cleanName(nameRaw);
    if (number < 1 || number > 18 || !name || name.length > 40 || /^\d/.test(name)) {
      warnings.push(`枠${a.waku}の行で馬番・馬名を読み取れませんでした`);
      return;
    }
    const pastAt = block.search(PAST_DATE);
    const own = pastAt >= 0 ? block.slice(0, pastAt) : block;
    const odds = ODDS.exec(own);
    const scratched = SCRATCH.test(own);
    horses.push({
      id: `h${String(number).padStart(2, '0')}`,
      number,
      name,
      ...(scratched ? { scratched: true } : {}),
      winOdds: odds && !scratched ? Number(odds[1]) : null,
      popularity: odds && !scratched ? Number(odds[2]) : null,
    });
  });

  const seen = new Set<number>();
  const unique = horses.filter((h) => {
    if (seen.has(h.number)) {
      warnings.push(`馬番 ${h.number} が2回出てきました（最初の行を使います）`);
      return false;
    }
    seen.add(h.number);
    return true;
  });
  unique.sort((x, y) => x.number - y.number);
  if (unique.length > 0) {
    const max = unique[unique.length - 1]!.number;
    const missing = Array.from({ length: max }, (_, i) => i + 1).filter((n) => !seen.has(n));
    if (missing.length) warnings.push(`馬番 ${missing.join('・')} が見つかりません。貼り付けが途中で切れていないか確認してください`);
    const withOdds = unique.filter((h) => h.winOdds !== null).length;
    const running = unique.filter((h) => !h.scratched).length;
    if (withOdds > 0 && withOdds < running) warnings.push('一部の馬の単勝オッズが見つかりません');
  }
  const body = anchors.length ? text.slice(anchors[0]!.index).trim() : '';
  return { header: parseHeader(text), horses: unique, warnings, body };
}
