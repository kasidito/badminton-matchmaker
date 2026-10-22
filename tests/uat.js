/* Walks docs/UAT.md against tests/fake-supabase.js and prints one line per checklist item:
   PASS / FAIL, or MANUAL for the few items that need a real device or the real Supabase.
   Run: node tests/uat.js   (screenshots go to $UAT_SHOTS if set) */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const fake = fs.readFileSync(path.join(__dirname, 'fake-supabase.js'), 'utf8');
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  fs.readFile(p, (e, buf) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'text/plain' }); res.end(buf); });
});
const SHOTS = process.env.UAT_SHOTS;
const out = [];
const item = (sec, name, ok, note) => out.push({ sec, name, res: ok === null ? 'MANUAL' : ok ? 'PASS' : 'FAIL', note: note || '' });
const POST = 'พุธ 21 ตค 20:00 - 22:00  3 สนาม\n1. ชิน \n2. โฟล์ค\n3. เดือน\n4. นัทซ้าย\n5. เปตอง \n6. ป๊อป \n7. Ard\n8. ภู \n9. กร\n10. ตรัย\n11. บีม\n12. Yiip\n13. ตั้ง\n14. มิว\n15. \n------------------\n16.\n\nถอนชื่อหลังอังคารเที่ยงแล้วไม่มีคนแทนหารค่าสนามนะคะ';

async function open(browser, base, vp, scheme) {
  const ctx = await browser.newContext({ viewport: vp, colorScheme: scheme || 'light' });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  await page.route('**/supabase.js', r => r.fulfill({ body: fake, contentType: 'application/javascript' }));
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
  await page.goto(base);
  return page;
}
const db = p => p.evaluate(() => window.__fakeDb());
const S = p => p.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('bmm-cache-u1-')) return JSON.parse(localStorage.getItem(k)).S; return null; });
const text = p => p.textContent('#view');
const shot = async (p, n) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, n + '.png') }); };
const names = async (p, ci) => p.$$eval(`[data-act=pick][data-ci="${ci}"]`, els => els.map(e => [...e.childNodes].find(n => n.nodeType === 3).textContent));
async function signIn(p, email, pw) {
  await p.waitForSelector('#loginForm');
  await p.fill('#email', email || 'admin@example.com');
  await p.fill('#password', pw || 'correct-horse');
  await p.click('#loginForm button');
}

