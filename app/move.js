// Moving the app to a new address (e.g. GitHub Pages → Vercel) without losing anyone.
// app/site.json: "url" = where the app lives now; "movedFrom" = its old addresses. build.js puts the script below at the
// very top of every page. The same files are served at both addresses, so the script works out where it is:
//  - on an old address: forward to the same page at the new one (same ?c= / ?t= link), carrying the login (lr_tok) and,
//    for candidates, who they are (lr_cand) in the #, which never reaches any server. Not while something on this phone
//    is still waiting to reach Google (it sends from here first; the next open moves).
//  - on the new address: take the login from the #, then clear the # from the address bar.
'use strict';
const KEYS = ['lr_tok', 'lr_cand'];
module.exports = function moveScript(to, from) {
  if (!from || !from.length) return '';
  return `<script>(function () {
    var T = ${JSON.stringify(to)}, F = ${JSON.stringify(from)}, K = ${JSON.stringify(KEYS)}, ls;
    try { ls = window.localStorage; } catch (e) { return; }
    try {
      var m = /(?:^#|&)lr_move=([^&]*)/.exec(location.hash);
      if (m) {
        var got = JSON.parse(decodeURIComponent(m[1]));
        K.forEach(function (k) { if (typeof got[k] === 'string' && !ls.getItem(k)) ls.setItem(k, got[k]); });
        history.replaceState(history.state, '', location.href.replace(/#.*$/, ''));
      }
    } catch (e) {}
    var h = location.href;
    for (var i = 0; i < F.length; i++) if (h.indexOf(F[i]) === 0) {
      try { if (JSON.parse(ls.getItem('lr_outbox') || '[]').length || Object.keys(JSON.parse(ls.getItem('lr_sendq') || '{}')).length) return; } catch (e) {}
      var carry = {}, n = 0;
      K.forEach(function (k) { var v = ls.getItem(k); if (v && v !== 'null') { carry[k] = v; n++; } });
      location.replace(T + h.slice(F[i].length).replace(/#.*$/, '') + (n ? '#lr_move=' + encodeURIComponent(JSON.stringify(carry)) : ''));
      return;
    }
  })();</script>`;
};
