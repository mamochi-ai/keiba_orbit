// End-to-end smoke check against a running build (npm run build && npx vite preview --port 4173).
// Walks the demo flow, checks error states, horizontal overflow at 390/768/1024/1366 and
// keyboard focus. Usage: node scripts/e2e-smoke.mjs [baseUrl] [screenshotDir]
import { createRequire } from 'node:module';

// Uses the globally installed Playwright (not a project dependency).
const { chromium } = createRequire(import.meta.url)('playwright');

const base = process.argv[2] ?? 'http://localhost:4173/';
const shots = process.argv[3];
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, hasTouch: false });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin });
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(String(e)));

async function overflow(label) {
  for (const w of [390, 768, 1024, 1366]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(80);
    const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`${label}: no horizontal overflow at ${w}px`, o <= 0, `overflow=${o}`);
    if (shots) await page.screenshot({ path: `${shots}/${label}-${w}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1366, height: 900 });
}

await page.goto(base);
await page.waitForSelector('h1');
await overflow('home');

// Home validation: empty required fields
await page.locator('#home-date').fill('');
await page.getByRole('button', { name: '分析を準備' }).click();
check('home: required field errors shown (date, race name)', (await page.locator('.field-error').count()) >= 2);

// Small text check: body text >= 16px
const bodySize = await page.evaluate(() => getComputedStyle(document.body).fontSize);
check('body font-size is 16px', bodySize === '16px', bodySize);

// Tap targets: all buttons / nav links >= 48px tall
const small = await page.evaluate(() =>
  [...document.querySelectorAll('button, .btn, .nav a, input:not([type=checkbox]):not([type=file]), select')]
    .filter((el) => el.offsetParent !== null)
    .filter((el) => el.getBoundingClientRect().height < 47.5)
    .map((el) => el.outerHTML.slice(0, 80)),
);
check('home: tap targets >= 48px', small.length === 0, small.join(' | '));

// Demo flow
await page.getByRole('button', { name: '架空デモで試す' }).click();
await page.waitForURL(/#\/prepare/);
check('demo banner visible on prepare', await page.locator('.demo-banner').isVisible());
await overflow('prepare');

const copyBtn = page.getByRole('button', { name: '分析用コピー' });
check('copy disabled before confirmation', await copyBtn.isDisabled());
await page.getByLabel('分析対象と情報締切を確認しました').check();
await copyBtn.click();
await page.waitForSelector('text=コピーしました');
const clip = await page.evaluate(() => navigator.clipboard.readText());
check('analysis prompt copied to clipboard', clip.startsWith('あなたは出典を明示する競馬分析担当です。') && clip.includes('"isDemo": true'));

await page.getByRole('button', { name: '結果を貼り付け' }).click();
await page.waitForURL(/#\/paste/);
await page.getByRole('heading', { name: /結果を貼り付け/ }).waitFor();
const pasteBox = page.getByLabel(/Claudeの応答/);
// Invalid paste → positioned error
await pasteBox.fill('結果は以下です\n{"a":1}');
await page.getByRole('button', { name: '読み込んで確認' }).click();
check('paste: mixed text error with position', (await page.locator('#paste-error').innerText()).includes('1行 1文字目'));
// Other race
await page.getByRole('button', { name: '架空デモの応答を入れる' }).click();
const demoJson = await pasteBox.inputValue();
const other = JSON.parse(demoJson);
other.raceId = 'demo-other';
await pasteBox.fill(JSON.stringify(other));
await page.getByRole('button', { name: '読み込んで確認' }).click();
check('paste: other race rejected', (await page.locator('.error-box').innerText()).includes('別レース'));
// Over budget
const over = JSON.parse(demoJson);
over.bets[0].amount = 30000;
over.spent = 33000; over.unspent = -3000; over.maxLoss = 33000;
await pasteBox.fill(JSON.stringify(over));
await page.getByRole('button', { name: '読み込んで確認' }).click();
check('paste: budget overrun rejected', (await page.locator('.error-box').innerText()).includes('予算超過'));
// Good demo response
await page.getByRole('button', { name: '架空デモの応答を入れる' }).click();
await page.getByRole('button', { name: '読み込んで確認' }).click();
check('paste: confirmation screen shown', await page.getByRole('heading', { name: '取り込み内容の確認' }).isVisible());
check('paste: missing-odds warning shown', (await page.locator('.notice').first().innerText()).includes('オッズが未取得'));
await overflow('confirm');
await page.getByRole('button', { name: 'この内容で保存してレポートを表示' }).click();
await page.waitForURL(/#\/report\//);
await page.waitForSelector('#report-title');
check('report: demo labels', (await page.locator('.report-cover').innerText()).includes('架空レース'));
await overflow('report');

// Scenario switching keeps the budget unchanged
const budgetBefore = await page.locator('#budget-title').locator('..').innerText();
await page.getByRole('tab', { name: /馬場が悪化/ }).click();
const firstWet = await page.locator('.ranking .horse h3').first().innerText();
check('report: wet scenario reorders (B first)', firstWet.includes('B馬'), firstWet);
await page.getByRole('tab', { name: /速いペース/ }).click();
check('report: unanalysed scenario shows empty state + re-analyse', await page.getByRole('button', { name: '情報を補って再分析' }).isVisible());
const budgetAfter = await page.locator('#budget-title').locator('..').innerText();
check('report: budget unchanged by scenario switch', budgetBefore === budgetAfter);

// Sticky side column only on desktop pointer
const pos = await page.evaluate(() => getComputedStyle(document.querySelector('.report-layout > .side')).position);
check('report: side column sticky on desktop', pos === 'sticky', pos);

// Note copy — footer must be the very end
await page.getByRole('button', { name: 'note記事作成用コピー' }).click();
await page.waitForSelector('.copy-block >> text=コピーしました');
const note = await page.evaluate(() => navigator.clipboard.readText());
check('note prompt ends with footer', note.endsWith('外側を ````markdown にしてください）'));

// Copy failure fallback
await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('denied')); });
await page.getByRole('button', { name: 'note記事作成用コピー' }).click();
check('copy failure shows selectable full text', await page.locator('.manual-copy textarea').isVisible());

// Note article paste with XSS string
await page.getByText('生成された記事を貼り戻す（任意）').click();
await page.getByLabel('記事の原文（Markdown）').fill('```markdown\n# タイトル<img src=x onerror="window.__xss=1">\n- **太字**\n```');
await page.getByRole('button', { name: '外側のコードフェンスを外す' }).click();
const xss = await page.evaluate(() => window.__xss);
check('note preview does not execute HTML', xss === undefined && (await page.locator('.md-preview img').count()) === 0);

// Saved list + settlement
await page.goto(base + '#/saved');
await page.waitForSelector('.saved-item');
check('saved: list shows demo record with version', (await page.locator('.saved-item').first().innerText()).includes('版1'));
await overflow('saved');

// Reduced motion: transitions disabled
const rm = await browser.newContext({ reducedMotion: 'reduce' });
const p2 = await rm.newPage();
await p2.goto(base);
await p2.waitForSelector('button.btn');
const dur = await p2.evaluate(() => getComputedStyle(document.querySelector('button.btn')).transitionDuration);
check('reduced motion disables transitions', dur === '0s', dur);
await rm.close();

// Keyboard: Tab reaches nav, focus ring visible
await page.goto(base);
await page.waitForSelector('button.btn');
await page.keyboard.press('Tab');
await page.keyboard.press('Tab');
const focused = await page.evaluate(() => ({ tag: document.activeElement?.tagName, outline: getComputedStyle(document.activeElement).outlineStyle }));
check('keyboard focus is visible', focused.outline !== 'none', JSON.stringify(focused));

// iPad (touch) landscape: no sticky
const ipad = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true });
const p3 = await ipad.newPage();
await p3.goto(base);
await p3.waitForSelector('button.btn');
const stickyMq = await p3.evaluate(() => matchMedia('(min-width: 1200px) and (hover: hover) and (pointer: fine)').matches);
check('iPad touch: sticky side-column media query does not match', stickyMq === false);
const o3 = await p3.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('iPad touch: no horizontal overflow', o3 <= 0, `overflow=${o3}`);
await ipad.close();

// Real-data (non-demo) flow with odds → payout estimates
const real = await browser.newContext({ viewport: { width: 1024, height: 900 } });
await real.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin });
const r = await real.newPage();
await r.goto(base);
await r.waitForSelector('button.btn');
await r.locator('#home-name').fill('テスト特別');
await r.locator('#home-venue').selectOption('東京');
await r.locator('#home-number').selectOption('11');
await r.getByRole('button', { name: '分析を準備' }).click();
await r.getByRole('heading', { name: /分析準備/ }).waitFor();
// 出馬表 paste → entries, win odds and past performances in one go
const card = ['出馬表 2026年11月1日（日曜）4回東京9日 11レース', ...Array.from({ length: 10 }, (_, i) =>
  `枠${Math.min(8, i + 1)}${'白黒赤青黄緑橙桃'[Math.min(7, i)]}\t${i + 1}\tテスト${'アイウエオカキクケコ'[i]}\n${i === 0 ? '3.2' : (5 + i).toFixed(1)} (${i + 1} 番人気 )\n\t牡4/鹿\t2026年9月1日\n中山\n${i + 1} 着`)].join('\n');
