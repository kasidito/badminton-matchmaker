# UAT checklist

Run on the iPad you use at the court (landscape and portrait) and on a phone. Mark each line Pass / Fail and note anything odd.
`npm run uat` walks the same list against the fake backend and prints PASS / FAIL / MANUAL per line.

Tester: ______  Date: ______  Device: ______

## Sign in
- [ ] Opening the link shows the sign-in screen
- [ ] A wrong password shows an error
- [ ] The admin signs in and lands on สนาม (Courts)
- [ ] Closing and reopening the app keeps you signed in
- [ ] The header shows Budmintan and the club name

## Check-in
- [ ] Pasting the full LINE post checks in everyone, ignores the date line, empty numbers and footer
- [ ] A new name in the post is added and asks for a starting bird
- [ ] Courts are set from "3 สนาม"
- [ ] Picking a starting bird sets the starting MMR
- [ ] A near spelling asks "ใช่คนเดิมไหม" instead of adding a duplicate
- [ ] Toggling a member's switch checks them out
- [ ] and back in

## Courts
- [ ] สุ่มลงสนามว่าง fills every empty court; nobody is on two courts
- [ ] Each court shows Team A and B with average MMR and win chance
- [ ] ทีมนี้ชนะ highlights the winner; tapping again clears it
- [ ] บันทึกผล only appears once a winner is picked
- [ ] After บันทึกผล the court is empty and stays empty
- [ ] สุ่มใหม่ changes the players and does not count a match
- [ ] Undo reverses the last draw
- [ ] Court mode chip cycles ปกติ → แข่งขัน → สังสรรค์
- [ ] Typing an optional score picks the winner

## Manual swap
- [ ] Tap a player, then a player on another court: they swap
- [ ] Tap a player, then a name under พักตานี้: they swap
- [ ] Swapping inside one court changes partners
- [ ] Swapping on a court with a winner picked clears the winner

## Ranking, history and rest
- [ ] Ranking moves after each saved match (winners up, losers down)
- [ ] Editing a player's MMR (pencil) sticks
- [ ] Bird emblems and the bird legend show
- [ ] สลับผู้ชนะ flips a past result
- [ ] ลบแมตช์นี้ needs a second tap and removes it
- [ ] ขอพัก puts someone in "ขอพัก 1 ตา"
- [ ] and the x takes them back
- [ ] Win chance and rating use OpenSkill; ยังไม่นิ่ง shows for new players

## Saving and connection
- [ ] The header shows บันทึกแล้ว after each change
- [ ] Offline: the app keeps working and the header warns
- [ ] Back online it saves (บันทึกแล้ว) and the matches are in the database
- [ ] Refreshing mid-session brings results back
- [ ] A second device shows the same night
- [ ] The night is visible in Supabase (Table editor → matches)

## Summary, LINE and stats
- [ ] ส่งไป LINE shares ranking, games per person, no emoji
- [ ] ทุกคืน lists members with games, win %, MMR

## End of night
- [ ] จบเกมวันนี้ needs two taps and closes the night
- [ ] MMR and uncertainty carry over to next time
- [ ] Summary → เกมที่จบแล้ว shows tonight
- [ ] A new night starts with nobody checked in
- [ ] เริ่มเกมใหม่ resets ratings to the starting birds
- [ ] and undo brings them back

## Layout
- [ ] iPad landscape: one-row header with the menu, no bottom bar, 3 courts in a row
- [ ] iPad portrait: bottom menu, nothing scrolls sideways on any tab
- [ ] Phone: bottom menu, nothing scrolls sideways on any tab
- [ ] Phone dark: bottom menu, nothing scrolls sideways on any tab
- [ ] Board mode shows big names and hides every button on the courts
- [ ] Add to Home Screen shows the Budmintan icon and opens full screen

## Clubs, admins and pair rules
- [ ] Settings shows ก๊วน, ผู้ดูแลก๊วน, บัญชี and ข้อมูลและขั้นสูง
- [ ] Adding a second admin works
- [ ] A pair rule can be added (คู่พิเศษ)
- [ ] Forgot password email arrives

## Overall
- [ ] No script errors during the whole walk

## Only on real devices
- [ ] Add to Home Screen shows the Budmintan icon and opens full screen (iPad and iPhone)
- [ ] A second device signed in to the same club shows the same night
- [ ] Supabase Table editor → matches shows tonight
- [ ] Forgot password: the email arrives and its link sets a new password (needs SMTP, see README)
- [ ] On a real night: ratings and "ยังไม่นิ่ง" feel right; ขอพัก, คู่พิเศษ and scores behave as expected
