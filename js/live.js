/* Players' live view (live.html#<token>): courts, who is next and the queue for tonight, read-only.
   Polls public.live_night(token) every 8 s while the page is visible; the admin app writes the picture
   (sessions.live) after each save. No MMR, no history, no login. */
(function () {
  'use strict';
  var BIRDS = [['chick', 'ลูกเจี๊ยบ'], ['sparrow', 'นกกระจอก'], ['pigeon', 'นกพิราบ'], ['hawk', 'เหยี่ยว'], ['eagle', 'อินทรี'], ['phoenix', 'ฟีนิกซ์']];
  var MODE = { normal: 'ปกติ', competitive: 'แข่งขัน', social: 'สังสรรค์' };
  var POLL = 8000;
  var el = document.getElementById('live');
  var token = (location.hash || '').replace(/^#/, '').trim();
  var client = null, timer = null, last = null, failures = 0;

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function mins(ts) { return ts ? Math.max(0, Math.floor((Date.now() - ts) / 60000)) : 0; }
  function clock(ms) { var d = new Date(ms); return d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2); }
  function bird(i, cls) { var b = BIRDS[i] || BIRDS[0]; return '<span class="bird ' + (cls || 'sm') + '" role="img" aria-label="' + b[1] + '"><img src="img/birds/' + b[0] + '.webp?v=1" alt=""></span>'; }
  function person(p) { return '<span class="lp">' + bird(p.b) + '<span>' + esc(p.n) + '</span></span>'; }

  function message(title, text) { el.innerHTML = '<section class="lhead"><h1>' + esc(title) + '</h1><p class="muted">' + esc(text) + '</p></section>'; }

  function render(d) {
    var v = d.live || {};
    var h = '<section class="lhead"><div><small class="muted">' + esc(d.club || '') + '</small><h1>คิวคืนนี้</h1></div>' +
      '<span class="lstamp" data-at="' + (v.at || '') + '">' + (v.at ? 'อัปเดต ' + clock(v.at) : '') + '</span></section>';
    if (v.next && v.next.length) h += '<section class="lnext"><b>ลงต่อ</b><span>' + v.next.map(esc).join(' · ') + '</span></section>';
    h += '<section class="lcourts">';
    (v.courts || []).forEach(function (c) {
      h += '<article class="lcourt' + (c.empty ? ' empty' : '') + '"><header><b>สนาม ' + c.n + '</b><span class="modechip m-' + esc(c.mode || 'normal') + '">' + (MODE[c.mode] || 'ปกติ') + '</span>' +
        (c.empty ? '' : '<small class="muted">เล่นมา ' + mins(c.since) + ' นาที</small>') + '</header>';
      if (c.empty) h += '<p class="muted small">สนามว่าง</p>';
      else h += '<div class="lteams"><div>' + c.t[0].map(person).join('') + '</div><span class="lvs">VS</span><div>' + c.t[1].map(person).join('') + '</div></div>';
      h += '</article>';
    });
    h += '</section>';
    var q = v.queue || [];
    h += '<section class="lqueue"><h2>รอลงสนาม (' + q.length + ')</h2>';
    if (!q.length) h += '<p class="muted small">ทุกคนอยู่ในสนาม</p>';
    q.forEach(function (p, i) {
      h += '<div class="lrow"><span class="lpos">' + (i + 1) + '</span>' + person(p) + '<span class="muted small">' + (p.g ? p.g + ' เกม' : 'ยังไม่เล่น') + (p.since ? ' · รอ ' + mins(p.since) + ' น.' : '') + (p.rest ? ' · ขอพัก' : '') + '</span></div>';
    });
    h += '</section><p class="lfoot muted small">ดูได้อย่างเดียว ผู้ดูแลก๊วนเป็นคนจัดคิว · Budmintan</p>';
    el.innerHTML = h;
  }

  async function load() {
    try {
      var r = await client.rpc('live_night', { p_token: token });
      if (r.error) throw new Error(r.error.message);
      failures = 0;
      if (!r.data) { message('ลิงก์นี้ใช้ไม่ได้แล้ว', 'คืนนี้อาจจบไปแล้ว หรือผู้ดูแลเปลี่ยนลิงก์ ขอ QR ใหม่จากผู้ดูแลก๊วน'); return; }
      if (!r.data.live) { message('ยังไม่มีคิว', 'ผู้ดูแลยังไม่ได้จัดสนามคืนนี้ หน้านี้จะอัปเดตเอง'); return; }
      last = r.data; render(r.data);            // every poll, so the minute counters keep moving
    } catch (e) {
      failures++;
      if (!last) message('โหลดไม่ได้', 'เช็กอินเทอร์เน็ต แล้วหน้านี้จะลองใหม่เอง');
    }
  }
  function schedule() {
    clearTimeout(timer);
    if (document.visibilityState === 'visible') timer = setTimeout(function () { load().then(schedule); }, POLL * Math.min(4, 1 + failures));
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') load().then(schedule); });

  if (!token || token.length < 16) { message('ลิงก์ไม่ครบ', 'สแกน QR จากผู้ดูแลก๊วนอีกครั้ง'); return; }
  var cfg = window.APP_CONFIG;
  client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
  load().then(schedule);
})();
