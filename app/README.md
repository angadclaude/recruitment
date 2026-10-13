# LINK × JUSS Recruitment App

One place for the whole morning-appointment journey, replacing the handwritten sheet and the shared Google Form.

```
Slide 1 QR → candidate checks in (name, booker type-ahead, 18+, right to work) → 🔔 booker
  → Presenter's phone: Green/Amber/Red, ★1–5, tags, notes (rating = in the room)
Slide N QR → evaluation (same phone straight in · other phone by mobile · or check in now) → 🔔 booker
  → Booker: one-page snapshot → call → outcome + Academy Day 1 date
  → One tap: Gen Z WhatsApp (LINK or JUSS) with a personal welcome page link
  → Candidate taps CONFIRM on their welcome page → 🔔 booker
  → Everything grouped by date / week ending → weekly recruitment incentive (net attended, bookers only — admins don't earn it)
```

**To set it up, follow [SETUP.md](SETUP.md).** Free: Google Apps Script + Sheet (data), GitHub Pages (`/join`), OneSignal (push).

Slide QR codes (permanent): [`docs/qr-1-checkin.png`](docs/qr-1-checkin.png) · [`docs/qr-2-evaluation.png`](docs/qr-2-evaluation.png)

## Files
| Path | What it is |
|---|---|
| `src/Code.gs` | Server: data, rules (flags, recruitment incentive, deadlines, 6-month repeats), logins, push/email alerts, welcome page API, setup, history import |
| `src/JS.html` | The app: check-in, evaluation, welcome page, and the staff app (Today, My candidates, All, Incentive, Team, slide QR codes) |
| `src/Index.html`, `Styles.html`, `Logos.html`, `QR.html` | Page shell, styles, embedded logos, QR generator (qrcode-generator 1.4.4, MIT) |
| `build.js` | Builds the installable app into `/join` (GitHub Pages) from the same `src/` files |
| `assets/` | Icons, Week 1 posters, WhatsApp link-preview cards |
| `../join/` | **Built output, served by GitHub Pages.** `config.js` holds the Apps Script URL + OneSignal App ID |
| `dev/` | Fake Google services, end-to-end browser test, screenshot tour (`shots.js`) |

## Testing locally
```
node app/build.js
NODE_PATH=$(npm root -g) node app/dev/e2e.js ./shots
```
Runs the real `Code.gs` on an in-memory fake of Sheets, Gmail, UrlFetch and so on, then walks the whole journey in a phone-sized browser: 160+ checks covering QR flows, push alerts, WhatsApp messages, the welcome page and confirm, the recruitment incentive, non-qualifiers, repeats, late outcomes, access removal, GDPR deletion, the LINK / JUSS looks and the one-tap actions on the lists.

To see every screen as a LINK user and as a JUSS user (about 40 seconds):
```
NODE_PATH=$(npm root -g) node app/dev/shots.js ./shots-ui
```

## Look
One design system, two brands, taken from the logos: **LINK** = orange + charcoal, **JUSS** = coral → amber → teal.
Staff see their own company's look. Check-in starts in the joint LINK × JUSS look and switches to the booker's company the moment the candidate picks them; the evaluation, thank-you and welcome pages follow the booker's company too.
Fonts: Anton (big titles and numbers) and Oswald (labels), both already used on the bulletin posters, so the app and the WhatsApp posters match.