(async () => {
  await new Promise(r => server.listen(0, r));
  const base = 'http://localhost:' + server.address().port + '/';
  const browser = await chromium.launch();
  const p = await open(browser, base, { width: 1180, height: 820 });

  /* 1. Sign in */
  item(1, 'Opening the link shows the sign-in screen', await p.isVisible('#loginForm'));
  await signIn(p, 'admin@example.com', 'nope');
  await p.waitForSelector('.err');
  item(1, 'A wrong password shows an error', (await p.textContent('.err')).length > 0);
  await signIn(p);
  await p.waitForSelector('#app:not([hidden])');
  item(1, 'The admin signs in and lands on สนาม (Courts)', await p.isVisible('.tab.on[data-tab=play]'));
  await p.reload();
  await p.waitForSelector('#app:not([hidden])');
  item(1, 'Closing and reopening the app keeps you signed in', await p.isVisible('#app'));
  item(1, 'The header shows Budmintan and the club name', (await p.textContent('.brand')).includes('Budmintan') && (await p.textContent('#date')).includes('ก๊วนแบด'));

  /* 2. Check-in */
  await p.click('[data-tab=people]');
  await p.fill('#nameIn', POST);
  await p.click('#addForm button[type=submit]');
  await p.waitForSelector('#toast:not([hidden])');
  let d = await db(p), st = await S(p);
  item(2, 'Pasting the full LINE post checks in everyone, ignores the date line, empty numbers and footer', st.players.filter(x => x.active).length === 14 && !d.players.some(x => /ถอน|พุธ|---/.test(x.name)));
  item(2, 'A new name in the post is added and asks for a starting bird', d.players.some(x => x.name === 'มิว') && await p.isVisible('.newcard'));
  item(2, 'Courts are set from "3 สนาม"', st.courts.length === 3);
  const miu = d.players.find(x => x.name === 'มิว').id;
  await p.click(`[data-act=setlevel][data-id="${miu}"][data-lv=A]`);
  await p.click('[data-act=new-done]');
  item(2, 'Picking a starting bird sets the starting MMR', (await S(p)).players.find(x => x.id === miu).start === 1650);
  await p.fill('#nameIn', '1. นัท ซ้าย');
  await p.click('#addForm button[type=submit]');
  await p.waitForSelector('.askcard');
  item(2, 'A near spelling asks "ใช่คนเดิมไหม" instead of adding a duplicate', !(await db(p)).players.some(x => x.name === 'นัท ซ้าย'));
  await p.click('[data-act=ask-same]');
  const yiip = d.players.find(x => x.name === 'Yiip').id;
  await p.$eval(`input[data-act=toggle][data-id="${yiip}"]`, el => el.click());
  item(2, 'Toggling a member\'s switch checks them out', !(await S(p)).players.find(x => x.id === yiip).active);
  await p.$eval(`input[data-act=toggle][data-id="${yiip}"]`, el => el.click());
  item(2, 'and back in', (await S(p)).players.find(x => x.id === yiip).active);
  await shot(p, 'uat-people');

  /* 3. Courts */
  await p.click('[data-tab=play]');
  await p.click('.fill-inline');
  st = await S(p);
  const all = [].concat(...st.live.filter(Boolean).map(c => c.t[0].concat(c.t[1])));
  item(3, 'สุ่มลงสนามว่าง fills every empty court; nobody is on two courts', st.live.every(Boolean) && new Set(all).size === 12);
  item(3, 'Each court shows Team A and B with average MMR and win chance', (await p.$$('.tmeta')).length === 6 && (await p.textContent('.tmeta')).includes('%'));
  await p.click('[data-act=win][data-ci="0"][data-s="0"]');
  const picked = await p.$('.match >> nth=0 >> .team.win');
  await p.click('[data-act=win][data-ci="0"][data-s="0"]');
  item(3, 'ทีมนี้ชนะ highlights the winner; tapping again clears it', !!picked && !(await p.$('.match >> nth=0 >> .team.win')));
  item(3, 'บันทึกผล only appears once a winner is picked', !(await p.$('[data-act=save][data-ci="0"]')));
  await p.click('[data-act=win][data-ci="0"][data-s="0"]');
  await p.click('[data-act=save][data-ci="0"]');
  st = await S(p);
  item(3, 'After บันทึกผล the court is empty and stays empty', st.live[0] === null && st.done.length === 1 && !!(await p.$('[data-act=draw][data-ci="0"]')));
  const before = await names(p, 1);
  await p.click('[data-act=redraw][data-ci="1"]');
  st = await S(p);
  item(3, 'สุ่มใหม่ changes the players and does not count a match', JSON.stringify(await names(p, 1)) !== JSON.stringify(before) && st.done.length === 1);
  await p.click('#undoBtn');
  item(3, 'Undo reverses the last draw', JSON.stringify(await names(p, 1)) === JSON.stringify(before));
  const m0 = await p.textContent('[data-act=mode][data-ci="1"]');
  await p.click('[data-act=mode][data-ci="1"]'); const m1 = await p.textContent('[data-act=mode][data-ci="1"]');
  await p.click('[data-act=mode][data-ci="1"]'); const m2 = await p.textContent('[data-act=mode][data-ci="1"]');
  await p.click('[data-act=mode][data-ci="1"]');
  item(3, 'Court mode chip cycles ปกติ → แข่งขัน → สังสรรค์', m0 === 'ปกติ' && m1 === 'แข่งขัน' && m2 === 'สังสรรค์');
  await p.fill('[data-act=score][data-ci="1"][data-s="1"]', '21');
  await p.fill('[data-act=score][data-ci="1"][data-s="0"]', '17');
  await p.click('h2');
  item(3, 'Typing an optional score picks the winner', (await S(p)).live[1].w === 1);
  await p.fill('[data-act=score][data-ci="1"][data-s="1"]', '');
  await p.fill('[data-act=score][data-ci="1"][data-s="0"]', '');
  await p.click('h2');
  await shot(p, 'uat-courts');

  /* 4. Manual swap */
  const c1 = await names(p, 1), c2 = await names(p, 2);
  await p.click('[data-act=pick][data-ci="1"][data-s="0"][data-i="0"]');
  await p.click('[data-act=pick][data-ci="2"][data-s="0"][data-i="0"]');
  item(4, 'Tap a player, then a player on another court: they swap', (await names(p, 1))[0] === c2[0] && (await names(p, 2))[0] === c1[0]);
  const qName = await p.$eval('.chip[data-act=pickq] .cn', e => e.textContent);
  const out1 = (await names(p, 1))[1];
  await p.click('[data-act=pick][data-ci="1"][data-s="0"][data-i="1"]');
  await p.click('.chip[data-act=pickq]');
  item(4, 'Tap a player, then a name under พักตานี้: they swap', (await names(p, 1))[1] === qName && (await p.$$eval('.chip .cn', els => els.map(e => e.textContent))).includes(out1));
  await p.click('[data-act=win][data-ci="1"][data-s="0"]');
  const a = (await names(p, 1));
  await p.click('[data-act=pick][data-ci="1"][data-s="0"][data-i="1"]');
  await p.click('[data-act=pick][data-ci="1"][data-s="1"][data-i="0"]');
  const b = (await names(p, 1));
  item(4, 'Swapping inside one court changes partners', a[1] === b[2] && a[2] === b[1]);
  item(4, 'Swapping on a court with a winner picked clears the winner', (await S(p)).live[1].w === null);

  /* 5. Ranking, history, rest */
  const r0 = (await S(p)).done.length;
  await p.click('[data-act=win][data-ci="1"][data-s="0"]');
  await p.click('[data-act=save][data-ci="1"]');
  await p.click('[data-tab=rank]');
  item(5, 'Ranking moves after each saved match (winners up, losers down)', (await text(p)).includes('+') && (await text(p)).includes('-'));
  await p.click('[data-act=edit-mmr] >> nth=3');
  await p.fill('#mmrIn', '1777');
  await p.click('#mmrForm button[type=submit]');
  item(5, 'Editing a player\'s MMR (pencil) sticks', (await text(p)).includes('1777'));
  item(5, 'Bird emblems and the bird legend show', (await p.$$('.rk .bird')).length > 5 && (await p.$$('.btile')).length === 6);
  await p.click('[data-tab=sum]');
  await p.click('[data-act=hflip] >> nth=0');
  item(5, 'สลับผู้ชนะ flips a past result', (await S(p)).done.slice(-1)[0].w === 1);
  await p.click('[data-act=hdel] >> nth=0');
  const still = (await S(p)).done.length;
  await p.click('[data-act=hdel] >> nth=0');
  item(5, 'ลบแมตช์นี้ needs a second tap and removes it', still === 2 && (await S(p)).done.length === 1);
  await p.click('[data-tab=play]');
  await p.click('[data-act=restpick]');
  const restName = await p.$eval('.chip.pick .cn', e => e.textContent);
  await p.click('.chip.pick');
  await p.click('[data-act=restpick]');
  item(5, 'ขอพัก puts someone in "ขอพัก 1 ตา"', (await p.textContent('.restline')).includes(restName));
  await p.click('[data-act=rest]');
  item(5, 'and the x takes them back', !(await p.$('.restline')));
  item(5, 'Win chance and rating use OpenSkill; ยังไม่นิ่ง shows for new players', null, 'covered by unit tests; check the numbers feel right on a real night');

  /* 6. Saving and connection */
  await p.waitForSelector('#syncPill.saved', { timeout: 8000 });
  item(6, 'The header shows บันทึกแล้ว after each change', true);
  await p.evaluate(() => { window.__fakeOffline = true; });
  await p.click('[data-act=win][data-ci="2"][data-s="0"]');
  await p.click('[data-act=save][data-ci="2"]');
  await p.waitForSelector('#syncPill.offline, #syncPill.error', { timeout: 8000 }).catch(() => {});
  item(6, 'Offline: the app keeps working and the header warns', (await S(p)).done.length === 2 && /offline|error/.test(await p.getAttribute('#syncPill', 'class')));
  await p.evaluate(() => { window.__fakeOffline = false; });
  await p.click('#syncPill');
  await p.waitForSelector('#syncPill.saved', { timeout: 12000 });
  d = await db(p);
  item(6, 'Back online it saves (บันทึกแล้ว) and the matches are in the database', d.matches.length === 2);
  await p.reload(); await p.waitForSelector('#app:not([hidden])');
  item(6, 'Refreshing mid-session brings results back', (await S(p)).done.length === 2 && (await p.textContent('#doneCount')) === '2');
  item(6, 'A second device shows the same night', null, 'needs two real devices');
  item(6, 'The night is visible in Supabase (Table editor → matches)', null, 'check once in the dashboard');

  /* 7. Summary, LINE, stats */
  await p.evaluate(() => { window.__shared = []; navigator.share = t => { window.__shared.push(t.text); return Promise.resolve(); }; });
  await p.click('[data-tab=sum]');
  await p.click('[data-act=share-night]');
  const line = await p.evaluate(() => window.__shared[0] || '');
  item(7, 'ส่งไป LINE shares ranking, games per person, no emoji', line.includes('อันดับ') && line.includes('เล่นคนละ') && !/[\u{1F300}-\u{1FAFF}]/u.test(line));
  await p.click('[data-act=sumview][data-v=all]');
  await p.waitForSelector('.srow2');
  item(7, 'ทุกคืน lists members with games, win %, MMR', (await p.$$('.srow2')).length >= 4);
  await p.click('[data-act=sumview][data-v=night]');

  /* 8. End of night */
  await p.click('#setBtn');
  await p.click('[data-act=end]');
  const notYet = (await db(p)).sessions.some(x => x.status === 'open');
  await p.click('[data-act=end]');
  await p.waitForFunction(() => !document.querySelector('.busy'));
  d = await db(p);
  item(8, 'จบเกมวันนี้ needs two taps and closes the night', notYet && !d.sessions.some(x => x.status === 'open'));
  item(8, 'MMR and uncertainty carry over to next time', d.players.filter(x => x.start_sigma != null).length >= 8);
  await p.click('[data-tab=sum]');
  item(8, 'Summary → เกมที่จบแล้ว shows tonight', (await text(p)).includes('เกมที่จบแล้ว (1)'));
  await p.click('[data-tab=people]');
  item(8, 'A new night starts with nobody checked in', !(await S(p)).players.some(x => x.active));
  await p.click('#setBtn');
  const carried = (await S(p)).players.map(x => x.start);
  await p.click('[data-act=reset]'); await p.click('[data-act=reset]');
  item(8, 'เริ่มเกมใหม่ clears tonight only and keeps MMR carried from earlier nights', JSON.stringify((await S(p)).players.map(x => x.start)) === JSON.stringify(carried) && (await S(p)).done.length === 0);
  await p.click('#undoBtn');
  item(8, 'and undo brings tonight back', (await S(p)).players.length === carried.length);

  /* 9. Layout */
  await p.click('[data-tab=people]'); await p.click('[data-act=checkall]'); await p.click('[data-tab=play]'); await p.click('.fill-inline');
  const L = await p.evaluate(() => ({ tabsFixed: getComputedStyle(document.querySelector('.tabs')).position === 'fixed', dock: getComputedStyle(document.querySelector('.dock')).display, oneRow: Math.abs(document.querySelector('.tabs').getBoundingClientRect().top - document.querySelector('.brand').getBoundingClientRect().top) < 40, perRow: new Set([...document.querySelectorAll('.court')].map(c => Math.round(c.getBoundingClientRect().top))).size }));
  item(9, 'iPad landscape: one-row header with the menu, no bottom bar, 3 courts in a row', !L.tabsFixed && L.dock === 'none' && L.oneRow && L.perRow === 1, JSON.stringify(L));
  await shot(p, 'uat-ipad-landscape');
  for (const [label, vp, scheme] of [['iPad portrait', { width: 820, height: 1180 }, 'light'], ['Phone', { width: 390, height: 844 }, 'light'], ['Phone dark', { width: 375, height: 667 }, 'dark']]) {
    await p.setViewportSize(vp);
    await p.emulateMedia({ colorScheme: scheme });
    let wide = false;
    for (const t of ['play', 'people', 'rank', 'sum']) { await p.click(`[data-tab=${t}]`); wide = wide || await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); }
    await p.click('#setBtn'); wide = wide || await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    await p.click('[data-tab=play]');
    const fixed = await p.evaluate(() => getComputedStyle(document.querySelector('.tabs')).position === 'fixed');
    item(9, `${label}: bottom menu, nothing scrolls sideways on any tab`, fixed && !wide);
    await shot(p, 'uat-' + label.replace(/\s/g, '-').toLowerCase());
  }
  await p.setViewportSize({ width: 1180, height: 820 }); await p.emulateMedia({ colorScheme: 'light' });
  await p.click('[data-act=board]');
  const bigName = await p.$eval('.pl', e => parseFloat(getComputedStyle(e).fontSize));
  item(9, 'Board mode shows big names and hides every button on the courts', bigName >= 24 && !(await p.isVisible('[data-act=win]')) && !(await p.isVisible('.redraw')) && !(await p.isVisible('[data-act=restpick]')) && !(await p.isVisible('.scin')));
  await p.click('[data-act=board]');
  item(9, 'Add to Home Screen shows the Budmintan icon and opens full screen', null, 'needs the real iPad / iPhone');

  /* 10. Clubs, admins, pair rules */
  await p.click('#setBtn');
  const t10 = await text(p);
  item(10, 'Settings shows ก๊วน, ผู้ดูแลก๊วน, บัญชี and ข้อมูลและขั้นสูง', ['ก๊วน', 'ผู้ดูแลก๊วน', 'บัญชี', 'ข้อมูลและขั้นสูง'].every(x => t10.includes(x)));
  await p.fill('#admEmail', 'second@example.com'); await p.fill('#admPw', 'second-pass-1');
  await p.click('#adminAddForm button[type=submit]');
  await p.waitForFunction(() => !document.querySelector('.busy'));
  item(10, 'Adding a second admin works', (await text(p)).includes('second@example.com'));
  await p.click('[data-tab=people]');
  const ids = (await db(p)).players.filter(x => x.club_id === 1);
  await p.selectOption('#ruleA', String(ids[0].id)); await p.selectOption('#ruleB', String(ids[1].id)); await p.selectOption('#ruleKind', 'with');
  await p.click('#ruleForm button[type=submit]');
  await p.waitForSelector('[data-act=rule-del]');
  item(10, 'A pair rule can be added (คู่พิเศษ)', (await db(p)).pair_rules.length === 1);
  item(10, 'Forgot password email arrives', null, 'needs the real Supabase with SMTP set up');

  item(0, 'No script errors during the whole walk', p.errors.length === 0, p.errors.slice(0, 3).join(' | '));
  await browser.close(); server.close();
  let fail = 0, manual = 0;
  out.forEach(r => { if (r.res === 'FAIL') fail++; if (r.res === 'MANUAL') manual++; console.log(`${r.res.padEnd(6)} [${r.sec}] ${r.name}${r.note ? '  -> ' + r.note : ''}`); });
  console.log(`\n${out.length - fail - manual} pass, ${fail} fail, ${manual} manual`);
  if (process.env.UAT_JSON) fs.writeFileSync(process.env.UAT_JSON, JSON.stringify(out, null, 2));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
