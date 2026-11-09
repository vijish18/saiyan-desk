// Run with Playwright installed; all Apps Script calls use an isolated test fixture.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const settings = JSON.parse(vm.runInNewContext(fs.readFileSync(path.join(root, 'Code.gs'), 'utf8') + '\nJSON.stringify(DEFAULT_SETTINGS)'));
const data = { settings: { ...settings, sheetUpdate: 'menu-test' }, exercises: [], lifting: [], study: [], stamina: { headers: [], rows: [] }, artIndex: {}, listPriority: {}, loadedAt: new Date().toISOString() };
const html = fs.readFileSync(path.join(root, 'Index.html'), 'utf8');
function wav(seconds) {
  const samples = 8000 * seconds;
  const b = Buffer.alloc(44 + samples * 2);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(samples * 2, 40);
  return b;
}
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(d => {
      window.__calls = []; window.__spoken = [];
      window.google = { script: { run: { withSuccessHandler(success) { return { withFailureHandler(fail) { return new Proxy({}, { get(_, method) { return () => {
        window.__calls.push(method);
        if (method === 'getData') success(structuredClone(d)); else fail(new Error('Unexpected RPC: ' + method));
      }; } }); } }; } } } };
      // Capture speech requests without depending on OS speech services or making sound.
      if (window.speechSynthesis) {
        speechSynthesis.speak = u => window.__spoken.push({ text: u.text, lang: u.lang, volume: u.volume });
        speechSynthesis.cancel = () => {};
      }
    }, data);
    await page.route('http://saiyan.test/', r => r.fulfill({ contentType: 'text/html', body: html }));
    await page.goto('http://saiyan.test/');
    await page.waitForFunction(() => document.querySelector('.h-fighter img')?.naturalWidth > 0);
    await page.locator('.h-fighter img').evaluate(img => img.decode());
    assert.equal(await page.locator('.scene-orbit').count(), 2);
    assert.equal(await page.locator('.scene-rock').count(), 6);
    await page.evaluate(() => document.querySelector('footer').scrollIntoView());
    await page.waitForFunction(() => !FX.inView && heroAura.raf === 0);
    await page.locator('.hero2').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => FX.inView && heroAura.raf !== 0);
    assert(await page.evaluate(() => !BattleVoice.on && !SFX.on));
    const hero = await page.locator('.hero2').boundingBox();
    await page.mouse.move(hero.x + hero.width * .8, hero.y + hero.height * .3);
    await page.waitForFunction(() => document.querySelector('.hero2').style.getPropertyValue('--look-x') !== '');
    assert.notEqual(await page.locator('.hero2').evaluate(el => el.style.getPropertyValue('--look-x')), '0deg');
    if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'goku-cinematic-desktop.png') });
    await page.locator('.btn-power').click();
    await page.waitForFunction(() => document.querySelector('.a-to')?.naturalWidth > 0);
    assert(await page.evaluate(() => document.querySelector('.shell').inert && document.activeElement.classList.contains('tf-skip')));
    await page.keyboard.press('Tab');
    assert(await page.evaluate(() => document.activeElement.classList.contains('tf-skip')));
    assert(await page.evaluate(() => document.querySelector('.a-from').src === DEFAULT_ART.artBase && document.querySelector('.a-to').src === DEFAULT_ART.artSsj));
    await page.waitForFunction(() => document.querySelector('#transform').classList.contains('burst'));
    assert.equal(await page.locator('.tf-phase').textContent(), 'LIMIT BREAK / POWER RELEASED');
    await page.locator('.tf-skip').click();
    assert(await page.locator('#transform').isHidden());
    assert.equal(await page.evaluate(() => tfRaf), 0);
    assert(await page.evaluate(() => !document.querySelector('.shell').inert && document.activeElement.classList.contains('btn-power')));
    await page.locator('[data-act="open-effects"]').click();
    await page.locator('[name="voice"]').check();
    await page.locator('[data-act="voice-test"]').click();
    assert.equal((await page.evaluate(() => window.__spoken)).at(-1).lang, 'en-US');
    await page.locator('[name="volume"]').fill('35');
    await page.locator('[data-act="voice-test"]').click();
    assert(Math.abs((await page.evaluate(() => window.__spoken)).at(-1).volume - .35) < .00001);
    await page.locator('[name="voice"]').uncheck();
    assert(await page.locator('#voice-caption').isHidden());
    await page.locator('#voice-file').setInputFiles({ name: 'test-clip.wav', mimeType: 'audio/wav', buffer: wav(1) });
    await page.waitForFunction(() => document.querySelector('#voice-file-status').textContent.includes('Custom clip ready'));
    assert(await page.evaluate(() => localStorage.getItem('saiyan-voice-clip').startsWith('data:audio/wav;base64,')));
    await page.locator('[name="voice"]').check();
    await page.locator('[data-act="voice-test"]').click();
    assert(await page.evaluate(() => BattleVoice.player && BattleVoice.player.volume === .35));
    await page.locator('[name="voice"]').uncheck();
    assert(await page.evaluate(() => BattleVoice.player === null));
    await page.locator('#voice-file').setInputFiles({ name: 'too-long.wav', mimeType: 'audio/wav', buffer: wav(13) });
    await page.waitForFunction(() => document.querySelector('#voice-file-status').textContent.includes('no longer than 12 seconds'));
    await page.locator('[data-act="voice-remove"]').click();
    assert.equal(await page.evaluate(() => localStorage.getItem('saiyan-voice-clip')), null);
    await page.locator('[name="cinematic"]').uncheck();
    assert(await page.evaluate(() => FX.reduced() && heroAura.raf === 0));
    await page.keyboard.press('Escape');
    await page.locator('.btn-power').click();
    assert(await page.locator('#transform').isHidden());
    await page.reload();
    await page.waitForSelector('.hero2');
    assert(await page.evaluate(() => FX.calm && BattleVoice.volume === .35 && !BattleVoice.on));
    await page.locator('[data-act="open-effects"]').click();
    await page.locator('[name="cinematic"]').check();
    await page.keyboard.press('Escape');
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      await page.locator('.h-fighter img').evaluate(img => img.decode());
      const box = await page.locator('.h-fighter img').boundingBox();
      assert(box.width > 100 && box.x >= 0 && box.x + box.width <= width, 'Art fits mobile viewport');
      await page.locator('[data-act="open-effects"]').click();
      const dialog = await page.locator('#dlg-effects').boundingBox();
      assert(dialog.x >= 0 && dialog.x + dialog.width <= width, 'Settings fit viewport');
      await page.keyboard.press('Escape');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.h-right').scrollIntoViewIfNeeded();
    if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'goku-cinematic-mobile.png') });
    for (const tab of ['gym', 'study', 'progress', 'today']) {
      await page.evaluate(tab => { S.tab = tab; render(); }, tab);
      assert(await page.evaluate(tab => S.tab === tab && (tab === 'today' ? !!FX.cleanup : FX.cleanup === null), tab));
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => FX.reduced() && heroAura.raf === 0);
    await page.locator('.btn-power').click();
    assert(await page.locator('#transform').isHidden());
    assert.deepEqual(await page.evaluate(() => window.__calls), ['getData']);
    assert.deepEqual(errors, []);
    console.log('PASS: depth interaction, transformation lifecycle, audio opt-in, English speech, volume, clip import/validation/removal, persisted preferences, mobile layout, tabs, reduced motion, no data writes.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
