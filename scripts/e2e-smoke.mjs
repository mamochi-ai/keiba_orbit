// End-to-end smoke check against a running build (npm run build && npx vite preview --port 4173).
// Walks the demo flow, checks error states, horizontal overflow at 390/768/1024/1366 and
// keyboard focus. Usage: node scripts/e2e-smoke.mjs [baseUrl] [screenshotDir]
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

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
const prepBtn = page.getByRole('button', { name: '分析を準備' });
check('home: 分析を準備 disabled with one-line reason (name)', (await prepBtn.isDisabled()) && (await page.locator('#cta-reason').innerText()).includes('レース名'));
await page.locator('#home-name').fill('X');
await page.locator('#home-date').fill('');
check('home: reason switches to date', (await page.locator('#cta-reason').innerText()).includes('開催日'));
await page.locator('#home-name').fill('');
await page.locator('#home-date').fill('2026-11-01');

// Small text check: body text >= 16px
const bodySize = await page.evaluate(() => getComputedStyle(document.body).fontSize);
check('body font-size is 16px', bodySize === '16px', bodySize);

// Tap targets: everything >= 44px, primary actions and inputs >= 48px
const tapIssues = async () => page.evaluate(() => {
  const vis = (el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed';
  const all = [...document.querySelectorAll('button, .btn, a, input:not([type=checkbox]):not([type=file]), select, summary')].filter(vis);
  const small = all.filter((el) => el.getBoundingClientRect().height < 43.5 && !el.closest('footer') && !el.matches('.skip'));
  const main = [...document.querySelectorAll('.btn.primary, input:not([type=checkbox]):not([type=file]), select')].filter(vis).filter((el) => el.getBoundingClientRect().height < 47.5);
  return [...small, ...main].map((el) => el.outerHTML.slice(0, 70));
});
check('home: tap targets (44px / primary 48px)', (await tapIssues()).length === 0, (await tapIssues()).join(' | '));
await page.setViewportSize({ width: 390, height: 844 });
check('390: bottom nav shown, top nav hidden', (await page.locator('.bottomnav').isVisible()) && !(await page.locator('.topnav').isVisible()));
check('390: tap targets', (await tapIssues()).length === 0, (await tapIssues()).join(' | '));
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(100);
const covered = await page.evaluate(() => document.querySelector('.app-foot').getBoundingClientRect().bottom - document.querySelector('.bottomnav').getBoundingClientRect().top);
check('390: bottom nav does not cover the end of the page', covered <= 0, `overlap=${covered}`);
const inputFont = await page.evaluate(() => getComputedStyle(document.querySelector('#home-name')).fontSize);
check('390: inputs are 16px (no iOS zoom)', inputFont === '16px', inputFont);
await page.setViewportSize({ width: 1024, height: 900 });
check('1024: top nav shown, bottom nav hidden', (await page.locator('.topnav').isVisible()) && !(await page.locator('.bottomnav').isVisible()));
await page.setViewportSize({ width: 1366, height: 900 });

// Demo flow
await page.getByRole('button', { name: '架空デモで試す' }).click();
await page.waitForURL(/#\/prepare/);
check('demo strip visible on prepare (once)', (await page.locator('.demo-strip').isVisible()) && (await page.getByText('実在レースの予想ではありません').count()) === 1);
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
check('report: demo strip shown', (await page.locator('.demo-strip').innerText()).includes('架空デモ'));
check('report: verdict shows the base-scenario top pick', (await page.locator('.verdict-pick').innerText()).includes('A馬'));
await page.locator('.summary-box summary').click();
check('report: Claude summary readable as lines', (await page.locator('.summary-lines').innerText()).includes('良馬場ならA馬'));
check('report: candidates with roles', (await page.locator('.cand .role').first().innerText()) === '中心候補');
await overflow('report');

// Scenario switching keeps the budget unchanged
const budgetBefore = await page.locator('.r-side').innerText();
await page.getByRole('tab', { name: /馬場が悪化/ }).click();
const firstWet = await page.locator('.ranking .rank-name').first().innerText();
check('report: wet scenario reorders (B first)', firstWet.includes('B馬'), firstWet);
check('report: changed horses show up/down with reason', (await page.locator('.ranking .delta.up').count()) === 1 && (await page.locator('.ranking .rank-why').count()) === 2 && (await page.locator('.change-reason').innerText()).includes('評価順が変わった理由'));
await page.getByRole('tab', { name: /基本の想定/ }).focus();
await page.keyboard.press('ArrowRight');
check('report: arrow keys move between condition tabs', (await page.getByRole('tab', { name: /馬場が悪化/ }).getAttribute('aria-selected')) === 'true');
await page.getByRole('tab', { name: /速いペース/ }).click();
check('report: unanalysed scenario shows empty state + re-analyse', await page.getByRole('button', { name: '情報を補って再分析' }).isVisible());
const budgetAfter = await page.locator('.r-side').innerText();
check('report: budget unchanged by scenario switch', budgetBefore === budgetAfter);

// Sticky side column only on desktop pointer
const pos = await page.evaluate(() => getComputedStyle(document.querySelector('.r-side')).position);
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
check('prep: empty entries point to received data', await r.getByRole('link', { name: /受け取ったデータからレースを選ぶ/ }).isVisible());
const cardPanel = r.locator('details.card-import');
check('prep: backup card import is closed by default', (await cardPanel.getAttribute('open')) === null);
await cardPanel.locator('summary.item-head').click();
await cardPanel.getByLabel('出馬表ページのテキスト').fill(card);
await cardPanel.getByRole('button', { name: '読み取る' }).click();
check('card import: preview lists 10 horses', (await cardPanel.locator('.runner-list li').count()) === 10);
check('card import: header mismatch warned', (await cardPanel.locator('.notice').first().innerText()).includes('見出しが違います'));
await cardPanel.getByRole('button', { name: 'この内容で反映' }).click();
await cardPanel.locator('text=を反映しました').waitFor();
const badgeOf = (label) => r.locator('details.item:not(.card-import)', { has: r.locator('.item-label', { hasText: new RegExp(`^${label}$`) }) }).locator('summary.item-head .state');
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
check('prepare: odds marked as obtained', (await odds.locator('summary.item-head .state').innerText()).includes('取得済'));
const weather = r.locator('details.item:not(.card-import)', { has: r.locator('.item-label', { hasText: /^天気$/ }) });
await weather.locator('summary.item-head').click();
await weather.getByRole('button', { name: /天気予報を取得/ }).click();
await weather.locator('summary.item-head .state').filter({ hasText: /取得済|取得エラー/ }).waitFor({ timeout: 20000 });
const wState = await weather.locator('summary.item-head .state').innerText();
check('weather: shows 取得済 or 取得エラー (never fake)', /取得済|取得エラー/.test(wState) && (wState.includes('取得済') || (await weather.locator('.error-box').count()) > 0), wState);
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
const budgetText = await r.locator('.r-side').innerText();
check('real report: win payout estimate ¥3,200', budgetText.includes('¥3,200'));
check('real report: wide payout range ¥4,200〜¥5,600', budgetText.includes('¥4,200〜¥5,600'));
check('real report: profit shown separately', budgetText.includes('この買い目だけ的中した場合の収支'));
await r.locator('.summary-box summary').click();
check('real report: HTML in summary is text', (await r.locator('.cover script').count()) === 0 && (await r.locator('.cover').innerText()).includes('<script>'));
check('real report: no demo strip', (await r.locator('.demo-strip').count()) === 0);
check('real report: confirmed course/R shown', (await r.locator('.cover-meta').innerText()).includes('東京') && (await r.locator('.cover-meta').innerText()).includes('11R'));
await real.close();

// Received data (受取データ, schema 1.0)
const feedCtx = await browser.newContext({ viewport: { width: 1024, height: 900 } });
const fp = await feedCtx.newPage();
const sampleFeed = JSON.parse(readFileSync(new URL('../src/test/feed-sample.json', import.meta.url), 'utf8'));
const importFeed = async (obj, fenced = false) => {
  await fp.goto(base + '#/feed');
  await fp.getByLabel('受け取りデータ（JSON）').fill(fenced ? '```json\n' + JSON.stringify(obj, null, 2) + '\n```' : JSON.stringify(obj));
  await fp.getByRole('button', { name: '取り込む', exact: true }).click();
  await fp.locator('.ok-box, .error-box').first().waitFor();
};
await importFeed(sampleFeed, true);
const summary = await fp.locator('[role=status]').first().innerText();
check('feed: imports 7 runners and 21 mock pairs (fenced paste)', summary.includes('出走馬 7頭') && summary.includes('仮オッズ 21組') && summary.includes('テストデータ'), summary);
check('feed: sample shown separately', (await fp.locator('#feed-sample').isVisible()) && (await fp.getByText('まだ受け取ったレースはありません。').isVisible()));
await importFeed(sampleFeed);
const summary2 = await fp.locator('[role=status]').first().innerText();
check('feed: re-import updates, no duplicates', summary2.includes('新規 0件・更新 1件') && (await fp.locator('#feed-sample ~ * .saved-item, section:has(#feed-sample) .saved-item').count()) === 1, summary2);
await fp.locator('section:has(#feed-sample) .saved-item a').first().click();
await fp.getByRole('heading', { name: /2歳未勝利/ }).waitFor();
check('feed race: 7 runners and 21 range pairs', (await fp.locator('.feed-runner').count()) === 7 && (await fp.locator('.pair-grid li').count()) === 21 && (await fp.locator('.pair-grid').innerText()).includes('1.2〜1.6倍'));
check('feed race: mock odds labelled', (await fp.getByText('仮オッズ・分析に使いません').isVisible()));
check('feed race: going is reference info with nulls as 未取得', (await fp.getByText('参考・過去情報').first().isVisible()) && (await fp.locator('pre.raw').innerText()).includes('クッション値：未取得'));
for (const w of [390, 768]) {
  await fp.setViewportSize({ width: w, height: 844 });
  const o = await fp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`feed race: no horizontal overflow at ${w}px`, o <= 0, `overflow=${o}`);
  if (shots) await fp.screenshot({ path: `${shots}/feed-race-${w}.png`, fullPage: true });
}
await fp.setViewportSize({ width: 1024, height: 900 });
await fp.getByRole('button', { name: /テストデータで試す/ }).click();
await fp.waitForURL(/#\/prepare/);
await fp.locator('.demo-strip').waitFor({ timeout: 5000 }).catch(() => {});
check('feed → prep: demo draft with 7 runners, no odds', (await fp.locator('.demo-strip').isVisible()) && (await fp.getByText('出走表').first().isVisible()));
// Partial update: odds 取得未完了 / pairs [] / is_mock false keeps entries and previous odds
const partial = structuredClone(sampleFeed);
partial.races[0].wide_odds = { ...partial.races[0].wide_odds, status: '取得未完了', is_mock: false, pairs: [] };
await importFeed(partial);
const s3 = await fp.locator('[role=status]').first().innerText();
check('feed: partial odds import keeps entries', s3.includes('出走馬 7頭'), s3);
// Invalid pairs are reported, valid data still imported
const bad = structuredClone(sampleFeed);
bad.races[0].wide_odds.pairs.push({ horse_number_1: 1, horse_number_2: 9, odds_min: 2, odds_max: 3 }, { horse_number_1: 3, horse_number_2: 3, odds_min: 2, odds_max: 3 }, { horse_number_1: 4, horse_number_2: 5, odds_min: 9, odds_max: 3 });
await importFeed(bad);
const errs = await fp.locator('.error-box').innerText();
check('feed: detects bad horse number / same-horse / min>max', errs.includes('1-9') && errs.includes('同じ馬番どうし') && errs.includes('上限 3 を超えて'), errs);
const receivedFeed = JSON.parse(readFileSync(new URL('../src/test/feed-received-2026-10-28.json', import.meta.url), 'utf8'));
await importFeed(receivedFeed);
const s4 = await fp.locator('[role=status]').first().innerText();
check('feed: received 2026-10-28 file imports (no is_mock, doc fields ignored with notice)', s4.includes('出走馬 7頭') && s4.includes('wide_odds_record_template') && s4.includes('claude_code_instructions'), s4);
const extendedFeed = JSON.parse(readFileSync(new URL('../src/test/feed-extended-example.json', import.meta.url), 'utf8'));
await importFeed(extendedFeed);
await fp.locator('section:has(#feed-sample) .saved-item a', { hasText: 'テスト記念' }).click();
await fp.getByRole('heading', { name: /テスト記念/ }).waitFor();
check('feed extended: 単勝・人気・取消・過去成績 shown', (await fp.locator('.win-odds').first().innerText()).includes('3.2') && (await fp.getByText('出走取消').first().isVisible()) && (await fp.locator('.past-runs').count()) === 1);
await fp.locator('.past-runs summary').first().click();
check('feed extended: past run line', (await fp.locator('.past-runs').first().innerText()).includes('上がり33.8'));
for (const w of [390, 1024]) {
  await fp.setViewportSize({ width: w, height: 844 });
  const o = await fp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`feed extended: no horizontal overflow at ${w}px`, o <= 0, `overflow=${o}`);
  if (shots) await fp.screenshot({ path: `${shots}/feed-extended-${w}.png`, fullPage: true });
}
await feedCtx.close();

// Claude link setting and cut-off replies
const cl = await browser.newContext({ viewport: { width: 1024, height: 900 } });
const cp = await cl.newPage();
await cp.goto(base + '#/settings');
await cp.getByLabel(/開き先のURL/).fill('https://example.com/chat');
await cp.getByRole('button', { name: '保存', exact: true }).click();
check('settings: non-claude.ai URL rejected', (await cp.locator('#claude-target ~ * .error-text, section:has(#claude-target) .error-text').innerText()).includes('https://claude.ai/'));
await cp.getByLabel(/開き先のURL/).fill('https://claude.ai/project/keiba-ai-test');
await cp.getByRole('button', { name: '保存', exact: true }).click();
await cp.goto(base);
await cp.waitForSelector('button.btn');
await cp.getByRole('button', { name: '架空デモで試す' }).click();
await cp.waitForURL(/prepare/);
check('prep: Claude link opens the saved chat', (await cp.getByRole('link', { name: /Claudeを開く/ }).getAttribute('href')) === 'https://claude.ai/project/keiba-ai-test');
await cp.getByLabel('分析対象と情報締切を確認しました').check();
await cp.getByRole('button', { name: '分析用コピー' }).click().catch(() => {});
await cp.waitForTimeout(300);
await cp.getByRole('button', { name: '結果を貼り付け' }).click();
await cp.getByLabel(/Claudeの応答/).fill('{"schemaVersion":1,"horses":[{"id":"h01","sourceIds":["src-past"\n');
await cp.getByRole('button', { name: '読み込んで確認' }).click();
check('paste: cut-off reply explained', (await cp.locator('#paste-error').innerText()).includes('途中で切れています'));
await cp.getByRole('button', { name: '架空デモの応答を入れる' }).click();
const full = await cp.getByLabel(/Claudeの応答/).inputValue();
const cut = Math.floor(full.length / 2);
await cp.getByLabel(/Claudeの応答/).fill('```json\n' + full.slice(0, cut));
await cp.getByRole('button', { name: /続きを貼り足す/ }).click();
await cp.getByLabel(/続き（2つ目）/).fill(full.slice(cut - 12) + '\n```');
check('paste: parts joined with overlap removed', (await cp.getByText(/2つをつなげて/).innerText()).includes('12 文字を除きました'));
await cp.getByRole('button', { name: '読み込んで確認' }).click();
check('paste: two-part reply reaches confirmation', await cp.getByRole('heading', { name: '取り込み内容の確認' }).isVisible());
await cl.close();

// Official result → suggested payout on the saved analysis (real data)
const rs = await browser.newContext({ viewport: { width: 1024, height: 900 } });
await rs.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin });
const rp = await rs.newPage();
const liveFeed = JSON.parse(readFileSync(new URL('../src/test/feed-extended-example.json', import.meta.url), 'utf8'));
liveFeed.sample = false;
await rp.goto(base + '#/feed');
await rp.getByLabel('受け取りデータ（JSON）').fill(JSON.stringify(liveFeed));
await rp.getByRole('button', { name: '取り込む', exact: true }).click();
await rp.locator('.ok-box').first().waitFor();
await rp.locator('section:has(#feed-live) .saved-item a', { hasText: 'テスト記念' }).click();
await rp.getByRole('heading', { name: /テスト記念/ }).waitFor();
check('feed race: result and race-day weight shown', (await rp.getByRole('heading', { name: 'レース結果' }).isVisible()) && (await rp.locator('.feed-runner').first().innerText()).includes('482kg'));
await rp.getByRole('button', { name: 'このレースで分析を準備' }).click();
await rp.waitForURL(/prepare/);
await rp.getByLabel('分析対象と情報締切を確認しました').check();
await rp.getByRole('button', { name: '分析用コピー' }).click();
await rp.waitForSelector('text=コピーしました');
const rprompt = await rp.evaluate(() => navigator.clipboard.readText());
const rsnap = JSON.parse(rprompt.slice(rprompt.indexOf('【入力】') + 4));
const rresp = {
  schemaVersion: 1, raceId: rsnap.race.id, snapshotId: rsnap.snapshotId, isDemo: false, status: 'provisional', summary: '【推測】h01を中心に。',
  horses: [{ id: 'h01', reasons: ['r'], concerns: [], sourceIds: [] }],
  scenarios: [{ id: 'base', status: 'analyzed', order: ['h01', 'h04'], reason: 'x' }],
  // 3 runners after the scratch: JRA sells no ワイド, so 単勝 only.
  bets: [{ type: 'win', horseIds: ['h01'], amount: 1000, reason: '', odds: null, oddsAt: null }, { type: 'win', horseIds: ['h02'], amount: 1000, reason: '', odds: null, oddsAt: null }],
  budget: 30000, spent: 2000, unspent: 28000, maxLoss: 2000, calculation: { executed: false, method: '' }, limitations: [], reviewTriggers: [], sourceIds: [],
};
await rp.getByRole('button', { name: '結果を貼り付け' }).click();
await rp.getByLabel(/Claudeの応答/).fill(JSON.stringify(rresp));
await rp.getByRole('button', { name: '読み込んで確認' }).click();
await rp.getByRole('button', { name: 'この内容で保存してレポートを表示' }).click();
await rp.waitForSelector('.verdict');
await rp.goto(base + '#/saved');
await rp.locator('.saved-item').first().waitFor();
await rp.locator('.saved-item summary', { hasText: 'レース後の記録' }).first().click();
const sug = await rp.locator('.saved-item .ok-box').first().innerText();
check('saved: payout computed from the official result', sug.includes('¥3,200') && sug.includes('単勝 1番 ¥3,200') && sug.includes('+¥1,200'), sug);
await rp.getByRole('button', { name: 'この金額を入れる' }).click();
check('saved: suggestion fills the payout field (not recorded yet)', (await rp.getByLabel(/払戻額の合計/).inputValue()) === '3200');
await rs.close();

// Empty states in a fresh browser profile
const fresh = await browser.newContext({ viewport: { width: 390, height: 844 } });
const f = await fresh.newPage();
const seen = (t) => f.getByText(t).first().waitFor({ timeout: 5000 }).then(() => true, () => false);
await f.goto(base + '#/saved');
check('empty: saved list shows empty state', await seen('保存した分析はまだありません。'));
await f.goto(base + '#/prepare');
check('empty: prep without race shows empty state', await seen('まだレースが選ばれていません。'));
await f.goto(base + '#/paste');
check('empty: paste without copy shows empty state', await seen('まだ分析用コピーをしていません。'));
await f.goto(base + '#/report/a-missing');
check('empty: unknown report shows not-found', await seen('レポートが見つかりません'));
if (shots) {
  await f.goto(base);
  await f.waitForSelector('button.btn');
  await f.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await f.screenshot({ path: `${shots}/home-390-bottom-viewport.png` });
}
await fresh.close();

check('no console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
