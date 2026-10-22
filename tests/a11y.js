/* Accessibility pass: axe-core (colour contrast, WCAG target size) plus our own 44 px tap-target rule,
   on every tab at phone size in light and dark, and on the iPad in light.
   Run: node tests/a11y.js   (part of npm run e2e) */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const fake = fs.readFileSync(path.join(__dirname, 'fake-supabase.js'), 'utf8');
const axe = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  fs.readFile(p, (e, buf) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'text/plain' }); res.end(buf); });
});
const results = [];
const check = (name, cond, detail) => results.push({ name, ok: !!cond, detail });

// 44 px rule: every visible control; .modechip and label.sw carry an invisible ring (::after) that adds 16 px
const small = () => [...document.querySelectorAll('button, a[href], select, summary, input:not([type=checkbox]), label.sw')]
  .filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && !e.closest('.toast'))
  .map(e => { const b = e.getBoundingClientRect(), ring = e.matches('.modechip, label.sw') ? 16 : 0; return { e, w: b.width + ring, h: b.height + ring }; })
  .filter(x => x.w < 43.5 || x.h < 43.5)
  .map(x => (x.e.dataset.act || x.e.className || x.e.tagName) + ' ' + Math.round(x.w) + 'x' + Math.round(x.h));

async function audit(page, label) {
  await page.addScriptTag({ content: axe });
  const r = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'rule', values: ['color-contrast', 'target-size'] }, resultTypes: ['violations'] })).violations
    .map(v => v.id + ': ' + v.nodes.slice(0, 4).map(n => n.target.join(' ') + (n.any[0] && n.any[0].data && n.any[0].data.contrastRatio ? ' (' + n.any[0].data.contrastRatio + ')' : '')).join(', ')));
  check(`${label}: axe contrast and target size`, r.length === 0, r.join(' | '));
  // Thai text: no letter-spacing, and line-height at least 1.3x the font size where Thai can be clipped
  const thai = await page.evaluate(() => {
    const bad = new Set();
    document.querySelectorAll('body *').forEach(e => {
      if (!e.getClientRects().length) return;
      const own = [...e.childNodes].some(n => n.nodeType === 3 && /[\u0E00-\u0E7F]/.test(n.textContent));
      if (!own) return;
      const cs = getComputedStyle(e), fs = parseFloat(cs.fontSize);
      if (cs.letterSpacing !== 'normal' && parseFloat(cs.letterSpacing) !== 0) bad.add('letter-spacing on ' + (e.className || e.tagName));
      const lh = cs.lineHeight === 'normal' ? fs * 1.4 : parseFloat(cs.lineHeight);
      if (/hidden|clip/.test(cs.overflow + cs.overflowY) && lh < fs * 1.3) bad.add('tight clipped line on ' + (e.className || e.tagName));
    });
    return [...bad];
  });
  check(`${label}: Thai text has room for tone marks and no letter-spacing`, thai.length === 0, thai.join(', '));
  const s = [...new Set(await page.evaluate(`(${small.toString()})()`))];
  check(`${label}: every control is at least 44 px`, s.length === 0, s.join(', '));
}

async function run(browser, base, label, viewport, scheme) {
  const ctx = await browser.newContext({ viewport, colorScheme: scheme });
  const page = await ctx.newPage();
  await page.route('**/supabase.js', r => r.fulfill({ body: fake, contentType: 'application/javascript' }));
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
  await page.goto(base);
  await page.fill('#email', 'admin@example.com'); await page.fill('#password', 'correct-horse'); await page.click('#loginForm button');
  await page.waitForSelector('#gate', { state: 'hidden' });
  await page.click('[data-tab=people]');
  await page.fill('#nameIn', '1. ชิน\n2. โฟล์ค\n3. เดือน\n4. นัทซ้าย\n5. เปตอง\n6. ป๊อป\n7. Ard\n8. ภู\n9. กร\n10. ตรัย\n11. บีม\n12. ตั้ง\n13. มิว\n14. แบงค์');
  await page.click('#addForm button[type=submit]'); await page.waitForTimeout(300);
  await page.evaluate(() => { const b = document.querySelector('[data-act=new-done]'); if (b) b.click(); });
  await page.click('[data-tab=play]');
  await page.evaluate(() => document.querySelector('[data-act=fill]:not([disabled])').click());
  await page.evaluate(() => { const w = document.querySelector('[data-act=win][data-ci="0"][data-s="0"]'); if (w) w.click(); });
  await page.waitForTimeout(150);
  await audit(page, label + ' courts');
  for (const t of ['people', 'rank', 'sum']) { await page.click(`[data-tab=${t}]`); await page.waitForTimeout(150); await audit(page, label + ' ' + t); }
  await page.click('#setBtn'); await page.waitForTimeout(150);
  await audit(page, label + ' settings');
  await ctx.close();
}

(async () => {
  await new Promise(r => server.listen(0, r));
  const base = 'http://localhost:' + server.address().port + '/';
  const browser = await chromium.launch();
  await run(browser, base, 'phone/light', { width: 390, height: 844 }, 'light');
  await run(browser, base, 'phone/dark', { width: 390, height: 844 }, 'dark');
  await run(browser, base, 'ipad/light', { width: 1180, height: 820 }, 'light');
  await browser.close(); server.close();
  let failed = 0;
  results.forEach(r => { if (!r.ok) failed++; console.log((r.ok ? 'ok   ' : 'FAIL ') + r.name + (r.ok || !r.detail ? '' : '  -> ' + r.detail)); });
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
