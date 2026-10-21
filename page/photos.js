'use strict';
// Photos tab: full screen pictures, from the Frameo app's folder (through the kiosk app) and/or cfg.photos URLs.
// Every photo fills the screen; two portraits share it side by side. Tap the left or right quarter for the
// previous or next photo, the middle to go back home.

function isPortrait(d) { return !!d && d.h > d.w; }

// What one screen shows from position `at`: a landscape alone, or a portrait with the next portrait found within
// `look` photos, side by side. dims: url -> { w, h } for the photos loaded so far.
function slide(order, at, dims, look) {
  var first = order[at];
  if (!isPortrait(dims[first])) return [first];
  for (var k = 1; k <= look && k < order.length; k++) {
    var u = order[(at + k) % order.length];
    if (isPortrait(dims[u])) return [first, u];
  }
  return [first];
}

// Fisher-Yates with an injectable random, so the order is testable.
function shuffled(list, rnd) {
  var a = list.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor((rnd || Math.random)() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function photosTab(ctx) {
  var cfg = ctx.cfg;
  var $ = ctx.$;
  var kiosk = typeof window !== 'undefined' && window.Kiosk && window.Kiosk.photos ? window.Kiosk : null;
  var extra = photoUrls({ host: cfg.host, background: cfg.photos });
  var seconds = cfg.photoSeconds || 60;
  var order = [];
  var at = 0;
  var timer = null;
  var listedAt = 0;

  if (!kiosk && !extra.length) $('nav-photos').style.display = 'none';

  function list() {
    var own = [];
    if (kiosk) { try { own = JSON.parse(kiosk.photos()); } catch (x) { own = []; } }
    return own.concat(extra);
  }

  // Re-read the folder at most every 10 min, keeping the photo on screen first.
  function refresh() {
    if (order.length && Date.now() - listedAt < 10 * 60000) return;
    listedAt = Date.now();
    var cur = order[at];
    order = shuffled(list());
    var i = order.indexOf(cur);
    if (i > 0) { order.splice(i, 1); order.unshift(cur); }
    at = 0;
  }

  var LOOK = 6;
  var dims = {};     // url -> { w, h }, or null when it failed to load
  var shownCount = 1;
  var showing = 0;   // bumps on every show(), so a slow load cannot draw over a newer one

  function measure(url, done) {
    if (url in dims) { done(); return; }
    var img = new Image();
    img.onload = function () { dims[url] = { w: img.naturalWidth, h: img.naturalHeight }; done(); };
    img.onerror = function () { dims[url] = null; done(); };
    img.src = url;
  }

  // Measure the current photo, and when it is a portrait the next few, then draw the slide.
  function show() {
    var token = ++showing;
    var first = order[at];
    $('ph-empty').style.display = first ? 'none' : '';
    if (!first) return;
    var k = 0;
    function next() {
      if (token !== showing) return;
      if (dims[first] === null) { if (order.length > 1) step(1); return; }
      var s = slide(order, at, dims, LOOK);
      var more = isPortrait(dims[first]) && s.length === 1 && k < LOOK && k < order.length - 1;
      if (!(first in dims) || more) {
        var u = first in dims ? order[(at + ++k) % order.length] : first;
        measure(u, next);
        return;
      }
      draw(s);
    }
    next();
  }

  function draw(s) {
    // Move the partner up next to the first photo, so stepping on skips exactly what was shown.
    if (s.length === 2) {
      var j = order.indexOf(s[1]);
      var n = (at + 1) % order.length;
      if (j !== n) { order[j] = order[n]; order[n] = s[1]; }
    }
    shownCount = s.length;
    $('ph-a').src = s[0];
    if (s[1]) $('ph-b').src = s[1];
    $('view-photos').className = 'view' + (s.length === 2 ? ' pair' : '');
  }

  function step(d) {
    if (!order.length) return;
    at = (at + (d > 0 ? shownCount : -1) + order.length) % order.length;
    show();
  }

  $('view-photos').onclick = function (ev) {
    var x = ev.clientX;
    if (x < 320) step(-1);
    else if (x > 960) step(1);
    else ctx.showView('home');
  };

  return {
    onView: function (v) {
      $('stale').style.visibility = v === 'photos' ? 'hidden' : '';
      clearInterval(timer);
      timer = null;
      if (v !== 'photos') return;
      refresh();
      show();
      timer = setInterval(function () { step(1); }, seconds * 1000);
    },
  };
}
