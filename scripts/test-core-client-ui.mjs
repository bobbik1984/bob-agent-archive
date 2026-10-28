// Actual Vue settings + Work view with a fake native bridge. No remote credentials or model calls.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.BOB_BROWSER_MODULE ? pathToFileURL(process.env.BOB_BROWSER_MODULE).href : 'playwright');
const base = process.env.BOB_UI_TEST_URL || 'http://127.0.0.1:5179';
assert.equal(new URL(base).hostname, '127.0.0.1');
const output = join(tmpdir(), 'bob-core-client-ui');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const [name, width, height, lang, theme] of [['mobile', 390, 844, 'zh-CN', 'dark'], ['desktop', 1280, 900, 'en-US', 'light']]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    await page.goto(`${base}/tests/fixtures/remote-agent-preview.html?adapter=bob-core&lang=${lang}&theme=${theme}`);
    await page.locator('.remote-settings form button').click();
    await page.locator('[data-adapter-select]').selectOption('bob-core');
    assert.equal(await page.locator('input[type=password]').count(), 0);
    await page.locator('input[maxlength="120"]').fill('Core demo');
    await page.locator('input[type=url]').fill('https://fixture.invalid');
    await page.locator('.remote-settings form button').click();
    await page.locator('[data-core-code]').waitFor();
    assert.equal(await page.locator('[data-core-code]').textContent(), 'ABCD123456');
    await page.screenshot({ path: join(output, `${name}-authorize.png`), fullPage: true });
    await page.locator('[data-core-pairing] button').first().click();
    await page.locator('[data-core-pairing]').waitFor({ state: 'detached' });
    await page.locator('[data-nav=work]').click();
    await page.locator('[data-core-read-only]').waitFor();
    await page.getByRole('button', { name: '建筑模型渲染 · 示例' }).click();
    await page.locator('.remote-message').last().waitFor();
    await page.getByRole('button', { name: lang === 'zh-CN' ? '加载后续消息' : 'Load following messages' }).click();
    await page.getByText(/Simulated Core record: Web V1/).waitFor();
    await page.locator('.remote-core-facts select').selectOption('task-fixture');
    await page.locator('[data-core-snapshot]').waitFor();
    await page.locator('[data-core-snapshot] summary').click();
    await page.getByText(lang === 'zh-CN' ? '尚无验证记录，不能视为通过。' : 'No verification records. This is not a passing result.', { exact: true }).waitFor();
    assert.equal(await page.locator('.remote-composer').count(), 0);
    assert.equal(await page.locator('.remote-transcript img').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: join(output, `${name}-read-only.png`), fullPage: true });
    await page.locator('[data-nav=settings]').click();
    await page.getByRole('button', { name: lang === 'zh-CN' ? '撤销读取授权' : 'Revoke read access', exact: true }).click();
    await page.getByRole('button', { name: lang === 'zh-CN' ? '撤销读取授权' : 'Revoke read access', exact: true }).last().click();
    await page.locator('.remote-settings article').waitFor({ state: 'detached' });
    const calls = await page.evaluate(() => window.__remoteFixtureCalls);
    assert(calls.some(c => c[0] === 'revoke' && c[1] === 'core1'));
    assert(!calls.some(c => ['send', 'answer', 'cancel'].includes(c[0])));
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(`Core UI passed: 390px zh + desktop en; simulated native bridge only. Screenshots: ${output}`);
} finally { await browser.close(); }
