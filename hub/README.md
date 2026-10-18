# LINK × JUSS hub: one login for every app

**Address:** `https://link-juss.vercel.app`. A separate Vercel project, `link-juss`, built from this repo's `hub/` folder.

**What it does:**
- You sign in with your work email and a 6-digit code.
- It shows a tile for each app you have an account in: Recruitment, the FR Playbook, the HelloFresh Playbook and the Leaders Playbook.
- It sends you into any of them already signed in.

Angad decided this on 18 Oct 2026:
- The hub's address.
- Old playbook passwords stay as a backup for 1 month.
- Onboarding a new starter in Recruitment opens their playbook automatically.

## How it works
- **Data:** everything lives in the shared Supabase project, in schema `core`:
  - `people`: one row per work email.
  - `codes`: hashed; 10 minutes; 5 tries; 5 sends an hour.
  - `sessions`: hashed tokens in an HttpOnly cookie; 90 days.
  - `handoffs`: one-use, 2-minute tickets for one app.
  - `app_links`: HelloFresh usernames connected by hand.
- **Accounts stay in each app** (`jl` Users tab, `public.users`, `leaders.users`, `hf.users`). The hub finds them by email.
  - HelloFresh usernames that aren't emails are connected once with the old username and password.
- **Signing in to an app:** the app's "Sign in" link goes to `https://link-juss.vercel.app/?app=<id>&r=<path>`.
  - The hub sends you back to the app's hand-off page with `#hub=<ticket>&r=<path>`.
  - The app redeems the ticket in the same database and signs you in its own way:

    ```sql
    update core.handoffs h set used_at = now() from core.people p
     where h.code_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex') and h.app = $2
       and h.used_at is null and h.expires_at > now() and p.id = h.person_id
    returning p.email
    ```

  - Alternatively, with Node, use `redeemHandoff(q, ticket, app)` from `lib/core.js`. Then find the local user by that email (HelloFresh: also via `core.app_links`).
- **Login codes** are emailed from Gmail through the recruitment app's Google relay (`RELAY_URL` / `RELAY_SECRET`).
  - Until `HUB_LAUNCHED=1`, codes only go to `MAIL_ALLOW` (Angad).

## Settings (Vercel → link-juss → Environment Variables; never in this public repo)
`DATABASE_URL`, `DATABASE_PASSWORD`, `RELAY_URL`, `RELAY_SECRET`, `HUB_SECRET` (random; peppers the code hashes), `MAIL_ALLOW`, `HUB_LAUNCHED`.

## Test
- `node hub/dev/test.js`: 31 checks on PGlite with pretend users in each app's tables.
- `node hub/dev/server.js`: local preview at `http://localhost:5190`. Codes print in the console.
