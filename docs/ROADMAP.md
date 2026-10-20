# Roadmap

Status as of 20 Oct 2026. Owner decides order; update this file when something ships or changes.

## Now: get to UAT

| # | Task | Who | Status |
|---|---|---|---|
| 1 | Turn on GitHub Pages | Owner | Done |
| 2 | Sign in on the iPad, check the layout loads correctly | Owner | Waiting |
| 3 | Wed 21 Oct: run the night on the old app, press "คัดลอกข้อมูลสำรอง" at the end | Owner | Waiting |
| 4 | Import that backup into the new app (Settings → นำเข้าจากแอปเดิม) | Owner + Claude | After 3 |
| 5 | Run `docs/UAT.md` on the iPad and report issues | Owner | After 2 |
| 6 | Fix UAT issues | Claude | After 5 |
| 7 | Security: run the SQL that moves `is_admin()` to a private schema; turn on leaked password protection | Owner (Claude provides SQL) | Pending |

## Next: improvements (agreed)

| # | Item | Size | Notes |
|---|---|---|---|
| 1 | Backup + report to Google Sheet on End day | M | Free plan has no backups. Sheet doubles as the report. Add a weekly export to GitHub too. |
| 2 | Forgot password | S | Needs Supabase Site URL set to the Pages address. |
| 3 | Open the night at first check-in, show the night's date in the header | S | Today a session opens at sign-in, so its title can be the wrong day. |
| 4 | Multi-step undo without a time limit; confirm before deleting a match | S | |
| 5 | Show the next 4 on an empty court | S | |
| 6 | **OpenSkill ratings** | M | Owner approved. Keep Elo for 4–6 weeks first, then compute both from `match_players` history and compare before switching. Show levels, not raw numbers, to avoid new players feeling penalised. |

## Later / ideas

- Copy tonight's summary to LINE (ranking, matches per person, results)
- Optional score entry (e.g. 21–15) feeding MMR margin
- Player stats: MMR chart, best partner, head-to-head, attendance
- Pair rules: always together / never together
- Rest this round / leaving at a set time
- Court timer alert (over 20 minutes)
- Monthly or seasonal leaderboards
- Read-only link for players (only if the admin-only rule changes)
- Cost split (court + shuttles), paid checkbox. **On hold by owner's decision, 20 Oct 2026.**
