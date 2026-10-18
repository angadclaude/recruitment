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

## Shipping a change
1. Branch from `main` and edit `app/src/`. Then run `node app/build.js`.
2. Run the tests:
   - **Main suite:** `node app/dev/e2e.js <scratch folder>` (e.g. `/tmp/shots`). The argument is where screenshots go, never `join/`. It must be **all ✓**: 379 checks at handover.
   - **Other harnesses:**
     - `dev/speed.js`: must print ALL INSTANT.
     - `dev/room.js`: busy room, 20 check-ins; `CPU=10` for a slow phone.
     - `dev/move-test.js`: address moves.
   - **Needs:** Node 22+ and Playwright with Chromium (`npm i -g playwright && npx playwright install chromium`). `pdftotext` is optional.
   - **On Angad's PC (PowerShell):** Playwright is installed in `%LOCALAPPDATA%\jl-recruitment-tools`, so first run `$env:NODE_PATH = "$env:LOCALAPPDATA\jl-recruitment-tools\node_modules"; $env:TZ = "UTC"`. The test clocks were written on a UTC machine: on UK time one e2e step (Chase → Nudge all) times out. Git is at `%LOCALAPPDATA%\Programs\Git\cmd\git.exe` (not on PATH in older shells). This clone has `core.autocrlf=false`: keep files LF, or the build's version hash changes. `private/` (ignored locally) holds files that must never go in this public repo.
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
