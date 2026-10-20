# CLAUDE.md

Context for anyone changing this repo. Read it before editing. Keep it current when a decision changes.

## Product decisions (agreed with the owner, Oct 2026)

- **Admin only.** One admin runs the night on an iPad or phone. Players never log in. Don't add player accounts, sign-up, or public pages unless asked.
- **Supabase is the system of record.** Google Sheets is only a report (planned: append a summary on End day). Don't use Sheets as storage.
- **Hosting:** static files on GitHub Pages. No build step, no framework. Keep it plain HTML/CSS/JS with supabase-js loaded from jsDelivr at a pinned version.
- **UI language is Thai.** Code, comments and docs are English.
- **No emojis anywhere in the UI.** Icons are inline SVG symbols in `index.html` (`<use href="#i-name">`).
- **Never auto-draw.** Saving a result empties the court. A court is only drawn when the admin presses สุ่มลงสนามนี้ / สุ่มลงสนามว่าง / สุ่มสนามนี้ใหม่. Redrawing and swapping never count a match.
- **Only courts with a result are counted.** A match is "done" only when the admin picks a winner and presses บันทึกผล.

## Matching rules (`js/algo.js`)

1. **Who plays next:** fewest finished matches this night (`base + played`), then longest waiting (`freeSince`), then a random number `p.qr` drawn when the player became free (check-in or result saved). Using a stored number keeps the on-screen queue and the draw identical. This order always wins; modes may only bend it inside the flex window.
2. **Rest one round** (`p.rest`, ขอพัก on the banner): the player is left out of `queueOrder`/`freeCount` and the next draw. The flag clears in `fill()` once a draw took someone who was not ahead of them (more matches, or same matches and free no earlier), so they sit out exactly once and come back at the front. Swapping them in by hand also clears it. Can be set for someone on court ("พักตาหน้า").
2b. **Late arrivals / re-check-in:** `base` is raised so they start level with the lowest active player.
3. **Flex window** (`S.flex`, default 4): Competitive and Social courts may pick from the first `4*k + flex` people in the queue. Skipping someone costs 10, and skipping someone with fewer matches costs 30 per match of difference. Normal courts never use flex.
4. **Team split:** among the 3 possible pairings, minimise repeat partners (weight 3x) and repeat opponents, avoid the pairing just redrawn, and balance team MMR (`/30` normal, `/15` competitive and social).
5. **Modes:** Competitive adds `spread/5` (wants close ratings); Social subtracts `spread/12` (wants a mix).
6. Simulations: match-count spread is usually at most 2 during a night and occasionally 3 for a short time, because courts finish at different times (tested with a bound of 3). A hard guard stops modes from skipping anyone who is 2+ matches behind. Competitive narrows rating spread only modestly when the queue is short (e.g. 16 players / 3 courts); that's expected.

## MMR (Elo v2)

- Start levels (`players.level`, `players.start_mmr`): B เพิ่งเริ่ม 1200, N มือใหม่ 1350, I กลาง 1500, A เก่ง 1650, P โหด 1800. New names from a check-in get a level picker card on the people tab.
- **Bird ranks** (`A.BIRDS`, computed in `ratings()` as `RT.B`): ลูกเจี๊ยบ <1275, นกกระจอก 1275, นกพิราบ 1425, เหยี่ยว 1575, อินทรี 1725, ฟีนิกซ์ 1875. Up as soon as the floor is reached, down only after falling 25 below it (`stepBird`). Each start level lands in its own bird. Saving a result toasts rank changes. Illustrations are `#b-<bird>` symbols in `index.html` (fixed colours on purpose) shown on a tinted disc (`.bird`, `--bd-*`).
- Expectation per player: `eff = 0.75*own + 0.25*partner` against the opponent team average.
- K = 48 for a player's first 10 career matches (`career_games`), then 24. Social courts x0.5.
- Ratings are always **recomputed by replaying tonight's matches** from `start` plus manual edits (`S.adj`, applied before match index `at`). Never store a running rating in state. Editing or deleting a past match must just change `S.done`.
- End day: `carryForward()` → `players.start_mmr`, `career_games`.
- Planned upgrade: OpenSkill, recalculated from `match_players` history.

## State shape (`S`, version 4)

```js
{
  v: 4, sessionId, title,
  players: [{ id, name, active /* here tonight */, base, level: 'N'|'I'|'A', start, games, freeSince }],
  courts:  [{ mode: 'normal'|'competitive'|'social' }],
  live:    [null | { t: [[a,b],[c,d]], w: null|0|1, at }],   // one slot per court
  done:    [{ t, w, mode, court, at, end }],                  // finished matches, in order
  adj:     [{ at, id, to }],                                   // manual MMR edits
  days:    [...],                                              // past nights, loaded from DB, never synced
  flex, board
}
```

## Sync (`js/app.js`, `js/db.js`)

