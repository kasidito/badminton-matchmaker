# Roadmap

Status as of 22 Oct 2026. Owner decides order; update this file when something ships or changes.

## Now: get to UAT

| # | Task | Who | Status |
|---|---|---|---|
| 1 | Supabase → Authentication → URL Configuration: Site URL + Redirect URL = the Pages address (for forgot password) | Owner | Waiting |
| 2 | Wed 21 Oct: run the night on the old app, press "คัดลอกข้อมูลสำรอง" at the end, then import it (Settings → ข้อมูลและขั้นสูง → นำเข้าจากแอปเดิม) | Owner | Waiting |
| 3 | Run `docs/UAT.md` on the iPad and the phone; report issues | Owner | Waiting |
| 4 | Add a second admin to ก๊วนแบด as a backup (forgot-password emails only reach Supabase team members) | Owner | Suggested |
| 5 | Optional: leaked password protection (Supabase advisor; needs a paid plan) | Owner | Optional |
| 6 | Run `20261021090000_openskill_aliases_club_tools.sql` in the SQL editor | Owner | Done 21 Oct |
| 7 | Run `20261021120000_pair_rules_scores.sql` in the SQL editor | Owner | Done 21 Oct (verified) |
| 8 | Gmail SMTP (app password) in Authentication → Emails → SMTP, see README "Email" | Owner | Waiting |

## Shipped (20–21 Oct)

- Sporty look (design C), no stripes, light/dark/auto, app name **Budmintan**, home-screen icon
- Courts banner: matches, play time, games per person, who sits out (tap to swap), ขอพัก (sit out one draw)
- Bird ranks as emblems (ลูกเจี๊ยบ → ฟีนิกซ์), rank-up toast, legend on the ranking tab
- Five starting levels and a level picker for new names
- Edit member name and MMR; other admins (add with starting password, remove, reset password)
- **Clubs**: players and nights per club, create/switch/rename clubs, admins per club, permissions checked in the database
- Settings regrouped in two fixed columns
- 21 Oct: OpenSkill ratings, "ใช่คนเดิมไหม" on check-in with remembered spellings, offline member add, LINE summary, all-nights stats, leave/delete club, Google Sheet removed
- 21 Oct: pair rules (เล่นคู่กัน / ห้ามเจอกัน), optional real scores (feed MMR margin), UAT walk 53 pass / 0 fail / 5 manual
- 22 Oct: new bird emblem pictures; courtside basics (screen stays on, 44 px tap targets with an accessibility test, last-saved time, long-court flag, wait time on queue chips); score margin judged against the expected result; uncertainty grows for members away; certainty % and distance to the next bird; members away 3+ weeks and weekly attendance streaks. Research report: `research_notes/` + project doc `badminton-app-research-improve-and-sell.md`
- Tests: unit, two UI runs, seeded random long runs (`npm run explore`), database permission replay (`npm run test:db`)

## Next (suggested, owner to pick)

| # | Item | Size | Why |
|---|---|---|---|
| 1 | Cost split v1: court + shuttle cost per head from games played, PromptPay QR in the LINE summary, paid tick on chips | M | Every Thai competitor has it (research report, 22 Oct). Needs the owner to lift the 20 Oct hold |
| 2 | Read-only player page by QR (token per night, no login) | M | Players see the queue on their own phone. Needs the owner to allow one public page |
| 3 | Thai voice call of the next match (speaker button, admin taps) | S–M | Less shouting across the hall |
| 4 | Before selling: move hosting off GitHub Pages, Supabase Pro, self sign-up, PDPA kit | M–L | See the research report, part 2 |

## Later / ideas

- Leaving at a set time
- Cost split (court + shuttles), paid checkbox. **On hold by owner's decision, 20 Oct 2026.**
- Reserve list from the LINE post (names under the `------` line). **Declined by owner, 21 Oct 2026**: every numbered name is checked in.
