# J&L Recruitment App: handover for Claude

The recruitment app for **LINK Marketing** and **JUSS Marketing** (Angad runs both). It covers check-in QR, the presenter's room rating and notes, the candidate's evaluation, the booker's call outcomes and call log, Chase, Day 1 (New Starts List, reminders, arrivals), new-starter onboarding, the incentive, and phone alerts. About 80 people use it: admins (Angad, Jess, Satpal, Rubal), the recruitment team (Jess, Rubal, Fiza), bookers and presenters. Built in a Claude Code cloud session from 12 to 18 Oct 2026, then handed to Angad's computer.

**Working with Angad:** he's not technical and usually on his phone. Give plain English, the exact clicks, and links. Be direct. Stress-test his ideas and tell him if one is weak. Show the data. Never send him code to edit by hand except pasting `Code.gs` (below).

## How it fits together
- **`app/src/`**: the source.
  - `Code.gs` is the server: Google Apps Script bound to the Google Sheet (ID in `app/SETUP.md`). All the data and rules live there.
  - `JS.html`, `Styles.html`, `Logos.html`, `QR.html` and `Bulletin.html` are the app.
- **`app/build.js`**: builds the static app into **`join/`** (committed; hosting serves it as-is, with no build step). Run `node app/build.js` after every change under `app/src/`.
- **`join/config.js`**: the Apps Script web app URL and the OneSignal App ID. The build never overwrites it.
- **Hosting:**
  - Now: GitHub Pages at `https://angadclaude.github.io/recruitment/join/`.
  - Moving to Vercel (next task). `vercel.json` at the root serves `join/`.
  - Where the app lives is set in `app/site.json`.
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
   - **Needs:** Node 22 and Playwright with Chromium (`npm i -g playwright && npx playwright install chromium`). `pdftotext` is optional.
   - **Test browser clocks** follow the fake server clock (`setTime`), so tests don't depend on today's real date.
3. Commit, open a PR, merge. Hosting picks up `main` by itself within about a minute.
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

## NEXT TASK: move hosting to Vercel (Angad asked on 18 Oct)
He wants all his apps on Vercel so they link into each other. The FR playbook is at `link-fr-playbook.vercel.app`.

Everything is prepared and tested. `app/move.js` forwards the old address to the new one:
- same page and same link (`?c=`, `?t=`, welcome links, slide QR codes);
- people stay logged in (carried in the `#`, which never reaches a server);
- it holds back on a phone that still has saves waiting to reach Google.

`node app/dev/move-test.js` proves it.

1. **Vercel (his browser):** Add New → Project → Import Git Repository → `angadclaude/recruitment`. If it isn't listed, use Adjust GitHub App Permissions. Project name `jl-recruitment` (or his choice). Framework: Other. Deploy.
   - It must be the **Git-connected** import, never `vercel deploy` from a folder, so every merge deploys.
   - Check `https://<name>.vercel.app/index.html` (login screen) and `/checkin.html`.
2. **Point the app at it:**
   - **`app/site.json`:** set `"url": "https://<name>.vercel.app/"` and `"movedFrom": ["https://angadclaude.github.io/recruitment/join/"]`.
   - **`app/src/Code.gs`:** set `CONFIG.PUBLIC_URL` to the same Vercel URL. The build warns if they differ.
   - **`SETUP.md` / `README.md`:** update the links.
   - **Then** run `node app/build.js`, the e2e suite and `move-test.js`. Commit, PR, merge.
3. **Angad pastes `Code.gs`** (pinned link, New version). From then on, welcome links, alert taps, slide QR codes and email images use Vercel.
4. **OneSignal (his browser):** the app's Settings → Push & In-App → Web → change the **Site URL** to the Vercel address and save. Keep the same App ID, so `join/config.js` doesn't change. Alerts are tied to the web address, so everyone turns them on again once.
5. **Check on his phone:**
   - the old link opens the Vercel app, still logged in;
   - alerts can be turned on;
   - Today, Chase and Day 1 load.
6. **Message for the team** (draft it for him, short, WhatsApp-style):
   - "Open the app from this link: <new link>. You're still logged in."
   - "Tap **Turn on alerts**."
   - "Add it to your home screen again (⋮ → Add to Home screen / Share → Add to Home Screen) and delete the old icon."
   - He can see who hasn't turned alerts back on in **Team → Alerts check**.
7. **Best timing:** a quiet day, not during a presentation. Old links keep working through the forward, so nothing has to be reprinted.
8. **Plan check:** Vercel's free Hobby plan is for non-commercial use only; these are business apps. Make sure he knows (Pro is per member per month).

## Open items (ask Angad when relevant)
- Should Fiza (`recruitment@jussmarketing.co.uk`) get the new-starter / 12:00 / 10:00 alerts that Jess and Rubal get?
- Fiza's Gmail "Send mail as" plus running `setupWelcomeEmail`, so she can send welcome emails.
- **Optional:** auto-deploy `Code.gs` from GitHub with `clasp`, to remove the paste step. It needs the Apps Script API turned on and a `CLASPRC_JSON` GitHub secret, which he sets himself and never pastes in chat.
- The full team guide is `app/SETUP.md`.
