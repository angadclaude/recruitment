// Every page's own errors, all the way through a harness run (11 Nov): an exception the app didn't catch (a screen that broke)
// and anything it wrote to console.error. The checks prove what they look at; this catches the screen nobody was looking at.
// Usage: const pageErrors = require('./watch').watch(browser) straight after chromium.launch(), then
//        require('./watch').report(pageErrors) before the final line (throws when there's one that isn't expected).
'use strict';

// Expected in the tests themselves: a page with no signal (the offline check-ins), a request cut off when a test closes or
// reloads a page mid-call, and the test browser's own clock script being refused by the welcome email preview (that frame is
// sandboxed with no scripts, as it should be: the email itself has none).
const EXPECTED = [/Failed to load resource/i, /net::ERR_/i, /Failed to fetch/i, /NetworkError/i, /Load failed/i, /The network connection was lost/i, /AbortError/i,
  /Blocked script execution in 'about:srcdoc'/];

function watch(browser) {
  const seen = [];
  const add = (kind, text, page) => { let url = ''; try { url = page ? page.url() : ''; } catch (e) { /* closed */ } seen.push({ kind, text: String(text), url }); };
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...a) => {
    const ctx = await newContext(...a);
    ctx.on('weberror', e => { const x = e.error(); add('exception', (x && (x.stack || x.message)) || x, e.page()); });
    ctx.on('console', m => { if (m.type() === 'error') add('console.error', m.text(), m.page()); });
    return ctx;
  };
  return seen;
}

/** Another site's page, opened by a tap in a test (💬 Send opens wa.me in a new tab, which becomes WhatsApp's own page): what that
 *  site logs isn't a screen of ours (12 Nov: WhatsApp's page logged a Content Security Policy line and the run failed on it). */
function elsewhere(x) { return /^https?:\/\//.test(x.url) && !/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(x.url); }

/** Prints what was seen; throws on anything that isn't an expected network line. */
function report(seen) {
  const other = seen.filter(elsewhere).length;
  seen = seen.filter(x => !elsewhere(x));
  if (other) console.log('  (' + other + ' line' + (other === 1 ? '' : 's') + ' from other sites\' own pages left out: WhatsApp\'s page, opened by a Send tap)');
  const real = seen.filter(x => x.kind === 'exception' || !EXPECTED.some(re => re.test(x.text)));
  const by = {};
  real.forEach(x => { const k = x.kind + ' · ' + x.text.split('\n').slice(0, 3).join(' ⏎ ').slice(0, 400) + ' · ' + x.url.replace(/^https?:\/\/[^/]+/, '').slice(0, 80); by[k] = (by[k] || 0) + 1; });
  Object.keys(by).forEach(k => console.log('  PAGE ERROR ×' + by[k] + ' · ' + k));
  if (real.length) throw new Error(real.length + ' page error(s): a screen threw or logged an error during the run (listed above)');
  console.log('  ✓ no page threw or logged an error, all the way through (' + (seen.length - real.length) + ' expected lines from the tests themselves)');
}

module.exports = { watch, report };
