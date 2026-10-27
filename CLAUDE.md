# J&L Recruitment App: handover for Claude

The recruitment app for **LINK Marketing** and **JUSS Marketing** (Angad runs both). It covers check-in QR, the presenter's room rating and notes, the candidate's evaluation, the booker's call outcomes and call log, Chase, Day 1 (New Starts List, reminders, arrivals), new-starter onboarding, the incentive, and phone alerts. About 80 people use it: admins (Angad, Jess, Satpal, Rubal), the recruitment team (Jess and Rubal), bookers and presenters. **Fiza Iqbal left the business on 26 Oct 2026**: Angad deleted her account that day (the app switched it off instead, because she has candidates, so her history stays in pay and All). Don't add her back to anything. Built in a Claude Code cloud session from 12 to 18 Oct 2026, then handed to Angad's Windows PC: since 18 Oct 2026 it's looked after from the folder `Desktop\Claude playground\J&L Recruitment App` (this repo's clone).

**Working with Angad:** he's not technical and usually on his phone. Give plain English, the exact clicks, and links. Be direct. Stress-test his ideas and tell him if one is weak. Show the data. Never send him code to edit by hand except pasting `Code.gs` (below).

## How it fits together
- **`app/src/`**: the source.
  - `Code.gs` is the server: Google Apps Script bound to the Google Sheet (ID in `app/SETUP.md`). All the data and rules live there.
  - `JS.html`, `Styles.html`, `Logos.html`, `QR.html` and `Bulletin.html` are the app.
- **`app/build.js`**: builds the static app into **`join/`** (committed; hosting serves it as-is, with no build step). Run `node app/build.js` after every change under `app/src/`.
- **`join/config.js`**: the Apps Script web app URL and the OneSignal App ID. The build never overwrites it.
- **Hosting:**
  - **Vercel** at `https://jl-recruitment.vercel.app/` (since 18 Oct 2026): project `jl-recruitment` in the Vercel team "Link Marketing" (Pro), Git-connected to this repo, so every merge to `main` goes live in about a minute. `vercel.json` at the root serves `join/`.
  - **GitHub Pages** at the old address `https://angadclaude.github.io/recruitment/join/` stays on only to forward old links, QR codes and home-screen icons to Vercel (`app/move.js`). Keep it on, and keep the repo public (Pages and the raw `Code.gs` links need that).
  - Where the app lives is set in `app/site.json` (`url` + `movedFrom`); `CONFIG.PUBLIC_URL` in `Code.gs` must match `url`.
- **Alerts:** OneSignal web push. The REST API key is a Script Property in Apps Script; it must never go in chat or GitHub.
- **Sheet columns:** new columns append themselves (`readTable` plus `tidyHeaders`). Never reorder or insert columns by hand.
- **The Supabase back end (live since 19 Oct 2026, PR #79):** the same `Code.gs` runs on Vercel, unchanged. The app (`join/config.js` `API_URL: '/api/rpc'`) talks only to Vercel, and the data lives in Supabase, not the Sheet. Google's copy of `Code.gs` only runs the relay.
  - `server/worker.js` runs `Code.gs` in a worker thread with the Google services rebuilt on Postgres: each Sheet tab = `jl.tabs` + `jl.rows` (ordered), CacheService = `jl.cache`, PropertiesService = `jl.props`, LockService = a Postgres advisory lock. Code.gs is synchronous, so every database call waits on the main thread (`server/runtime.js`, Atomics).
  - `server/runtime.js`: one job = one transaction, one job at a time per instance. Emails go into `jl.outbox` and are sent after the commit.
  - `server/live.js` wires it to Supabase (the shared project; schema `jl`, next to FR's `public`, `leaders` and `hf`), OneSignal, and Google's **email relay**.
  - The relay is the Google-only part of `Code.gs` (`relayMail`, `relayInfo`, `relayExport`, `relayFreeze`, `relaySwitch`). Emails still go out from Gmail ("send mail as" Jess / Rubal / Fiza), and the OneSignal key stays in Google. Calls carry Vercel's `RELAY_SECRET`; `Code.gs` holds only its SHA-256 (`RELAY_SECRET_SHA256`).
  - `api/rpc.js` is the app's API (same requests and answers as Google's `/exec`). `api/cron.js` is Vercel Cron every 5 minutes, replacing Google's timers in London time. It does nothing until `jl.props.VERCEL_LIVE` is set.
  - `scripts/import-from-google.js` copies every tab and setting from Google, then compares them field by field (`--apply`, `--verify`).
  - Local secrets in the repo root (gitignored): `.env.supabase`, `.env.relay`, `.env.cron`.
  - **Test it the same way:** `$env:JL_BACKEND = "pg"` makes `app/dev/server.js` (and so e2e/speed/room) run on this back end with PGlite (in-memory Postgres). Both back ends must pass everything.

## Shipping a change
1. Branch from `main` and edit `app/src/`. Then run `node app/build.js`.
2. Run the tests:
   - **Main suite:** `node app/dev/e2e.js <scratch folder>` (e.g. `/tmp/shots`). The argument is where screenshots go, never `join/`. It must be **all ✓**: 379 checks at handover.
   - **Other harnesses:**
     - `dev/speed.js`: must print ALL INSTANT.
     - `dev/room.js`: busy room, 20 check-ins; `CPU=10` for a slow phone.
     - `dev/move-test.js`: address moves.
     - `dev/book.js`: booking a presentation after the call (both back ends, 49 checks).
   - **Needs:** Node 22+ and Playwright with Chromium (`npm i -g playwright && npx playwright install chromium`). `pdftotext` is optional.
   - **On Angad's PC (PowerShell):** Playwright is installed in `%LOCALAPPDATA%\jl-recruitment-tools`, so first run `$env:NODE_PATH = "$env:LOCALAPPDATA\jl-recruitment-tools\node_modules"`. Run the harnesses one at a time: with `speed.js` running alongside, an e2e step (Chase → Nudge all) once timed out. Alone, e2e passes 379/379 on UK time and on UTC. Git is at `%LOCALAPPDATA%\Programs\Git\cmd\git.exe` (not on PATH in older shells). This clone has `core.autocrlf=false`: keep files LF, or the build's version hash changes. `private/` (ignored locally) holds files that must never go in this public repo.
   - **Test browser clocks** follow the fake server clock (`setTime`), so tests don't depend on today's real date.
3. Commit, open a PR, merge. Vercel picks up `main` by itself within about a minute.
4. **`Code.gs` changes go live on merge**, because Vercel runs it. Angad only pastes it into Apps Script when a `relay*` function (the Google-only part) changes. On 23 Oct he was asked to paste for a welcome-email wording change; it did no harm, but it wasn't needed. When a paste is needed, give him:
   - the commit-pinned link `https://raw.githubusercontent.com/angadclaude/recruitment/<merge-sha>/app/src/Code.gs`;
   - the steps: Sheet → Extensions → Apps Script → `Code.gs` → select all → paste → Save → **Deploy → Manage deployments → ✏️ → New version → Deploy**.
5. The repo is **public**. Never commit secrets, passwords or internal business documents.

## Rules
- **Bookers** see only their own candidates. **Admins** see everyone. **Presenters** see everyone else's candidates as name, who booked them and room rating only.
- **Onboarding** (Databyte, welcome email) is for admins only.
- **The recruitment team** (`THANKS_TEAM` + `RECRUIT_TEAM` in `Code.gs`) send thank-yous, Day 1 details and follow-ups as LINK or JUSS, signed with their own name, and the welcome emails. Everyone else follows the candidate's company. **Only Jess and Rubal since 26 Oct** (Angad: Fiza off): `RECRUIT_TEAM` is empty; e2e puts an address back in it to keep testing it.
- **Outcome deadline** is Friday 18:00 (later outcomes are marked LATE).
- **Day 1 tab and New Starts List order (always, Angad 25 Oct):** JUSS on top, LINK below; in each company Monday's starters then Tuesday's, by name, no-shows at the bottom (`d1Order`). That's the default; the tab can also sort *Name A–Z* and show one campaign (`d1View`), and the PDF follows what's on screen.
- **Campaign = where a starter is placed, FR or HF, per person (27 Oct).** The default is their company's (JUSS = HF, LINK = FR). An admin switches it in one tap on the Day 1 row (`setCampaign`, `campaign` column, `campaignOf` on server and app).
  - Angad's 26 Oct rule "JUSS = HF always" didn't match his own printed list: 6 of the 12 JUSS starters who arrived went to FR (orange = FR, pink = HF on the team's highlighter).
  - The Day 1 list, its PDF, availability, the poster and the results all follow the placement.
- **The numbers mean one thing everywhere (Angad, 26 Oct: "I don't want to explain this again"):**
  - **Checked in** = everyone.
  - **Attended / appointments** = rated in the room (walk outs too), Mon–Fri, **minus non-qualifiers**, the incentive's net (`counted(c) && !c.pay_reason`).
  - **Non-qualifiers** = came in but don't count (`notCounting`: not eligible, repeat, removed by admin).
  - **Checked in = attended + non-qualifiers + not rated.**
  - Applies to Today, the daily poster and its Top performers, the Friday weekly total, Week top 5, Appts Attended (hero *Attended*, the *Bookers + booked by admins + no booker yet* line, rows say *checked in*), the Appointments total PDF (cells and total net, non-qualifiers in their own column), the 18:00 booker alert, and the Friday week and team roundups.
  - `figuresAgree` in e2e checks every one of them against each other for two weeks. Any new figure must use these definitions and join that check.
- **Bulletin (Angad, 26 Oct; he doesn't want to repeat these):**
  - **Recognition is always 2 and above.** Only bookers with 2+ are named on Top performers, daily and Week top 5 (`dailyRows`, `weeklyRows`).
  - **The numbers always add up.** *First appointments attended* = counted minus non-qualifiers = the sum of the Top performers lines. Everyone with 1 is counted on one unnamed line (*+ 8 more bookers, 1 each*), plus *❓ No booker yet*.
  - *Non-qualifiers* = Today's **Non-qual** (`notCounting`).
  - e2e checks all of this.
- **Someone who leaves (Angad, 26 Oct):** `CONFIG.HANDOVER` credits their *new* check-ins to whoever took over, until a date: typed names (`matchBooker(typed, day)`), picks from an out-of-date list (`liveBooker`), and their name in the check-in list. After the date: no booker, and an admin sets it. Nobody switched off is ever credited. **Alerts** about their candidates go to whoever took over (`successorOf` in `notify`, no end date). **Now: Fiza → Angad until Sun 1 Nov 2026** (company = Angad's, LINK, so FR).
- **Who booked an appointment never changes after the fact (Angad, 27 Oct).** Past weeks must read exactly as they happened. Only an admin's manual **Booker → Save** (a correction) moves one. PR #140 broke this: it moved Fiza's open candidates to Angad, so w/e 25 Oct showed Angad with appointments he never had. `undoHandoverOpen` put them all back once (PR #141), and e2e proves a leaver's week reads identically before and after they leave.
- **Other things Angad has settled (don't re-ask):**
  - **Day 1 reminders** name one company, the candidate's (`brandOf`), never "LINK Marketing and JUSS Marketing".
  - **Day 1** has a **Dropped out** option (two taps, Undo), left out of counts and onboarding.
  - **New Starts List:** *Closed by* comes after *Booked by*.
  - **Today's summary:** Checked in · Non-qual · Rated · Evaluated · To call.
  - **The booking confirmation** says "approximately 60–90 minutes". There's one confirmed state (⏳ Not confirmed yet / ✅ Mark as confirmed).
  - **Book Appts:** day by day with ‹ ›, or the week. Each has PDFs: who was booked and who came. Chase has a week PDF of who hasn't responded.
- **"Thinking it over"** needs a call-back time. **"No answer" / "Thinking it over"** older than 2 weeks shows as 🔴 Stale on Chase until a final answer is logged.
- **GDPR:** full details for 12 weeks, then trimmed (notes and answers wiped, the call log's notes too). Everything is deleted after 6 months.
- **Never:** paste passwords in chat; log into Cube; pull IQ Suite / Acwyre data without Angad's sign-off; recreate the old web-app mailer (welcome emails go through Gmail "send mail as" from Apps Script).

## NEXT TASK: one ecosystem, released in one go (Angad, 18 Oct 2026)
He asked for J&L to be "an entire ecosystem" with his playbooks (FR `link-fr-playbook.vercel.app`, Leaders `link-leaders-playbook.vercel.app`, JUSS Playbook `juss-playbook.vercel.app` (was `juss-hf-playbook.vercel.app`, which still works), all on the same Supabase) without losing anything. He chose:
- **Everything in one go.** Build and rehearse it all behind the scenes, then switch on one quiet day.
- **One login for all apps:** work email + 6-digit code.
- **The immersive look** of the playbooks. A separate session may do this on its own branch and must not merge before switch day.

Status:
1. Welcome emails link to the Vercel playbooks: done (PR #77, Apps Script version 34).
2. Supabase back end: built (above). e2e passes on both back ends.
3. Still to do:
   - set Vercel's environment variables (needs Angad's OK);
   - deploy `Code.gs` with the relay to Apps Script;
   - rehearsal import plus a preview test (`REHEARSAL=1`: emails only to Angad, no phone alerts);
   - the one-login hub;
   - the look;
   - switch day.

**Order (Angad, 18 Oct):** switch the invisible back end first, once he has tried the rehearsal (branch `switch-to-supabase`, preview `https://jl-recruitment-git-switch-to-supabase-angadclaude.vercel.app`, REHEARSAL=1). Then release the new look and the one login together.

**Switch-day runbook:** `scripts/switch.js` (needs Apps Script on the relay version of `Code.gs`, version 35+). `node scripts/switch.js status` shows where things stand at any time.
1. `node scripts/switch.js freeze`: Google stops saving, its timers stop, and phones retry by themselves. Wait 60 s for any running timer to finish.
2. `node scripts/import-from-google.js --apply`. It must report **0 mismatches**.
3. `node scripts/switch.js live`: Vercel's API answers and its timers run.
4. `node scripts/switch.js forward`: Google passes every request on to Vercel (old open tabs keep working).
5. Merge the `switch-to-supabase` PR (`join/config.js` `API_URL: '/api/rpc'`). Every merge needs Angad's OK in chat.
6. Check: log in, Today / Chase / Day 1, a test check-in, an alert to Angad's phone, the Log in Supabase.

**Undo:** `unforward`, `notlive`, `unfreeze`, and revert `config.js`. Google's data is untouched from step 1 onwards, but anything saved on Vercel after the switch would need copying back.

**One login, findings:** FR (73 users) and Leaders (93) all have emails. HelloFresh has 295 users and only 46 have email usernames, so the hub needs a one-time "connect your old account" step (old username + password once).

## Done: hosting moved to Vercel (18 Oct 2026)
Angad wants all his apps on Vercel so they link into each other (the FR playbook is at `link-fr-playbook.vercel.app`). Vercel team "Link Marketing" is on **Pro**, so the Hobby plan's non-commercial rule doesn't apply.

`app/move.js` forwards the old address to the new one (`node app/dev/move-test.js` proves it):
- same page and same link (`?c=`, `?t=`, welcome links, slide QR codes);
- people stay logged in (carried in the `#`, which never reaches a server);
- it holds back on a phone that still has saves waiting to reach Google.

What was done:
1. **Vercel:** the GitHub app is installed on `angadclaude` (all repositories). `angadclaude/recruitment` was imported as `jl-recruitment` (Framework: Other) through the **Git-connected** import, never `vercel deploy` from a folder, so every merge deploys.
2. **The app points at it:** `app/site.json` (`url` + `movedFrom`), `CONFIG.PUBLIC_URL` in `Code.gs`, `SETUP.md`, `README.md`. The e2e and screenshot scripts read the address from `site.json`.
3. **After the merge, Angad's part:**
   - he pastes `Code.gs` (pinned link, New version); from then on welcome links, alert taps, slide QR codes and email images use Vercel;
   - OneSignal: the app's Settings → Push & In-App → Web → **Site URL** = `https://jl-recruitment.vercel.app` (same App ID, so `join/config.js` doesn't change). Alerts are tied to the web address, so everyone turns them on again once; **Team → Alerts check** shows who hasn't.
   - phone check: the old link opens the Vercel app still logged in, alerts turn on, Today / Chase / Day 1 load.
4. **Team message** (short, WhatsApp-style): open the new link (still logged in) → **Turn on alerts** → add it to the home screen again and delete the old icon.

Old links keep working through the forward, so nothing has to be reprinted.

## Done: booking a presentation after the call (23 Oct 2026)
Jess, Rubal and Angad (`CONFIG.BOOK_TEAM`) book Teamtailor applicants into a Mon–Fri 10:00 presentation from the **Book Appts** tab (`viewBook`; for them Team moves into the menu, 7 tabs don't fit a phone). Data: the **Bookings** tab (made by itself the first time it's needed, `newTab`). The app writes three WhatsApp messages in the thank-you's style, no hearts, signed by the sender, "In association with JUSS Marketing Ltd" (`msgBookConfirm`, `msgBookRemind`, `msgBookMissed` in `JS.html`; Angad approved the wording). Alerts: 18:00 the evening before (`maybeBookingReminders`, `?c=bookrem` opens the send list) and 10:30 on the day (`maybeMissedBookings`). Check-in matches the booking by mobile (`bookingFor`): the booking's booker wins, `brand` = JUSS, `booking_note` shows to the presenter. Show-up card on Appts Attended (admins, `showupFor`). On a computer every wa.me button copies the message and opens the chat empty (`IS_DESKTOP` listener next to `waUrl`): WhatsApp's desktop app turns pre-filled emojis into "�". CONFIRM like Day 1: each booking has a `confirm_token`; the messages link to `booked.html?t=…&n=…&d=…` (`startBooked` / `renderBooked`, public `bookingInfo` / `confirmBooking`, the booker gets an alert). The office robot (`office-texting` branch) is on hold.

## Done: new starters' availability, Week 1 and Week 2 (27 Oct 2026)
This replaces the "Juss & Link - NS Availability - 2026" Google Sheet (a W1 / Pics / W2 tab per week since Jan 2025) and the Canva poster. Angad: "the app becomes the all-in-one go-to". **The app is the one place now**; the Sheet stays as the archive of old weeks, and nobody re-creates tabs.
- **Where:** Day 1 tab → **🗓️ Availability · Week 1 & Week 2**, and the account menu → **🗓️ New starters' availability** for everyone (`viewAvail`).
- **Data:** `Availability` + `StarterPhotos` tabs (`availRows`, `availWeek`, `saveAvail`, `addStarter`, `removeStarter`, `saveStarterPhoto`, `availPhotos`).
  - **Rows:** everyone ticked **Arrived** on Day 1 gets a row by themselves (cohort = their Day 1 week), plus anyone added by hand ("someone who started without the app").
  - **Fields:** name and mobile are copied in. Coach = whoever booked them (if that person has left, whoever took over). Driver, Week 1 and Week 2 as `w1` / `w2` (7 letters Mon–Sun: I in / O out / - not said), notes, photo (360 px JPEG under 48k characters).
- **Angad's decisions (27 Oct, don't re-ask):**
  - **Who fills it in:** the one-to-one on Day 1 is done by Angad, Satpal or someone they delegate. Editors are `canAvail` = admins plus anyone ticked **Availability** in Team.
  - **Everyone can view, phone numbers included**, like the sheet.
  - **Kept for good:** numbers, notes and photos. The 6-month clear-out only touches Candidates.
  - **Pictures:** a photo of each starter; the app makes the poster (`drawStarters` in `Bulletin.html`: "Welcome our new starters", HelloFresh then Fundraising, photo, name, coach).
- **Extras:**
  - per-day headcount with 🚗 drivers;
  - "N with no Week 1 days yet" on screen;
  - an 18:00 alert to the editors (`maybeAvailReminder`, Mon–Sat, once a day);
  - "Said 5 days, in 3" against their evaluation answer (`q6_days`);
  - their coach gets an alert when days change after the first fill;
  - a PDF like the sheet (`availPdf`, "NS Availability W1 w-e dd.mm.yyyy").
- **e2e section "availability"** covers all of it, on both back ends.

## Done: the morning after Day 1 (27 Oct 2026)
Every Tuesday the team brought Angad the printed New Starts List marked up by hand:
- pink highlighter = HF, orange = FR;
- struck through = didn't start (NI, not confirmed, no-show), or arrived but didn't come back;
- a tally of starts by booker ("Office 5 · Hasini 3 · Ramis 2 …") and "NDCS 9 / HF 6".

The app now does all of it, and **he decided the flow is mine to set**:
1. **Monday, in the room:** Day 1 tab, as before: Arrived / No-show / 🚫 Dropped out (NI). Plus the **FR | HF** switch on each row.
2. **Next morning:** **🚪 Didn't continue** (two taps, Undo) on anyone who came on Day 1 but not back (`markDay1` `left` / `stayed`, columns `day1_left_at` / `_by`). They still count as a Day 1 start, and they drop off availability.
3. **09:00 the morning after a Day 1:** admins get the results (`maybeDay1Results`, `D1_RESULTS_TIME`; tap opens Day 1). The first one is for Day 1 Mon 2 Nov (`D1_RESULTS_FROM`): 26 Oct's FR / HF were only on paper, so an alert for it would have shown the wrong split.
   - "🎓 Day 1 Monday 26th October: 15 of 23 started"
   - "FR 9 · HF 6 · 2 didn't continue"
   - "Office 5 · Hasini 3 …"
   - "Didn't start: 4 dropped out, 3 didn't confirm, 1 no-show"
4. **The Day 1 tab** shows the same results card per day (`d1Results` in the app = `day1Results` on the server; keep them identical).
5. **From the next day, 📄 New Starts List comes out marked up:** rows in their campaign's colour, struck through for anyone who didn't start or didn't continue, Arrived = Left / No, and the results underneath. On the day itself it's still the plain sign-in sheet.

- **"Office"** = bookings by admins, or by anyone in `CONFIG.OFFICE_BOOKERS` (Fiza Iqbal), as in the team's tally (`isOffice`; `office` flag in `shape`).
- **Fix their name** (admins, on their page, `fixName`) updates availability too. The 26 Oct list had "Mel Anouman" corrected to "Mel Abraham" by hand.
- **Not built, ask if needed:** the ✓ ticks the team put next to some pink (HF) rows. Meaning unknown.

## Data fixes Angad asked for
- **26 Oct 2026:** Fiza's 2 appointments that day were Angad's (he entered them under her by mistake). Angad moved both himself (candidate → **Booker** → Angad → **Save**, `reassignBooker`, which also moves the candidate's company to the booker's). The rest of that week is automatic (`HANDOVER`, above). Her earlier candidates stay hers, and their alerts go to Angad (the PR #140 move was undone on 27 Oct, see Rules).

## Open items (ask Angad when relevant)
- **Optional:** auto-deploy `Code.gs` from GitHub with `clasp`, to remove the paste step. It needs the Apps Script API turned on and a `CLASPRC_JSON` GitHub secret, which he sets himself and never pastes in chat.
- The full team guide is `app/SETUP.md`.
