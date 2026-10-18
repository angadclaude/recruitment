# J&L Recruitment App: handover for Claude

The recruitment app for **LINK Marketing** and **JUSS Marketing** (Angad runs both). It covers check-in QR, the presenter's room rating and notes, the candidate's evaluation, the booker's call outcomes and call log, Chase, Day 1 (New Starts List, reminders, arrivals), new-starter onboarding, the incentive, and phone alerts. About 80 people use it: admins (Angad, Jess, Satpal, Rubal), the recruitment team (Jess, Rubal, Fiza), bookers and presenters. Built in a Claude Code cloud session from 12 to 18 Oct 2026, then handed to Angad's Windows PC: since 18 Oct 2026 it's looked after from the folder `Desktop\Claude playground\J&L Recruitment App` (this repo's clone).

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
- **The Supabase back end (built 18 Oct 2026, not live until switch day):** the same `Code.gs` runs on Vercel, unchanged.
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
   - **Needs:** Node 22+ and Playwright with Chromium (`npm i -g playwright && npx playwright install chromium`). `pdftotext` is optional.
   - **On Angad's PC (PowerShell):** Playwright is installed in `%LOCALAPPDATA%\jl-recruitment-tools`, so first run `$env:NODE_PATH = "$env:LOCALAPPDATA\jl-recruitment-tools\node_modules"`. Run the harnesses one at a time: with `speed.js` running alongside, an e2e step (Chase → Nudge all) once timed out. Alone, e2e passes 379/379 on UK time and on UTC. Git is at `%LOCALAPPDATA%\Programs\Git\cmd\git.exe` (not on PATH in older shells). This clone has `core.autocrlf=false`: keep files LF, or the build's version hash changes. `private/` (ignored locally) holds files that must never go in this public repo.
   - **Test browser clocks** follow the fake server clock (`setTime`), so tests don't depend on today's real date.
3. Commit, open a PR, merge. Vercel picks up `main` by itself within about a minute.
4. **If `Code.gs` changed**, Angad has to paste it (there's no auto-deploy yet). Give him:
   - the commit-pinned link `https://raw.githubusercontent.com/angadclaude/recruitment/<merge-sha>/app/src/Code.gs`;
   - the steps: Sheet → Extensions → Apps Script → `Code.gs` → select all → paste → Save → **Deploy → Manage deployments → ✏️ → New version → Deploy** → close and reopen the app.
   - Verify with the Sheets connector where you can, e.g. new columns appearing.
5. The repo is **public**. Never commit secrets, passwords or internal business documents.

## Rules
- **Bookers** see only their own candidates. **Admins** see everyone. **Presenters** see everyone else's candidates as name, who booked them and room rating only.
- **Onboarding** (Databyte, welcome email) is for admins only.
- **The recruitment team** (`THANKS_TEAM` + `RECRUIT_TEAM` in `Code.gs`) send thank-yous, Day 1 details and follow-ups as LINK or JUSS, signed with their own name. Everyone else follows the candidate's company.
- **Outcome deadline** is Friday 18:00 (later outcomes are marked LATE).
- **"Thinking it over"** needs a call-back time. **"No answer" / "Thinking it over"** older than 2 weeks shows as 🔴 Stale on Chase until a final answer is logged.
- **GDPR:** full details for 12 weeks, then trimmed (notes and answers wiped, the call log's notes too). Everything is deleted after 6 months.
- **Never:** paste passwords in chat; log into Cube; pull IQ Suite / Acwyre data without Angad's sign-off; recreate the old web-app mailer (welcome emails go through Gmail "send mail as" from Apps Script).

## NEXT TASK: one ecosystem, released in one go (Angad, 18 Oct 2026)
He asked for J&L to be "an entire ecosystem" with his playbooks (FR `link-fr-playbook.vercel.app`, Leaders `link-leaders-playbook.vercel.app`, JUSS HelloFresh `juss-hf-playbook.vercel.app`, all on the same Supabase) without losing anything. He chose:
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

## Open items (ask Angad when relevant)
- Should Fiza (`recruitment@jussmarketing.co.uk`) get the new-starter / 12:00 / 10:00 alerts that Jess and Rubal get?
- Fiza's Gmail "Send mail as" plus running `setupWelcomeEmail`, so she can send welcome emails.
- **Optional:** auto-deploy `Code.gs` from GitHub with `clasp`, to remove the paste step. It needs the Apps Script API turned on and a `CLASPRC_JSON` GitHub secret, which he sets himself and never pastes in chat.
- The full team guide is `app/SETUP.md`.
