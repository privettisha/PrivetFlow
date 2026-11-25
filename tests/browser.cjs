const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const root = path.resolve(__dirname, '..');
const extension = path.join(root, 'extension');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'privetflow-browser-'));
const cfg = Array(34).fill(null); cfg[0] = 'Привет 🌊'; cfg[30] = false; cfg[31] = true;
const batch = JSON.stringify([['wrb.fr', 'cPZSdc', JSON.stringify(cfg)]]);
const endpoint = '/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=cPZSdc';
(async () => {
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {}),
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-sandbox'],
    viewport: {width: 380, height: 600}
  });
  try {
    const errors = [];
    context.on('page', p => p.on('pageerror', e => errors.push(e.message)));
    let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.waitForFunction(() => !document.querySelector('#enabled').disabled);
    assert.equal(await popup.locator('#enabled').isChecked(), true);
    await context.route('https://flow.google.com/**', async route => {
      const u = new URL(route.request().url());
      if (u.pathname.endsWith('/batchexecute')) {
        await route.fulfill({status: u.searchParams.has('error') ? 403 : 200, contentType: 'application/json', body: batch});
      } else if (u.pathname === '/checkAppAvailability') {
        await route.fulfill({status: 200, contentType: 'application/json', body: '{"isCountrySupported":false,"isAgeSupported":true}'});
      } else {
        await route.fulfill({contentType: 'text/html', body: '<!doctype html><html lang="ru"><title>PrivetFlow test fixture</title><body>Local test fixture</body></html>'});
      }
    });
    const page = await context.newPage();
    await page.goto('https://flow.google.com/');
    await page.waitForFunction(() => Boolean(window.__privetFlow));
    const results = await page.evaluate(async ({endpoint, batch}) => {
      const r = await fetch(endpoint), clone = r.clone();
      const fetchValue = JSON.parse((await r.json())[0][2])[30];
      const cloneValue = JSON.parse((await clone.json())[0][2])[30];
      const get = (url, type = '') => new Promise((resolve, reject) => {
        const x = new XMLHttpRequest(); x.open('GET', url); x.responseType = type;
        x.onload = () => resolve({text: type === 'json' ? x.response : x.responseText, same: x.response === x.response});
        x.onerror = reject; x.send();
      });
      const xhr = await get(endpoint);
      const xhrJSON = await get('/checkAppAvailability', 'json');
      const denied = await fetch(endpoint + '&error=1');
      const deniedText = await denied.text();
      const stream = JSON.parse(batch);
      const reviver = JSON.parse(batch, (key, value) => value);
      return {fetchValue, cloneValue, url: r.url, used: r.bodyUsed, xhr: JSON.parse(JSON.parse(xhr.text)[0][2])[30], xhrJSON: xhrJSON.text.isCountrySupported, stable: xhrJSON.same, deniedStatus: denied.status, deniedText, stream: JSON.parse(stream[0][2])[30], reviver: JSON.parse(reviver[0][2])[30]};
    }, {endpoint, batch});
    assert.equal(results.fetchValue, true); assert.equal(results.cloneValue, true);
    assert.equal(results.url, 'https://flow.google.com' + endpoint); assert.equal(results.used, true);
    assert.equal(results.xhr, true); assert.equal(results.xhrJSON, true); assert.equal(results.stable, true);
    assert.equal(results.deniedStatus, 403); assert.equal(results.deniedText, batch);
    assert.equal(results.stream, true); assert.equal(results.reviver, false);
    await popup.bringToFront();
    await popup.waitForFunction(() => document.querySelector('#state-title').textContent === 'Региональный флаг изменён');
    fs.mkdirSync(path.join(root, 'docs'), {recursive: true});
    await popup.locator('body').screenshot({path: path.join(root, 'docs/popup.png')});
    const size = await popup.evaluate(() => ({width: document.body.scrollWidth, height: document.body.scrollHeight}));
    console.log('Popup dimensions:', size);
    assert.ok(size.height <= 600, 'Collapsed popup must fit Chrome popup height');
    assert.equal(size.width, 380);
    await popup.locator('#copy').click();
    await popup.waitForFunction(() => document.querySelector('#notice').textContent.includes('Отчёт скопирован'));
    await popup.locator('#enabled').uncheck();
    await popup.waitForFunction(() => document.querySelector('#state-title').textContent === 'Помощник выключен');
    await page.waitForFunction(() => !window.__privetFlow);
    assert.equal(await page.evaluate(async ep => JSON.parse((await (await fetch(ep)).json())[0][2])[30], endpoint), false);
    const state = await worker.evaluate(() => chrome.storage.local.get('enabled'));
    assert.equal(state.enabled, false);
    assert.equal((await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts())).length, 0);
    await popup.locator('#enabled').check();
    await page.waitForFunction(() => Boolean(window.__privetFlow));
    await popup.waitForFunction(() => !document.querySelector('#enabled').disabled);
    assert.equal((await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts())).length, 1);
    const count = context.pages().length;
    await popup.locator('#open').click();
    await popup.waitForTimeout(150);
    assert.equal(context.pages().length, count);
    // The page can tamper with its diagnostic object; reports must remain bounded and anonymous.
    await page.evaluate(() => Object.assign(window.__privetFlow, {state: 'private string', changed: 'private string', errors: -1}));
    const sanitized = await popup.evaluate(() => chrome.runtime.sendMessage({action:'status'}));
    assert.equal(sanitized.diagnostic.state, 'unknown'); assert.equal(sanitized.diagnostic.changed, 0);
    assert.deepEqual(errors, []);
    console.log('PASS: real MV3 registration, fetch/clone/metadata, XHR text/JSON, JSON parsing, HTTP errors, popup, toggles, saved settings, tab reuse, sanitized diagnostics.');
  } finally { await context.close(); fs.rmSync(profile, {recursive:true, force:true}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