- **A night (session) opens lazily**: signing in does not create one. The first change that belongs to a night (check-in, draw, result, MMR edit) creates it in `runSync` (`openOrCreateSession`; on unique-violation it joins the open night). End day leaves no open night. An open night from an earlier date that was never used is re-dated on sign-in.
- Every change: `changed()` → write local cache (`bmm-cache-<userId>`, flag `dirty`) → debounce 1.2 s → `sync_session` RPC.
- `sync_session` rewrites the night's `session_players`, `matches`, `match_players`, `rating_adjustments` and the `state` snapshot in one transaction. It is idempotent, so retrying is always safe.
- Failure: keep `dirty`, retry every 10 s and on `online`. The header pill shows the status; tapping it retries.
- Boot: an unsynced local cache for the same session beats the server snapshot.
- If the session was closed elsewhere (error code `P0002`), open a new session and retry.
- Adding or removing members needs to be online (inserts need DB ids). Level changes are also written straight to `players` so they stick before a night is open.
- **Undo** is an in-memory stack of state snapshots (`ui.undos`, max 30), pushed by `toast(msg, snapshot)`. Undo keeps the current `sessionId`, `title` and `days`. Cleared on End day.
- **Google Sheet report**: `buildReport()` before closing; queued in localStorage (`bmm-sheet-queue`) and posted as `text/plain` JSON to the Apps Script web app (`tools/google-sheet-report.gs`, idempotent per night id). URL and token live in localStorage (`bmm-sheet`), per device. Success sets `sessions.sheet_exported_at`.
- **Edit a member**: pencil on the member row opens name + MMR. The name is written straight to `players` (unique, needs online); the MMR becomes a normal `S.adj` edit (undoable).
- **Other admins**: Settings → ผู้ดูแลก๊วน calls the `manage-admins` edge function (`supabase/functions/manage-admins`, deployed with verify_jwt, uses the service role and checks the caller is in `admins`). Actions: list, add (creates the auth user with a starting password, no email), remove (not self, not the last), reset another admin's password. `tests/fake-supabase.js` mirrors it under `functions.invoke`.
- **Password reset** uses `resetPasswordForEmail` with `redirectTo` = the page URL; boot detects `type=recovery` in the hash and shows the new-password form. Supabase Site URL / Redirect URLs must include the Pages address. Without custom SMTP, Supabase only emails addresses that are members of the Supabase org team, so for other admins the fallback is an admin setting a new password for them in ผู้ดูแลก๊วน.

## Database

- Migrations live in `supabase/migrations/`, applied in name order. Project ref `vhvlhuimelqsnglhayxs` (Singapore).
- RLS on every table: authenticated users listed in `public.admins` only. RPCs are `security invoker`, so RLS applies inside them.
- `players.name` is unique case-insensitively. Removing a member sets `active = false`; history is kept.
- Only one `open` session at a time (partial unique index).

## Commands

```bash
npm test          # node --test tests/algo.test.js tests/sheet-script.test.js
npm run e2e       # Playwright: tests/smoke.js (iPad evening) + tests/flows.js (phone, edge cases, undo, sheet, password) against tests/fake-supabase.js
```

When you change `sync_session`/`close_session`, update `tests/fake-supabase.js` to match, and add a migration file. Never edit an applied migration.

## Style

- Colours come from CSS tokens on `:root` with dark-mode overrides. Never hard-code colours in components.
- Layout breakpoints: 700px (tablet: courts side by side, banner facts in one row), 760px (two-column tabs), 1000px (landscape: one-row header, no bottom dock).
- Settings: grouped cards (`.sgroup` > `.ghead` + `.scard` of `.srow` rows) in two fixed columns (`.scol`) from 760px, one column below. Never use CSS columns there: expanding a section must not move cards between columns.
- Courts tab banner (`.board`): matches done, play time, games per person (fairness), here tonight, then **พักตานี้** chips = the queue in order (first 4 tagged ลงต่อ; tap to swap). There is no separate queue panel any more.
- Rank rows use `.podium`, not `.top` (`.top` is the header).
- Look is design C "sports club app" (chosen Oct 2026): font Prompt, navy ink `--accent`, lime `--hi`. Light: pale page, white cards, navy diagonal-stripe `--banner` (`.strip`, `.hero`) and `--panel` (court) with white team cards. Dark: owner asked for **no stripes**; banners and court use soft navy gradients.
- Theme: Settings → สีของแอป (auto / light / dark), stored per device in localStorage `bmm-theme`, applied by a tiny inline script in `<head>` as `html[data-theme]`.
- Phone and tablet portrait: the menu (`.tabs`) is a floating pill fixed at the bottom; the courts dock sits above it. From 1000px the menu moves into the header.
- Court: header row (name, mode chip, time, `.redraw` สุ่มใหม่), then the `.match` panel: two `.team` cards split by the net with a lime VS; each team card has its own `.won` (ทีมนี้ชนะ) button, as in the owner's light mockup. บันทึกผล appears under the panel once a winner is picked.