const cardPanel = r.locator('details.card-import');
await cardPanel.getByLabel('出馬表ページのテキスト').fill(card);
await cardPanel.getByRole('button', { name: '読み取る' }).click();
check('card import: preview lists 10 horses', (await cardPanel.locator('.runner-list li').count()) === 10);
check('card import: header mismatch warned', (await cardPanel.locator('.notice').first().innerText()).includes('見出しが違います'));
await cardPanel.getByRole('button', { name: 'この内容で反映' }).click();
await cardPanel.locator('text=を反映しました').waitFor();
const badgeOf = (label) => r.locator('details.item:not(.card-import)', { has: r.locator('.item-label', { hasText: new RegExp(`^${label}$`) }) }).locator('summary.item-head .badge');
check('card import: entries / odds / past obtained', (await badgeOf('出走表').innerText()).includes('取得済') && (await badgeOf('オッズ').innerText()).includes('取得済') && (await badgeOf('過去成績').innerText()).includes('取得済'));
const odds = r.locator('details.item:not(.card-import)', { has: r.locator('.item-label', { hasText: /^オッズ$/ }) });
await odds.locator('summary.item-head').click();
await odds.locator('textarea').fill('1 3.2\n1-2 2.1-2.8');
await odds.getByLabel('提供者').fill('手入力テスト');
await odds.getByLabel('対象時点（JST）').fill('2026-11-01T14:30');
await odds.getByLabel('元URL（http/https）').fill('javascript:alert(1)');
await odds.getByRole('button', { name: 'この内容で反映' }).click();
check('prepare: dangerous URL rejected', (await odds.locator('.error-box').innerText()).includes('http://'));
await odds.getByLabel('元URL（http/https）').fill('https://example.com/odds');
await odds.getByRole('button', { name: 'この内容で反映' }).click();
check('prepare: odds marked as obtained', (await odds.locator('summary.item-head .badge').innerText()).includes('取得済'));
await r.getByLabel('分析対象と情報締切を確認しました').check();
await r.getByRole('button', { name: '分析用コピー' }).click();
await r.waitForSelector('text=コピーしました');
const prompt = await r.evaluate(() => navigator.clipboard.readText());
const snap = JSON.parse(prompt.slice(prompt.indexOf('【入力】') + 4));
check('real snapshot is not demo', snap.isDemo === false && snap.race.id.endsWith('-tokyo-11r'));
const resp = {
  schemaVersion: 1, raceId: snap.race.id, snapshotId: snap.snapshotId, isDemo: false, status: 'provisional', summary: 'テスト<script>x</script>',
  horses: [{ id: 'h01', reasons: ['r'], concerns: [], sourceIds: ['src-entries'] }],
  scenarios: [{ id: 'base', status: 'analyzed', order: ['h01', 'h02'], reason: 'x' }],
  bets: [{ type: 'win', horseIds: ['h01'], amount: 1000, reason: '', odds: null, oddsAt: null }, { type: 'wide', horseIds: ['h01', 'h02'], amount: 2000, reason: '', odds: null, oddsAt: null }],
  budget: 30000, spent: 3000, unspent: 27000, maxLoss: 3000, calculation: { executed: false, method: '' }, limitations: [], reviewTriggers: [], sourceIds: [],
};
await r.getByRole('button', { name: '結果を貼り付け' }).click();
await r.getByRole('heading', { name: /結果を貼り付け/ }).waitFor();
check('real: no demo response button', (await r.getByRole('button', { name: '架空デモの応答を入れる' }).count()) === 0);
await r.getByLabel(/Claudeの応答/).fill('```json\n' + JSON.stringify(resp) + '\n```');
await r.getByRole('button', { name: '読み込んで確認' }).click();
await r.getByRole('button', { name: 'この内容で保存してレポートを表示' }).click();
await r.waitForSelector('#report-title');
const budgetText = await r.locator('#budget-title').locator('..').innerText();
check('real report: win payout estimate ¥3,200', budgetText.includes('¥3,200'));
check('real report: wide payout range ¥4,200〜¥5,600', budgetText.includes('¥4,200〜¥5,600'));
check('real report: profit shown separately', budgetText.includes('この買い目だけ的中した場合の収支'));
check('real report: HTML in summary is text', (await r.locator('.report-cover script').count()) === 0 && (await r.locator('.report-cover').innerText()).includes('<script>'));
check('real report: no demo banner', (await r.locator('.demo-banner').count()) === 0);
await real.close();

check('no console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
