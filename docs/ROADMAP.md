# Roadmap

Status as of 20 Oct 2026, 19:50. Owner decides order; update this file when something ships or changes.

## Now: get to UAT

| # | Task | Who | Status |
|---|---|---|---|
| 1 | Turn on GitHub Pages | Owner | Done |
| 2 | Sign in on the iPad, check the layout loads correctly | Owner | Done (layout bug fixed) |
| 2b | Supabase → Authentication → URL Configuration: Site URL + Redirect URL = the Pages address (for forgot password) | Owner | Waiting |
| 2c | Google Sheet report | Owner | **Skipped by owner** (app + Supabase are enough; sheet `รายงานก๊วนแบด` exists in kasiditkenn@gmail.com Drive, unused) |
| 3 | Wed 21 Oct: run the night on the old app, press "คัดลอกข้อมูลสำรอง" at the end | Owner | Waiting |
| 4 | Import that backup into the new app (Settings → นำเข้าจากแอปเดิม) | Owner + Claude | After 3 |
| 5 | Run `docs/UAT.md` on the iPad and report issues | Owner | After 2 |
| 6 | Fix UAT issues | Claude | After 5 |
| 7 | Security: run the SQL that moves `is_admin()` to a private schema; turn on leaked password protection | Owner (Claude provides SQL) | Pending |

## Next: improvements (agreed)

| # | Item | Size | Notes |
|---|---|---|---|
| 1 | Backup + report to Google Sheet on End day | M | **Shipped.** Plus a download-all-data button. Weekly automatic export to GitHub not done (would need the service key as a GitHub secret). |
| 2 | Forgot password | S | **Shipped**, plus change password. Needs Supabase Site URL set (Now 2b). |
| 3 | Open the night at first check-in, show the night's date in the header | S | **Shipped.** |
| 4 | Multi-step undo without a time limit; confirm before deleting a match | S | **Shipped** (header undo button, 30 steps). |
| 5 | Show the next 4 on an empty court | S | **Shipped.** Also fixed: on-screen queue and draw now break ties the same way. |
| 6 | **OpenSkill ratings** | M | Owner approved. Keep Elo for 4–6 weeks first, then compute both from `match_players` history and compare before switching. Show levels, not raw numbers, to avoid new players feeling penalised. |

## Pending decision: sporty UI

Mockups (Design canvas "จัดคู่ก๊วนแบด – แนวดีไซน์สปอร์ต", https://claude.ai/artifact/6TWuPZ4ijtdiV9StU5VAwM):
- **A · Scoreboard** — dark, shuttle-yellow accent, Chakra Petch, teams as scoreboard rows, A/B win buttons together, LIVE strip, podium ranking, iPad 3 courts in one row.
- **C · Sports club app** — light, navy + lime, Prompt, VS circle, diagonal-stripe summary, pill bottom nav.
- Both move the phone menu to the bottom and put both "win" buttons together.
Owner to pick A, C or a mix; then restyle via CSS tokens + small markup changes in `js/app.js` views. Fonts must support Thai (Chakra Petch, Prompt, Kanit, Noto Sans Thai).

## Later / ideas

- In-app stats dashboard (instead of Google Sheet): all-time table, per-player MMR chart, best partner, attendance

- Copy tonight's summary to LINE (ranking, matches per person, results)
- Optional score entry (e.g. 21–15) feeding MMR margin
- Player stats: MMR chart, best partner, head-to-head, attendance
- Pair rules: always together / never together
- Rest this round / leaving at a set time
- Court timer alert (over 20 minutes)
- Monthly or seasonal leaderboards
- Read-only link for players (only if the admin-only rule changes)
- Cost split (court + shuttles), paid checkbox. **On hold by owner's decision, 20 Oct 2026.**
