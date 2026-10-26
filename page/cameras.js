'use strict';
// Caméras tab: RTSP streams from cfg.cameras ([{ name, url }]), up to four in a 2x2 grid; a tap on one shows it full
// screen, another tap goes back to the grid. A page cannot play RTSP, so the kiosk app plays each stream with Android's
// own player over the tile this tab reserves for it, draws the names and states, and reports taps as camTap(slot).

// cfg.cameras -> [{ name, url }] with an rtsp:// url, at most four; anything else is dropped.
function cameraList(cfg) {
  return (cfg.cameras || []).filter(function (c) { return c && /^rtsp:\/\//.test(c.url || ''); }).slice(0, 4)
    .map(function (c, i) { return { name: c.name || 'Caméra ' + (i + 1), url: c.url }; });
}

function camerasTab(ctx) {
  var $ = ctx.$;
  var setHTML = ctx.setHTML;
  var esc = ctx.esc;
  var cams = cameraList(ctx.cfg);
  var kiosk = typeof window !== 'undefined' && window.Kiosk && window.Kiosk.playRtsp ? window.Kiosk : null;
  var full = -1;      // the camera shown full screen, -1 for the grid
  var showing = false;

  if (!cams.length) $('nav-cameras').style.display = 'none';
  // Fewer cameras use the space: one fills it, two sit side by side.
  $('cam-grid').className = 'n' + Math.min(cams.length, 4);
  setHTML('cam-grid', cams.map(function (c) {
    return '<div class="cam-tile"><span>' + esc(c.name) + '</span></div>';
  }).join('') + (kiosk ? '' : '<div id="cam-msg">Les flux RTSP se lisent dans l’app du cadre.</div>'));

  function layout() {
    if (!kiosk || !cams.length) return;
    $('view-cameras').className = 'view' + (full >= 0 ? ' full' : '');
    var tiles = $('cam-grid').children;
    cams.forEach(function (c, i) {
      if (full >= 0 && i !== full) { kiosk.stopVideo(i); return; }
      var r = full >= 0 ? { left: 0, top: 0, width: 1280, height: 800 } : tiles[i].getBoundingClientRect();
      kiosk.playRtsp(i, c.name, c.url, r.left, r.top, r.width, r.height, 1280);
    });
  }

  // The kiosk app catches taps on the videos (they sit above the page).
  if (typeof window !== 'undefined') window.camTap = function (i) { full = full === i ? -1 : i; layout(); };

  return {
    onView: function (v) {
      if (v === 'cameras') { showing = true; full = -1; layout(); }
      else if (showing) { showing = false; full = -1; $('view-cameras').className = 'view'; if (kiosk) kiosk.stopVideo(-1); }
    },
    // Something opens over the tab (Settings): the videos, drawn above the page, step aside.
    pauseVideo: function () { if (showing && kiosk) kiosk.stopVideo(-1); },
    resumeVideo: function () { if (showing) layout(); },
  };
}
