# CLAUDE.md

Context for anyone changing this repo. Read it before editing. Keep it current when a decision changes.

## Product decisions (agreed with the owner, Oct 2026)

- **Admin only.** One admin runs the night on an iPad or phone. Players never log in. Don't add player accounts, sign-up, or public pages unless asked.
- **Clubs (ก๊วน).** Every player and night belongs to a club; admins are per club (`club_admins`). An admin can create another club from Settings and becomes its admin, then adds that club's admins. No self sign-up (owner's choice, Oct 2026).
- **Supabase is the system of record.** The Google Sheet report was removed (owner's call, 21 Oct 2026); results leave the app as a LINE summary text.
- **Hosting:** static files on GitHub Pages. No build step, no framework. Keep it plain HTML/CSS/JS with supabase-js loaded from jsDelivr at a pinned version.
- **UI language is Thai.** Code, comments and docs are English.
- **No emojis anywhere in the UI.** Icons are inline SVG symbols in `index.html` (`<use href="#i-name">`).
- **Never auto-draw.** Saving a result empties the court. A court is only drawn when the admin presses สุ่มลงสนามนี้ / สุ่มลงสนามว่าง / สุ่มสนามนี้ใหม่. Redrawing and swapping never count a match.
- **Only courts with a result are counted.** A match is "done" only when the admin picks a winner and presses บันทึกผล.

## Matching rules (`js/algo.js`)

1. **Who plays next:** fewest finished matches this night (`base + played`), then longest waiting (`freeSince`), then a random number `p.qr` drawn when the player became free (check-in or result saved). Using a stored number keeps the on-screen queue and the draw identical. This order always wins; modes may only bend it inside the flex window.
2. **Rest one round** (`p.rest`, ขอพัก on the banner): the player is left out of `queueOrder`/`freeCount` and the next draw. The flag clears in `fill()` once a draw took someone who was not ahead of them (more matches, or same matches and free no earlier), so they sit out exactly once and come back at the front. Swapping them in by hand also clears it. Can be set for someone on court ("พักตาหน้า").
2b. **Late arrivals / re-check-in:** `base` is raised so they start level with the lowest active player.
2c. **Pair rules** (`pair_rules` table, `S.rules`, Players tab → คู่พิเศษ): `with` = always partners when both are here; if one is on court the other waits (`lineup().held`, chip tag รอคู่). `apart` = never on the same court. `lineup()` keeps a with-pair next to each other in the queue, `takeUnits()` never splits them, single-court draws skip apart conflicts, and multi-court draws add a 5000 cost for any broken rule. `nextFour()` is what the empty-court hint and the ลงต่อ tags show, so they always match the draw. Rules only apply when both players are checked in.
3. **Flex window** (`S.flex`, default 4): Competitive and Social courts may pick from the first `4*k + flex` people in the queue. Skipping someone costs 10, and skipping someone with fewer matches costs 30 per match of difference. Normal courts never use flex.
4. **Team split:** among the 3 possible pairings, minimise repeat partners (weight 3x) and repeat opponents, avoid the pairing just redrawn, and balance team MMR (`/30` normal, `/15` competitive and social).
5. **Modes:** Competitive adds `spread/5` (wants close ratings); Social subtracts `spread/12` (wants a mix).
6. Simulations: match-count spread is usually at most 2 during a night and occasionally 3 for a short time, because courts finish at different times (tested with a bound of 3). A hard guard stops modes from skipping anyone who is 2+ matches behind. Competitive narrows rating spread only modestly when the queue is short (e.g. 16 players / 3 courts); that's expected.

## Ratings (OpenSkill, shown as MMR)

- Start levels (`players.level`, `players.start_mmr`) are shown as the bird they start in (owner's choice): B ลูกเจี๊ยบ 1200, N นกกระจอก 1350, I นกพิราบ 1500, A เหยี่ยว 1650, P อินทรี 1800. ฟีนิกซ์ can only be earned. New names from a check-in get a level picker card on the people tab.
- **Bird ranks** (`A.BIRDS`, computed in `ratings()` as `RT.B`): ลูกเจี๊ยบ <1275, นกกระจอก 1275, นกพิราบ 1425, เหยี่ยว 1575, อินทรี 1725, ฟีนิกซ์ 1875. Up as soon as the floor is reached, down only after falling 25 below it (`stepBird`). Each start level lands in its own bird. Saving a result toasts rank changes. Illustrations are emblem symbols `#b-<bird>` in `index.html` (fixed colours on purpose): the frame metal climbs with the rank (iron coin, bronze coin, silver shield, gold shield, platinum shield with star, fire shield with crown), and wings break out of the frame from เหยี่ยว up. Source: drawn by a small generator; edit the symbols directly.
- OpenSkill Weng-Lin Bradley-Terry for two teams, scaled so 1 OpenSkill point = 15 MMR: mu starts at the level MMR, sigma at 125 (`A.SIG0`), beta 62.5, tau 1.25. Team strength is the sum of the two players; each player's share of the change is their sigma² over the team's. A new player moves ~30 MMR per match, a settled one (sigma ~50) ~10. Social courts count half. `A.settled(RT, id)` = sigma < 105 (about 10 matches); below that the UI shows ยังไม่นิ่ง. `winProb(RT, t)` uses the same model.
- Switched from Elo on 21 Oct 2026 before any real matches were played, so nothing needed converting.
- **Optional score** (`live.sc`, `done.sc` = [a, b]; `matches.score_a/score_b`): typing both scores picks the winner. The rating change is multiplied by `marginFactor` = 0.75 + 0.5 × min(points apart, 15)/15 (21–19 → 0.82, 21–15 → 0.95, 21–6 → 1.25). A score that disagrees with the picked winner is dropped on save.
- Ratings are always **recomputed by replaying tonight's matches** from `start` plus manual edits (`S.adj`, applied before match index `at`). Never store a running rating in state. Editing or deleting a past match must just change `S.done`.
- End day: `carryForward()` → `players.start_mmr` (mu), `players.start_sigma`, `career_games` (via `close_session`).

## State shape (`S`, version 4)

```js
{
  v: 4, sessionId, title,
  players: [{ id, name, active /* here tonight */, base, level: 'B'|'N'|'I'|'A'|'P', start /* mu */, sigma, games, freeSince, qr, rest, aliases, pending /* added offline, negative id */ }],
  courts:  [{ mode: 'normal'|'competitive'|'social' }],
  live:    [null | { t: [[a,b],[c,d]], w: null|0|1, sc?: [a,b], at }],   // one slot per court; sc = optional score
  done:    [{ t, w, mode, court, at, end }],                  // finished matches, in order
  adj:     [{ at, id, to }],                                   // manual MMR edits
  rules:   [{ id, a, b, kind: 'with'|'apart' }],              // club pair rules, loaded from pair_rules
  days:    [...],                                              // past nights, loaded from DB, never synced
  flex, board
}
```

## Sync (`js/app.js`, `js/db.js`)

- **A night (session) opens lazily**: signing in does not create one. The first change that belongs to a night (check-in, draw, result, MMR edit) creates it in `runSync` (`openOrCreateSession`; on unique-violation it joins the open night). End day leaves no open night. An open night from an earlier date that was never used is re-dated on sign-in.
- Every change: `changed()` → write local cache (`bmm-cache-<userId>-<clubId>`, flag `dirty`; the last club is remembered in `bmm-club-<userId>`) → debounce 1.2 s → `sync_session` RPC.
- `sync_session` rewrites the night's `session_players`, `matches`, `match_players`, `rating_adjustments` and the `state` snapshot in one transaction. It is idempotent, so retrying is always safe.
- Failure: keep `dirty`, retry every 10 s and on `online`. The header pill shows the status; tapping it retries.
- Boot: an unsynced local cache for the same session beats the server snapshot.
- If the session was closed elsewhere (error code `P0002`), open a new session and retry.
- **Adding members offline**: a new name that cannot be inserted because the network is down becomes a local member with a temporary negative id (`pending`). `runSync` first calls `flushPending()`, which inserts them (or matches an existing name on unique-violation) and renumbers them everywhere with `A.remapId`. Removing members still needs to be online. Level changes are also written straight to `players` so they stick before a night is open.
- **Check-in names**: `A.matchName` treats the same name or a saved alias (`players.aliases`) as the member, and only suggests near spellings (no spaces/dots/tone marks, edit distance 1–2, prefix) for the admin to confirm (`ui.nameAsk`). Answering ใช่ saves the spelling as an alias. A numbered post (`A.isRoster`) is the whole list: anyone checked in earlier who is not in it (and not on court) is listed in a ไม่อยู่ในโพสต์นี้ card (`ui.notInPost`) with เอาออก / เอาออกทั้งหมด / ให้อยู่ต่อ. Never uncheck anyone without that tap.
- **Clubs**: Settings → ก๊วน can rename, switch, create, leave (`leave_club`, not the last admin, not your only club) and delete (`delete_club`, type the name; removes its nights and members).
- **Summary**: ส่งไป LINE uses `navigator.share` (falls back to the clipboard) with plain text from `dayText()`. ทุกคืน loads every match of the club (`DB.loadAllStats`) and computes per-member nights, games, win %, MMR trail, best partner, toughest opponent and longest streak.
- `<details>` remember only the admin's own taps (`det(key)`, reset when switching club), so a confirm tap that re-renders does not close a section.
- **Undo** is an in-memory stack of state snapshots (`ui.undos`, max 30), pushed by `toast(msg, snapshot)`. Undo keeps the current `sessionId`, `title` and `days`. Cleared on End day.
- **Edit a member**: pencil on the member row opens name + MMR. The name is written straight to `players` (unique, needs online); the MMR becomes a normal `S.adj` edit (undoable).
- **Other admins**: Settings → ผู้ดูแลก๊วน calls the `manage-admins` edge function (`supabase/functions/manage-admins`, deployed with verify_jwt, uses the service role and checks the caller runs the `club_id` sent by the app). Actions per club: list, add (creates the auth user with a starting password, no email, or adds an existing account), remove (not self, not the last), reset another admin's password (only if every club they run is one the caller also runs). `tests/fake-supabase.js` mirrors it under `functions.invoke`.
- **Password reset** uses `resetPasswordForEmail` with `redirectTo` = the page URL; boot detects `type=recovery` in the hash and shows the new-password form. Supabase Site URL / Redirect URLs must include the Pages address. Without custom SMTP, Supabase only emails addresses that are members of the Supabase org team, so for other admins the fallback is an admin setting a new password for them in ผู้ดูแลก๊วน. Custom SMTP is set in the dashboard (README → Email); Resend needs a verified domain to email anyone but the account owner, so the no-domain route is Gmail SMTP with an app password.

## Database

- Migrations live in `supabase/migrations/`, applied in name order. Project ref `vhvlhuimelqsnglhayxs` (Singapore).
- RLS on every table by club membership: `private.my_clubs()` (security definer helpers live in schema `private`). Child rows (session_players, match_players, rating_adjustments) also check that the player belongs to the night's club. RPCs `sync_session`/`close_session` are `security invoker`, so RLS applies inside them; `create_club` is definer and only for existing club admins.
- `db.js` scopes every players/sessions query with `club_id` (`DB.setClub`). Unique names and the one-open-night rule are per club.
- `players.name` is unique case-insensitively within a club. Removing a member sets `active = false`; history is kept.
- Only one `open` session per club (partial unique index `sessions_one_open`).

## Commands

```bash
npm test          # node --test tests/algo.test.js
npm run e2e       # Playwright: tests/smoke.js (iPad evening) + tests/flows.js (phone, edge cases, undo, admins, clubs, password) against tests/fake-supabase.js
npm run explore   # seeded random long run with invariant checks (phone/iPad, light/dark)
npm run test:db   # all migrations in PGlite + per-user permission checks (tests/db/permissions.sql)
npm run uat       # walks docs/UAT.md and prints PASS / FAIL / MANUAL per line (results kept in docs/UAT-results.md)
```

When you change `sync_session`/`close_session`, update `tests/fake-supabase.js` to match, and add a migration file. Never edit an applied migration.

## Style

- Colours come from CSS tokens on `:root` with dark-mode overrides. Never hard-code colours in components.
- Layout breakpoints: 700px (tablet: courts side by side, banner facts in one row), 760px (two-column tabs), 1000px (landscape: one-row header, no bottom dock).
- Settings: grouped cards (`.sgroup` > `.ghead` + `.scard` of `.srow` rows) in two fixed columns (`.scol`) from 760px, one column below. Never use CSS columns there: expanding a section must not move cards between columns.
- Courts tab banner (`.board`): matches done, play time, games per person (fairness), here tonight, then **พักตานี้** chips = the queue in order (first 4 tagged ลงต่อ; tap to swap). There is no separate queue panel any more.
- Rank rows use `.podium`, not `.top` (`.top` is the header).
- Look is design C "sports club app" (chosen Oct 2026): font Prompt, navy ink `--accent`, lime `--hi`. Light: pale page, white cards, navy gradient `--banner` (`.board`, `.strip`, `.hero`) and `--panel` (court) with white team cards. Dark: navy surfaces. Owner asked for **no stripes anywhere**.
- App name shown in the UI is **Budmintan** (header, login, home-screen name).
- Theme: Settings → สีของแอป (auto / light / dark), stored per device in localStorage `bmm-theme`, applied by a tiny inline script in `<head>` as `html[data-theme]`.
- Phone and tablet portrait: the menu (`.tabs`) is a floating pill fixed at the bottom; the courts dock sits above it. From 1000px the menu moves into the header.
- Court: header row (name, mode chip, time, `.redraw` สุ่มใหม่), then the `.match` panel: two `.team` cards split by the net with a lime VS; each team card has its own `.won` (ทีมนี้ชนะ) button, as in the owner's light mockup. บันทึกผล appears under the panel once a winner is picked.
